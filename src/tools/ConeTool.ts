import { nanoid } from 'nanoid';
import type { Store } from '../app/store';
import type { History } from '../app/history';
import type { Cone, Frame } from '../types/primitives';
import { clientToMap, type Viewport } from '../render/coords';
import type { ToolController } from '../app/tools';
import { TEAM_COLOURS } from '../render/team-colours';
import {
  DEFAULT_CONE_LENGTH, DEFAULT_CONE_SPREAD_IDX, SPREAD_PRESET_LABELS, DEFAULT_CONE_COLOUR,
} from './cone-presets';
import {
  coneOrigin, coneArcTip, hitConeHandle, nearestPlayerForAttach, clampConeLength,
  type ConeEdit, snapshotConeForEdit, liveConeEdit, commitConeEdit, revertConeEdit,
} from './cone-edit';

const RMB_HIT_RADIUS = 12; // map units around origin or arc dot for delete hit-testing

export interface ConeToolDeps {
  store: Store;
  history: History;
  getViewport(): Viewport;
}

export class ConeTool implements ToolController {
  readonly id = 'place-cone' as const;

  private offDown: () => void = () => {};
  private offMove: () => void = () => {};
  private offUp: () => void = () => {};
  private offContext: () => void = () => {};
  private downAt: { x: number; y: number } | null = null;
  private edit: ConeEdit | null = null;
  private spreadIdx: 0 | 1 | 2 = DEFAULT_CONE_SPREAD_IDX;
  private length: number = DEFAULT_CONE_LENGTH;

  setSpread(idx: 0 | 1 | 2): void { this.spreadIdx = idx; }
  getSpread(): 0 | 1 | 2 { return this.spreadIdx; }
  setLength(n: number): void { this.length = clampConeLength(n); }
  getLength(): number { return this.length; }

  constructor(private deps: ConeToolDeps) {}

  attach(target: HTMLElement): void {
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      e.preventDefault();
      const pt = this.toMap(e);
      const frame = this.frame();
      // Handle hit on any cone? Start a reshape (arc dot) or move (origin dot).
      for (let i = frame.cones.length - 1; i >= 0; i--) {
        const c = frame.cones[i]!;
        const h = hitConeHandle(c, coneOrigin(c, frame), pt);
        if (h) {
          this.edit = { id: c.id, mode: h, before: snapshotConeForEdit(c) };
          try { target.setPointerCapture(e.pointerId); } catch { /* ignore */ }
          return;
        }
      }
      this.downAt = pt;
    };

    const onMove = (e: PointerEvent): void => {
      if (!this.edit) return;
      liveConeEdit(this.deps.store, this.edit, this.toMap(e));
    };

    const onUp = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      try { target.releasePointerCapture(e.pointerId); } catch { /* not captured */ }

      if (this.edit) {
        commitConeEdit(this.deps.store, this.deps.history, this.edit);
        this.edit = null;
        return;
      }
      if (!this.downAt) return;
      const up = this.toMap(e);
      const dragged = Math.hypot(up.x - this.downAt.x, up.y - this.downAt.y) > 4;
      const start = this.downAt;
      this.downAt = null;
      if (dragged) return; // a drag on empty space is reserved for handle edits

      const players = this.frame().players;
      const pid = nearestPlayerForAttach(players, start.x, start.y);
      const attachedTo = pid ? players.find((p) => p.id === pid) : undefined;
      const cone: Cone = {
        id: nanoid(),
        x: attachedTo ? attachedTo.x : start.x,
        y: attachedTo ? attachedTo.y : start.y,
        angle: 0,
        length: this.length,
        spreadIdx: this.spreadIdx,
        customHalfAngle: null,
        color: attachedTo ? TEAM_COLOURS[attachedTo.team] : DEFAULT_CONE_COLOUR,
        attachedPlayerId: attachedTo ? pid : null,
      };
      this.deps.history.dispatch({ t: 'cone.add', cone });
    };

    // pointercancel fires when the gesture is interrupted (second touch, OS
    // takes over, etc). Treat that as an abort -- revert any in-flight edit
    // and drop the placement candidate, never commit a half-finished drag.
    const onCancel = (e: PointerEvent): void => {
      try { target.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      this.cancel();
    };

    const onContext = (e: MouseEvent): void => {
      const pt = clientToMap(e.clientX, e.clientY, this.deps.getViewport());
      const frame = this.frame();
      const hit = findConeAt(frame, pt.x, pt.y);
      if (!hit) return;
      e.preventDefault();
      this.deps.history.dispatch({ t: 'cone.delete', ids: [hit.id] });
    };

    target.addEventListener('pointerdown', onDown);
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onCancel);
    target.addEventListener('contextmenu', onContext);
    this.offDown = () => target.removeEventListener('pointerdown', onDown);
    this.offMove = () => target.removeEventListener('pointermove', onMove);
    this.offUp = () => {
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onCancel);
    };
    this.offContext = () => target.removeEventListener('contextmenu', onContext);
  }

  detach(): void {
    this.offDown(); this.offMove(); this.offUp(); this.offContext();
    // Revert any in-flight edit so we don't leave the store in a half-dragged
    // state with no undo entry to recover from when the tool gets re-attached.
    this.cancel();
  }

  /** Abort an in-flight gesture (touch second-finger interruption): revert a
   *  live cone reshape/move to its pre-drag snapshot and drop the placement
   *  candidate. Dispatches no command. */
  cancel(): void {
    if (this.edit) {
      revertConeEdit(this.deps.store, this.edit);
      this.edit = null;
    }
    this.downAt = null;
  }

  // ---- private ----

  private frame(): Frame {
    const s = this.deps.store.get();
    return s.frames[s.activeFrameIdx]!;
  }

  private toMap(e: PointerEvent): { x: number; y: number } {
    return clientToMap(e.clientX, e.clientY, this.deps.getViewport());
  }

  getContextPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'cp-panel cp-panel-cone';

    const spreadLabel = document.createElement('div');
    spreadLabel.className = 'cp-label';
    spreadLabel.textContent = 'SPREAD';
    panel.appendChild(spreadLabel);

    const segmented = document.createElement('div');
    segmented.className = 'cp-segmented';

    ([0, 1, 2] as const).forEach((idx) => {
      const button = document.createElement('button');
      button.className = 'cp-segmented-btn';
      if (idx === this.spreadIdx) button.classList.add('active');
      button.setAttribute('data-spread', String(idx));
      button.textContent = SPREAD_PRESET_LABELS[idx];

      button.addEventListener('click', () => {
        this.setSpread(idx);
        segmented.querySelectorAll('.cp-segmented-btn').forEach((btn) => {
          btn.classList.toggle('active', btn.getAttribute('data-spread') === String(idx));
        });
      });

      segmented.appendChild(button);
    });

    panel.appendChild(segmented);
    // The cone's length/radius is reshaped by dragging the arc-centre handle.
    return panel;
  }
}

/** RMB hit test: matches if the click is within RMB_HIT_RADIUS of the cone
 *  origin (the attached player's position for attached cones) or the arc-tip. */
function findConeAt(frame: Frame, mx: number, my: number): Cone | null {
  for (let i = frame.cones.length - 1; i >= 0; i--) {
    const c = frame.cones[i]!;
    const o = coneOrigin(c, frame);
    if (Math.hypot(o.x - mx, o.y - my) < RMB_HIT_RADIUS) return c;
    const tip = coneArcTip(c, o);
    if (Math.hypot(tip.x - mx, tip.y - my) < RMB_HIT_RADIUS) return c;
  }
  return null;
}
