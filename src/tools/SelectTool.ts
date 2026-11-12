import type { Store } from '../app/store';
import type { History } from '../app/history';
import type { ToolController } from '../app/tools';
import type { ToolId, SelectionRef, Point } from '../types/primitives';
import { clientToMap, type Viewport } from '../render/coords';
import type { StrokeLayer } from '../render/StrokeLayer';
import type { ShapeLayer } from '../render/ShapeLayer';
import type { ConeLayer } from '../render/ConeLayer';
import type { PlayerLayer } from '../render/PlayerLayer';
import type { QuickAddLayer } from '../render/QuickAddLayer';
import type { TextLayer } from '../render/TextLayer';
import { hitTestMarquee, hitTestLasso } from '../app/selection';
import { hitTestPoint, snapshotSelectionForMove, applyMoveDelta as applyMoveDeltaShared, measureMoveDelta, buildMoveCommands, type MovedItemSnapshot } from '../app/selectionMove';
import {
  coneOrigin, coneArcTip, hitConeHandle,
  type ConeEdit, snapshotConeForEdit, liveConeEdit, commitConeEdit, revertConeEdit,
} from './cone-edit';

export type SelectMode = 'cursor' | 'select' | 'lasso';

const MARQUEE_THRESHOLD_PX = 4;
const GROUP_MOVE_THRESHOLD_MAP = 4;

export interface SelectToolDeps {
  mode: SelectMode;
  store: Store;
  history: History;
  zoomViewport: HTMLElement;
  strokeLayer: StrokeLayer;
  shapeLayer: ShapeLayer;
  coneLayer: ConeLayer;
  playerLayer: PlayerLayer;
  quickAddLayer: QuickAddLayer;
  textLayer: TextLayer;
  getViewport(): Viewport;
}

interface MarqueeDrag {
  startSx: number;
  startSy: number;
  ctrlAtStart: boolean;
  preDragSel: SelectionRef[];
}

interface PanDrag {
  panX0: number;
  panY0: number;
  cx0: number;
  cy0: number;
}

interface GroupMoveDrag {
  startMx: number;
  startMy: number;
  items: MovedItemSnapshot[];
}

export class SelectTool implements ToolController {
  readonly id: ToolId;
  private mode: SelectMode;
  private target: HTMLElement | null = null;
  private marqueeEl: HTMLDivElement | null = null;
  private marquee: MarqueeDrag | null = null;
  private lassoSvg: SVGSVGElement | null = null;
  private lassoPath: SVGPathElement | null = null;
  private lasso: { points: Point[]; ctrlAtStart: boolean; preDragSel: SelectionRef[] } | null = null;
  private moveDrag: GroupMoveDrag | null = null;
  private panDrag: PanDrag | null = null;
  private coneEdit: ConeEdit | null = null;
  private offDown: () => void = () => {};
  private offMove: () => void = () => {};
  private offUp: () => void = () => {};

  constructor(private deps: SelectToolDeps) {
    this.mode = deps.mode;
    this.id = deps.mode;
  }

