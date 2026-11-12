import type { Store } from '../app/store';
import type { Shape, ShapeKind } from '../types/primitives';
import { directFrameView, applyItemEffect, type FrameView } from '../app/frameView';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ARROW_MARKER_ID = 'shape-arrowhead';

export interface MapSize { w: number; h: number }

export class ShapeLayer {
  private svg: SVGSVGElement;
  private nodes: Map<string, SVGElement> = new Map();
  private previewNode: SVGElement | null = null;
  private unsubShapes: () => void = () => {};
  private frameView: FrameView;

  constructor(
    private host: HTMLElement,
    private store: Store,
    private mapSize: MapSize,
    frameView?: FrameView,
  ) {
    this.frameView = frameView ?? directFrameView(store);
    this.svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    this.svg.setAttribute('id', 'shape-layer');
    this.svg.dataset['testid'] = 'shape-layer';
    this.svg.setAttribute('viewBox', `0 0 ${mapSize.w} ${mapSize.h}`);
    this.svg.setAttribute('width', String(mapSize.w));
    this.svg.setAttribute('height', String(mapSize.h));
    // The SVG itself is event-transparent (so drags through empty space reach
    // the viewer's tool listeners), but child shape nodes still receive their
    // own events and bubble to the viewer - that lets the cursor tool's
    // DOM-based hit-test pick them up directly via data-shape-id.
    this.svg.style.cssText = [
      'position:absolute', 'left:0', 'top:0',
      'pointer-events:none', 'overflow:visible',
    ].join(';');

    // <defs> with arrowhead marker for arrows
    const defs = document.createElementNS(SVG_NS, 'defs');
    const marker = document.createElementNS(SVG_NS, 'marker');
    marker.setAttribute('id', ARROW_MARKER_ID);
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '8');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '6');
    marker.setAttribute('markerHeight', '6');
    marker.setAttribute('orient', 'auto-start-reverse');
    const tri = document.createElementNS(SVG_NS, 'path');
    tri.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
    tri.setAttribute('fill', 'context-stroke');
    marker.appendChild(tri);
    defs.appendChild(marker);
    this.svg.appendChild(defs);
  }

  mount(): void {
    this.host.appendChild(this.svg);
    this.render();
    this.unsubShapes = this.frameView.subscribe(() => this.render());
  }

  setPreview(shape: Shape | null): void {
    if (this.previewNode) {
      this.previewNode.remove();
      this.previewNode = null;
    }
    if (shape) {
      const node = createShapeNode(shape);
      node.setAttribute('data-shape-preview', 'true');
      node.setAttribute('opacity', '0.7');
      this.svg.appendChild(node);
      this.previewNode = node;
    }
  }

  destroy(): void {
    this.unsubShapes();
    this.svg.remove();
    this.nodes.clear();
    this.previewNode = null;
  }

  /** Test/debug helper for SelectTool. Returns null if id is unknown. */
  getNode(id: string): SVGElement | null {
    return this.nodes.get(id) ?? null;
  }

  /** Accessor used by pngExport - exposes the SVG root for cloning/serialisation. */
  getSvg(): SVGSVGElement { return this.svg; }

  // ---- private ----

  private render(): void {
    const { frame, effects } = this.frameView.getView();
    const seen = new Set<string>();
    for (const s of frame.shapes) {
      seen.add(s.id);
      const existing = this.nodes.get(s.id);
      if (existing && existing.tagName.toLowerCase() === expectedTag(s.kind)) {
        applyShapeAttrs(existing, s);
      } else {
        if (existing) existing.remove();
        const node = createShapeNode(s);
        this.nodes.set(s.id, node);
        // Insert before preview node so preview stays on top:
        if (this.previewNode) this.svg.insertBefore(node, this.previewNode);
        else this.svg.appendChild(node);
      }
      applyItemEffect(this.nodes.get(s.id)!, effects.get(s.id));
    }
    // Remove nodes for shapes no longer in the frame
    for (const [id, node] of this.nodes) {
      if (!seen.has(id)) {
        node.remove();
        this.nodes.delete(id);
      }
    }
  }
}

function expectedTag(kind: ShapeKind): string {
  switch (kind) {
    case 'square': return 'rect';
    case 'circle': return 'ellipse';
    case 'triangle':
    case 'line':
    case 'arrow':
      return 'path';
  }
}

function createShapeNode(s: Shape): SVGElement {
  const tag = expectedTag(s.kind);
  const node = document.createElementNS(SVG_NS, tag) as SVGElement;
  node.setAttribute('data-shape-id', s.id);
  applyShapeAttrs(node, s);
  return node;
}

function applyShapeAttrs(node: SVGElement, s: Shape): void {
  node.setAttribute('stroke', s.stroke);
  node.setAttribute('stroke-width', String(s.strokeWidth));
  // Filled shapes paint their interior; unfilled rect/circle/triangle shapes
  // get a fully-transparent fill rather than fill="none" - visually identical,
  // but the SVG default pointer-events:visiblePainted treats fill="none" as a
  // "donut hole" the cursor tool can't DOM-target. Lines/arrows render as
  // open paths where a fill colour would close the path visually, so they
  // stay fill="none" and are hit-tested by their stroke instead.
  const fillable = s.kind === 'square' || s.kind === 'circle' || s.kind === 'triangle';
  node.setAttribute('fill', s.fill ? s.stroke : (fillable ? 'transparent' : 'none'));
  if (s.rotation !== 0) {
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    node.setAttribute('transform', `rotate(${s.rotation} ${cx} ${cy})`);
  } else {
    node.removeAttribute('transform');
  }
  switch (s.kind) {
    case 'square': {
      node.setAttribute('x', String(s.x));
      node.setAttribute('y', String(s.y));
      node.setAttribute('width', String(s.w));
      node.setAttribute('height', String(s.h));
      break;
    }
    case 'circle': {
      node.setAttribute('cx', String(s.x + s.w / 2));
      node.setAttribute('cy', String(s.y + s.h / 2));
      node.setAttribute('rx', String(Math.abs(s.w / 2)));
      node.setAttribute('ry', String(Math.abs(s.h / 2)));
      break;
    }
    case 'triangle': {
      const x1 = s.x + s.w / 2, y1 = s.y;
      const x2 = s.x, y2 = s.y + s.h;
      const x3 = s.x + s.w, y3 = s.y + s.h;
      node.setAttribute('d', `M ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y3} z`);
      break;
    }
    case 'line': {
      node.setAttribute('d', `M ${s.x} ${s.y} L ${s.x + s.w} ${s.y + s.h}`);
      node.removeAttribute('marker-end');
      break;
    }
    case 'arrow': {
      node.setAttribute('d', `M ${s.x} ${s.y} L ${s.x + s.w} ${s.y + s.h}`);
      node.setAttribute('marker-end', `url(#${ARROW_MARKER_ID})`);
      break;
    }
  }
}
