import type { Store } from '../app/store';
import type { History } from '../app/history';
import type { ScannerPlacement } from '../types/primitives';
import { clientToMap, type Viewport } from '../render/coords';
import type { ToolController } from '../app/tools';

const SCANNER_SIZE = 64;
const SCANNER_SPRITE = `${import.meta.env.BASE_URL}assets/quick-adds/map-assets/scanner.png`;
const DRAG_THRESHOLD = 4;

export interface ScannerToolDeps {
  store: Store;
  history: History;
  /** Element to mount the singleton scanner div into (typically `mapWrap`). */
  host: HTMLElement;
  getViewport(): Viewport;
}

interface InflightDrag {
  startMx: number;
  startMy: number;
  beforeX: number;
  beforeY: number;
}

export class ScannerTool implements ToolController {
  readonly id = 'place-scanner' as const;

  private el: HTMLDivElement | null = null;
  private drag: InflightDrag | null = null;
  private unsub: () => void = () => {};
  private offDownTarget: () => void = () => {};
  private offMoveTarget: () => void = () => {};
  private offUpTarget: () => void = () => {};

  constructor(private deps: ScannerToolDeps) {}

  attach(target: HTMLElement): void {
    // Render initial state, then keep in sync.
    this.syncFromStore();
    this.unsub = this.deps.store.subscribe(['frames', 'activeFrameIdx'], () => this.syncFromStore());

    // Placement listener on the viewer target. Skip if the down lands on the scanner element.
    const onDownTarget = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      if (this.el && (e.target === this.el || this.el.contains(e.target as Node))) return;
      e.preventDefault();
      const pt = clientToMap(e.clientX, e.clientY, this.deps.getViewport());
      this.deps.history.dispatch({ t: 'scanner.place', scanner: { x: pt.x, y: pt.y } });
    };
    const onMoveTarget = (e: PointerEvent): void => {
      if (!this.drag) return;
      const mp = clientToMap(e.clientX, e.clientY, this.deps.getViewport());
      const dx = mp.x - this.drag.startMx;
      const dy = mp.y - this.drag.startMy;
      const newX = this.drag.beforeX + dx;
      const newY = this.drag.beforeY + dy;
      const state = this.deps.store.get();
      this.deps.store._apply({
        frames: state.frames.map((f, i) => i === state.activeFrameIdx
          ? { ...f, scanner: { x: newX, y: newY } }
          : f),
      });
    };
    const onUpTarget = (e: PointerEvent): void => {
      if (!this.drag) return;
      const state = this.deps.store.get();
      const after = state.frames[state.activeFrameIdx]!.scanner;
      const before = { x: this.drag.beforeX, y: this.drag.beforeY };
      this.drag = null;
      if (!after) return;
      const moved = Math.hypot(after.x - before.x, after.y - before.y) > DRAG_THRESHOLD;
      try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      // Always rewind the live preview; a sub-threshold nudge stops there.
      this.deps.store._apply({
        frames: state.frames.map((f, i) => i === state.activeFrameIdx
          ? { ...f, scanner: before }
          : f),
      });
      if (!moved) return;
      this.deps.history.dispatch({ t: 'scanner.place', scanner: after });
    };
    // pointercancel = interrupted gesture: revert any in-flight scanner drag
    // to its pre-drag snapshot instead of committing a scanner.place at the
    // cursor's interrupted position.
    const onCancelTarget = (e: PointerEvent): void => {
      try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      this.cancel();
    };

    target.addEventListener('pointerdown', onDownTarget);
    target.addEventListener('pointermove', onMoveTarget);
    target.addEventListener('pointerup', onUpTarget);
    target.addEventListener('pointercancel', onCancelTarget);
    this.offDownTarget = () => target.removeEventListener('pointerdown', onDownTarget);
    this.offMoveTarget = () => target.removeEventListener('pointermove', onMoveTarget);
    this.offUpTarget = () => {
      target.removeEventListener('pointerup', onUpTarget);
      target.removeEventListener('pointercancel', onCancelTarget);
    };
  }

  detach(): void {
    this.unsub();
    this.offDownTarget(); this.offMoveTarget(); this.offUpTarget();
    if (this.el) { this.el.remove(); this.el = null; }
    this.cancel();
  }

  /** Abort an in-flight scanner drag (touch second-finger interruption):
   *  revert the live preview to the pre-drag snapshot and drop the drag
   *  state. Dispatches no command. */
  cancel(): void {
    if (!this.drag) return;
    const d = this.drag;
    const state = this.deps.store.get();
    this.deps.store._apply({
      frames: state.frames.map((f, i) => i === state.activeFrameIdx
        ? { ...f, scanner: { x: d.beforeX, y: d.beforeY } }
        : f),
    });
    this.drag = null;
  }

  // ---- private ----

  private syncFromStore(): void {
    const state = this.deps.store.get();
    const sc = state.frames[state.activeFrameIdx]!.scanner;
    if (!sc) {
      if (this.el) { this.el.remove(); this.el = null; }
      return;
    }
    if (!this.el) {
      this.el = this.createElement();
      this.deps.host.appendChild(this.el);
    }
    this.el.style.left = `${sc.x - SCANNER_SIZE / 2}px`;
    this.el.style.top = `${sc.y - SCANNER_SIZE / 2}px`;
  }

  private createElement(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'scanner-el';
    el.style.cssText = [
      'position:absolute',
      `width:${SCANNER_SIZE}px`,
      `height:${SCANNER_SIZE}px`,
      'cursor:grab',
      'user-select:none',
      'pointer-events:all',
    ].join(';');

    const img = document.createElement('img');
    img.src = SCANNER_SPRITE;
    img.alt = 'Scanner';
    img.draggable = false;
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;pointer-events:none;';
    el.appendChild(img);

    el.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const sc = this.deps.store.get().frames[this.deps.store.get().activeFrameIdx]!.scanner;
      if (!sc) return;
      const mp = clientToMap(e.clientX, e.clientY, this.deps.getViewport());
      this.drag = { startMx: mp.x, startMy: mp.y, beforeX: sc.x, beforeY: sc.y };
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });

    el.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.deps.history.dispatch({ t: 'scanner.place', scanner: null });
    });

    return el;
  }
}
