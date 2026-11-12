import type { Store } from './store';
import { clampZoom, fitZoomFor, compactViewZoom, anchoredZoomPan, pinchTransform, setMapSwitchZoom, fitElement } from './viewport';
import type { History } from './history';
import type { Viewport } from '../render/coords';
import { clientToMap } from '../render/coords';
import type { SelectionRef, Point, ToolId } from '../types/primitives';
import { hitTestPoint, snapshotSelectionForMove, applyMoveDelta, measureMoveDelta, buildMoveCommands, type MovedItemSnapshot } from './selectionMove';
import {
  coneOrigin, hitConeHandle, type ConeEdit,
  snapshotConeForEdit, liveConeEdit, commitConeEdit, revertConeEdit,
} from '../tools/cone-edit';
import { CONE_HANDLE_TOUCH_SCREEN_PX } from '../tools/cone-presets';
import { hitTestMarquee, mergeRefs, toggleRef } from './selection';
import type { ToolController } from './tools';

interface Pt { id: number; x: number; y: number; }

/** Threshold (map units) before an item drag is treated as a move, matching the desktop SELECT GROUP_MOVE_THRESHOLD_MAP. */
const GROUP_MOVE_THRESHOLD_MAP = 4;
/** Threshold (screen px) before a marquee drag counts; a sub-threshold drag is a tap. */
const MARQUEE_THRESHOLD_PX = 4;
/**
 * Selection hit radius in SCREEN px, divided by the live zoom at use. The hit test
 * runs in map space, so a fixed map-space radius shrinks on screen: the old raw 16
 * was a 3.3px radius at the portrait fit zoom of 0.203, i.e. you had to put a
 * finger within 5px of a node's centre. Mirrors SelectTool.findHit's `16 / v.zoom`,
 * but bigger, because this is the touch path.
 */
const TOUCH_SELECT_HIT_SCREEN_PX = 22;
/**
 * How far a finger may travel between down and up and still count as a tap. The
 * empty-space deselect used to require the up event to land on exactly the pixel
 * the down event did, which no real finger manages.
 */
const TAP_SLOP_PX = 8;
/**
 * How long a finger has to rest on an item before the per-item action menu
 * opens. A guess: much under this and it fires while you are starting to drag
 * something, much over and the gesture feels broken. Reuses TAP_SLOP_PX as the
 * cancel threshold so "held still enough to be a long press" and "held still
 * enough to be a tap" are the same number rather than two that can drift.
 */
const LONG_PRESS_MS = 500;
/**
 * How long two fingers may rest before their release stops counting as a tap.
 * Two-finger tap is undo - the one two-finger gesture that was still free, since
 * a pinch or a two-finger pan both move and this one by definition does not.
 * Fingers reuse TAP_SLOP_PX for "did not move", same as every other tap here.
 */
const TWO_FINGER_TAP_MS = 300;

/**
 * The seven creation tools. With one of these active the mounted tool owns
 * one-finger input (draw / erase / place); the controller is dormant on one
 * finger and only arbitrates two-finger pinch/pan. Select-family ids
 * (cursor / select / lasso) are absent - for those the touch edit path runs.
 */
const CREATION_TOOL_IDS = new Set<ToolId>([
  'draw', 'erase', 'shapes', 'place-cone', 'place-player', 'place-quickadd', 'place-text',
]);

export interface TouchEditDeps {
  getViewport(): Viewport;
  history: History;
  /**
   * The currently-attached creation tool, or null. Used to `cancel()` its
   * in-flight gesture when a second finger lands. Optional so the
   * select-path tests can construct edit deps without a ToolsManager.
   */
  getActiveTool?(): ToolController | null;
  /**
   * A finger rested on an item for LONG_PRESS_MS without moving. Opens the
   * per-item action menu. Optional so the existing tests can build edit deps
   * without one.
   */
  onLongPress?(ref: SelectionRef, clientX: number, clientY: number): void;
}

/**
 * Single touch input arbitrator for the compact viewer. One finger pans, or
 * grabs and moves an item when edit deps are supplied (drag-revert + one
 * Command). Two fingers pinch-zoom and pan.
 * With a creation tool active the controller ignores one finger so the event
 * reaches the tool; a second finger cancel()s the tool and double-tap zoom is
 * suppressed. View transforms bypass history, like the desktop controllers.
 */
