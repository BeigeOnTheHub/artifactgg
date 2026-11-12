import type { Store } from '../app/store';
import type { History } from '../app/history';
import type { Shape, ToolId } from '../types/primitives';
import { clientToMap, type Viewport } from './coords';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Tools that can have a selection; handles only show under one of these. */
const SELECT_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['cursor', 'select', 'lasso']);

const HANDLE_SIZE = 14;  // map units; the overlay scales with zoom, same as the cone dots
/** Screen px, divided by the live zoom wherever it is used. The overlay scales
 *  with the map, so a fixed map-unit size shrinks on screen: the old 40 map units
 *  came out at 8px on a 390x844 phone, whose fit zoom is 0.203. Nobody can grab
 *  an 8px handle. */
const TOUCH_HANDLE_SCREEN_PX = 44;
const MIN_BOX = 8;       // smallest width/height a box-like shape can be dragged down to

/** The 8 perimeter handles for box-like shapes (square / circle / triangle). */
const BOX_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

export interface MapSize { w: number; h: number }

interface ResizeDrag {
  id: string;
  kind: Shape['kind'];
  /** A BOX_HANDLES direction, or 'start' / 'end' for line/arrow endpoints. */
  role: string;
  before: { x: number; y: number; w: number; h: number };
}

/**
 * Drag handles on the single selected shape (select-family tools): 8 perimeter
 * handles for box shapes, one per endpoint for lines and arrows. Drag-revert,
 * then one `shape.modify`, as TextLayer does for textbox resize. Separate from
 * ShapeLayer so the handles never reach the PNG export, which clones its `<svg>`.
 * In the compact touch-edit viewer the handles are finger-sized, set in screen
 * px and divided by the live zoom so zooming out doesn't shrink them.
 */
export class ShapeHandlesLayer {
  private svg: SVGSVGElement;
  private unsub: () => void = () => {};
  private resize: ResizeDrag | null = null;

  constructor(
    private host: HTMLElement,
    private store: Store,
    private history: History,
    mapSize: MapSize,
    private getViewport: () => Viewport,
    private touchEdit = false,
  ) {
    this.svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    this.svg.setAttribute('id', 'shape-handles-layer');
    this.svg.dataset['testid'] = 'shape-handles-layer';
    this.svg.setAttribute('viewBox', `0 0 ${mapSize.w} ${mapSize.h}`);
    this.svg.setAttribute('width', String(mapSize.w));
    this.svg.setAttribute('height', String(mapSize.h));
    // Root is event-transparent so clicks through empty space reach the tool
    // listeners; the handle rects opt back in with pointer-events:all.
    this.svg.style.cssText = ['position:absolute', 'left:0', 'top:0', 'pointer-events:none', 'overflow:visible'].join(';');
  }

  mount(): void {
    this.host.appendChild(this.svg);
    this.render();
    // 'zoom' only in touch mode: those handles are sized in screen px, so a pinch
    // changes their map-unit size and they have to be redrawn. Desktop handles are
    // a constant 14 units, and render() rebuilds every rect from scratch - watching
    // zoom there would rebuild the whole overlay on every wheel tick for nothing.
    const keys: Array<'selection' | 'tool' | 'frames' | 'activeFrameIdx' | 'zoom'> =
      this.touchEdit
        ? ['selection', 'tool', 'frames', 'activeFrameIdx', 'zoom']
        : ['selection', 'tool', 'frames', 'activeFrameIdx'];
    this.unsub = this.store.subscribe(keys, () => this.render());
  }

  destroy(): void {
    this.unsub();
    this.svg.remove();
  }

  // ---- private ----

  private selectedShape(): Shape | null {
    const s = this.store.get();
    if (!SELECT_TOOLS.has(s.tool)) return null;
    if (s.selection.length !== 1 || s.selection[0]!.kind !== 'shape') return null;
    const id = s.selection[0]!.id;
    return s.frames[s.activeFrameIdx]!.shapes.find((sh) => sh.id === id) ?? null;
  }

