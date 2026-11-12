import type { Store } from '../app/store';
import type { History } from '../app/history';
import type { TextBox } from '../types/primitives';
import { clientToMap, type Viewport } from './coords';
import { directFrameView, applyItemEffect, type FrameView } from '../app/frameView';
import { sanitiseText } from '../app/sanitiseText';

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
const MIN_W = 20;
const MIN_H = 16;
const FONT_MIN = 8;
const FONT_MAX = 48;
const FONT_WHEEL_STEP = 1; // px per wheel tick

interface ResizeDrag {
  id: string;
  dir: string;
  startMx: number;
  startMy: number;
  beforeX: number;
  beforeY: number;
  beforeW: number;
  beforeH: number;
}

/**
 * Renders textboxes and owns the text-edit dispatch path (focus/blur, dblclick
 * to re-enter edit mode) so editing works whatever tool is active. Also owns the
 * resize-handle drags and wheel-to-resize-font on a selected box.
 */
export class TextLayer {
  private nodes: Map<string, HTMLDivElement> = new Map();
  private editingTextBefore: string = '';
  private editingId: string | null = null;
  private resize: ResizeDrag | null = null;
  private unsub: () => void = () => {};
  private frameView: FrameView;

  constructor(
    private host: HTMLElement,
    private store: Store,
    private history: History,
    private getViewport: () => Viewport,
    frameView?: FrameView,
  ) {
    this.frameView = frameView ?? directFrameView(store);
  }

  mount(): void {
    this.render();
    this.unsub = this.frameView.subscribe(() => this.render());
  }

  destroy(): void {
    this.unsub();
    for (const [, el] of this.nodes) el.remove();
    this.nodes.clear();
  }

  /** Test/debug helper. Returns null if id is unknown. */
  getNode(id: string): HTMLDivElement | null {
    return this.nodes.get(id) ?? null;
  }

  /**
   * The active frame's textboxes for the exporter to paint straight onto the
   * canvas. An SVG foreignObject would taint the canvas in Chromium and
   * toBlob/toDataURL would throw a SecurityError. A box mid-edit reports the
   * live textarea value, not the committed `b.text`.
   */
  getExportTextBoxes(): TextBox[] {
    const frame = this.store.get().frames[this.store.get().activeFrameIdx]!;
    return frame.textboxes.map((b) => {
      const live = this.nodes.get(b.id)?.querySelector('textarea') as HTMLTextAreaElement | null;
      return live ? { ...b, text: live.value } : b;
    });
  }

  // ---- private ----

  private render(): void {
    const { frame, effects } = this.frameView.getView();
    const seen = new Set<string>();
    for (const b of frame.textboxes) {
      seen.add(b.id);
      let el = this.nodes.get(b.id);
      if (!el) {
        el = createTextboxNode(b);
        this.bindEditHandlers(el, b.id);
        this.nodes.set(b.id, el);
        this.host.appendChild(el);
      }
      applyTextboxAttrs(el, b);
      applyItemEffect(el, effects.get(b.id));
    }
    for (const [id, el] of this.nodes) {
      if (!seen.has(id)) {
        el.remove();
        this.nodes.delete(id);
      }
    }
  }