  attach(target: HTMLElement): void {
    this.target = target;
    if (this.mode === 'select') this.ensureMarqueeEl();
    if (this.mode === 'lasso') this.ensureLassoSvg();


    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      // Once a textbox enters edit mode (its textarea is focused - typically
      // via dblclick), subsequent clicks inside that textarea should land on
      // the native textarea so the user can place the caret or select text.
      // Without this, the SelectTool would intercept and start a drag instead.
      const tgt = e.target as HTMLElement;
      if (tgt.tagName === 'TEXTAREA' && document.activeElement === tgt) return;
      // Resize handles on a textbox / shape are owned by their layers and call
      // stopPropagation themselves, but skip the SelectTool path explicitly
      // anyway: the user dragging a resize handle should never start a
      // parallel group-move.
      if (tgt.classList.contains('tbox-handle') || tgt.classList.contains('shape-handle')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      // A single selected cone exposes drag handles: the arc-centre dot
      // reshapes it (direction + length) and the origin dot moves it (and
      // re-attaches to / detaches from a player on release). Checked before
      // the generic group-move so the dots take priority over the body.
      if (!ctrl && this.tryBeginConeEdit(e)) return;
      // All three modes (cursor / select / lasso) fall back to coordinate-based
      // hit-testing so SVG layers (textboxes/players/cones/quickadds/shapes/strokes)
      // can be picked up directly - the SVG layer roots have pointer-events:none
      // and would otherwise be invisible to DOM-based hit-testing.
      const probe = this.findHitItem(e.target as Element)
        ?? this.findCoordHit(e);
      // Press on a cone that's attached to a player: drag it off to detach.
      // (A press that doesn't actually move just selects it - commitConeEdit
      // no-ops on a zero-movement origin edit.)
      if (!ctrl && this.tryBeginAttachedConeDetach(e, probe)) return;
      if (probe && this.isInSelection(probe) && !ctrl) {
        if (probe.kind === 'textbox') e.preventDefault();
        this.beginGroupMove(e);
        return;
      }
      // Hit on a selectable item: select-and-prepare-to-move in one gesture for
      // every mode (cursor's existing behaviour, now shared with select/lasso so
      // they also feel like a "grab the thing" tool).
      if (probe) {
        if (ctrl) { this.applyClickSelection(probe, true); return; }
        if (!this.isInSelection(probe)) {
          this.deps.store._apply({ selection: [probe] });
        }
        if (probe.kind === 'textbox') e.preventDefault();
        this.beginGroupMove(e);
        return;
      }
      // Empty space. In the select / lasso tools an empty-space left-drag IS
      // the marquee / lasso gesture (no Shift needed); Ctrl/meta merges the
      // result with the prior selection. Map-panning on the left button is a
      // cursor-tool thing only - the select tools rely on the middle mouse
      // button (handled by ViewportController, works in every tool).
      if (this.mode === 'select') { this.beginMarquee(e); return; }
      if (this.mode === 'lasso')  { this.beginLasso(e);   return; }
      // Cursor mode: Ctrl/meta during a pan preserves selection (additive
      // intent); no modifier clears it before panning so the screen quietly
      // resets.
      if (!ctrl) this.deps.store._apply({ selection: [] });
      this.beginPan(e);
    };
    const onMove = (e: PointerEvent): void => {
      if (this.marquee) this.updateMarquee(e);
      if (this.lasso) this.updateLasso(e);
      if (this.moveDrag) this.updateGroupMove(e);
      if (this.panDrag) this.updatePan(e);
      if (this.coneEdit) this.updateConeEdit(e);
    };
    const onUp = (e: PointerEvent): void => {
      if (this.marquee) this.finalizeMarquee(e);
      if (this.lasso) this.finalizeLasso();
      if (this.moveDrag) this.finalizeGroupMove();
      if (this.panDrag) this.finalizePan(e);
      if (this.coneEdit) this.finalizeConeEdit();
    };
    // pointercancel fires when the gesture is interrupted (second touch, OS
    // takeover, etc). Treat that as an abort -- revert any in-flight gesture
    // and dispatch nothing, never commit a half-finished drag as if the user
    // had released. Mirrors the ConeTool pointercancel fix.
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
    // Revert any in-flight gesture before tearing down. Otherwise a tool swap
    // mid-drag leaves the store with live-preview state (moved items, mid-pan
    // view, mid-edit cone) and no command in history to back out of it.
    this.cancel();
    if (this.marqueeEl) {
      this.marqueeEl.remove();
      this.marqueeEl = null;
    }
    if (this.lassoSvg) {
      this.lassoSvg.remove();
      this.lassoSvg = null;
      this.lassoPath = null;
    }
    this.target = null;
  }