  private render(): void {
    // Re-render even mid-drag so the handles track the cursor in lockstep with
    // the shape (the live-preview geometry is already in the store via
    // patchShape). This swaps out the rect the pointer went down on, but the
    // resize move/up listeners are document-level and the pointer is captured
    // on the stable `host` element, not the rect - so the drag survives the
    // swap (see onHandleDown).
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    const sh = this.selectedShape();
    if (!sh) return;

    if (sh.kind === 'line' || sh.kind === 'arrow') {
      this.addHandle('start', sh.x, sh.y, sh);
      this.addHandle('end', sh.x + sh.w, sh.y + sh.h, sh);
      return;
    }

    const left = sh.x, right = sh.x + sh.w;
    const top = sh.y, bottom = sh.y + sh.h;
    const midX = sh.x + sh.w / 2, midY = sh.y + sh.h / 2;
    const at: Record<(typeof BOX_HANDLES)[number], [number, number]> = {
      nw: [left, top], n: [midX, top], ne: [right, top], e: [right, midY],
      se: [right, bottom], s: [midX, bottom], sw: [left, bottom], w: [left, midY],
    };
    for (const dir of BOX_HANDLES) {
      const [hx, hy] = at[dir];
      this.addHandle(dir, hx, hy, sh);
    }
  }

  private addHandle(role: string, cx: number, cy: number, sh: Shape): void {
    const size = this.touchEdit ? TOUCH_HANDLE_SCREEN_PX / this.store.get().zoom : HANDLE_SIZE;
    const r = document.createElementNS(SVG_NS, 'rect') as SVGRectElement;
    r.setAttribute('x', String(cx - size / 2));
    r.setAttribute('y', String(cy - size / 2));
    r.setAttribute('width', String(size));
    r.setAttribute('height', String(size));
    r.setAttribute('rx', '2');
    r.setAttribute('fill', '#ffffff');
    r.setAttribute('stroke', '#16161a');
    r.setAttribute('stroke-width', '1.5');
    r.setAttribute('class', 'shape-handle');
    r.setAttribute('data-role', role);
    r.style.pointerEvents = 'all';
    r.style.cursor = cursorFor(role);
    r.addEventListener('pointerdown', (e) => this.onHandleDown(e, sh.id, sh.kind, role));
    this.svg.appendChild(r);
  }

  private onHandleDown(e: PointerEvent, id: string, kind: Shape['kind'], role: string): void {
    if (e.button !== 0) return;
    const cur = this.currentShape(id);
    if (!cur) return;
    e.preventDefault();
    // Don't let the press bubble to the viewer, or the SelectTool would start
    // a parallel group-move on the same shape.
    e.stopPropagation();
    this.resize = { id, kind, role, before: { x: cur.x, y: cur.y, w: cur.w, h: cur.h } };
    // Capture on `host`, not the rect: render() rebuilds (and removes) the rect
    // on every move now, so capturing it would drop capture on the first move.
    // `host` is stable for the layer's lifetime, so a drag that leaves the
    // window still delivers move/up.
    try { this.host.setPointerCapture(e.pointerId); } catch { /* not capturable */ }

    // Document-level move/up so we keep tracking even after the cursor leaves
    // the (small) handle rect - and after a re-render swaps the rect out.
    const onMove = (ev: PointerEvent): void => this.onResizeMove(ev);
    const cleanup = (): void => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
    };
    const onUp = (ev: PointerEvent): void => {
      cleanup();
      this.onResizeUp(ev);
    };
    // pointercancel = interrupted gesture: revert the live preview to the
    // pre-drag snapshot instead of committing a shape.modify at the cursor's
    // interrupted position. Same shape as the ConeTool / SelectTool fix, on
    // a document-level listener.
    const onCancel = (): void => {
      cleanup();
      this.onResizeCancel();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
  }

