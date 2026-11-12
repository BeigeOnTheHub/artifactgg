import type { Store } from '../app/store';
import type { QuickAdd, QuickAddType } from '../types/primitives';
import type { MapId } from '../types/maps';
import { directFrameView, applyItemEffect, type FrameView } from '../app/frameView';
import {
  GRENADE_RADII, IMPACT_RADII, FLASH_RADII, THERMITE_RADII,
  SMOKE_RADII, VORTEX_RADII, SCANNER_SIZE,
  getQuickAddScale,
} from '../tools/quickadd-presets';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_BASE_DIR = `${import.meta.env.BASE_URL}assets/quick-adds`;
const FLAME_PATH = 'M12.4 6.1C12.3 8.5 13 10 14.4 11.6C15.5 12.9 15.9 14 15.8 15C15.6 16.5 14.4 17.3 13.1 17.8C13.6 16.9 13.8 16 13.5 15.1C13.3 15.6 13 15.9 12.6 16C12.9 14.6 12.4 13.6 11.6 12.8C11.5 14 11 14.8 10.6 15.3C10.1 15.9 10.1 16.9 10.8 17.8C9.2 17.1 8.1 16 8.2 14.3C8.3 13.1 8.9 12 9.6 11.2C9.8 11.9 10.1 12.3 10.5 12.4C10.4 9.8 11.1 7.7 12.4 6.1Z';

export interface MapSize { w: number; h: number }

interface NodeRecord {
  g: SVGGElement;
  type: QuickAddType;
  builtForMapId: MapId;
}

export class QuickAddLayer {
  private svg: SVGSVGElement;
  private nodes: Map<string, NodeRecord> = new Map();
  private unsub: () => void = () => {};
  private unsubMap: () => void = () => {};
  private frameView: FrameView;

  constructor(
    private host: HTMLElement,
    private store: Store,
    private mapSize: MapSize,
    frameView?: FrameView,
  ) {
    this.frameView = frameView ?? directFrameView(store);
    this.svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    this.svg.setAttribute('id', 'quickadd-layer');
    this.svg.dataset['testid'] = 'quickadd-layer';
    this.svg.setAttribute('viewBox', `0 0 ${mapSize.w} ${mapSize.h}`);
    this.svg.setAttribute('width', String(mapSize.w));
    this.svg.setAttribute('height', String(mapSize.h));
    this.svg.style.cssText = [
      'position:absolute', 'left:0', 'top:0',
      'pointer-events:none', 'overflow:visible',
    ].join(';');
  }

  mount(): void {
    this.host.appendChild(this.svg);
    this.render();
    this.unsub = this.frameView.subscribe(() => this.render());
    // mapId still comes from the store - a map change rebuilds nodes at a new scale.
    this.unsubMap = this.store.subscribe(['mapId'], () => this.render());
  }

  destroy(): void {
    this.unsub();
    this.unsubMap();
    this.svg.remove();
    this.nodes.clear();
  }

  /** Test/debug helper. Returns null if id is unknown. */
  getNode(id: string): SVGGElement | null {
    return this.nodes.get(id)?.g ?? null;
  }

  /** Accessor used by pngExport - exposes the SVG root for cloning/serialisation. */
  getSvg(): SVGSVGElement { return this.svg; }

  // ---- private ----

  private render(): void {
    const mapId = this.store.get().mapId;
    const { frame, effects } = this.frameView.getView();
    const seen = new Set<string>();

    for (const qa of frame.quickadds) {
      seen.add(qa.id);
      let rec = this.nodes.get(qa.id);
      if (rec && rec.builtForMapId !== mapId) {
        // Map changed - tear down and rebuild at new scale.
        rec.g.remove();
        this.nodes.delete(qa.id);
        rec = undefined;
      }
      if (!rec) {
        const g = buildQuickAddNode(qa, mapId);
        this.svg.appendChild(g);
        rec = { g, type: qa.type, builtForMapId: mapId };
        this.nodes.set(qa.id, rec);
      }
      // Position + range toggle update on every render (cheap, attribute-only).
      rec.g.setAttribute('transform', `translate(${Math.round(qa.x)},${Math.round(qa.y)})`);
      applyRangeVisibility(rec.g, qa.rangeVisible);
      applyItemEffect(rec.g, effects.get(qa.id));
    }
    for (const [id, rec] of this.nodes) {
      if (!seen.has(id)) {
        rec.g.remove();
        this.nodes.delete(id);
      }
    }
  }
}

function applyRangeVisibility(g: SVGGElement, visible: boolean): void {
  g.querySelectorAll('.qa-range').forEach((el) => {
    el.setAttribute('display', visible ? 'inline' : 'none');
  });
  const icon = g.querySelector('.qa-center-icon');
  if (icon) icon.setAttribute('display', visible ? 'none' : 'inline');
}