export class TouchViewportController {
  private pts: Pt[] = [];
  private panStart: { panX: number; panY: number; x: number; y: number } | null = null;
  /** Snapshot of the two-finger gesture start: separation, midpoint (viewer-relative)
   *  and the view it began from. pinchTransform anchors off this rather than the
   *  live state so the anchor cannot drift over a long drag. */
  private pinchStart: { dist: number; midX: number; midY: number; zoom: number; panX: number; panY: number } | null = null;
  private lastTap = 0;
  private off: Array<() => void> = [];
  private edit: TouchEditDeps | null;
  private move: { items: MovedItemSnapshot[]; startMx: number; startMy: number; moved: boolean } | null = null;
  private downEmpty = false;
  private coneEdit: ConeEdit | null = null;
  private marqueeEl: HTMLDivElement | null = null;
  private marquee: { startSx: number; startSy: number } | null = null;
  private pendingTap: SelectionRef | null = null;
  private longPress: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | null = null;
  /** Set when a long press fired, so the release it belongs to does nothing. */
  private longPressFired = false;
  /** Where each finger landed for the current two-finger gesture, and when. */
  private twoFingerTap: { at: number; marks: Array<{ id: number; x: number; y: number }> } | null = null;

  constructor(private target: HTMLElement, private store: Store, edit?: TouchEditDeps) {
    this.edit = edit ?? null;
  }