  private onResizeMove(e: PointerEvent): void {
    const r = this.resize;
    if (!r) return;
    const mp = clientToMap(e.clientX, e.clientY, this.getViewport());
    this.patchShape(r.id, computeResize(r, mp));
  }

  private onResizeUp(_e: PointerEvent): void {
    const r = this.resize;
    if (!r) return;
    this.resize = null;
    const cur = this.currentShape(r.id);
    if (!cur) { this.render(); return; }
    const after = { x: cur.x, y: cur.y, w: cur.w, h: cur.h };
    if (after.x === r.before.x && after.y === r.before.y && after.w === r.before.w && after.h === r.before.h) {
      this.render();
      return;
    }
    // Drag-revert: rewind the live preview, then one undoable modify so Ctrl+Z
    // takes the whole resize back in a single step.
    this.patchShape(r.id, r.before);
    this.history.dispatch({ t: 'shape.modify', id: r.id, before: r.before, after });
  }

  /** Abort an in-flight resize, reverting the live preview. */
  cancel(): void { this.onResizeCancel(); }

  private onResizeCancel(): void {
    const r = this.resize;
    if (!r) return;
    this.resize = null;
    if (this.currentShape(r.id)) this.patchShape(r.id, r.before);
    this.render();
  }

  private patchShape(id: string, patch: Partial<Shape>): void {
    const s = this.store.get();
    const idx = s.activeFrameIdx;
    this.store._apply({
      frames: s.frames.map((f, i) => i === idx
        ? { ...f, shapes: f.shapes.map((sh) => sh.id === id ? { ...sh, ...patch } : sh) }
        : f),
    });
  }

  private currentShape(id: string): Shape | null {
    const s = this.store.get();
    return s.frames[s.activeFrameIdx]!.shapes.find((sh) => sh.id === id) ?? null;
  }
}

function cursorFor(role: string): string {
  switch (role) {
    case 'n': case 's': return 'ns-resize';
    case 'e': case 'w': return 'ew-resize';
    case 'ne': case 'sw': return 'nesw-resize';
    case 'nw': case 'se': return 'nwse-resize';
    default: return 'move'; // line / arrow endpoints
  }
}

/**
 * Map a handle drag to the shape fields it changes. For line/arrow `x,y` is the
 * start point and `w,h` is the (end - start) delta: 'start' moves the start and
 * keeps the end pinned, 'end' just moves the end. Box-like shapes use the
 * familiar 8-handle behaviour: edges adjust one dimension, corners both, and
 * west/north handles also shift `x`/`y` so the opposite edge stays put.
 */
export function computeResize(r: ResizeDrag, mp: { x: number; y: number }): Partial<Shape> {
  if (r.kind === 'line' || r.kind === 'arrow') {
    if (r.role === 'start') {
      const endX = r.before.x + r.before.w;
      const endY = r.before.y + r.before.h;
      return { x: mp.x, y: mp.y, w: endX - mp.x, h: endY - mp.y };
    }
    return { w: mp.x - r.before.x, h: mp.y - r.before.y };
  }
  const left0 = r.before.x, top0 = r.before.y;
  const right0 = r.before.x + r.before.w, bottom0 = r.before.y + r.before.h;
  let nx = left0, ny = top0, nw = r.before.w, nh = r.before.h;
  if (r.role.includes('e')) nw = Math.max(MIN_BOX, mp.x - left0);
  if (r.role.includes('s')) nh = Math.max(MIN_BOX, mp.y - top0);
  if (r.role.includes('w')) { nw = Math.max(MIN_BOX, right0 - mp.x); nx = right0 - nw; }
  if (r.role.includes('n')) { nh = Math.max(MIN_BOX, bottom0 - mp.y); ny = bottom0 - nh; }
  return { x: nx, y: ny, w: nw, h: nh };
}