function buildQuickAddNode(qa: QuickAdd, mapId: MapId): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
  g.setAttribute('class', `quickadd-el quickadd-${qa.type}`);
  g.setAttribute('data-quickadd-id', qa.id);
  g.setAttribute('data-quickadd-type', qa.type);

  switch (qa.type) {
    case 'grenade':        appendGrenade(g, mapId, false); break;
    case 'impact_grenade': appendGrenade(g, mapId, true); break;
    case 'smoke':          appendSmoke(g, mapId); break;
    case 'flash':          appendFlash(g, mapId); break;
    case 'thermite':       appendThermite(g, mapId); break;
    case 'vortex_mine':    appendVortexMine(g, mapId); break;
    case 'scanner':        appendScanner(g, mapId); return g;  // scanner has no centre icon
  }

  // Centre icon (sprite shown when range hidden) - for all types EXCEPT scanner.
  const halfIcon = 14;
  const icon = document.createElementNS(SVG_NS, 'image');
  icon.setAttribute('class', 'qa-center-icon');
  icon.setAttribute('href', `${ICON_BASE_DIR}/icons/${qa.type}.png`);
  icon.setAttribute('x', String(-halfIcon));
  icon.setAttribute('y', String(-halfIcon));
  icon.setAttribute('width', String(halfIcon * 2));
  icon.setAttribute('height', String(halfIcon * 2));
  icon.setAttribute('pointer-events', 'none');
  g.appendChild(icon);

  return g;
}

function appendCircle(
  g: SVGGElement, r: number, fill: string, stroke: string,
  strokeWidth: string, dasharray: string | null,
): void {
  const c = document.createElementNS(SVG_NS, 'circle');
  c.setAttribute('class', 'qa-range');
  c.setAttribute('cx', '0'); c.setAttribute('cy', '0');
  c.setAttribute('r', String(r));
  c.setAttribute('fill', fill);
  c.setAttribute('stroke', stroke);
  c.setAttribute('stroke-width', strokeWidth);
  if (dasharray) c.setAttribute('stroke-dasharray', dasharray);
  c.setAttribute('pointer-events', 'none');
  g.appendChild(c);
}

/**
 * Tactical reticle marking the quickadd's epicentre. The previous 1.5px,
 * 45%-opacity dot was easy to lose against busy map regions - especially
 * for grenades / flashes whose outer rings already eat the eye's
 * attention. Replace it with a bullseye + crosshair: dark contrast ring,
 * bright fill disc, and four tick marks aligned to the cardinal axes.
 */
function appendCentreDot(g: SVGGElement, fill: string): void {
  const TICK_LEN = 5;
  const TICK_OFFSET = 5;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const tick = document.createElementNS(SVG_NS, 'line');
    tick.setAttribute('class', 'qa-range');
    tick.setAttribute('x1', String(dx * TICK_OFFSET));
    tick.setAttribute('y1', String(dy * TICK_OFFSET));
    tick.setAttribute('x2', String(dx * (TICK_OFFSET + TICK_LEN)));
    tick.setAttribute('y2', String(dy * (TICK_OFFSET + TICK_LEN)));
    tick.setAttribute('stroke', fill);
    tick.setAttribute('stroke-width', '1.25');
    tick.setAttribute('stroke-linecap', 'round');
    tick.setAttribute('opacity', '0.95');
    tick.setAttribute('pointer-events', 'none');
    g.appendChild(tick);
  }

  const ring = document.createElementNS(SVG_NS, 'circle');
  ring.setAttribute('class', 'qa-range');
  ring.setAttribute('cx', '0'); ring.setAttribute('cy', '0');
  ring.setAttribute('r', '4.25');
  ring.setAttribute('fill', 'none');
  ring.setAttribute('stroke', 'rgba(0,0,0,0.75)');
  ring.setAttribute('stroke-width', '0.85');
  ring.setAttribute('pointer-events', 'none');
  g.appendChild(ring);

  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('class', 'qa-range');
  dot.setAttribute('cx', '0'); dot.setAttribute('cy', '0');
  dot.setAttribute('r', '3.25');
  dot.setAttribute('fill', fill);
  dot.setAttribute('opacity', '0.95');
  dot.setAttribute('pointer-events', 'none');
  g.appendChild(dot);
}

function appendGrenade(g: SVGGElement, mapId: MapId, isImpact: boolean): void {
  const sc = getQuickAddScale(mapId);
  const radii = isImpact ? IMPACT_RADII : GRENADE_RADII;
  appendCircle(g, radii.damage * sc, 'rgba(255,140,0,0.12)', 'rgba(255,140,0,0.75)', '1.5', '4 3');
  appendCircle(g, radii.death * sc, 'rgba(255,50,50,0.14)', 'rgba(255,80,80,0.85)', '1.5', null);
  appendCentreDot(g, isImpact ? '#5ab4ff' : '#ffffff');
}