  attach(): void {
    setMapSwitchZoom(() => fitElement(this.target, compactViewZoom));
    const down = (e: PointerEvent): void => {
      if (e.pointerType === 'mouse') return;
      if (this.isChromeEvent(e)) return;
      e.preventDefault();
      try { this.target.setPointerCapture(e.pointerId); } catch { /* synthetic/inactive pointer */ }
      this.pts.push({ id: e.pointerId, x: e.clientX, y: e.clientY });
      // Before the creation-tool branch, so it covers both paths: three fingers
      // is not a two-finger tap, and without this a three-finger tap would undo.
      if (this.pts.length > 2) this.twoFingerTap = null;
      if (this.creationToolActive()) { this.downCreation(e); return; }
      if (this.pts.length === 1) {
        const s = this.store.get();
        this.panStart = { panX: s.panX, panY: s.panY, x: e.clientX, y: e.clientY };
        this.maybeDoubleTap(e);
        if (this.edit) this.beginEditPress(e);
      } else if (this.pts.length === 2) {
        this.panStart = null;
        this.cancelLongPress();                                 // ...and a long press
        if (this.move) { this.revertMove(); this.move = null; } // 2nd finger cancels a move
        if (this.coneEdit) { revertConeEdit(this.store, this.coneEdit); this.coneEdit = null; }
        if (this.marquee) this.clearMarquee();   // 2nd finger cancels a marquee
        this.pendingTap = null;                   // ...and a pending multi-tap
        this.beginPinch();
      }
    };
    const move = (e: PointerEvent): void => {
      if (this.isChromeEvent(e)) return;
      const p = this.pts.find((q) => q.id === e.pointerId);
      if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      // A finger that travels past the tap slop is a drag, not a hold.
      if (this.longPress &&
          Math.hypot(e.clientX - this.longPress.x, e.clientY - this.longPress.y) > TAP_SLOP_PX) {
        this.cancelLongPress();
      }
      this.checkTwoFingerTravel();
      // Everything below is suppressed once the menu has opened - the finger is
      // still down but the gesture is over.
      if (this.longPressFired) return;
      if (this.creationToolActive()) { this.moveCreation(e); return; }
      if (this.pts.length === 1 && this.coneEdit) {
        const v = this.edit!.getViewport();
        liveConeEdit(this.store, this.coneEdit, clientToMap(e.clientX, e.clientY, v));
      } else if (this.pts.length === 1 && this.marquee) {
        this.updateMarquee(e);
      } else if (this.pts.length === 1 && this.move) {
        const v = this.edit!.getViewport();
        const cur = clientToMap(e.clientX, e.clientY, v);
        const dx = cur.x - this.move.startMx;
        const dy = cur.y - this.move.startMy;
        if (Math.hypot(dx, dy) > GROUP_MOVE_THRESHOLD_MAP) this.move.moved = true;
        applyMoveDelta(this.store, this.move.items, dx, dy);
      } else if (this.pts.length === 1 && this.panStart && !this.pendingTap) {
        // A pending multi-tap suppresses panning so the map does not lurch
        // while the user holds an item to toggle it.
        this.store._apply({
          panX: this.panStart.panX + (e.clientX - this.panStart.x),
          panY: this.panStart.panY + (e.clientY - this.panStart.y),
        });
      } else if (this.pts.length === 2 && this.pinchStart) {
        this.applyPinch();
      }
    };
    const up = (e: PointerEvent): void => {
      if (this.isChromeEvent(e)) return;
      this.cancelLongPress();
      // Checked before anything else: this is a whole-gesture verdict, and the
      // branches below are all single-finger business.
      const undid = this.tryTwoFingerTap();
      if (undid) {
        this.pts = this.pts.filter((q) => q.id !== e.pointerId);
        try { this.target.releasePointerCapture?.(e.pointerId); } catch { /* never captured */ }
        this.pinchStart = null;
        this.panStart = null;
        return;
      }
      // The release that ends a long press must do nothing else - no tap, no
      // deselect, no move commit. Still needs the bookkeeping at the bottom.
      if (this.longPressFired) {
        this.longPressFired = false;
        this.downEmpty = false;
        this.pts = this.pts.filter((q) => q.id !== e.pointerId);
        try { this.target.releasePointerCapture?.(e.pointerId); } catch { /* never captured */ }
        if (this.pts.length === 0) this.panStart = null;
        return;
      }
      if (this.creationToolActive()) { this.upCreation(e); return; }
      if (this.coneEdit && this.pts.some((q) => q.id === e.pointerId)) {
        if (e.type === 'pointercancel') revertConeEdit(this.store, this.coneEdit);
        else commitConeEdit(this.store, this.edit!.history, this.coneEdit);
        this.coneEdit = null;
      } else if (this.marquee && this.pts.some((q) => q.id === e.pointerId)) {
        const applied = e.type !== 'pointercancel' && this.finalizeMarquee(e);
        this.clearMarquee();
        // A sub-threshold marquee is a tap on empty space - multi mode routes
        // every empty press through the marquee, so this is the same gesture the
        // normal-mode branch below handles, and it means the same thing.
        if (!applied && e.type !== 'pointercancel') this.exitMultiSelect();
      } else if (this.pendingTap && this.pts.some((q) => q.id === e.pointerId)) {
        if (e.type !== 'pointercancel') {
          this.store._apply({ selection: toggleRef(this.store.get().selection, this.pendingTap) });
        }
        this.pendingTap = null;
      } else if (this.move && this.pts.some((q) => q.id === e.pointerId)) {
        if (e.type === 'pointercancel') { this.revertMove(); this.move = null; }
        else this.finalizeMove();
      } else if (this.edit && this.downEmpty && this.pts.length === 1 && this.panStart &&
                 // Within TAP_SLOP_PX of where the finger landed counts as a tap. This
                 // was an exact-equality check with a comment predicting it would miss
                 // on real hardware; it did - 1px of wobble and the deselect never fired.
                 Math.hypot(e.clientX - this.panStart.x, e.clientY - this.panStart.y) <= TAP_SLOP_PX) {
        // Tap on empty space deselects. Multi mode never reaches here - it
        // routes every empty press through the marquee - so there is no mode to
        // clear on this path.
        this.store._apply({ selection: [] });
      }
      this.downEmpty = false;
      this.pts = this.pts.filter((q) => q.id !== e.pointerId);
      // Guarded like setPointerCapture above: a pointer that was never captured
      // (synthetic events, or a capture that itself failed) throws on release.
      try { this.target.releasePointerCapture?.(e.pointerId); } catch { /* never captured */ }
      if (this.pts.length < 2) this.pinchStart = null;
      if (this.pts.length === 1 && !this.panStart) {
        const s = this.store.get();
        const remaining = this.pts[0]!;
        this.panStart = { panX: s.panX, panY: s.panY, x: remaining.x, y: remaining.y };
      }
      if (this.pts.length === 0) this.panStart = null;
    };
    this.target.addEventListener('pointerdown', down, true);
    this.target.addEventListener('pointermove', move, true);
    this.target.addEventListener('pointerup', up, true);
    this.target.addEventListener('pointercancel', up, true);
    this.off = [
      () => this.target.removeEventListener('pointerdown', down, true),
      () => this.target.removeEventListener('pointermove', move, true),
      () => this.target.removeEventListener('pointerup', up, true),
      () => this.target.removeEventListener('pointercancel', up, true),
    ];
  }

