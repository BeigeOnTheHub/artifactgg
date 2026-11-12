import type { Store } from '../app/store';
import type { Player } from '../types/primitives';
import { mapToClient, type Viewport } from './coords';
import { TEAM_COLOURS } from './team-colours';
import { directFrameView, applyItemEffect, type FrameView } from '../app/frameView';
import { getPlayerSizeMode, getPlayerSizeFactor, subscribePlayerSize } from '../app/playerSizePref';
import { STANDARD_ZOOM_100 } from '../app/viewport';

const SVG_NS = 'http://www.w3.org/2000/svg';

const PLAYER_R = 14;
const PLAYER_STROKE_W = 3;

/**
 * The on-screen ring radius for a player node given the live zoom and the user's
 * size preference. Auto mode is a fixed, constant pixel size (the scale slider
 * is greyed out and ignored). Manual mode scales with the map zoom - normalised
 * so the standard 100% zoom matches auto's base size - and the slider factor
 * multiplies that so you can dial the overall size up or down.
 */
export function playerRadiusFor(zoom: number): number {
  if (getPlayerSizeMode() === 'manual') {
    return PLAYER_R * (zoom / STANDARD_ZOOM_100) * getPlayerSizeFactor();
  }
  return PLAYER_R;
}

export interface MapSize { w: number; h: number }

export class PlayerLayer {
  private svg: SVGSVGElement;
  private nodes: Map<string, SVGGElement> = new Map();
  private unsubFrame: () => void = () => {};
  private unsubView: () => void = () => {};
  private unsubSize: () => void = () => {};
  private frameView: FrameView;

  constructor(
    private host: HTMLElement,
    private store: Store,
    _mapSize: MapSize,  // kept in the signature for symmetry with other layers; unused
    private getViewport: () => Viewport,
    frameView?: FrameView,
  ) {
    this.frameView = frameView ?? directFrameView(store);
    this.svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    this.svg.setAttribute('id', 'player-layer');
    this.svg.dataset['testid'] = 'player-layer';
    this.svg.style.cssText = [
      'position:absolute', 'inset:0',
      'pointer-events:none', 'overflow:visible',
    ].join(';');
    this.resize();
  }

  mount(): void {
    this.host.appendChild(this.svg);
    this.render();
    this.unsubFrame = this.frameView.subscribe(() => this.render());
    this.unsubView = this.store.subscribe(['zoom', 'panX', 'panY'], () => this.reposition());
    // Re-render when the size preference flips so existing nodes resize at once.
    this.unsubSize = subscribePlayerSize(() => this.render());
  }

  destroy(): void {
    this.unsubFrame();
    this.unsubView();
    this.unsubSize();
    this.svg.remove();
    this.nodes.clear();
  }

  /** Public so the Shell can call it on viewport resize. */
  resize(): void {
    const w = this.host.clientWidth || 800;
    const h = this.host.clientHeight || 600;
    this.svg.setAttribute('width', String(w));
    this.svg.setAttribute('height', String(h));
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }

  /** Test/debug helper for SelectTool. Returns null if id is unknown. */
  getNode(id: string): SVGGElement | null {
    return this.nodes.get(id) ?? null;
  }

  /** Accessor used by pngExport - exposes the SVG root for cloning/serialisation. */
  getSvg(): SVGSVGElement { return this.svg; }

  /**
   * Build a fresh SVG at natural map size (mapW x mapH) with players in map
   * coords. The live `this.svg` has `mapToClient` transforms baked in, so
   * exporting it would freeze the current zoom/pan into the PNG.
   */
  getExportSvg(mapW: number, mapH: number): SVGSVGElement {
    const out = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    out.setAttribute('xmlns', SVG_NS);
    out.setAttribute('width', String(mapW));
    out.setAttribute('height', String(mapH));
    out.setAttribute('viewBox', `0 0 ${mapW} ${mapH}`);

    const frame = this.store.get().frames[this.store.get().activeFrameIdx]!;
    const numbering = computeNumbering(frame.players);
    // The export is a natural-resolution still, so there's no live zoom to scale
    // against. Manual mode carries its slider factor through so a board sized up
    // also comes out bigger; auto stays the fixed base size.
    const exportRadius = getPlayerSizeMode() === 'manual'
      ? PLAYER_R * getPlayerSizeFactor()
      : PLAYER_R;
    for (const p of frame.players) {
      const g = createPlayerGroup(p);
      applyPlayerAttrs(g, p, numbering.get(p.id) ?? 0);
      resizeNode(g, exportRadius);
      g.setAttribute('transform', `translate(${p.x},${p.y})`);
      out.appendChild(g);
    }
    return out;
  }

