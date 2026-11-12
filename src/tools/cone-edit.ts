import type { Cone, Frame, Player, Point } from '../types/primitives';
import type { Store } from '../app/store';
import type { History } from '../app/history';
import { TEAM_COLOURS } from '../render/team-colours';
import {
  CONE_ATTACH_THRESHOLD, CONE_HANDLE_HIT_R, DEFAULT_CONE_COLOUR, clampConeLength,
} from './cone-presets';

export { clampConeLength };

/** Resolve a cone's effective origin: the attached player's position when the
 *  attachment resolves, otherwise the cone's own (x, y). */
export function coneOrigin(cone: Cone, frame: Frame): Point {
  if (cone.attachedPlayerId) {
    const p = frame.players.find((x) => x.id === cone.attachedPlayerId);
    if (p) return { x: p.x, y: p.y };
  }
  return { x: cone.x, y: cone.y };
}

/** The midpoint of the sector's arc - where the arc-centre drag handle sits. */
export function coneArcTip(cone: Cone, origin: Point): Point {
  return {
    x: origin.x + cone.length * Math.cos(cone.angle),
    y: origin.y + cone.length * Math.sin(cone.angle),
  };
}

/** Resolve a cone's effective colour: the attached player's team colour when
 *  the attachment resolves, otherwise the cone's own stored colour. Falls back
 *  to the default if a cone is somehow free-standing without a stored colour
 *  (the invariant says it shouldn't be, but we render rather than crash). */
export function coneEffectiveColour(cone: Cone, frame: Frame): string {
  if (cone.attachedPlayerId) {
    const p = frame.players.find((x) => x.id === cone.attachedPlayerId);
    if (p) return TEAM_COLOURS[p.team];
  }
  return cone.color ?? DEFAULT_CONE_COLOUR;
}

/** Hit-test a map point against a cone's drag handles. Origin is checked first
 *  so it wins when both are within range (e.g. a zero-length cone). */
export function hitConeHandle(
  cone: Cone, origin: Point, mp: Point, r = CONE_HANDLE_HIT_R,
): 'origin' | 'arc' | null {
  const dOrigin = Math.hypot(origin.x - mp.x, origin.y - mp.y);
  const tip = coneArcTip(cone, origin);
  const dTip = Math.hypot(tip.x - mp.x, tip.y - mp.y);
  // Nearest wins rather than origin-first. It only matters when both handles are
  // in range, which used to mean a cone shorter than 2r (28 map units, i.e.
  // degenerate) - but the touch radius is now 44 SCREEN px, so at a zoomed-out
  // fit the radius covers the whole cone and origin-first would turn every
  // reshape into a move.
  if (dOrigin > r && dTip > r) return null;
  return dTip < dOrigin ? 'arc' : 'origin';
}

/** The id of the nearest player within the attach threshold of (x, y), or null. */
export function nearestPlayerForAttach(
  players: Player[], x: number, y: number, threshold = CONE_ATTACH_THRESHOLD,
): string | null {
  let best: string | null = null;
  let bestD = threshold;
  for (const p of players) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= bestD) { bestD = d; best = p.id; }
  }
  return best;
}

// ---- shared edit-drag state + commit (used by ConeTool and SelectTool) ----

/** Keys of a Cone that an edit-drag may touch - before/after carry this shape. */
export type ConeEditSnapshot = Pick<Cone, 'x' | 'y' | 'angle' | 'length' | 'attachedPlayerId' | 'color'>;

export interface ConeEdit {
  id: string;
  mode: 'origin' | 'arc';
  before: ConeEditSnapshot;
}

export function snapshotConeForEdit(c: Cone): ConeEditSnapshot {
  return { x: c.x, y: c.y, angle: c.angle, length: c.length, attachedPlayerId: c.attachedPlayerId, color: c.color };
}

function activeFrame(store: Store): Frame {
  const s = store.get();
  return s.frames[s.activeFrameIdx]!;
}

function patchCone(store: Store, id: string, patch: Partial<Cone>): void {
  const s = store.get();
  const idx = s.activeFrameIdx;
  store._apply({
    frames: s.frames.map((f, i) => i === idx
      ? { ...f, cones: f.cones.map((c) => c.id === id ? { ...c, ...patch } : c) }
      : f),
  });
}

/** Live-preview a cone edit from the current pointer position (map coords). */
export function liveConeEdit(store: Store, edit: ConeEdit, mp: Point): void {
  const frame = activeFrame(store);
  const cone = frame.cones.find((c) => c.id === edit.id);
  if (!cone) return;
  if (edit.mode === 'arc') {
    const o = coneOrigin(cone, frame);
    const dx = mp.x - o.x, dy = mp.y - o.y;
    patchCone(store, edit.id, { angle: Math.atan2(dy, dx), length: clampConeLength(Math.hypot(dx, dy)) });
  } else {
    // Detach for the duration of the drag so the preview follows the cursor.
    patchCone(store, edit.id, { x: mp.x, y: mp.y, attachedPlayerId: null });
  }
}