  /** Revert an in-flight item move or cone edit without committing it. */
  cancelEdits(): void {
    if (this.move) { this.revertMove(); this.move = null; }
    if (this.coneEdit) { revertConeEdit(this.store, this.coneEdit); this.coneEdit = null; }
  }

  detach(): void {
    setMapSwitchZoom(null);
    this.off.forEach((f) => f());
    this.off = [];
    this.pts = [];
    this.panStart = null;
    this.pinchStart = null;
    if (this.move) this.revertMove();
    this.move = null;
    if (this.coneEdit) revertConeEdit(this.store, this.coneEdit);
    this.coneEdit = null;
    this.clearMarquee();
    this.marqueeEl?.remove();
    this.marqueeEl = null;
    this.pendingTap = null;
    this.downEmpty = false;
  }

  private dist(): number {
    const [a, b] = this.pts;
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** Viewer-relative midpoint of the two live pointers. */
  private mid(): { x: number; y: number } {
    const [a, b] = this.pts;
    const rect = this.target.getBoundingClientRect();
    if (!a || !b) return { x: 0, y: 0 };
    return { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
  }

  /** Snapshot the gesture start. Called from both two-finger entry points (the
   *  select-family path and the creation-tool path) so they cannot drift apart. */
  private beginPinch(): void {
    const s = this.store.get();
    const m = this.mid();
    this.pinchStart = { dist: this.dist(), midX: m.x, midY: m.y, zoom: s.zoom, panX: s.panX, panY: s.panY };
    // A two-finger gesture must never leave the single-finger double-tap armed:
    // two undo taps in a row would otherwise have the second one's first finger
    // land inside the 300ms window and toggle the zoom instead.
    this.lastTap = 0;
    this.twoFingerTap = {
      at: Date.now(),
      marks: this.pts.map((p) => ({ id: p.id, x: p.x, y: p.y })),
    };
  }

  /**
   * Two fingers down, neither moved, both up inside TWO_FINGER_TAP_MS: undo.
   * Pinch and two-finger pan move a finger past the slop first, which cancels it.
   *
   * @returns true if it fired, so the release does nothing else.
   */
  private tryTwoFingerTap(): boolean {
    const t = this.twoFingerTap;
    if (!t || !this.edit || this.pts.length !== 2) return false;
    this.twoFingerTap = null;
    if (Date.now() - t.at >= TWO_FINGER_TAP_MS) return false;
    this.edit.history.undo();
    // The surviving finger's release re-arms panStart on its way out, which
    // would let a two-finger tap on empty space also clear the selection.
    this.downEmpty = false;
    return true;
  }

  /** Any finger straying past the tap slop makes this a pinch or a pan, not a tap. */
  private checkTwoFingerTravel(): void {
    const t = this.twoFingerTap;
    if (!t) return;
    for (const p of this.pts) {
      const mark = t.marks.find((m) => m.id === p.id);
      if (!mark) { this.twoFingerTap = null; return; }   // a third finger joined
      if (Math.hypot(p.x - mark.x, p.y - mark.y) > TAP_SLOP_PX) { this.twoFingerTap = null; return; }
    }
  }

  /** Two fingers: pan by the midpoint's travel and zoom by the change in
   *  separation, both at once. Was anchoredZoomPan alone, which meant a
   *  same-direction two-finger drag (constant separation) moved nothing at all. */
  private applyPinch(): void {
    if (!this.pinchStart) return;
    const [a, b] = this.pts;
    if (!a || !b) return;
    const rect = this.target.getBoundingClientRect();
    const m = this.mid();
    this.store._apply(pinchTransform(this.pinchStart, this.dist(), m.x, m.y, rect.width, rect.height));
  }

  private maybeDoubleTap(e: PointerEvent): void {
    const now = Date.now();
    if (now - this.lastTap < 300) {
      this.toggleZoom(e);
      this.lastTap = 0;
    } else {
      this.lastTap = now;
    }
  }

  /**
   * The compact default view: boot, map switch, rotate and Reset view all land
   * here. Not a fit-to-screen, compactViewZoom overshoots by 2x in portrait.
   */
  resetToDefaultView(): void {
    const rect = this.target.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.store._apply({ zoom: clampZoom(compactViewZoom(rect.width, rect.height)), panX: 0, panY: 0 });
  }

  private toggleZoom(e: PointerEvent): void {
    const rect = this.target.getBoundingClientRect();
    const fit = clampZoom(fitZoomFor(rect.width, rect.height));
    const s = this.store.get();
    const atFit = Math.abs(s.zoom - fit) < 0.001;
    const next = atFit ? clampZoom(fit * 2) : fit;
    if (atFit) {
      this.store._apply(anchoredZoomPan(s, next, e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height));
    } else {
      this.store._apply({ zoom: next, panX: 0, panY: 0 });
    }
    this.panStart = null;
  }

  /**
   * One-finger press with edit deps. Multi-select mode: a press on an item
   * arms a membership toggle, empty space starts a marquee. Normal mode: a
   * press on an already-selected item grabs the whole selection (group move),
   * a press on an unselected item replaces the selection and grabs it, empty
   * space marks a candidate pan / deselect.
   */
  private beginEditPress(e: PointerEvent): void {
    if (!this.edit) return;
    const tgt = e.target as HTMLElement;
    if (tgt.classList?.contains('shape-handle') || tgt.classList?.contains('tbox-handle')) {
      this.downEmpty = false; return; // resize handles own their own drag
    }
    const v = this.edit.getViewport();
    const mp = clientToMap(e.clientX, e.clientY, v);
    // A selected cone exposes origin/arc drag handles - reshape takes priority
    // over the generic grab-and-move, mirroring SelectTool.tryBeginConeEdit.
    if (this.tryBeginConeEdit(mp)) { this.downEmpty = false; return; }
    const hit: SelectionRef | null = hitTestPoint(this.store.get(), mp, TOUCH_SELECT_HIT_SCREEN_PX / this.store.get().zoom);

    // Arm the per-item action menu. Both modes: holding an item is the one way
    // to reach Delete / Duplicate / Add to selection now that the multi-select
    // toggle has left the top bar.
    if (hit) this.armLongPress(e, hit);

    if (this.store.get().ui.touchMultiSelect === true) {
      this.downEmpty = false;
      if (hit) this.pendingTap = hit;   // tap toggles membership on release
      else this.beginMarquee(e);        // empty-space drag draws a marquee
      return;
    }

    if (!hit) { this.downEmpty = true; return; }
    this.downEmpty = false;
    const sel = this.store.get().selection;
    const inSel = sel.some((r) => r.kind === hit.kind && r.id === hit.id);
    const frame = this.store.get().frames[this.store.get().activeFrameIdx]!;
    if (inSel) {
      // Press on an already-selected item: move the whole selection.
      this.move = { items: snapshotSelectionForMove(frame, sel), startMx: mp.x, startMy: mp.y, moved: false };
    } else {
      this.store._apply({ selection: [hit] });
      this.move = { items: snapshotSelectionForMove(frame, [hit]), startMx: mp.x, startMy: mp.y, moved: false };
    }
  }

  /** Start the long-press countdown for a press that landed on `hit`. */
  private armLongPress(e: PointerEvent, hit: SelectionRef): void {
    this.cancelLongPress();
    if (!this.edit?.onLongPress) return;
    const { clientX, clientY } = e;
    this.longPress = {
      x: clientX,
      y: clientY,
      timer: setTimeout(() => {
        this.longPress = null;
        this.longPressFired = true;
        // Drop everything the press had set up, or the release would also
        // commit a move / toggle membership on top of opening the menu.
        if (this.move) { this.revertMove(); this.move = null; }
        this.pendingTap = null;
        this.panStart = null;
        this.edit?.onLongPress?.(hit, clientX, clientY);
      }, LONG_PRESS_MS),
    };
  }

  private cancelLongPress(): void {
    if (!this.longPress) return;
    clearTimeout(this.longPress.timer);
    this.longPress = null;
  }

  /** If exactly one cone is selected and the press hit one of its drag handles,
   *  start the cone reshape/move edit (enlarged touch hit radius) and return true. */
  private tryBeginConeEdit(mp: Point): boolean {
    const s = this.store.get();
    const sel = s.selection;
    if (sel.length !== 1 || sel[0]!.kind !== 'cone') return false;
    const frame = s.frames[s.activeFrameIdx]!;
    const cone = frame.cones.find((c) => c.id === sel[0]!.id);
    if (!cone) return false;
    // Screen px / zoom: the hit test is in map space, so a fixed map-space radius
    // shrinks on screen as you zoom out.
    const h = hitConeHandle(cone, coneOrigin(cone, frame), mp, CONE_HANDLE_TOUCH_SCREEN_PX / this.store.get().zoom);
    if (!h) return false;
    this.coneEdit = { id: cone.id, mode: h, before: snapshotConeForEdit(cone) };
    return true;
  }

  /** Drag-revert then dispatch one Command (or batch) if it moved past threshold. */
  private finalizeMove(): void {
    if (!this.edit || !this.move) return;
    const m = this.move;
    this.move = null;
    const frame = this.store.get().frames[this.store.get().activeFrameIdx]!;
    const item0 = m.items[0];
    const d = item0 ? measureMoveDelta(frame, item0) : { dx: 0, dy: 0 };
    applyMoveDelta(this.store, m.items, 0, 0); // revert to pre-drag
    if (!m.moved || !item0) return;
    const cmds = buildMoveCommands(frame, m.items, d.dx, d.dy);
    if (cmds.length === 1) this.edit.history.dispatch(cmds[0]!);
    else if (cmds.length > 1) this.edit.history.dispatch({ t: 'batch', cmds });
  }

  private revertMove(): void {
    if (this.move) applyMoveDelta(this.store, this.move.items, 0, 0);
  }

  // ---- multi-select marquee ----

  private ensureMarqueeEl(): HTMLDivElement {
    if (!this.marqueeEl) {
      const el = document.createElement('div');
      el.className = 'touch-marquee';
      el.dataset['testid'] = 'touch-marquee';
      this.target.appendChild(el);
      this.marqueeEl = el;
    }
    return this.marqueeEl;
  }

  /** Start a marquee box at the press point (viewer-local screen coords). */
  private beginMarquee(e: PointerEvent): void {
    const rect = this.target.getBoundingClientRect();
    this.marquee = { startSx: e.clientX - rect.left, startSy: e.clientY - rect.top };
    const el = this.ensureMarqueeEl();
    el.style.display = 'block';
    el.style.left = `${this.marquee.startSx}px`;
    el.style.top = `${this.marquee.startSy}px`;
    el.style.width = '0px';
    el.style.height = '0px';
  }

  private updateMarquee(e: PointerEvent): void {
    if (!this.marquee || !this.marqueeEl) return;
    const rect = this.target.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    this.marqueeEl.style.left = `${Math.min(this.marquee.startSx, sx)}px`;
    this.marqueeEl.style.top = `${Math.min(this.marquee.startSy, sy)}px`;
    this.marqueeEl.style.width = `${Math.abs(sx - this.marquee.startSx)}px`;
    this.marqueeEl.style.height = `${Math.abs(sy - this.marquee.startSy)}px`;
  }

  /**
   * Leave multi-select mode, keeping whatever is selected. No button shows the
   * mode is on, so a tap on empty space is the way out. The selection survives
   * because clearing it is not undoable and one stray tap would lose real work.
   */
  private exitMultiSelect(): void {
    const ui = this.store.get().ui;
    if (ui.touchMultiSelect !== true) return;
    this.store._apply({ ui: { ...ui, touchMultiSelect: false } });
  }

  /** @returns true if a marquee was actually applied; false for a sub-threshold tap. */
  private finalizeMarquee(e: PointerEvent): boolean {
    if (!this.marquee || !this.edit) return false;
    const rect = this.target.getBoundingClientRect();
    const ex = e.clientX - rect.left;
    const ey = e.clientY - rect.top;
    const minSx = Math.min(this.marquee.startSx, ex), maxSx = Math.max(this.marquee.startSx, ex);
    const minSy = Math.min(this.marquee.startSy, ey), maxSy = Math.max(this.marquee.startSy, ey);
    // A sub-threshold drag is a tap - in multi mode that selects nothing.
    if (maxSx - minSx < MARQUEE_THRESHOLD_PX && maxSy - minSy < MARQUEE_THRESHOLD_PX) return false;
    const v = this.edit.getViewport();
    const tl = clientToMap(rect.left + minSx, rect.top + minSy, v);
    const br = clientToMap(rect.left + maxSx, rect.top + maxSy, v);
    const hits = hitTestMarquee(this.store.get(), tl, br);
    this.store._apply({ selection: mergeRefs(this.store.get().selection, hits) });
    return true;
  }

  private clearMarquee(): void {
    this.marquee = null;
    if (this.marqueeEl) this.marqueeEl.style.display = 'none';
  }

  // ---- creation-tool arbitration ----

  /**
   * True when a pointer event originates inside the floating compact chrome
   * (tool rail / top bar / a bottom sheet). The controller must not arbitrate
   * those - the chrome insulates them from the map tools itself; the
   * controller simply stays out of the way (it does NOT stop propagation,
   * which would kill the chrome's own inner pointer handlers).
   */
  private isChromeEvent(e: PointerEvent): boolean {
    const t = e.target as Element | null;
    return t != null && typeof t.closest === 'function' && t.closest('[data-touch-chrome]') != null;
  }

  /** True when a creation tool is active - the mounted tool owns one finger. */
  private creationToolActive(): boolean {
    return CREATION_TOOL_IDS.has(this.store.get().tool);
  }

  /**
   * Creation-tool pointerdown. One finger: the controller stays dormant - the
   * event bubbles to the mounted tool and double-tap zoom is intentionally
   * skipped. A second (or later) finger is claimed so the tool never sees it;
   * the first transition to two fingers cancels the tool's in-flight gesture
   * and begins pinch/pan.
   */
  private downCreation(e: PointerEvent): void {
    this.lastTap = 0; // creation-tool taps must not arm the select-path double-tap
    if (this.pts.length >= 2) {
      e.stopImmediatePropagation();             // the tool never sees finger 2+
    }
    if (this.pts.length === 2) {
      this.edit?.getActiveTool?.()?.cancel?.();  // abort its in-flight gesture
      this.panStart = null;
      this.move = null;
      this.beginPinch();
    }
  }

  /**
   * Creation-tool pointermove. Two fingers: pinch (and claim the event so the
   * dormant tool never sees it). One finger: dormant - the mounted tool
   * handles the draw/erase move via its own bubble-phase listener.
   */
  private moveCreation(e: PointerEvent): void {
    if (this.pts.length >= 2 && this.pinchStart) {
      e.stopImmediatePropagation();
      this.applyPinch();
    }
  }

  /**
   * Creation-tool pointerup/cancel. Finger bookkeeping only - while two
   * fingers were down the event is claimed; after a 2->1 drop the lingering
   * finger is inert (the tool received no fresh pointerdown for it).
   */
  private upCreation(e: PointerEvent): void {
    if (this.pts.length >= 2) e.stopImmediatePropagation();
    this.pts = this.pts.filter((q) => q.id !== e.pointerId);
    try { this.target.releasePointerCapture?.(e.pointerId); } catch { /* never captured */ }
    if (this.pts.length < 2) this.pinchStart = null;
    if (this.pts.length === 0) this.panStart = null;
  }
}
