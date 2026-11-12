import type { StratState, Store } from './store';
import type { Cone, SelectionRef, Point, Frame } from '../types/primitives';
import type { Command } from '../types/commands';
import { distToSegment, findStrokeAt } from './selection';
import { halfAngleRad } from '../tools/cone-presets';
import { coneOrigin, coneArcTip, coneMoveAttachPayload } from '../tools/cone-edit';

/**
 * Coordinate-based hit-test over the active frame, topmost-first, shared by the
 * desktop cursor tool and the touch controller. Pure: no DOM, no events.
 *
 * `strokeHitR` is separate because a stroke is a thin line: the cursor tool uses
 * 16 screen px for a player but only 8 for a stroke, or you grab a line when you
 * meant the empty space beside it. Defaults to `hitR`.
 */
export function hitTestPoint(
  state: StratState, mp: Point, hitR: number, strokeHitR: number = hitR,
): SelectionRef | null {
  const frame = state.frames[state.activeFrameIdx]!;

  for (let i = frame.players.length - 1; i >= 0; i--) {
    const p = frame.players[i]!;
    if (Math.hypot(p.x - mp.x, p.y - mp.y) < hitR) return { kind: 'player', id: p.id };
  }
  for (let i = frame.quickadds.length - 1; i >= 0; i--) {
    const q = frame.quickadds[i]!;
    if (Math.hypot(q.x - mp.x, q.y - mp.y) < hitR) return { kind: 'quickadd', id: q.id };
  }
  for (let i = frame.cones.length - 1; i >= 0; i--) {
    const c = frame.cones[i]!;
    const o = coneOrigin(c, frame);
    if (Math.hypot(o.x - mp.x, o.y - mp.y) < hitR) return { kind: 'cone', id: c.id };
    const tip = coneArcTip(c, o);
    if (Math.hypot(tip.x - mp.x, tip.y - mp.y) < hitR) return { kind: 'cone', id: c.id };
    const dx = mp.x - o.x;
    const dy = mp.y - o.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0 && dist <= c.length) {
      const ha = halfAngleRad(c.spreadIdx, c.customHalfAngle);
      let delta = Math.atan2(dy, dx) - c.angle;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      if (Math.abs(delta) <= ha) return { kind: 'cone', id: c.id };
    }
  }
  for (let i = frame.textboxes.length - 1; i >= 0; i--) {
    const b = frame.textboxes[i]!;
    if (mp.x >= b.x && mp.x <= b.x + b.w && mp.y >= b.y && mp.y <= b.y + b.h) {
      return { kind: 'textbox', id: b.id };
    }
  }
  for (let i = frame.shapes.length - 1; i >= 0; i--) {
    const sh = frame.shapes[i]!;
    if (sh.kind === 'line' || sh.kind === 'arrow') {
      if (distToSegment(mp, { x: sh.x, y: sh.y }, { x: sh.x + sh.w, y: sh.y + sh.h }) <= hitR) {
        return { kind: 'shape', id: sh.id };
      }
      continue;
    }
    const cx = sh.x + sh.w / 2;
    const cy = sh.y + sh.h / 2;
    const hw = sh.w / 2, hh = sh.h / 2;
    const rad = sh.rotation * Math.PI / 180;
    const cosA = Math.abs(Math.cos(rad));
    const sinA = Math.abs(Math.sin(rad));
    const aabbHw = hw * cosA + hh * sinA;
    const aabbHh = hw * sinA + hh * cosA;
    if (Math.abs(mp.x - cx) <= aabbHw && Math.abs(mp.y - cy) <= aabbHh) {
      return { kind: 'shape', id: sh.id };
    }
  }
  if (frame.scanner) {
    if (Math.hypot(frame.scanner.x - mp.x, frame.scanner.y - mp.y) < hitR * 2) {
      return { kind: 'scanner', id: 'scanner' };
    }
  }
  // Strokes last, so anything drawn on top of one still wins. They live here,
  // not in SelectTool, because touch and long-press delete only call this.
  const strokeId = findStrokeAt(state, mp, strokeHitR);
  if (strokeId) return { kind: 'stroke', id: strokeId };
  return null;
}

