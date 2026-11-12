import { nanoid } from 'nanoid';
import type { Store } from '../app/store';
import type { History } from '../app/history';
import type { TextLayer } from '../render/TextLayer';
import type { TextBox } from '../types/primitives';
import type { Hex } from '../types/hex';
import { currentLayoutMode } from '../app/layoutMode';
import { clientToMap, type Viewport } from '../render/coords';
import type { ToolController } from '../app/tools';
import { FALLBACK_COLOUR } from '../app/colour';

const DEFAULT_W = 80;
const DEFAULT_H = 32;
const DEFAULT_FONT_SIZE = 13;
const DRAG_THRESHOLD = 4;

export interface TextToolDeps {
  store: Store;
  history: History;
  textLayer: TextLayer;
  getViewport(): Viewport;
}

interface MoveDrag {
  id: string;
  startMx: number;
  startMy: number;
  beforeX: number;
  beforeY: number;
}

export class TextTool implements ToolController {
  readonly id = 'place-text' as const;

  /** Border-drag move state. Resize is owned by TextLayer (works in any
   * tool) so this is move-only now - the previous Drag union collapsed
   * to just MoveDrag once handle clicks were rerouted to the layer. */
  private drag: MoveDrag | null = null;
  private offWindowDown: () => void = () => {};
  private offMove: () => void = () => {};
  private offUp: () => void = () => {};
  private offStoreSub: () => void = () => {};
  /** Per-tbox handlers we attached to layer DOM nodes. Stored so detach() can
   * removeEventListener - otherwise the listeners leak across tool switches
   * and intercept clicks (preventDefault + stopPropagation) on textboxes long
   * after this tool is no longer active. */
  private boundLayerHandlers = new Map<string, {
    el: HTMLDivElement;
    onDown: (e: PointerEvent) => void;
    onContext: (e: MouseEvent) => void;
  }>();
  private nextFontSize: number = DEFAULT_FONT_SIZE;

  constructor(private deps: TextToolDeps) {}

  setFontSize(n: number): void {
    this.nextFontSize = Math.max(8, Math.min(48, Math.round(n)));
  }

  getFontSize(): number {
    return this.nextFontSize;
  }

  attach(target: HTMLElement): void {
    // Placement listener on the viewer target.
    const onWindowDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      // If the down landed on an existing tbox, the layer-side listener handles it.
      if ((e.target as HTMLElement).closest('.tbox')) return;
      e.preventDefault();
      const pt = clientToMap(e.clientX, e.clientY, this.deps.getViewport());
      const box: TextBox = {
        id: nanoid(),
        x: pt.x, y: pt.y, w: DEFAULT_W, h: DEFAULT_H,
        text: '',
        fontSize: this.nextFontSize,
        color: this.activeColour(),
      };
      this.deps.history.dispatch({ t: 'textbox.add', box });
      // Focus the textarea so the user can type, then hand off to the cursor tool
      // so they can move the box afterwards. The tool swap bypasses history so
      // undo is still one step back to the empty state.
      // Desktop only: on a phone the textarea is ~13px tall, and tapping the
      // sheet's TEXT row blurs it while empty, which trips TextLayer's
      // auto-delete of empty placements. Compact edits through the sheet instead.
      if (currentLayoutMode(this.deps.store) !== 'compact') {
        queueMicrotask(() => {
          const el = this.deps.textLayer.getNode(box.id);
          if (el) {
            const ta = el.querySelector('textarea') as HTMLTextAreaElement | null;
            if (ta) ta.focus();
          }
        });
      }
      // Select it as well as switching tool. On desktop that just means the
      // context panel shows the new box's editor, which is what you want having
      // only just made it. On a phone it is the whole point: the box carries the
      // map's scale, so its own field is about 13px tall with a 5px font at the
      // default zoom, and the selection sheet's TEXT row is the only field you
      // can realistically type into.
      this.deps.store._apply({ tool: 'cursor', selection: [{ kind: 'textbox', id: box.id }] });
    };