  // ---- private ----

  private render(): void {
    const { frame, effects } = this.frameView.getView();
    const players = frame.players;
    const numbering = computeNumbering(players);

    const radius = playerRadiusFor(this.getViewport().zoom);
    const seen = new Set<string>();
    for (const p of players) {
      seen.add(p.id);
      let g = this.nodes.get(p.id);
      if (!g) {
        g = createPlayerGroup(p);
        this.nodes.set(p.id, g);
        this.svg.appendChild(g);
      }
      applyPlayerAttrs(g, p, numbering.get(p.id) ?? 0);
      resizeNode(g, radius);
      this.positionPlayerGroup(g, p);
      const fx = effects.get(p.id);
      applyItemEffect(g, fx);
      // applyPlayerAttrs dims dead players via style.opacity; applyItemEffect just
      // cleared that when there's no transition effect, so re-apply it here.
      if (!fx && p.dead) g.style.opacity = '0.45';
    }
    for (const [id, node] of this.nodes) {
      if (!seen.has(id)) {
        node.remove();
        this.nodes.delete(id);
      }
    }
  }

  private reposition(): void {
    // Read through the FrameView so onion-skin ghost instances (which are wired
    // to a PreviousFrameView) reposition their players from the *previous*
    // frame's positions, not the live active frame's. Reading the store
    // directly here used to make ghost players jump to their live positions on
    // any zoom/pan.
    const { frame } = this.frameView.getView();
    // Manual mode ties node size to zoom, so a zoom change must resize too - not
    // just reposition. Auto mode recomputes to the same fixed radius, which is a
    // cheap no-op.
    const radius = playerRadiusFor(this.getViewport().zoom);
    for (const p of frame.players) {
      const g = this.nodes.get(p.id);
      if (g) {
        resizeNode(g, radius);
        this.positionPlayerGroup(g, p);
      }
    }
  }

  private positionPlayerGroup(g: SVGGElement, p: Player): void {
    const v = this.getViewport();
    // mapToClient returns window-relative coords (it adds v.left/v.top), but the
    // SVG container itself is positioned at v.left/v.top inside the window - so
    // we have to subtract those back out to get coords relative to the SVG's
    // own origin. Without this, players are offset by the sidebar/topbar size.
    const sp = mapToClient(p.x, p.y, v);
    const x = Math.round(sp.x - v.left);
    const y = Math.round(sp.y - v.top);
    g.setAttribute('transform', `translate(${x},${y})`);
  }
}

/** Return a Map<playerId, 1-based number> with each team numbered independently. */
function computeNumbering(players: Player[]): Map<string, number> {
  const out = new Map<string, number>();
  let nC = 0, nR = 0;
  for (const p of players) {
    if (p.team === 'colonist') {
      nC++;
      out.set(p.id, nC);
    } else {
      nR++;
      out.set(p.id, nR);
    }
  }
  return out;
}

function createPlayerGroup(p: Player): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
  g.setAttribute('class', 'player-group');
  g.setAttribute('data-player-id', p.id);

  const shadow = document.createElementNS(SVG_NS, 'circle');
  shadow.setAttribute('data-role', 'shadow');
  shadow.setAttribute('r', String(PLAYER_R + 1));
  shadow.setAttribute('fill', 'rgba(0,0,0,0.45)');
  shadow.setAttribute('transform', 'translate(1,2)');
  shadow.setAttribute('pointer-events', 'none');
  g.appendChild(shadow);

  const ring = document.createElementNS(SVG_NS, 'circle');
  ring.setAttribute('data-role', 'ring');
  ring.setAttribute('r', String(PLAYER_R));
  ring.setAttribute('fill', 'rgba(0,0,0,0.55)');
  ring.setAttribute('stroke-width', String(PLAYER_STROKE_W));
  ring.setAttribute('pointer-events', 'none');
  g.appendChild(ring);

  return g;
}

/**
 * Resize a built player node to the given ring radius. Everything scales off
 * `k = radius / PLAYER_R` so the shadow, stroke width, number and skull stay in
 * proportion. Call after applyPlayerAttrs (which rebuilds the number/skull each
 * pass) so the freshly-added glyph gets sized too.
 */