export interface MovedItemSnapshot {
  ref: SelectionRef;
  beforeX: number;
  beforeY: number;
  /** For strokes: deep copy of original points. */
  strokeBefore?: Point[];
  /** For cones: attach/colour state before the move. */
  coneBefore?: { attachedPlayerId: string | null; color: Cone['color'] };
}

/** Snapshot every selected item's pre-drag position (the beginGroupMove loop). */
export function snapshotSelectionForMove(frame: Frame, sel: SelectionRef[]): MovedItemSnapshot[] {
  const items: MovedItemSnapshot[] = [];
  for (const ref of sel) {
    if (ref.kind === 'player') {
      const p = frame.players.find((x) => x.id === ref.id);
      if (p) items.push({ ref, beforeX: p.x, beforeY: p.y });
    } else if (ref.kind === 'cone') {
      const c = frame.cones.find((x) => x.id === ref.id);
      // An attached cone's own x/y goes stale once its player moves alone, so
      // start from where it's actually drawn.
      if (c) {
        const o = coneOrigin(c, frame);
        items.push({ ref, beforeX: o.x, beforeY: o.y, coneBefore: { attachedPlayerId: c.attachedPlayerId, color: c.color } });
      }
    } else if (ref.kind === 'shape') {
      const sh = frame.shapes.find((x) => x.id === ref.id);
      if (sh) items.push({ ref, beforeX: sh.x, beforeY: sh.y });
    } else if (ref.kind === 'textbox') {
      const b = frame.textboxes.find((x) => x.id === ref.id);
      if (b) items.push({ ref, beforeX: b.x, beforeY: b.y });
    } else if (ref.kind === 'quickadd') {
      const q = frame.quickadds.find((x) => x.id === ref.id);
      if (q) items.push({ ref, beforeX: q.x, beforeY: q.y });
    } else if (ref.kind === 'stroke') {
      const st = frame.strokes.find((x) => x.id === ref.id);
      if (st) items.push({ ref, beforeX: 0, beforeY: 0, strokeBefore: st.points.map((p) => ({ x: p.x, y: p.y })) });
    }
    if (ref.kind === 'scanner' && frame.scanner) {
      items.push({ ref, beforeX: frame.scanner.x, beforeY: frame.scanner.y });
    }
  }
  return items;
}