  /**
   * Abort whichever drag/edit is currently in flight without dispatching a
   * command. Each gesture's revert path matches its live-preview shape:
   * marquee/lasso never wrote to the store, so we just clear the overlay;
   * group move and cone edit drag-revert items to their pre-drag snapshot;
   * pan snaps view back to where the drag started.
   */
  cancel(): void {
    this.cancelEdits();
    if (this.panDrag) this.cancelPan();
  }

  cancelEdits(): void {
    if (this.marquee) this.cancelMarquee();
    if (this.lasso) this.cancelLasso();
    if (this.moveDrag) this.cancelGroupMove();
    if (this.coneEdit) this.cancelConeEdit();
  }

  private cancelMarquee(): void {
    this.marquee = null;
    this.hideMarquee();
  }

  private cancelLasso(): void {
    this.lasso = null;
    this.clearLassoPath();
  }

  private cancelGroupMove(): void {
    if (!this.moveDrag) return;
    // applyMoveDelta(0, 0) snaps items back to their pre-drag positions via
    // the same shared mover the live-preview uses; we then clear the drag.
    this.applyMoveDelta(0, 0);
    this.moveDrag = null;
  }

  private cancelPan(): void {
    if (!this.panDrag) return;
    this.deps.store._apply({ panX: this.panDrag.panX0, panY: this.panDrag.panY0 });
    this.panDrag = null;
  }

  private cancelConeEdit(): void {
    if (!this.coneEdit) return;
    revertConeEdit(this.deps.store, this.coneEdit);
    this.coneEdit = null;
  }

  // ---- marquee ----

  private ensureMarqueeEl(): void {
    if (this.marqueeEl) return;
    const el = document.createElement('div');
    el.id = 'marquee-rect';
    this.deps.zoomViewport.appendChild(el);
    this.marqueeEl = el;
  }

