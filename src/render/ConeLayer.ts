import type { Store } from '../app/store';
import type { Cone, Frame } from '../types/primitives';
import { halfAngleRad } from '../tools/cone-presets';
import { coneOrigin, coneEffectiveColour } from '../tools/cone-edit';
import { directFrameView, applyItemEffect, type FrameView } from '../app/frameView';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface MapSize { w: number; h: number }

export class ConeLayer {
  private svg: SVGSVGElement;
  private nodes: Map<string, SVGGElement> = new Map();
  private unsub: () => void = () => {};
  private frameView: FrameView;

  constructor(
    private host: HTMLElement,
    private store: Store,
    private mapSize: MapSize,
    frameView?: FrameView,
  ) {
    this.frameView = frameView ?? directFrameView(store);
    this.svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    this.svg.setAttribute('id', 'cone-layer');
    this.svg.dataset['testid'] = 'cone-layer';
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
  }

  destroy(): void {
    this.unsub();
    this.svg.remove();
    this.nodes.clear();
  }

  /** Test/debug helper for SelectTool. Returns null if id is unknown. */
  getNode(id: string): SVGGElement | null {
    return this.nodes.get(id) ?? null;
  }

  /** Accessor used by pngExport - exposes the SVG root for cloning/serialisation. */
  getSvg(): SVGSVGElement { return this.svg; }

  // ---- private ----

  private render(): void {
    const { frame, effects } = this.frameView.getView();
    const seen = new Set<string>();
    for (const c of frame.cones) {
      seen.add(c.id);
      let g = this.nodes.get(c.id);
      if (!g) {
        g = createConeGroup(c);
        this.nodes.set(c.id, g);
        this.svg.appendChild(g);
      }
      applyConeAttrs(g, c, frame);
      applyItemEffect(g, effects.get(c.id));
    }
    for (const [id, node] of this.nodes) {
      if (!seen.has(id)) {
        node.remove();
        this.nodes.delete(id);
      }
    }
  }
}

function createConeGroup(c: Cone): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
  g.setAttribute('data-cone-id', c.id);

  const body = document.createElementNS(SVG_NS, 'path');
  body.setAttribute('data-role', 'body');
  body.setAttribute('stroke-width', '1.5');
  body.setAttribute('stroke-linejoin', 'round');
  body.setAttribute('pointer-events', 'none');
  g.appendChild(body);

  const arcDot = document.createElementNS(SVG_NS, 'circle');
  arcDot.setAttribute('data-role', 'arc');
  arcDot.setAttribute('r', '7');
  arcDot.setAttribute('stroke', 'rgba(255,255,255,0.7)');
  arcDot.setAttribute('stroke-width', '1.5');
  arcDot.setAttribute('pointer-events', 'none');
  g.appendChild(arcDot);

  const rootDot = document.createElementNS(SVG_NS, 'circle');
  rootDot.setAttribute('data-role', 'root');
  rootDot.setAttribute('r', '5');
  rootDot.setAttribute('stroke-width', '1.5');
  rootDot.setAttribute('pointer-events', 'none');
  g.appendChild(rootDot);

  return g;
}

function applyConeAttrs(g: SVGGElement, c: Cone, frame: Frame): void {
  // Attached cones draw from the player's live position and take the team
  // colour; free cones use their own (x, y) and stored colour.
  const origin = coneOrigin(c, frame);
  const ox = origin.x, oy = origin.y;
  // customHalfAngle is unbounded in the type, but SVG's elliptical arc command
  // degenerates when start == end (i.e. 2*ha >= 2*pi - the sector wraps fully).
  // Clamp just shy of pi so the arc always has two distinct endpoints.
  const HALF_ANGLE_MAX = Math.PI - 0.001;
  const ha = Math.max(0.001, Math.min(HALF_ANGLE_MAX, halfAngleRad(c.spreadIdx, c.customHalfAngle)));
  const a1 = c.angle - ha;
  const a2 = c.angle + ha;
  const x1 = ox + c.length * Math.cos(a1);
  const y1 = oy + c.length * Math.sin(a1);
  const x2 = ox + c.length * Math.cos(a2);
  const y2 = oy + c.length * Math.sin(a2);
  const largeArc = 2 * ha > Math.PI ? 1 : 0;
  const d = `M${ox} ${oy} L${x1} ${y1} A${c.length} ${c.length} 0 ${largeArc} 1 ${x2} ${y2} Z`;
  const midX = ox + c.length * Math.cos(c.angle);
  const midY = oy + c.length * Math.sin(c.angle);

  const strokeColour = coneEffectiveColour(c, frame);
  const fillColour = withAlpha(strokeColour, 0.18);

  const body = g.querySelector('[data-role="body"]') as SVGPathElement;
  body.setAttribute('d', d);
  body.setAttribute('fill', fillColour);
  body.setAttribute('stroke', strokeColour);

  const arcDot = g.querySelector('[data-role="arc"]') as SVGCircleElement;
  arcDot.setAttribute('cx', String(midX));
  arcDot.setAttribute('cy', String(midY));
  arcDot.setAttribute('fill', strokeColour);

  const rootDot = g.querySelector('[data-role="root"]') as SVGCircleElement;
  rootDot.setAttribute('cx', String(ox));
  rootDot.setAttribute('cy', String(oy));
  rootDot.setAttribute('fill', strokeColour);
  rootDot.setAttribute('stroke', strokeColour);
}

/** Convert a `#rrggbb` hex into an `rgba(r,g,b,a)` string at the given alpha. */
function withAlpha(hexColour: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hexColour);
  if (!m) return `rgba(0,255,136,${alpha})`;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}
