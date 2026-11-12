import { nanoid } from 'nanoid';
import type { Store } from '../app/store';
import type { History } from '../app/history';
import type { StrokeLayer } from '../render/StrokeLayer';
import { DASH_STYLES, type DashStyle, type Point, type Stroke } from '../types/primitives';
import type { Hex } from '../types/hex';
import { clientToMap, type Viewport } from '../render/coords';
import type { ToolController } from '../app/tools';
import { FALLBACK_COLOUR } from '../app/colour';

const DEFAULT_BRUSH_SIZE = 4;
const MIN_BRUSH_SIZE = 1;
const MAX_BRUSH_SIZE = 100;
const DEFAULT_ALPHA = 0.92;

export interface DrawToolDeps {
  store: Store;
  history: History;
  strokeLayer: StrokeLayer;
  getViewport(): Viewport;
}

export class DrawTool implements ToolController {
  readonly id = 'draw' as const;

  private panelSlider: HTMLInputElement | null = null;
  private panelValue: HTMLInputElement | null = null;
  private dashButtons: Map<DashStyle, HTMLButtonElement> | null = null;
  private settingsCb: (() => void) | null = null;
  private size: number = DEFAULT_BRUSH_SIZE;
  private dash: DashStyle = 'solid';
  private target: HTMLElement | null = null;
  private inflight: { id: string; color: Hex; points: Point[] } | null = null;
  private offDown: () => void = () => {};
  private offMove: () => void = () => {};
  private offUp: () => void = () => {};

  constructor(private deps: DrawToolDeps) {}

  getSize(): number { return this.size; }
  setSize(n: number): void {
    if (Number.isFinite(n)) this.size = Math.max(MIN_BRUSH_SIZE, Math.min(MAX_BRUSH_SIZE, Math.round(n)));
    if (this.panelSlider) this.panelSlider.value = String(this.size);
    if (this.panelValue) this.panelValue.value = String(this.size);
    this.settingsCb?.();
  }

  getDash(): DashStyle { return this.dash; }
  setDash(d: DashStyle): void {
    if (!DASH_STYLES.includes(d)) return;
    this.dash = d;
    if (this.dashButtons) {
      for (const [style, btn] of this.dashButtons) {
        const on = style === d;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', String(on));
      }
    }
    this.settingsCb?.();
  }

  getSettings(): { size: number; dash: DashStyle } { return { size: this.size, dash: this.dash }; }
  setSettings(s: { size: number; dash?: DashStyle }): void {
    if (s.dash && DASH_STYLES.includes(s.dash)) this.dash = s.dash;
    this.setSize(s.size);
  }

  /** Single-listener pattern. A second register replaces the first. */
  onSettingsChanged(cb: () => void): () => void {
    this.settingsCb = cb;
    return () => {
      if (this.settingsCb === cb) this.settingsCb = null;
    };
  }

  attach(target: HTMLElement): void {
    this.target = target;
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      // Don't paint a stroke when the press actually lands on an interactive
      // overlay (a textbox / its resize handles, a shape-handle, the scanner
      // sprite). The user is reaching for that thing, not the canvas.
      const t = e.target as Element | null;
      if (t && t.closest('.tbox, .tbox-handle, .shape-handle, .scanner-el')) return;
      e.preventDefault();
      const colour = this.activeColour();
      const pt = this.toMap(e);
      this.inflight = { id: nanoid(), color: colour, points: [pt] };
      this.deps.strokeLayer.setPreview(this.previewStroke());
      target.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent): void => {
      if (!this.inflight) return;
      this.inflight.points.push(this.toMap(e));
      this.deps.strokeLayer.setPreview(this.previewStroke());
    };
    const onUp = (e: PointerEvent): void => {
      if (e.button !== 0 || !this.inflight) return;
      const stroke: Stroke = {
        id: this.inflight.id,
        type: 'draw',
        color: this.inflight.color,
        alpha: DEFAULT_ALPHA,
        size: this.size,
        points: this.inflight.points,
        ...(this.dash !== 'solid' ? { dash: this.dash } : {}),
      };
      this.inflight = null;
      this.deps.strokeLayer.setPreview(null);
      this.deps.history.dispatch({ t: 'stroke.add', stroke });
      try { target.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    };
    // pointercancel = interrupted gesture (second touch, OS takeover): drop
    // the in-flight stroke instead of committing it at the cursor's
    // interrupted position. Mirrors the ConeTool / SelectTool fix.
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
    if (this.inflight) {
      this.deps.strokeLayer.setPreview(null);
      this.inflight = null;
    }
    this.target = null;
    this.panelSlider = null;
    this.panelValue = null;
    this.dashButtons = null;
  }