  private bindEditHandlers(el: HTMLDivElement, id: string): void {
    const ta = el.querySelector('textarea') as HTMLTextAreaElement;

    ta.addEventListener('focus', () => {
      const cur = this.currentBox(id);
      if (!cur) return;
      this.editingId = id;
      this.editingTextBefore = cur.text;
      el.classList.add('tbox--selected');
    });

    ta.addEventListener('blur', () => {
      const cur = this.currentBox(id);
      // clean on commit (strip emoji / control chars), keep line breaks
      const newText = sanitiseText(ta.value, { allowNewlines: true, collapseWhitespace: false, maxLen: 4096 });
      if (newText !== ta.value) ta.value = newText;
      const wasEditing = this.editingId === id;
      this.editingId = null;
      el.classList.remove('tbox--selected');
      if (!cur || !wasEditing) return;
      if (newText.trim() === '' && this.editingTextBefore.trim() === '') {
        // Empty placement -> auto-delete (cancels the prior textbox.add so the
        // user doesn't accumulate orphan empty boxes when clicking around).
        this.history.dispatch({ t: 'textbox.delete', ids: [id] });
        return;
      }
      if (newText !== this.editingTextBefore) {
        this.history.dispatch({
          t: 'textbox.modify', id,
          before: { text: this.editingTextBefore },
          after: { text: newText },
        });
      }
    });

    // Double-click anywhere on the textbox enters edit mode regardless of the
    // active tool. SelectTool's drag intercept fires on each pointerdown, but
    // dblclick still bubbles up to us once both clicks resolve, so the
    // textarea reliably picks up focus afterward.
    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      ta.focus();
      const len = ta.value.length;
      ta.setSelectionRange(len, len);
    });

    // Per-handle resize. Permanent so the perimeter handles work in any tool
    // - cursor, select, lasso, place-text - not just the text tool. Each
    // handle gets its own pointerdown that captures the pointer, runs
    // document-level pointermove/up, and dispatches a single textbox.modify
    // when the drag finishes.
    for (const h of el.querySelectorAll<HTMLElement>('.tbox-handle')) {
      h.addEventListener('pointerdown', (e) => this.onHandleDown(e, id, h));
    }

    // Wheel-to-resize-font when this textbox is part of the current
    // selection but isn't being typed into. Lets the user scale text from
    // the map directly, no round-trip through the context-panel slider.
    el.addEventListener('wheel', (e) => this.onWheel(e, id), { passive: false });
  }

  private onHandleDown(e: PointerEvent, id: string, handle: HTMLElement): void {
    if (e.button !== 0) return;
    const cur = this.currentBox(id);
    if (!cur) return;
    e.preventDefault();
    e.stopPropagation();
    const mp = clientToMap(e.clientX, e.clientY, this.getViewport());
    this.resize = {
      id,
      dir: handle.dataset['dir'] ?? 'se',
      startMx: mp.x, startMy: mp.y,
      beforeX: cur.x, beforeY: cur.y,
      beforeW: cur.w, beforeH: cur.h,
    };
    try { handle.setPointerCapture(e.pointerId); } catch { /* ignore */ }

    // Document-level move/up so we keep tracking even if the cursor leaves
    // the handle's pixel rect mid-drag (which it usually does - corner
    // handles are 8×8). Also makes the path testable without needing the
    // jsdom equivalent of pointer capture redirection.
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
    // pre-drag snapshot instead of committing a textbox.modify at the
    // cursor's interrupted position.
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
    const dx = mp.x - r.startMx;
    const dy = mp.y - r.startMy;
    let nx = r.beforeX, ny = r.beforeY, nw = r.beforeW, nh = r.beforeH;
    if (r.dir.includes('e')) nw = Math.max(MIN_W, r.beforeW + dx);
    if (r.dir.includes('s')) nh = Math.max(MIN_H, r.beforeH + dy);
    if (r.dir.includes('w')) {
      nw = Math.max(MIN_W, r.beforeW - dx);
      nx = r.beforeX + (r.beforeW - nw);
    }
    if (r.dir.includes('n')) {
      nh = Math.max(MIN_H, r.beforeH - dy);
      ny = r.beforeY + (r.beforeH - nh);
    }
    const state = this.store.get();
    this.store._apply({
      frames: state.frames.map((f, i) => i === state.activeFrameIdx
        ? { ...f, textboxes: f.textboxes.map((b) => b.id === r.id ? { ...b, x: nx, y: ny, w: nw, h: nh } : b) }
        : f),
    });
  }

  private onResizeUp(_e: PointerEvent): void {
    const r = this.resize;
    if (!r) return;
    this.resize = null;
    const cur = this.currentBox(r.id);
    if (!cur) return;
    const before = { x: r.beforeX, y: r.beforeY, w: r.beforeW, h: r.beforeH };
    const after = { x: cur.x, y: cur.y, w: cur.w, h: cur.h };
    if (before.x === after.x && before.y === after.y && before.w === after.w && before.h === after.h) {
      return;
    }
    // Drag-revert pattern: rewind the live preview, then dispatch a single
    // undoable modify so Ctrl+Z reverts the resize in one step.
    const state = this.store.get();
    this.store._apply({
      frames: state.frames.map((f, i) => i === state.activeFrameIdx
        ? { ...f, textboxes: f.textboxes.map((b) => b.id === r.id ? { ...b, ...before } : b) }
        : f),
    });
    this.history.dispatch({ t: 'textbox.modify', id: r.id, before, after });
  }

  private onResizeCancel(): void {
    const r = this.resize;
    if (!r) return;
    this.resize = null;
    const before = { x: r.beforeX, y: r.beforeY, w: r.beforeW, h: r.beforeH };
    if (!this.currentBox(r.id)) return;
    const state = this.store.get();
    this.store._apply({
      frames: state.frames.map((f, i) => i === state.activeFrameIdx
        ? { ...f, textboxes: f.textboxes.map((b) => b.id === r.id ? { ...b, ...before } : b) }
        : f),
    });
  }

  private onWheel(e: WheelEvent, id: string): void {
    // Only intercept when this textbox is in the current selection AND the
    // user is not actively typing in it (focus check) - typing-mode wheel
    // is reserved for native textarea scrolling. Outside selection, let the
    // wheel bubble up to the viewport zoom handler.
    const sel = this.store.get().selection;
    const isSelected = sel.some((r) => r.kind === 'textbox' && r.id === id);
    if (!isSelected) return;
    const ta = this.nodes.get(id)?.querySelector('textarea');
    if (ta && document.activeElement === ta) return;

    const cur = this.currentBox(id);
    if (!cur) return;
    e.preventDefault();
    e.stopPropagation();
    const direction = e.deltaY < 0 ? 1 : -1;
    const next = Math.max(FONT_MIN, Math.min(FONT_MAX, cur.fontSize + direction * FONT_WHEEL_STEP));
    if (next === cur.fontSize) return;
    this.history.dispatch({
      t: 'textbox.modify', id,
      before: { fontSize: cur.fontSize },
      after: { fontSize: next },
    });
  }

  private currentBox(id: string): TextBox | null {
    const frame = this.store.get().frames[this.store.get().activeFrameIdx]!;
    return frame.textboxes.find((b) => b.id === id) ?? null;
  }
}

function createTextboxNode(b: TextBox): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'tbox';
  el.setAttribute('data-tbox-id', b.id);

  const ta = document.createElement('textarea');
  ta.className = 'tbox-text';
  ta.placeholder = 'Type here...';
  ta.spellcheck = false;
  ta.autocomplete = 'off';
  el.appendChild(ta);

  for (const dir of HANDLES) {
    const h = document.createElement('div');
    h.className = `tbox-handle tbox-handle--${dir}`;
    h.dataset['dir'] = dir;
    el.appendChild(h);
  }

  return el;
}

function applyTextboxAttrs(el: HTMLDivElement, b: TextBox): void {
  el.style.left = `${b.x}px`;
  el.style.top = `${b.y}px`;
  el.style.width = `${b.w}px`;
  el.style.height = `${b.h}px`;
  const ta = el.querySelector('textarea.tbox-text') as HTMLTextAreaElement;
  ta.style.fontSize = `${b.fontSize}px`;
  ta.style.color = b.color;
  // Don't clobber a focused textarea - that would lose the user's in-progress edit.
  if (document.activeElement !== ta) {
    ta.value = b.text;
  }
}