function appendSmoke(g: SVGGElement, mapId: MapId): void {
  const sc = getQuickAddScale(mapId);
  appendCircle(g, SMOKE_RADII.cloud * sc, 'rgba(160,160,165,0.25)', 'rgba(200,200,205,0.75)', '1.5', null);
  appendCentreDot(g, 'rgba(210,210,215,0.45)');
}

function appendFlash(g: SVGGElement, mapId: MapId): void {
  const sc = getQuickAddScale(mapId);
  appendCircle(g, FLASH_RADII.outer * sc, 'rgba(180,180,180,0.18)', 'rgba(160,160,160,0.80)', '1.5', '5 3');
  appendCircle(g, FLASH_RADII.inner * sc, 'rgba(255,255,255,0.14)', 'rgba(255,255,255,0.70)', '1.5', null);
  // 8 rays at 45° intervals
  for (let i = 0; i < 8; i++) {
    const a = (i * 45) * Math.PI / 180;
    const x1 = Math.cos(a) * 9, y1 = Math.sin(a) * 9;
    const x2 = Math.cos(a) * 15, y2 = Math.sin(a) * 15;
    const innerLine = document.createElementNS(SVG_NS, 'line');
    innerLine.setAttribute('class', 'qa-range');
    innerLine.setAttribute('x1', '0'); innerLine.setAttribute('y1', '0');
    innerLine.setAttribute('x2', String(x1)); innerLine.setAttribute('y2', String(y1));
    innerLine.setAttribute('stroke', 'rgba(255,255,200,0.9)');
    innerLine.setAttribute('stroke-width', '1.5');
    innerLine.setAttribute('stroke-linecap', 'round');
    innerLine.setAttribute('pointer-events', 'none');
    g.appendChild(innerLine);

    const outerLine = document.createElementNS(SVG_NS, 'line');
    outerLine.setAttribute('class', 'qa-range');
    outerLine.setAttribute('x1', String(x1)); outerLine.setAttribute('y1', String(y1));
    outerLine.setAttribute('x2', String(x2)); outerLine.setAttribute('y2', String(y2));
    outerLine.setAttribute('stroke', 'rgba(255,240,100,0.5)');
    outerLine.setAttribute('stroke-width', '1');
    outerLine.setAttribute('stroke-linecap', 'round');
    outerLine.setAttribute('pointer-events', 'none');
    g.appendChild(outerLine);
  }
  appendCentreDot(g, 'rgba(255,255,200,0.45)');
}

function appendThermite(g: SVGGElement, mapId: MapId): void {
  const sc = getQuickAddScale(mapId);
  const halfSide = (THERMITE_RADII.burn / 2) * sc;
  const iconHalf = Math.round(13 * sc);

  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('class', 'qa-range');
  rect.setAttribute('x', String(-halfSide));
  rect.setAttribute('y', String(-halfSide));
  rect.setAttribute('width', String(halfSide * 2));
  rect.setAttribute('height', String(halfSide * 2));
  rect.setAttribute('fill', 'rgba(220,60,0,0.14)');
  rect.setAttribute('stroke', 'rgba(230,80,20,0.80)');
  rect.setAttribute('stroke-width', '1.5');
  rect.setAttribute('pointer-events', 'none');
  g.appendChild(rect);

  // FLAME_PATH is drawn in a 24-unit box that maps onto the icon box.
  const fire = document.createElementNS(SVG_NS, 'path');
  fire.setAttribute('class', 'qa-range');
  fire.setAttribute('d', FLAME_PATH);
  fire.setAttribute('fill', '#000');
    fire.setAttribute('transform', `translate(${-iconHalf} ${-iconHalf}) scale(${(iconHalf * 2) / 24})`);
  fire.setAttribute('pointer-events', 'none');
  g.appendChild(fire);

  appendCentreDot(g, 'rgba(255,120,30,0.45)');
}

function appendVortexMine(g: SVGGElement, mapId: MapId): void {
  const sc = getQuickAddScale(mapId);
  appendCircle(g, VORTEX_RADII.pull * sc, 'rgba(0,220,255,0.10)', 'rgba(0,220,255,0.80)', '1.5', null);
  appendCentreDot(g, 'rgba(0,220,255,0.45)');
}

function appendScanner(g: SVGGElement, mapId: MapId): void {
  const sc = getQuickAddScale(mapId);
  const sz = Math.round(SCANNER_SIZE * sc);
  const half = sz / 2;
  const img = document.createElementNS(SVG_NS, 'image');
  img.setAttribute('href', `${ICON_BASE_DIR}/map-assets/scanner.png`);
  img.setAttribute('x', String(-half));
  img.setAttribute('y', String(-half));
  img.setAttribute('width', String(sz));
  img.setAttribute('height', String(sz));
  img.setAttribute('pointer-events', 'none');
  g.appendChild(img);
}