  /** Abort an in-flight stroke (touch second-finger interruption). Drops the
   *  inflight points and clears the layer preview; dispatches no command. */
  cancel(): void {
    if (this.inflight) {
      this.deps.strokeLayer.setPreview(null);
      this.inflight = null;
    }
  }

  private activeColour(): Hex {
    const s = this.deps.store.get();
    return s.colourSlots[s.activeSlot] ?? FALLBACK_COLOUR;
  }

  private toMap(e: PointerEvent): Point {
    const v = this.deps.getViewport();
    return clientToMap(e.clientX, e.clientY, v);
  }

  private previewStroke(): Stroke {
    return {
      id: this.inflight!.id,
      type: 'draw',
      color: this.inflight!.color,
      alpha: DEFAULT_ALPHA,
      size: this.size,
      points: this.inflight!.points,
      ...(this.dash !== 'solid' ? { dash: this.dash } : {}),
    };
  }

  getContextPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'cp-panel cp-panel-draw';

    const row = document.createElement('div');
    row.className = 'cp-row';

    const label = document.createElement('span');
    label.className = 'cp-label';
    label.textContent = 'PEN SIZE';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'cp-slider';
    slider.setAttribute('min', String(MIN_BRUSH_SIZE));
    slider.setAttribute('max', String(MAX_BRUSH_SIZE));
    slider.value = String(this.size);
    slider.setAttribute('aria-label', 'Pen size');

    // The size readout is an editable field - type a value in directly or drag
    // the slider, either updates both.
    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.className = 'cp-value cp-value-input';
    valueInput.setAttribute('inputmode', 'numeric');
    valueInput.maxLength = 3;
    valueInput.setAttribute('aria-label', 'Pen size');
    valueInput.value = String(this.size);

    slider.addEventListener('input', () => {
      this.setSize(Number(slider.value));
    });

    const commitField = (): void => {
      const n = parseInt(valueInput.value, 10);
      if (Number.isFinite(n)) this.setSize(n);
      // setSize (or this fallthrough) snaps the field back to the live size.
      valueInput.value = String(this.size);
    };
    valueInput.addEventListener('change', commitField);
    valueInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); valueInput.blur(); }
    });

    row.appendChild(label);
    row.appendChild(slider);
    row.appendChild(valueInput);
    panel.appendChild(row);

    // STYLE - three pills (solid / dashed / dotted) as a full-width segmented
    // control under its own label, same shape the Shapes tool uses for kinds.
    const styleLabel = document.createElement('span');
    styleLabel.className = 'cp-label';
    styleLabel.textContent = 'STYLE';
    panel.appendChild(styleLabel);

    const styleGroup = document.createElement('div');
    styleGroup.className = 'cp-segmented cp-segmented--wrap';
    const buttons = new Map<DashStyle, HTMLButtonElement>();
    for (const style of DASH_STYLES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const on = style === this.dash;
      btn.className = on ? 'cp-segmented-btn active' : 'cp-segmented-btn';
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('data-dash', style);
      btn.textContent = style.toUpperCase();
      btn.addEventListener('click', () => this.setDash(style));
      buttons.set(style, btn);
      styleGroup.appendChild(btn);
    }
    panel.appendChild(styleGroup);

    this.panelSlider = slider;
    this.panelValue = valueInput;
    this.dashButtons = buttons;

    return panel;
  }
}
