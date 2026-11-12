import { nanoid } from 'nanoid';
import type { Store } from '../app/store';
import type { History } from '../app/history';
import type { ShapeLayer } from '../render/ShapeLayer';
import type { Shape, ShapeKind, Point } from '../types/primitives';
import type { Hex } from '../types/hex';
import { clientToMap, type Viewport } from '../render/coords';
import type { ToolController } from '../app/tools';
import { FALLBACK_COLOUR } from '../app/colour';

const DEFAULT_STROKE_WIDTH = 2;
const MIN_STROKE_WIDTH = 1;
const MAX_STROKE_WIDTH = 20;
const DEFAULT_FILL = false;
const MIN_DRAG_DISTANCE = 1; // map units below which we treat a drag as a no-op click
const CLICK_DEFAULT_SIZE = 60; // map units; size of a shape placed by a click without drag
const SHAPE_KINDS_ORDER: readonly ShapeKind[] = ['square', 'circle', 'triangle', 'line', 'arrow'];

export interface ShapesToolDeps {
  store: Store;
  history: History;
  shapeLayer: ShapeLayer;
  getViewport(): Viewport;
}

export class ShapesTool implements ToolController {
  readonly id = 'shapes' as const;

  private kind: ShapeKind = 'square';
  private strokeWidth: number = DEFAULT_STROKE_WIDTH;
  private panelSlider: HTMLInputElement | null = null;
  private panelValue: HTMLInputElement | null = null;
  private settingsCb: (() => void) | null = null;
  private start: Point | null = null;
  private inflightId: string | null = null;
  private offDown: () => void = () => {};
  private offMove: () => void = () => {};
  private offUp: () => void = () => {};

  constructor(private deps: ShapesToolDeps) {}

  setKind(kind: ShapeKind): void { this.kind = kind; this.settingsCb?.(); }
  getKind(): ShapeKind { return this.kind; }

  getStrokeWidth(): number { return this.strokeWidth; }
  setStrokeWidth(n: number): void {
    if (Number.isFinite(n)) this.strokeWidth = Math.max(MIN_STROKE_WIDTH, Math.min(MAX_STROKE_WIDTH, Math.round(n)));
    if (this.panelSlider) this.panelSlider.value = String(this.strokeWidth);
    if (this.panelValue) this.panelValue.value = String(this.strokeWidth);
    this.settingsCb?.();
  }