    const onMove = (e: PointerEvent): void => {
      if (!this.drag) return;
      const mp = clientToMap(e.clientX, e.clientY, this.deps.getViewport());
      const drag = this.drag;
      const dx = mp.x - drag.startMx;
      const dy = mp.y - drag.startMy;
      const state = this.deps.store.get();
      const frame = state.frames[state.activeFrameIdx]!;
      const id = drag.id;
      const next = frame.textboxes.map((b) =>
        b.id === id ? { ...b, x: drag.beforeX + dx, y: drag.beforeY + dy } : b,
      );
      this.deps.store._apply({
        frames: state.frames.map((f, i) =>
          i === state.activeFrameIdx ? { ...f, textboxes: next } : f),
      });
    };

    const onUp = (e: PointerEvent): void => {
      if (!this.drag) return;
      const drag = this.drag;
      const id = drag.id;
      const state = this.deps.store.get();
      const after = state.frames[state.activeFrameIdx]!.textboxes.find((b) => b.id === id);
      if (!after) { this.drag = null; return; }

      const moved = Math.hypot(after.x - drag.beforeX, after.y - drag.beforeY) > DRAG_THRESHOLD;
      const before = { x: drag.beforeX, y: drag.beforeY };
      const afterPos = { x: after.x, y: after.y };
      this.drag = null;
      if (!moved) {
        // Revert live-preview (no actual move).
        this.deps.store._apply({
          frames: state.frames.map((f, i) => i === state.activeFrameIdx
            ? { ...f, textboxes: f.textboxes.map((b) => b.id === id ? { ...b, ...before } : b) }
            : f),
        });
        return;
      }
      // Restore before state, then dispatch undoable command.
      this.deps.store._apply({
        frames: state.frames.map((f, i) => i === state.activeFrameIdx
          ? { ...f, textboxes: f.textboxes.map((b) => b.id === id ? { ...b, ...before } : b) }
          : f),
      });
      this.deps.history.dispatch({
        t: 'textbox.modify', id, before, after: afterPos,
      });
      try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    };

    // pointercancel = interrupted gesture: revert any in-flight text-box drag
    // to its pre-drag snapshot instead of committing a textbox.modify at the
    // cursor's interrupted position.
    const onCancel = (e: PointerEvent): void => {
      try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      this.cancel();
    };