function resizeNode(g: SVGGElement, radius: number): void {
  const k = radius / PLAYER_R;

  const ring = g.querySelector('[data-role="ring"]') as SVGCircleElement | null;
  if (ring) {
    ring.setAttribute('r', String(radius));
    ring.setAttribute('stroke-width', String(PLAYER_STROKE_W * k));
  }
  const shadow = g.querySelector('[data-role="shadow"]') as SVGCircleElement | null;
  if (shadow) {
    shadow.setAttribute('r', String((PLAYER_R + 1) * k));
    shadow.setAttribute('transform', `translate(${k},${2 * k})`);
  }
  const text = g.querySelector('text');
  if (text) text.setAttribute('font-size', String(13 * k));
  const skull = g.querySelector('[data-role="skull"]');
  if (skull) skull.setAttribute('transform', `translate(0,${0.7 * k}) scale(${1.4 * k})`);
}

function applyPlayerAttrs(g: SVGGElement, p: Player, num: number): void {
  const colour = TEAM_COLOURS[p.team];
  g.style.opacity = p.dead ? '0.45' : '1';

  const ring = g.querySelector('[data-role="ring"]') as SVGCircleElement;
  ring.setAttribute('stroke', colour);

  // Remove any prior text or skull, then re-add the right one.
  const oldText = g.querySelector('text');
  if (oldText) oldText.remove();
  const oldSkull = g.querySelector('[data-role="skull"]');
  if (oldSkull) oldSkull.remove();

  if (p.dead) {
    g.appendChild(renderSkull(colour));
  } else {
    const tx = document.createElementNS(SVG_NS, 'text');
    tx.setAttribute('text-anchor', 'middle');
    tx.setAttribute('dominant-baseline', 'central');
    tx.setAttribute('fill', colour);
    tx.setAttribute('font-size', '13');
    tx.setAttribute('font-weight', 'bold');
    tx.setAttribute('font-family', "'JetBrains Mono', ui-monospace, monospace");
    tx.setAttribute('pointer-events', 'none');
    tx.textContent = String(num);
    g.appendChild(tx);
  }
}

/** Hand-rolled skull glyph. Scaled 1.4× to match R=14 circle. Ported from v1 players.js. */
function renderSkull(colour: string): SVGGElement {
  const skull = document.createElementNS(SVG_NS, 'g') as SVGGElement;
  skull.setAttribute('data-role', 'skull');
  skull.setAttribute('pointer-events', 'none');
  skull.setAttribute('transform', 'translate(0,0.7) scale(1.4)');

  const cranium = document.createElementNS(SVG_NS, 'circle');
  cranium.setAttribute('cx', '0'); cranium.setAttribute('cy', '-1.5');
  cranium.setAttribute('r', '5.2');
  cranium.setAttribute('fill', colour);
  cranium.setAttribute('opacity', '0.9');
  skull.appendChild(cranium);

  const jaw = document.createElementNS(SVG_NS, 'rect');
  jaw.setAttribute('x', '-3.5'); jaw.setAttribute('y', '2.5');
  jaw.setAttribute('width', '7'); jaw.setAttribute('height', '3.5');
  jaw.setAttribute('rx', '1');
  jaw.setAttribute('fill', colour);
  jaw.setAttribute('opacity', '0.9');
  skull.appendChild(jaw);

  for (const [cx, cy] of [['-2', '-1.5'], ['2', '-1.5']] as const) {
    const eye = document.createElementNS(SVG_NS, 'ellipse');
    eye.setAttribute('cx', cx); eye.setAttribute('cy', cy);
    eye.setAttribute('rx', '1.6'); eye.setAttribute('ry', '1.8');
    eye.setAttribute('fill', 'rgba(0,0,0,0.75)');
    skull.appendChild(eye);
  }

  const nose = document.createElementNS(SVG_NS, 'path');
  nose.setAttribute('d', 'M-0.8,0.5 L0,2 L0.8,0.5 Z');
  nose.setAttribute('fill', 'rgba(0,0,0,0.6)');
  skull.appendChild(nose);

  for (const x of ['-2.8', '-0.75', '1.3']) {
    const tooth = document.createElementNS(SVG_NS, 'rect');
    tooth.setAttribute('x', x); tooth.setAttribute('y', '3.0');
    tooth.setAttribute('width', '1.5'); tooth.setAttribute('height', '2.5');
    tooth.setAttribute('rx', '0.3');
    tooth.setAttribute('fill', 'rgba(0,0,0,0.7)');
    skull.appendChild(tooth);
  }

  return skull;
}
