import type { Store } from '../app/store';
import type { History } from '../app/history';
import type { StrokeLayer } from '../render/StrokeLayer';
import type { Point, Stroke } from '../types/primitives';
import { clientToMap, type Viewport } from '../render/coords';
import type { ToolController } from '../app/tools';

// 6 map units feels like a precision eraser - small enough to nibble at one
// stroke on a busy board without taking out its neighbours. Bigger felt blunt.
const DEFAULT_ERASER_SIZE = 6;
const MIN_ERASER_SIZE = 4;
const MAX_ERASER_SIZE = 80;

export interface EraseToolDeps {
  store: Store;
  history: History;
  strokeLayer: StrokeLayer;
  getViewport(): Viewport;
}

export class EraseTool implements ToolController {
  readonly id = 'erase' as const;

  private panelSlider: HTMLInputElement | null = null;
  private panelValue: HTMLElement | null = null;
  private settingsCb: (() => void) | null = null;
  private size: number = DEFAULT_ERASER_SIZE;
  private session: Set<string> | null = null;
  private lastPoint: Point | null = null;
  private offDown: () => void = () => {};
  private offMove: () => void = () => {};
  private offUp: () => void = () => {};

  constructor(private deps: EraseToolDeps) {}

  getSize(): number { return this.size; }
  setSize(n: number): void {
    this.size = Math.max(MIN_ERASER_SIZE, Math.min(MAX_ERASER_SIZE, n));
    if (this.panelSlider) this.panelSlider.value = String(this.size);
    if (this.panelValue) this.panelValue.textContent = String(this.size);
    this.settingsCb?.();
  }

  getSettings(): { size: number } { return { size: this.size }; }
  setSettings(s: { size: number }): void { this.setSize(s.size); }

  /** Single-listener pattern. A second register replaces the first. */
  onSettingsChanged(cb: () => void): () => void {
    this.settingsCb = cb;
    return () => {
      if (this.settingsCb === cb) this.settingsCb = null;
    };
  }

  attach(target: HTMLElement): void {
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.session = new Set();
      this.lastPoint = null;
      this.hitTestAt(e);
      target.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent): void => {
      if (!this.session) return;
      this.hitTestAt(e);
    };
    const onUp = (e: PointerEvent): void => {
      if (e.button !== 0 || !this.session) return;
      const ids = Array.from(this.session);
      this.session = null;
      this.deps.strokeLayer.setHiddenIds(new Set());
      if (ids.length > 0) {
        this.deps.history.dispatch({ t: 'stroke.erase', ids });
      }
      try { target.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    };
    // pointercancel = interrupted gesture: drop the in-flight erase session
    // and unhide its strokes instead of committing a partial stroke.erase.
    const onCancel = (e: PointerEvent): void => {
      try { target.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      this.cancel();
    };

    target.addEventListener('pointerdown', onDown);
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onCancel);
    this.offDown = () => target.removeEventListener('pointerdown', onDown);
    this.offMove = () => target.removeEventListener('pointermove', onMove);
    this.offUp = () => {
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onCancel);
    };
  }

  detach(): void {
    this.offDown(); this.offMove(); this.offUp();
    if (this.session) {
      this.deps.strokeLayer.setHiddenIds(new Set());
      this.session = null;
    }
    this.panelSlider = null;
    this.panelValue = null;
  }

  /** Abort an in-flight erase session (touch second-finger interruption).
   *  Drops the session and unhides the strokes; dispatches no command. */
  cancel(): void {
    if (this.session) {
      this.session = null;
      this.deps.strokeLayer.setHiddenIds(new Set());
    }
  }

  /**
   * No size slider: the eraser removes whole strokes, so a size only changed
   * how close the cursor had to be, not how much got erased. That confused people.
   */
  getContextPanel(): HTMLElement | null {
    return null;
  }

  private hitTestAt(e: PointerEvent): void {
    if (!this.session) return;
    const v = this.deps.getViewport();
    const p = clientToMap(e.clientX, e.clientY, v);
    // A fast drag lands its events far apart, so also test points along the gap
    // since the last one, spaced no wider than the eraser itself.
    const from = this.lastPoint ?? p;
    this.lastPoint = p;
    const steps = Math.max(1, Math.ceil(Math.hypot(p.x - from.x, p.y - from.y) / this.size));
    const frame = this.deps.store.get().frames[this.deps.store.get().activeFrameIdx]!;
    for (let i = 1; i <= steps; i++) {
      const q = { x: from.x + ((p.x - from.x) * i) / steps, y: from.y + ((p.y - from.y) * i) / steps };
      for (const s of frame.strokes) {
        if (this.session.has(s.id)) continue;
        if (strokeHit(s, q, this.size + s.size / 2)) this.session.add(s.id);
      }
    }
    this.deps.strokeLayer.setHiddenIds(new Set(this.session));
  }
}

function strokeHit(s: Stroke, p: Point, r: number): boolean {
  const r2 = r * r;
  const pts = s.points;
  if (pts.length === 1) {
    const dx = pts[0]!.x - p.x;
    const dy = pts[0]!.y - p.y;
    return dx * dx + dy * dy <= r2;
  }
  for (let i = 1; i < pts.length; i++) {
    if (segDist2(pts[i - 1]!, pts[i]!, p) <= r2) return true;
  }
  return false;
}

function segDist2(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = p.x - a.x, ey = p.y - a.y;
    return ex * ex + ey * ey;
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx, cy = a.y + t * dy;
  const ex = p.x - cx, ey = p.y - cy;
  return ex * ex + ey * ey;
}
