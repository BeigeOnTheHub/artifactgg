import type { StratState } from './store';
import type { Point, SelectionRef } from '../types/primitives';
import { coneOrigin } from '../tools/cone-edit';

/** Shortest distance from point `p` to the line segment a-b (all in map coords). */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ray-casting point-in-polygon. Polygon is an ordered list of vertices in map coords. */
export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  const n = polygon.length;
  if (n < 3) return false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i]!.x, yi = polygon[i]!.y;
    const xj = polygon[j]!.x, yj = polygon[j]!.y;
    if (((yi > p.y) !== (yj > p.y)) &&
        (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Find the topmost draw stroke whose any point is within `hitRadiusMap` of `mapPoint`.
 * Returns the stroke id, or `null`. Erase strokes are skipped (matches v1).
 * Iterates in reverse so the most-recently-painted stroke wins ties.
 */
export function findStrokeAt(
  state: StratState, mapPoint: Point, hitRadiusMap: number,
): string | null {
  const frame = state.frames[state.activeFrameIdx]!;
  for (let i = frame.strokes.length - 1; i >= 0; i--) {
    const s = frame.strokes[i]!;
    if (s.type === 'erase') continue;
    const r = hitRadiusMap + s.size / 2;
    for (const p of s.points) {
      if (Math.hypot(p.x - mapPoint.x, p.y - mapPoint.y) < r) return s.id;
    }
  }
  return null;
}

/** Rectangle (marquee) hit test. Returns SelectionRefs for every primitive intersecting [tlMap, brMap]. */
export function hitTestMarquee(
  state: StratState, tlMap: Point, brMap: Point,
): SelectionRef[] {
  const frame = state.frames[state.activeFrameIdx]!;
  const refs: SelectionRef[] = [];
  const inRect = (x: number, y: number): boolean =>
    x >= tlMap.x && x <= brMap.x && y >= tlMap.y && y <= brMap.y;

  // Players: centre inside rect.
  for (const p of frame.players) {
    if (inRect(p.x, p.y)) refs.push({ kind: 'player', id: p.id });
  }

  // Cones: BOTH root AND arc-tip inside rect (matches v1 select.js:638-643).
  // Attached cones track the player, so use coneOrigin instead of stale c.x/c.y.
  for (const c of frame.cones) {
    const o = coneOrigin(c, frame);
    const arcX = o.x + Math.cos(c.angle) * c.length;
    const arcY = o.y + Math.sin(c.angle) * c.length;
    if (inRect(o.x, o.y) && inRect(arcX, arcY)) refs.push({ kind: 'cone', id: c.id });
  }

  // Strokes: any point inside rect, draw type only.
  for (const s of frame.strokes) {
    if (s.type === 'erase') continue;
    if (s.points.some((p) => inRect(p.x, p.y))) refs.push({ kind: 'stroke', id: s.id });
  }

  // Shapes: rotated-AABB overlap (centre cx,cy = x+w/2, y+h/2).
  for (const sh of frame.shapes) {
    const cx = sh.x + sh.w / 2;
    const cy = sh.y + sh.h / 2;
    const hw = sh.w / 2, hh = sh.h / 2;
    const rad = sh.rotation * Math.PI / 180;
    const cosA = Math.abs(Math.cos(rad));
    const sinA = Math.abs(Math.sin(rad));
    const aabbHw = hw * cosA + hh * sinA;
    const aabbHh = hw * sinA + hh * cosA;
    if (cx + aabbHw >= tlMap.x && cx - aabbHw <= brMap.x &&
        cy + aabbHh >= tlMap.y && cy - aabbHh <= brMap.y) {
      refs.push({ kind: 'shape', id: sh.id });
    }
  }

  // Textboxes: centre inside rect.
  for (const b of frame.textboxes) {
    if (inRect(b.x + b.w / 2, b.y + b.h / 2)) refs.push({ kind: 'textbox', id: b.id });
  }

  // Quickadds: centre inside rect.
  for (const q of frame.quickadds) {
    if (inRect(q.x, q.y)) refs.push({ kind: 'quickadd', id: q.id });
  }

  // Scanner singleton: centre inside rect.
  if (frame.scanner !== null) {
    if (inRect(frame.scanner.x, frame.scanner.y)) {
      refs.push({ kind: 'scanner', id: 'scanner' });
    }
  }

  return refs;
}

/**
 * Every selectable primitive in the active frame - used by Ctrl+A (select
 * all). Mirrors the marquee/lasso kind order and scanner convention
 * (`{ kind: 'scanner', id: 'scanner' }`), and skips erase strokes for the
 * same reason the marquee does: eraser marks aren't user-selectable objects.
 */
export function allRefs(state: StratState): SelectionRef[] {
  const frame = state.frames[state.activeFrameIdx]!;
  const refs: SelectionRef[] = [];
  for (const p of frame.players) refs.push({ kind: 'player', id: p.id });
  for (const c of frame.cones) refs.push({ kind: 'cone', id: c.id });
  for (const s of frame.strokes) {
    if (s.type !== 'erase') refs.push({ kind: 'stroke', id: s.id });
  }
  for (const sh of frame.shapes) refs.push({ kind: 'shape', id: sh.id });
  for (const b of frame.textboxes) refs.push({ kind: 'textbox', id: b.id });
  for (const q of frame.quickadds) refs.push({ kind: 'quickadd', id: q.id });
  if (frame.scanner !== null) refs.push({ kind: 'scanner', id: 'scanner' });
  return refs;
}

/** Polygon (lasso) hit test. */
export function hitTestLasso(
  state: StratState, polygonMap: Point[],
): SelectionRef[] {
  const frame = state.frames[state.activeFrameIdx]!;
  const refs: SelectionRef[] = [];
  const pip = (x: number, y: number): boolean => pointInPolygon({ x, y }, polygonMap);

  // Players.
  for (const p of frame.players) {
    if (pip(p.x, p.y)) refs.push({ kind: 'player', id: p.id });
  }

  // Cones: BOTH root AND arc-tip inside.
  // Attached cones track the player, so use coneOrigin instead of stale c.x/c.y.
  for (const c of frame.cones) {
    const o = coneOrigin(c, frame);
    const arcX = o.x + Math.cos(c.angle) * c.length;
    const arcY = o.y + Math.sin(c.angle) * c.length;
    if (pip(o.x, o.y) && pip(arcX, arcY)) refs.push({ kind: 'cone', id: c.id });
  }

  // Strokes: any point inside, draw type only.
  for (const s of frame.strokes) {
    if (s.type === 'erase') continue;
    if (s.points.some((p) => pip(p.x, p.y))) refs.push({ kind: 'stroke', id: s.id });
  }

  // Shapes: centre + 4 rotated corners - any one inside selects (matches v1 select.js:712-725).
  for (const sh of frame.shapes) {
    const cx = sh.x + sh.w / 2;
    const cy = sh.y + sh.h / 2;
    const hw = sh.w / 2, hh = sh.h / 2;
    const rad = sh.rotation * Math.PI / 180;
    const cosA = Math.cos(rad), sinA = Math.sin(rad);
    const corners: Point[] = [
      { x: cx, y: cy },
      { x: cx + cosA * hw - sinA * (-hh),    y: cy + sinA * hw + cosA * (-hh) },
      { x: cx + cosA * (-hw) - sinA * (-hh), y: cy + sinA * (-hw) + cosA * (-hh) },
      { x: cx + cosA * hw - sinA * hh,       y: cy + sinA * hw + cosA * hh },
      { x: cx + cosA * (-hw) - sinA * hh,    y: cy + sinA * (-hw) + cosA * hh },
    ];
    if (corners.some((c) => pip(c.x, c.y))) refs.push({ kind: 'shape', id: sh.id });
  }

  // Textboxes: centre inside.
  for (const b of frame.textboxes) {
    if (pip(b.x + b.w / 2, b.y + b.h / 2)) refs.push({ kind: 'textbox', id: b.id });
  }

  // Quickadds: centre inside.
  for (const q of frame.quickadds) {
    if (pip(q.x, q.y)) refs.push({ kind: 'quickadd', id: q.id });
  }

  // Scanner singleton.
  if (frame.scanner !== null) {
    if (pip(frame.scanner.x, frame.scanner.y)) {
      refs.push({ kind: 'scanner', id: 'scanner' });
    }
  }

  return refs;
}

/**
 * Merge two SelectionRef lists, de-duplicating by (kind, id). `a`'s order is
 * preserved; refs from `b` not already present are appended. Shared by the
 * touch marquee (TouchViewportController); the desktop SelectTool keeps its
 * own private equivalent.
 */
export function mergeRefs(a: SelectionRef[], b: SelectionRef[]): SelectionRef[] {
  const out = [...a];
  for (const r of b) {
    if (!out.some((x) => x.kind === r.kind && x.id === r.id)) out.push(r);
  }
  return out;
}

/** Toggle a ref's membership: remove it if present (by kind+id), else append it. */
export function toggleRef(sel: SelectionRef[], ref: SelectionRef): SelectionRef[] {
  const idx = sel.findIndex((x) => x.kind === ref.kind && x.id === ref.id);
  if (idx >= 0) return [...sel.slice(0, idx), ...sel.slice(idx + 1)];
  return [...sel, ref];
}