  getSettings(): { kind: ShapeKind; strokeWidth: number } {
    return { kind: this.kind, strokeWidth: this.strokeWidth };
  }
  setSettings(s: { kind: ShapeKind; strokeWidth?: number }): void {
    if (typeof s.strokeWidth === 'number') this.strokeWidth = Math.max(MIN_STROKE_WIDTH, Math.min(MAX_STROKE_WIDTH, Math.round(s.strokeWidth)));
    this.setKind(s.kind);
  }

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
      this.start = this.toMap(e);
      this.inflightId = nanoid();
      // No preview on the bare press. Showing the full default here made a
      // drag visibly "cut" - the big default flashed, then the custom shape
      // restarted from near-zero and grew. Instead we let the draft grow from
      // the start point as the pointer moves, and drop the default on a
      // click-without-drag (onUp).
      this.deps.shapeLayer.setPreview(null);
      target.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent): void => {
      if (!this.start || !this.inflightId) return;
      const cur = this.toMap(e);
      const draft = this.makeShape(this.start, cur);
      // Below the drag threshold this is still a click (the default lands on
      // release), so show nothing; once it's a real drag, preview the live
      // shape growing from the start point - no jump from a default size.
      const dragged = Math.abs(draft.w) > MIN_DRAG_DISTANCE || Math.abs(draft.h) > MIN_DRAG_DISTANCE;
      this.deps.shapeLayer.setPreview(dragged ? draft : null);
    };
    const onUp = (e: PointerEvent): void => {
      if (e.button !== 0 || !this.start || !this.inflightId) return;
      const end = this.toMap(e);
      const start = this.start;
      this.start = null;
      this.deps.shapeLayer.setPreview(null);
      const draftShape = this.makeShape(start, end);
      const dragged = Math.abs(draftShape.w) > MIN_DRAG_DISTANCE || Math.abs(draftShape.h) > MIN_DRAG_DISTANCE;
      // Click-without-drag: place a default-sized shape centred on the click,
      // otherwise a click gives w === h === 0 and nothing shows.
      const finalShape = dragged ? draftShape : this.defaultShape(start);
      this.inflightId = null;
      this.deps.history.dispatch({ t: 'shape.add', shape: finalShape });
      try { target.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    };
    // pointercancel = interrupted gesture: drop the in-flight shape instead
    // of committing it at the cursor's interrupted position.
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
    if (this.start) {
      this.deps.shapeLayer.setPreview(null);
      this.start = null;
      this.inflightId = null;
    }
    this.panelSlider = null;
    this.panelValue = null;
  }

  /** Abort an in-flight shape (touch second-finger interruption). Drops the
   *  inflight start point + id and clears the layer preview; dispatches no
   *  command. */
  cancel(): void {
    if (this.start) {
      this.start = null;
      this.inflightId = null;
      this.deps.shapeLayer.setPreview(null);
    }
  }

  private toMap(e: PointerEvent): Point {
    return clientToMap(e.clientX, e.clientY, this.deps.getViewport());
  }

  /**
   * The shape a click-without-drag commits: a CLICK_DEFAULT_SIZE shape centred
   * on the click point. Also used as the pointerdown / sub-threshold preview so
   * the tool shows the real default shape straight away rather than a
   * degenerate zero-size flicker (most visible on arrows and lines).
   */
  private defaultShape(at: Point): Shape {
    return this.makeShape(
      { x: at.x - CLICK_DEFAULT_SIZE / 2, y: at.y - CLICK_DEFAULT_SIZE / 2 },
      { x: at.x + CLICK_DEFAULT_SIZE / 2, y: at.y + CLICK_DEFAULT_SIZE / 2 },
    );
  }

  private makeShape(start: Point, end: Point): Shape {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);
    const colour = this.activeColour();
    return {
      id: this.inflightId!,
      kind: this.kind,
      // For line and arrow, w/h represent the delta from start to end (signed makes sense),
      // not a bounding box. Use signed deltas for those kinds.
      x: this.kind === 'line' || this.kind === 'arrow' ? start.x : x,
      y: this.kind === 'line' || this.kind === 'arrow' ? start.y : y,
      w: this.kind === 'line' || this.kind === 'arrow' ? end.x - start.x : w,
      h: this.kind === 'line' || this.kind === 'arrow' ? end.y - start.y : h,
      rotation: 0,
      stroke: colour,
      strokeWidth: this.strokeWidth,
      fill: DEFAULT_FILL,
    };
  }

  private activeColour(): Hex {
    const s = this.deps.store.get();
    return s.colourSlots[s.activeSlot] ?? FALLBACK_COLOUR;
  }

  getContextPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'cp-panel cp-panel-shapes';

    const segmented = document.createElement('div');
    // Wrap variant: five kind buttons flow onto a second row when they don't
    // fit one line, so the labels never overflow past the sidebar edge.
    segmented.className = 'cp-segmented cp-segmented--wrap';

    SHAPE_KINDS_ORDER.forEach((k) => {
      const button = document.createElement('button');
      button.className = 'cp-segmented-btn';
      if (k === this.kind) button.classList.add('active');
      button.setAttribute('data-kind', k);
      button.textContent = k.toUpperCase();

      button.addEventListener('click', () => {
        this.setKind(k);
        const buttons = segmented.querySelectorAll('.cp-segmented-btn');
        buttons.forEach((btn) => {
          if (btn.getAttribute('data-kind') === k) {
            btn.classList.add('active');
          } else {
            btn.classList.remove('active');
          }
        });
      });

      segmented.appendChild(button);
    });

    panel.appendChild(segmented);

    // Thickness controls the stroke-width of the shape's lines/edges. Same
    // slider + editable readout pattern the draw tool uses for pen size.
    const row = document.createElement('div');
    row.className = 'cp-row';

    const label = document.createElement('span');
    label.className = 'cp-label';
    label.textContent = 'THICKNESS';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'cp-slider';
    slider.setAttribute('min', String(MIN_STROKE_WIDTH));
    slider.setAttribute('max', String(MAX_STROKE_WIDTH));
    slider.value = String(this.strokeWidth);
    slider.setAttribute('aria-label', 'Shape thickness');

    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.className = 'cp-value cp-value-input';
    valueInput.setAttribute('inputmode', 'numeric');
    valueInput.maxLength = 2;
    valueInput.setAttribute('aria-label', 'Shape thickness');
    valueInput.value = String(this.strokeWidth);

    slider.addEventListener('input', () => {
      this.setStrokeWidth(Number(slider.value));
    });

    const commitField = (): void => {
      const n = parseInt(valueInput.value, 10);
      if (Number.isFinite(n)) this.setStrokeWidth(n);
      // setStrokeWidth (or this fallthrough) snaps the field back to the live value.
      valueInput.value = String(this.strokeWidth);
    };
    valueInput.addEventListener('change', commitField);
    valueInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); valueInput.blur(); }
    });

    row.appendChild(label);
    row.appendChild(slider);
    row.appendChild(valueInput);
    panel.appendChild(row);

    this.panelSlider = slider;
    this.panelValue = valueInput;

    return panel;
  }
}