    target.addEventListener('pointerdown', onWindowDown);
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onCancel);
    this.offWindowDown = () => target.removeEventListener('pointerdown', onWindowDown);
    this.offMove = () => target.removeEventListener('pointermove', onMove);
    this.offUp = () => {
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onCancel);
    };

    // Per-tbox listeners are bound lazily as nodes appear in the layer.
    // Subscribe to store changes so we can bind nodes synchronously after TextLayer renders.
    this.offStoreSub = this.deps.store.subscribe(['frames', 'activeFrameIdx'], () => {
      this.bindExistingTbox();
    });
    this.bindExistingTbox();
  }

  detach(): void {
    this.offWindowDown(); this.offMove(); this.offUp(); this.offStoreSub();
    // Tear down every per-tbox listener we attached. Skipping this leaves
    // pointerdown/contextmenu listeners on the .tbox elements that keep
    // calling preventDefault + stopPropagation in cursor/select modes,
    // which prevented re-editing and silently swallowed clicks.
    for (const [, h] of this.boundLayerHandlers) {
      h.el.removeEventListener('pointerdown', h.onDown);
      h.el.removeEventListener('contextmenu', h.onContext);
    }
    this.boundLayerHandlers.clear();
    // Revert a half-done drag; it has no undo entry yet.
    this.cancel();
  }

  /** Abort an in-flight gesture (touch second-finger interruption): revert a
   *  live text box move to its pre-drag snapshot and drop the drag state.
   *  Dispatches no command. */
  cancel(): void {
    if (this.drag) {
      const d = this.drag;
      const state = this.deps.store.get();
      this.deps.store._apply({
        frames: state.frames.map((f, i) => i === state.activeFrameIdx
          ? { ...f, textboxes: f.textboxes.map((b) => b.id === d.id
              ? { ...b, x: d.beforeX, y: d.beforeY } : b) }
          : f),
      });
      this.drag = null;
    }
  }

  // ---- private ----

  private bindExistingTbox(): void {
    const state = this.deps.store.get();
    const frame = state.frames[state.activeFrameIdx]!;
    for (const b of frame.textboxes) {
      if (this.boundLayerHandlers.has(b.id)) continue;
      const el = this.deps.textLayer.getNode(b.id);
      if (!el) continue;
      const ta = el.querySelector('textarea') as HTMLTextAreaElement;

      const onDown = (e: PointerEvent): void => {
        if (e.button !== 0) return;
        const tgt = e.target as HTMLElement;
        // Resize handles are owned by TextLayer (works in any tool), so skip
        // them here and let the layer-side handler take the click.
        if (tgt.classList.contains('tbox-handle')) return;
        const isTa = tgt === ta;
        const editingThis = document.activeElement === ta;
        e.stopPropagation();
        // If editing the same textarea, let the textarea handle text selection - don't drag.
        if (isTa && editingThis) return;
        e.preventDefault();
        const mp = clientToMap(e.clientX, e.clientY, this.deps.getViewport());
        const cur = this.currentBox(b.id);
        if (!cur) return;
        this.drag = {
          id: b.id,
          startMx: mp.x, startMy: mp.y,
          beforeX: cur.x, beforeY: cur.y,
        };
        try { tgt.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      };

      const onContext = (e: MouseEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        this.deps.history.dispatch({ t: 'textbox.delete', ids: [b.id] });
      };

      el.addEventListener('pointerdown', onDown);
      el.addEventListener('contextmenu', onContext);
      this.boundLayerHandlers.set(b.id, { el, onDown, onContext });
    }
    // Clean up handler entries for boxes that no longer exist.
    for (const id of Array.from(this.boundLayerHandlers.keys())) {
      if (!frame.textboxes.some((b) => b.id === id)) {
        const h = this.boundLayerHandlers.get(id);
        if (h) {
          h.el.removeEventListener('pointerdown', h.onDown);
          h.el.removeEventListener('contextmenu', h.onContext);
        }
        this.boundLayerHandlers.delete(id);
      }
    }
  }

  private currentBox(id: string): TextBox | null {
    const state = this.deps.store.get();
    return state.frames[state.activeFrameIdx]!.textboxes.find((b) => b.id === id) ?? null;
  }

  private activeColour(): Hex {
    const s = this.deps.store.get();
    return s.colourSlots[s.activeSlot] ?? FALLBACK_COLOUR;
  }

  getContextPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.setAttribute('class', 'cp-panel cp-panel-text');

    const row = document.createElement('div');
    row.setAttribute('class', 'cp-row');

    const label = document.createElement('span');
    label.setAttribute('class', 'cp-label');
    label.textContent = 'FONT SIZE';

    const slider = document.createElement('input');
    slider.setAttribute('type', 'range');
    slider.setAttribute('min', '8');
    slider.setAttribute('max', '48');
    slider.setAttribute('value', String(this.nextFontSize));
    slider.setAttribute('class', 'cp-slider');
    slider.setAttribute('aria-label', 'Font size');

    const value = document.createElement('span');
    value.setAttribute('class', 'cp-value');
    value.textContent = String(this.nextFontSize);

    slider.addEventListener('input', (e: Event) => {
      const target = e.target as HTMLInputElement;
      const newSize = Number(target.value);
      this.setFontSize(newSize);
      value.textContent = String(this.nextFontSize);
    });

    row.appendChild(label);
    row.appendChild(slider);
    row.appendChild(value);
    panel.appendChild(row);

    return panel;
  }
}