/** Finish a cone edit: drag-revert to `before`, then dispatch one cone.modify. */
export function commitConeEdit(store: Store, history: History, edit: ConeEdit): void {
  const frame = activeFrame(store);
  const cone = frame.cones.find((c) => c.id === edit.id);
  if (!cone) return;

  if (edit.mode === 'arc') {
    const after = { angle: cone.angle, length: cone.length };
    const before = { angle: edit.before.angle, length: edit.before.length };
    patchCone(store, edit.id, before);
    if (after.angle !== before.angle || after.length !== before.length) {
      history.dispatch({ t: 'cone.modify', id: edit.id, before, after });
    }
    return;
  }

  // A plain click on an attached cone (no drag) must not detach it: liveConeEdit
  // was never called, so x/y/attach are untouched. (cone.x/y can be stale
  // attach-time coords once the player has moved, which would otherwise make
  // nearestPlayerForAttach miss and trigger a spurious detach.)
  if (cone.x === edit.before.x && cone.y === edit.before.y
      && cone.attachedPlayerId === edit.before.attachedPlayerId) {
    return;
  }

  // origin move - may attach to / detach from a player.
  const pid = nearestPlayerForAttach(frame.players, cone.x, cone.y);
  const attachChanged = pid !== edit.before.attachedPlayerId;
  let before: Partial<Cone>;
  let after: Partial<Cone>;
  if (attachChanged) {
    before = {
      x: edit.before.x, y: edit.before.y,
      attachedPlayerId: edit.before.attachedPlayerId, color: edit.before.color,
    };
    if (pid) {
      const player = frame.players.find((p) => p.id === pid)!;
      after = { x: player.x, y: player.y, attachedPlayerId: pid, color: TEAM_COLOURS[player.team] };
    } else {
      after = { x: cone.x, y: cone.y, attachedPlayerId: null, color: DEFAULT_CONE_COLOUR };
    }
  } else if (pid) {
    // Dropped back on the same player. liveConeEdit left attachedPlayerId: null
    // in the store; the displayed origin is the player's (via coneOrigin), so
    // the cursor delta is invisible. Snap c.x/c.y to the current player pos and
    // dispatch nothing - no history pollution, no "detached behind your back".
    const player = frame.players.find((p) => p.id === pid)!;
    patchCone(store, edit.id, { x: player.x, y: player.y, attachedPlayerId: pid });
    return;
  } else {
    before = { x: edit.before.x, y: edit.before.y };
    after = { x: cone.x, y: cone.y };
  }
  patchCone(store, edit.id, before);
  if (!coneShallowEqual(before, after)) {
    history.dispatch({ t: 'cone.modify', id: edit.id, before, after });
  }
}

/**
 * Drag-revert a cone edit without dispatching - restores the cone to its
 * pre-drag snapshot. Used when a cone reshape/move drag is interrupted (a
 * second finger lands, pointercancel, the controller detaches) so undo
 * history stays clean. The dispatching finaliser is commitConeEdit.
 */
export function revertConeEdit(store: Store, edit: ConeEdit): void {
  patchCone(store, edit.id, {
    x: edit.before.x, y: edit.before.y, angle: edit.before.angle,
    length: edit.before.length, attachedPlayerId: edit.before.attachedPlayerId,
    color: edit.before.color,
  });
}

/**
 * Resolve the attach state for a cone whose ORIGIN ended at (x, y) after a
 * whole-cone group move, returning the `before`/`after` payloads for its
 * cone.modify. `prior` is the cone's attach state from before the drag.
 * Always returns `x`/`y`; adds `attachedPlayerId`/`color` only when the
 * attachment changed.
 */
export function coneMoveAttachPayload(
  frame: Frame,
  x: number, y: number,
  beforeX: number, beforeY: number,
  prior: { attachedPlayerId: string | null; color: Cone['color'] },
): { before: Partial<Cone>; after: Partial<Cone> } {
  const pid = nearestPlayerForAttach(frame.players, x, y);
  if (pid === prior.attachedPlayerId) {
    return { before: { x: beforeX, y: beforeY }, after: { x, y } };
  }
  const before: Partial<Cone> = { x: beforeX, y: beforeY, attachedPlayerId: prior.attachedPlayerId, color: prior.color };
  if (pid) {
    const player = frame.players.find((p) => p.id === pid)!;
    return { before, after: { x: player.x, y: player.y, attachedPlayerId: pid, color: TEAM_COLOURS[player.team] } };
  }
  return { before, after: { x, y, attachedPlayerId: null, color: DEFAULT_CONE_COLOUR } };
}

function coneShallowEqual(a: Partial<Cone>, b: Partial<Cone>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Cone>;
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}