  private beginMarquee(e: PointerEvent): void {
    const rect = this.deps.zoomViewport.getBoundingClientRect();
    this.marquee = {
      startSx: e.clientX - rect.left,
      startSy: e.clientY - rect.top,
      ctrlAtStart: e.ctrlKey || e.metaKey,
      preDragSel: e.ctrlKey || e.metaKey ? [...this.deps.store.get().selection] : [],
    };
    this.showMarquee(this.marquee.startSx, this.marquee.startSy, 0, 0);
    try { this.target?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  private updateMarquee(e: PointerEvent): void {
    if (!this.marquee) return;
    const rect = this.deps.zoomViewport.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const dx = sx - this.marquee.startSx;
    const dy = sy - this.marquee.startSy;
    const x = dx >= 0 ? this.marquee.startSx : sx;
    const y = dy >= 0 ? this.marquee.startSy : sy;
    this.showMarquee(x, y, Math.abs(dx), Math.abs(dy));
  }

  private finalizeMarquee(e: PointerEvent): void {
    if (!this.marquee) return;
    const md = this.marquee;
    this.marquee = null;
    this.hideMarquee();

    const rect = this.deps.zoomViewport.getBoundingClientRect();
    const ex = e.clientX - rect.left;
    const ey = e.clientY - rect.top;
    const minSx = Math.min(md.startSx, ex);
    const maxSx = Math.max(md.startSx, ex);
    const minSy = Math.min(md.startSy, ey);
    const maxSy = Math.max(md.startSy, ey);

    if (maxSx - minSx < MARQUEE_THRESHOLD_PX && maxSy - minSy < MARQUEE_THRESHOLD_PX) {
      if (!md.ctrlAtStart) this.deps.store._apply({ selection: [] });
      return;
    }

    const v = this.deps.getViewport();
    const tl = clientToMap(rect.left + minSx, rect.top + minSy, v);
    const br = clientToMap(rect.left + maxSx, rect.top + maxSy, v);
    const newSel = hitTestMarquee(this.deps.store.get(), tl, br);
    const merged = md.ctrlAtStart ? mergeRefs(md.preDragSel, newSel) : newSel;
    this.deps.store._apply({ selection: merged });
    // Once a marquee selection is committed, hand off to cursor tool so the
    // user can drag the selection without round-tripping through the rail.
    if (merged.length > 0) this.deps.store._apply({ tool: 'cursor' });
  }

  private showMarquee(x: number, y: number, w: number, h: number): void {
    if (!this.marqueeEl) return;
    this.marqueeEl.style.display = 'block';
    this.marqueeEl.style.left = `${x}px`;
    this.marqueeEl.style.top = `${y}px`;
    this.marqueeEl.style.width = `${w}px`;
    this.marqueeEl.style.height = `${h}px`;
  }

  private hideMarquee(): void {
    if (!this.marqueeEl) return;
    this.marqueeEl.style.display = 'none';
  }

  // ---- lasso ----

  private ensureLassoSvg(): void {
    if (this.lassoSvg) return;
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    svg.id = 'lasso-svg';
    const path = document.createElementNS(SVG_NS, 'path') as SVGPathElement;
    path.id = 'lasso-path';
    svg.appendChild(path);
    this.deps.zoomViewport.appendChild(svg);
    this.lassoSvg = svg;
    this.lassoPath = path;
  }

  private beginLasso(e: PointerEvent): void {
    const rect = this.deps.zoomViewport.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const ctrl = e.ctrlKey || e.metaKey;
    this.lasso = {
      points: [{ x: sx, y: sy }],
      ctrlAtStart: ctrl,
      preDragSel: ctrl ? [...this.deps.store.get().selection] : [],
    };
    this.renderLassoPath();
    try { this.target?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  private updateLasso(e: PointerEvent): void {
    if (!this.lasso) return;
    const rect = this.deps.zoomViewport.getBoundingClientRect();
    this.lasso.points.push({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    this.renderLassoPath();
  }

  private finalizeLasso(): void {
    if (!this.lasso) return;
    const ld = this.lasso;
    this.lasso = null;
    this.clearLassoPath();

    if (ld.points.length < 3) {
      if (!ld.ctrlAtStart) this.deps.store._apply({ selection: [] });
      return;
    }

    const v = this.deps.getViewport();
    const rect = this.deps.zoomViewport.getBoundingClientRect();
    const polygonMap: Point[] = ld.points.map((p) =>
      clientToMap(rect.left + p.x, rect.top + p.y, v),
    );
    const newSel = hitTestLasso(this.deps.store.get(), polygonMap);
    const merged = ld.ctrlAtStart ? mergeRefs(ld.preDragSel, newSel) : newSel;
    this.deps.store._apply({ selection: merged });
    // Hand off to cursor so the lassoed items are immediately draggable.
    if (merged.length > 0) this.deps.store._apply({ tool: 'cursor' });
  }

  private renderLassoPath(): void {
    if (!this.lasso || !this.lassoPath || !this.lassoSvg) return;
    this.lassoSvg.style.display = 'block';
    const pts = this.lasso.points;
    if (pts.length === 0) { this.lassoPath.setAttribute('d', ''); return; }
    let d = `M${pts[0]!.x},${pts[0]!.y}`;
    for (let i = 1; i < pts.length; i++) d += ` L${pts[i]!.x},${pts[i]!.y}`;
    d += ' Z';
    this.lassoPath.setAttribute('d', d);
  }

  private clearLassoPath(): void {
    if (this.lassoPath) this.lassoPath.setAttribute('d', '');
    if (this.lassoSvg) this.lassoSvg.style.display = 'none';
  }

  // ---- hit-test ----

  private findHitItem(target: Element | null): SelectionRef | null {
    if (!target) return null;
    const playerEl = target.closest('[data-player-id]') as HTMLElement | null;
    if (playerEl) return { kind: 'player', id: playerEl.getAttribute('data-player-id')! };
    const coneEl = target.closest('[data-cone-id]') as HTMLElement | null;
    if (coneEl) return { kind: 'cone', id: coneEl.getAttribute('data-cone-id')! };
    const shapeEl = target.closest('[data-shape-id]') as HTMLElement | null;
    if (shapeEl) return { kind: 'shape', id: shapeEl.getAttribute('data-shape-id')! };
    const tbEl = target.closest('[data-tbox-id]') as HTMLElement | null;
    if (tbEl) return { kind: 'textbox', id: tbEl.getAttribute('data-tbox-id')! };
    const qaEl = target.closest('[data-quickadd-id]') as HTMLElement | null;
    if (qaEl) return { kind: 'quickadd', id: qaEl.getAttribute('data-quickadd-id')! };
    const scEl = target.closest('.scanner-el') as HTMLElement | null;
    if (scEl) return { kind: 'scanner', id: 'scanner' };
    return null;
  }

  /**
   * Coordinate-based hit-test fallback for cursor mode.
   * Real browsers treat SVG layers with pointer-events:none descendants as
   * non-interactive for elementFromPoint, so DOM-based hit-test (`findHitItem`)
   * misses every primitive in those layers. This walks the active frame's
   * collections in reverse (topmost wins) and returns the closest hit.
   */
  private findCoordHit(e: PointerEvent): SelectionRef | null {
    const v = this.deps.getViewport();
    const mp = clientToMap(e.clientX, e.clientY, v);
    // 16 map units at zoom=1 matches PlayerTool.PLAYER_HIT_R and reads as
    // roughly the visible player sprite size on screen. Keep that screen-space
    // size constant across zoom - otherwise at high zoom you have to land bang
    // on the centre of a huge sprite. Strokes take a tighter 8, because a line
    // is thin and 16 grabs one when you meant the empty space beside it.
    const zoom = Math.max(0.001, v.zoom);
    return hitTestPoint(this.deps.store.get(), mp, 16 / zoom, 8 / zoom);
  }

  // ---- highlight ----

  private applyClickSelection(hit: SelectionRef, ctrl: boolean): void {
    const cur = [...this.deps.store.get().selection];
    if (ctrl) {
      const idx = cur.findIndex((r) => r.kind === hit.kind && r.id === hit.id);
      if (idx >= 0) cur.splice(idx, 1);
      else cur.push(hit);
      this.deps.store._apply({ selection: cur });
    } else {
      const inSel = cur.some((r) => r.kind === hit.kind && r.id === hit.id);
      if (!inSel) this.deps.store._apply({ selection: [hit] });
    }
  }

  // ---- group move ----

  private isInSelection(ref: SelectionRef): boolean {
    return this.deps.store.get().selection.some(
      (r) => r.kind === ref.kind && r.id === ref.id,
    );
  }

  private beginGroupMove(e: PointerEvent): void {
    const v = this.deps.getViewport();
    const start = clientToMap(e.clientX, e.clientY, v);
    const sel = this.deps.store.get().selection;
    const frame = this.deps.store.get().frames[this.deps.store.get().activeFrameIdx]!;

    const items = snapshotSelectionForMove(frame, sel);
    this.moveDrag = { startMx: start.x, startMy: start.y, items };
    try { this.target?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  private updateGroupMove(e: PointerEvent): void {
    if (!this.moveDrag) return;
    const v = this.deps.getViewport();
    const cur = clientToMap(e.clientX, e.clientY, v);
    const dx = cur.x - this.moveDrag.startMx;
    const dy = cur.y - this.moveDrag.startMy;
    this.applyMoveDelta(dx, dy);
  }

  private applyMoveDelta(dx: number, dy: number): void {
    if (!this.moveDrag) return;
    applyMoveDeltaShared(this.deps.store, this.moveDrag.items, dx, dy);
  }

  private finalizeGroupMove(): void {
    if (!this.moveDrag) return;
    const md = this.moveDrag;
    this.moveDrag = null;

    const state = this.deps.store.get();
    const frame = state.frames[state.activeFrameIdx]!;

    const item0 = md.items[0];
    if (!item0) return;
    const { dx: actualDx, dy: actualDy } = measureMoveDelta(frame, item0);

    const moved = Math.hypot(actualDx, actualDy) > GROUP_MOVE_THRESHOLD_MAP;

    // Always revert to pre-drag state, then dispatch the batch (drag-revert pattern).
    this.moveDrag = md; // restore so applyMoveDelta works
    this.applyMoveDelta(0, 0);
    this.moveDrag = null;

    if (!moved) return;

    const cmds = buildMoveCommands(frame, md.items, actualDx, actualDy);

    if (cmds.length === 0) return;
    if (cmds.length === 1) this.deps.history.dispatch(cmds[0]!);
    else this.deps.history.dispatch({ t: 'batch', cmds });
  }

  // ---- pan (cursor mode left-mouse drag on empty space) ----

  private beginPan(e: PointerEvent): void {
    const s = this.deps.store.get();
    this.panDrag = { panX0: s.panX, panY0: s.panY, cx0: e.clientX, cy0: e.clientY };
    try { this.target?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  private updatePan(e: PointerEvent): void {
    if (!this.panDrag) return;
    const dx = e.clientX - this.panDrag.cx0;
    const dy = e.clientY - this.panDrag.cy0;
    this.deps.store._apply({
      panX: this.panDrag.panX0 + dx,
      panY: this.panDrag.panY0 + dy,
    });
  }

  private finalizePan(e: PointerEvent): void {
    this.panDrag = null;
    try { this.target?.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
  }

  // ---- cone handle edit (when exactly one cone is selected) ----

  /** If exactly one cone is selected and the pointer landed on one of its
   *  handles, start the corresponding edit drag and return true. */
  private tryBeginConeEdit(e: PointerEvent): boolean {
    const sel = this.deps.store.get().selection;
    if (sel.length !== 1 || sel[0]!.kind !== 'cone') return false;
    const frame = this.deps.store.get().frames[this.deps.store.get().activeFrameIdx]!;
    const cone = frame.cones.find((c) => c.id === sel[0]!.id);
    if (!cone) return false;
    const mp = clientToMap(e.clientX, e.clientY, this.deps.getViewport());
    const h = hitConeHandle(cone, coneOrigin(cone, frame), mp);
    if (!h) return false;
    this.coneEdit = { id: cone.id, mode: h, before: snapshotConeForEdit(cone) };
    try { this.target?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    return true;
  }

  /** If the press resolved onto a cone that's attached to a player, select it and
   *  begin an origin-edit drag - liveConeEdit detaches it & follows the cursor,
   *  commitConeEdit re-evaluates the attachment on release. Returns true if started. */
  private tryBeginAttachedConeDetach(e: PointerEvent, probe: SelectionRef | null): boolean {
    if (!probe || probe.kind !== 'cone') return false;
    const s = this.deps.store.get();
    const cone = s.frames[s.activeFrameIdx]!.cones.find((c) => c.id === probe.id);
    if (!cone || cone.attachedPlayerId == null) return false;
    if (!this.isInSelection(probe)) this.deps.store._apply({ selection: [probe] });
    this.coneEdit = { id: cone.id, mode: 'origin', before: snapshotConeForEdit(cone) };
    try { this.target?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    return true;
  }

  private updateConeEdit(e: PointerEvent): void {
    if (!this.coneEdit) return;
    const mp = clientToMap(e.clientX, e.clientY, this.deps.getViewport());
    liveConeEdit(this.deps.store, this.coneEdit, mp);
  }

  private finalizeConeEdit(): void {
    if (!this.coneEdit) return;
    const edit = this.coneEdit;
    this.coneEdit = null;
    commitConeEdit(this.deps.store, this.deps.history, edit);
  }
}

/** Merge two SelectionRef lists, de-duplicating by (kind, id). */
function mergeRefs(a: SelectionRef[], b: SelectionRef[]): SelectionRef[] {
  const out: SelectionRef[] = [...a];
  for (const r of b) {
    if (!out.some((x) => x.kind === r.kind && x.id === r.id)) out.push(r);
  }
  return out;
}