/** Live-preview the move by writing the active frame (the applyMoveDelta body). */
export function applyMoveDelta(store: Store, items: MovedItemSnapshot[], dx: number, dy: number): void {
  const stateNow = store.get();
  const idx = stateNow.activeFrameIdx;
  const frame = stateNow.frames[idx]!;
  const findItem = (kind: SelectionRef['kind'], id: string): MovedItemSnapshot | undefined =>
    items.find((it) => it.ref.kind === kind && it.ref.id === id);

  const newPlayers = frame.players.map((p) => {
    const it = findItem('player', p.id);
    return it ? { ...p, x: it.beforeX + dx, y: it.beforeY + dy } : p;
  });
  const newCones = frame.cones.map((c) => {
    const it = findItem('cone', c.id);
    return it ? { ...c, x: it.beforeX + dx, y: it.beforeY + dy } : c;
  });
  const newShapes = frame.shapes.map((sh) => {
    const it = findItem('shape', sh.id);
    return it ? { ...sh, x: it.beforeX + dx, y: it.beforeY + dy } : sh;
  });
  const newTboxes = frame.textboxes.map((b) => {
    const it = findItem('textbox', b.id);
    return it ? { ...b, x: it.beforeX + dx, y: it.beforeY + dy } : b;
  });
  const newQAs = frame.quickadds.map((q) => {
    const it = findItem('quickadd', q.id);
    return it ? { ...q, x: it.beforeX + dx, y: it.beforeY + dy } : q;
  });
  const newStrokes = frame.strokes.map((st) => {
    const it = findItem('stroke', st.id);
    if (!it || !it.strokeBefore) return st;
    return { ...st, points: it.strokeBefore.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  });
  const scannerItem = items.find((it) => it.ref.kind === 'scanner');
  const newScanner = scannerItem && frame.scanner
    ? { x: scannerItem.beforeX + dx, y: scannerItem.beforeY + dy }
    : frame.scanner;

  store._apply({
    frames: stateNow.frames.map((f, i) => i === idx
      ? { ...f, players: newPlayers, cones: newCones, shapes: newShapes,
          textboxes: newTboxes, quickadds: newQAs, strokes: newStrokes, scanner: newScanner }
      : f),
  });
}

/** Read the realised delta from item0's current vs before position. */
export function measureMoveDelta(frame: Frame, item0: MovedItemSnapshot): { dx: number; dy: number } {
  const ref = item0.ref;
  if (ref.kind === 'player') {
    const p = frame.players.find((x) => x.id === ref.id);
    if (p) return { dx: p.x - item0.beforeX, dy: p.y - item0.beforeY };
  } else if (ref.kind === 'cone') {
    const c = frame.cones.find((x) => x.id === ref.id);
    if (c) return { dx: c.x - item0.beforeX, dy: c.y - item0.beforeY };
  } else if (ref.kind === 'shape') {
    const sh = frame.shapes.find((x) => x.id === ref.id);
    if (sh) return { dx: sh.x - item0.beforeX, dy: sh.y - item0.beforeY };
  } else if (ref.kind === 'textbox') {
    const b = frame.textboxes.find((x) => x.id === ref.id);
    if (b) return { dx: b.x - item0.beforeX, dy: b.y - item0.beforeY };
  } else if (ref.kind === 'quickadd') {
    const q = frame.quickadds.find((x) => x.id === ref.id);
    if (q) return { dx: q.x - item0.beforeX, dy: q.y - item0.beforeY };
  } else if (ref.kind === 'stroke' && item0.strokeBefore && item0.strokeBefore.length > 0) {
    const st = frame.strokes.find((x) => x.id === ref.id);
    const before0 = item0.strokeBefore[0]!;
    if (st && st.points.length > 0) return { dx: st.points[0]!.x - before0.x, dy: st.points[0]!.y - before0.y };
  } else if (ref.kind === 'scanner' && frame.scanner) {
    return { dx: frame.scanner.x - item0.beforeX, dy: frame.scanner.y - item0.beforeY };
  }
  return { dx: 0, dy: 0 };
}

/** Build the undoable command(s) for a committed move (the finalizeGroupMove builder). */
export function buildMoveCommands(frame: Frame, items: MovedItemSnapshot[], dx: number, dy: number): Command[] {
  const cmds: Command[] = [];
  for (const item of items) {
    if (item.ref.kind === 'player') {
      cmds.push({ t: 'player.modify', id: item.ref.id,
        before: { x: item.beforeX, y: item.beforeY },
        after: { x: item.beforeX + dx, y: item.beforeY + dy } });
    } else if (item.ref.kind === 'cone' && item.coneBefore) {
      const { before, after } = coneMoveAttachPayload(
        frame, item.beforeX + dx, item.beforeY + dy,
        item.beforeX, item.beforeY, item.coneBefore);
      cmds.push({ t: 'cone.modify', id: item.ref.id, before, after });
    } else if (item.ref.kind === 'shape') {
      cmds.push({ t: 'shape.modify', id: item.ref.id,
        before: { x: item.beforeX, y: item.beforeY },
        after: { x: item.beforeX + dx, y: item.beforeY + dy } });
    } else if (item.ref.kind === 'textbox') {
      cmds.push({ t: 'textbox.modify', id: item.ref.id,
        before: { x: item.beforeX, y: item.beforeY },
        after: { x: item.beforeX + dx, y: item.beforeY + dy } });
    } else if (item.ref.kind === 'quickadd') {
      cmds.push({ t: 'quickadd.modify', id: item.ref.id,
        before: { x: item.beforeX, y: item.beforeY },
        after: { x: item.beforeX + dx, y: item.beforeY + dy } });
    } else if (item.ref.kind === 'stroke' && item.strokeBefore) {
      const orig = frame.strokes.find((s) => s.id === item.ref.id);
      if (!orig) continue;
      const shifted = item.strokeBefore.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      cmds.push({ t: 'stroke.erase', ids: [item.ref.id] });
      cmds.push({ t: 'stroke.add', stroke: { ...orig, points: shifted } });
    }
    if (item.ref.kind === 'scanner') {
      cmds.push({ t: 'scanner.place', scanner: { x: item.beforeX + dx, y: item.beforeY + dy } });
    }
  }
  return cmds;
}
