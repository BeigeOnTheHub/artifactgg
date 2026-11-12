import LZString from 'lz-string';
import type { StratFile } from '../types/stratFile';
import {
  emptyFrame,
  type Frame,
  type Stroke,
  type Point,
  type Player,
  type Cone,
  type TextBox,
  type Shape,
  type QuickAdd,
  type ScannerPlacement,
  type ShapeKind,
  type QuickAddType,
  type Team,
} from '../types/primitives';
import type { MapId } from '../types/maps';
import { hex, isHex, type Hex } from '../types/hex';
import { DEFAULT_CONE_COLOUR } from '../tools/cone-presets';

const KNOWN_MAPS: MapId[] = ['suna', 'miru', 'khidi', 'cliffside', 'frio', 'kiiro'];
const FALLBACK_MAP: MapId = 'suna';
const FALLBACK_COLOUR: Hex = hex('#00ff88');
// v1 text boxes never stored a colour -- they were always white on a dark
// panel -- so that's what we give the migrated boxes.
const TEXTBOX_DEFAULT_COLOUR: Hex = hex('#ffffff');

const SHAPE_KINDS: ReadonlySet<ShapeKind> = new Set(['square', 'circle', 'triangle', 'line', 'arrow']);
const QUICK_ADD_TYPES: ReadonlySet<QuickAddType> = new Set([
  'grenade', 'impact_grenade', 'smoke', 'flash', 'thermite', 'vortex_mine', 'scanner',
]);
const TEAMS: ReadonlySet<Team> = new Set(['colonist', 'reyab']);

/** Categories the v1 decoder found in the source but couldn't migrate at all
 *  (every item in them was malformed). Normally empty now that every layer is
 *  migrated; surfaced by main.ts as a toast just in case. */
export type V1DroppedKind = 'players' | 'cones' | 'text' | 'scanner' | 'shapes' | 'quick-adds';

export interface V1DecodeResult {
  file: StratFile;
  droppedKinds: V1DroppedKind[];
}

/**
 * Decode a v1 share string into a v2 `StratFile` (see vailscan.gg/js/app/app-state.js).
 * Two shapes:
 *
 *  - a single board: `'L' + lz(JSON([version, mapId, players, cones, textboxes,
 *    scanner, strokes, shapes?, quickadds?, desc?, callouts?]))`, version 3 or 4.
 *  - an animation: `'A' + lz(JSON(['A1', activeFrame, [frameCode, ...]]))`, each
 *    frameCode a single-board code -> one v2 frame each.
 *
 * Coordinates share the 1920x1080 space so they carry over as is. Returns null
 * on anything unrecognised.
 */
export function decodeV1Hash(input: string): V1DecodeResult | null {
  if (!input) return null;
  if (input.startsWith('A')) return decodeAnimation(input);
  if (input.startsWith('L')) return decodeSingle(input);
  return null;
}

/**
 * Looser entry point for the file-import button: a user might hand us a raw v1
 * code with no `#` in front, or even the decompressed packed array as JSON.
 * Tries the lot before giving up.
 */
export function tryDecodeV1Text(text: string): V1DecodeResult | null {
  const t = text.trim();
  if (t === '') return null;
  // An 'L'/'A' share code (with or without a leading '#').
  const code = t.startsWith('#') ? t.slice(1) : t;
  const asHash = decodeV1Hash(code);
  if (asHash) return asHash;
  // The raw packed array as JSON (single board or animation envelope).
  let parsed: unknown;
  try { parsed = JSON.parse(t); } catch { return null; }
  if (Array.isArray(parsed)) {
    if (parsed[0] === 'A1') return assembleAnimation(parsed);
    const state = parseV1State(parsed);
    if (state) return singleResult(state, parsed);
  }
  return null;
}

function decodeSingle(code: string): V1DecodeResult | null {
  const packed = decompressToArray(code.slice(1));
  if (!packed) return null;
  const state = parseV1State(packed);
  if (!state) return null;
  return singleResult(state, packed);
}

function decodeAnimation(code: string): V1DecodeResult | null {
  const packed = decompressToArray(code.slice(1));
  if (!packed) return null;
  return assembleAnimation(packed);
}

function assembleAnimation(packed: unknown[]): V1DecodeResult | null {
  if (packed[0] !== 'A1') return null;
  const codes = packed[2];
  if (!Array.isArray(codes) || codes.length === 0) return null;

  const frames: Frame[] = [];
  const dropped = new Set<V1DroppedKind>();
  let mapId: MapId = FALLBACK_MAP;
  let notes = '';
  let first = true;

  for (const c of codes) {
    if (typeof c !== 'string') continue;
    const inner = decompressToArray(c.startsWith('L') ? c.slice(1) : c);
    if (!inner) continue;
    const state = parseV1State(inner);
    if (!state) continue;
    if (first) { mapId = state.mapId; notes = state.notes; first = false; }
    state.dropped.forEach((d) => dropped.add(d));
    frames.push(state.frame);
  }
  if (frames.length === 0) return null;

  let activeFrame = Math.floor(numOr(packed[1], 0));
  if (!Number.isFinite(activeFrame) || activeFrame < 0 || activeFrame >= frames.length) activeFrame = 0;

  return {
    file: { v: 2, map: mapId, notes, view: { zoom: 1, panX: 0, panY: 0 }, frames, activeFrame },
    droppedKinds: [...dropped],
  };
}

function singleResult(
  state: { mapId: MapId; frame: Frame; notes: string; dropped: V1DroppedKind[] },
  _packed: unknown[],
): V1DecodeResult {
  return {
    file: {
      v: 2,
      map: state.mapId,
      notes: state.notes,
      view: { zoom: 1, panX: 0, panY: 0 },
      frames: [state.frame],
      activeFrame: 0,
    },
    droppedKinds: state.dropped,
  };
}

interface V1State {
  mapId: MapId;
  frame: Frame;
  notes: string;
  dropped: V1DroppedKind[];
}

function parseV1State(packed: unknown[]): V1State | null {
  const version = packed[0];
  if (version !== 3 && version !== 4) return null;

  const mapId = coerceMap(packed[1]);
  const v4 = version === 4;
  const playersRaw = packed[2];
  const conesRaw = packed[3];
  const textRaw = packed[4];
  const scannerRaw = packed[5];
  const strokesRaw = packed[6];
  const shapesRaw = v4 ? packed[7] : [];
  const quickRaw = v4 ? packed[8] : [];
  const notes = v4 && typeof packed[9] === 'string' ? (packed[9] as string) : '';

  const players = parsePlayers(playersRaw);
  const cones = parseCones(conesRaw);
  const textboxes = parseTextboxes(textRaw);
  const strokes = parseStrokes(strokesRaw);
  const shapes = parseShapes(shapesRaw);
  const quickadds = parseQuickAdds(quickRaw);
  const scanner = parseScanner(scannerRaw);

  const frame: Frame = {
    ...emptyFrame(),
    players,
    cones,
    textboxes,
    quickadds,
    strokes,
    shapes,
    scanner,
  };

  // Report a category as dropped only if the source had items but none made it
  // through (so a partially-bad payload doesn't cry wolf).
  const dropped: V1DroppedKind[] = [];
  if (srcLen(playersRaw) > 0 && players.length === 0) dropped.push('players');
  if (srcLen(conesRaw) > 0 && cones.length === 0) dropped.push('cones');
  if (srcLen(textRaw) > 0 && textboxes.length === 0) dropped.push('text');
  if (srcLen(shapesRaw) > 0 && shapes.length === 0) dropped.push('shapes');
  if (srcLen(quickRaw) > 0 && quickadds.length === 0) dropped.push('quick-adds');
  if (scannerRaw != null && scanner == null) dropped.push('scanner');

  return { mapId, frame, notes, dropped };
}

// ---- per-layer migration ----

function parsePlayers(raw: unknown): Player[] {
  if (!Array.isArray(raw)) return [];
  // v1 row: [id, team, x, y, order, dead?1:0, name]. Sort by the stored order
  // so the migrated array keeps the v1 ordering (v2 numbers players by index).
  const rows: Array<{ order: number; player: Player }> = [];
  for (const r of raw) {
    if (!Array.isArray(r) || r.length < 4) continue;
    const id = coerceId(r[0]);
    if (id == null) continue;
    const team = r[1];
    if (typeof team !== 'string' || !TEAMS.has(team as Team)) continue;
    rows.push({
      order: numOr(r[4], rows.length),
      player: {
        id,
        team: team as Team,
        x: numOr(r[2], 0),
        y: numOr(r[3], 0),
        name: typeof r[6] === 'string' ? r[6] : '',
        dead: r[5] === 1 || r[5] === true,
      },
    });
  }
  rows.sort((a, b) => a.order - b.order);
  return rows.map((row) => row.player);
}

function parseCones(raw: unknown): Cone[] {
  if (!Array.isArray(raw)) return [];
  // v1 row: [id, x, y, angle, length, spreadIdx, customHalfAngle|null, attached|null].
  const out: Cone[] = [];
  for (const r of raw) {
    if (!Array.isArray(r) || r.length < 6) continue;
    const id = coerceId(r[0]);
    if (id == null) continue;
    let spreadIdx: 0 | 1 | 2 = 1;
    if (r[5] === 0 || r[5] === 1 || r[5] === 2) spreadIdx = r[5];
    const cha = r[6];
    const customHalfAngle = typeof cha === 'number' && Number.isFinite(cha) ? cha : null;
    const attachedPlayerId = r[7] == null ? null : coerceId(r[7]);
    out.push({
      id,
      x: numOr(r[1], 0),
      y: numOr(r[2], 0),
      angle: numOr(r[3], 0),
      length: numOr(r[4], 130),
      spreadIdx,
      customHalfAngle,
      // v1 derived an attached cone's colour from its player and gave free
      // cones a neutral grey -- v2 does the same, but needs the grey stored.
      color: attachedPlayerId == null ? DEFAULT_CONE_COLOUR : null,
      attachedPlayerId,
    });
  }
  return out;
}

function parseTextboxes(raw: unknown): TextBox[] {
  if (!Array.isArray(raw)) return [];
  // v1 row: [id, x, y, w, h, text, fontSize].
  const out: TextBox[] = [];
  for (const r of raw) {
    if (!Array.isArray(r) || r.length < 5) continue;
    const id = coerceId(r[0]);
    if (id == null) continue;
    const fontSize = numOr(r[6], 13);
    out.push({
      id,
      x: numOr(r[1], 0),
      y: numOr(r[2], 0),
      w: numOr(r[3], 0),
      h: numOr(r[4], 0),
      text: typeof r[5] === 'string' ? r[5] : '',
      fontSize: fontSize > 0 ? fontSize : 13,
      color: TEXTBOX_DEFAULT_COLOUR,
    });
  }
  return out;
}

function parseShapes(raw: unknown): Shape[] {
  if (!Array.isArray(raw)) return [];
  // v1 row: [id, type, cx, cy, w, h, rotation(deg), color, strokeWidth, fill?1:0].
  // v1 stored a centre + size and rotated about the centre; v2 stores a
  // top-left + size for boxes, and start + signed delta for lines/arrows.
  const out: Shape[] = [];
  for (const r of raw) {
    if (!Array.isArray(r) || r.length < 8) continue;
    const id = coerceId(r[0]);
    if (id == null) continue;
    const kind = r[1];
    if (typeof kind !== 'string' || !SHAPE_KINDS.has(kind as ShapeKind)) continue;
    const cx = numOr(r[2], 0);
    const cy = numOr(r[3], 0);
    const w = numOr(r[4], 0);
    const h = numOr(r[5], 0);
    const rotationDeg = numOr(r[6], 0);
    const stroke = coerceColour(r[7], FALLBACK_COLOUR);
    const strokeWidth = numOr(r[8], 2);
    const fill = r[9] === 1 || r[9] === true;

    if (kind === 'line' || kind === 'arrow') {
      // Bake the v1 rotation into the endpoints so v2 can draw it as a plain
      // start -> start+delta segment with no rotation of its own.
      const th = (rotationDeg * Math.PI) / 180;
      const halfX = (w / 2) * Math.cos(th);
      const halfY = (w / 2) * Math.sin(th);
      out.push({
        id,
        kind: kind as ShapeKind,
        x: cx - halfX,
        y: cy - halfY,
        w: halfX * 2,
        h: halfY * 2,
        rotation: 0,
        stroke,
        strokeWidth,
        fill: false,
      });
    } else {
      out.push({
        id,
        kind: kind as ShapeKind,
        x: cx - w / 2,
        y: cy - h / 2,
        w,
        h,
        // v2 renders rotation as SVG degrees about the box centre, same as v1.
        rotation: rotationDeg,
        stroke,
        strokeWidth,
        fill,
      });
    }
  }
  return out;
}

function parseQuickAdds(raw: unknown): QuickAdd[] {
  if (!Array.isArray(raw)) return [];
  // v1 row: [id, type, x, y].
  const out: QuickAdd[] = [];
  for (const r of raw) {
    if (!Array.isArray(r) || r.length < 4) continue;
    const id = coerceId(r[0]);
    if (id == null) continue;
    const type = r[1];
    if (typeof type !== 'string' || !QUICK_ADD_TYPES.has(type as QuickAddType)) continue;
    out.push({
      id,
      type: type as QuickAddType,
      x: numOr(r[2], 0),
      y: numOr(r[3], 0),
      rangeVisible: false,
    });
  }
  return out;
}

function parseScanner(raw: unknown): ScannerPlacement | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const x = raw[0];
  const y = raw[1];
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
}

function parseStrokes(raw: unknown): Stroke[] {
  if (!Array.isArray(raw)) return [];
  // v1 row: [id, erase?1:0, color, alpha, size, points[[x,y], ...]].
  const out: Stroke[] = [];
  for (const r of raw) {
    if (!Array.isArray(r) || r.length < 6) continue;
    const id = coerceId(r[0]);
    if (id == null) continue;
    const [, eraseFlag, color, alpha, size, pts] = r as [unknown, unknown, unknown, unknown, unknown, unknown];
    if (typeof alpha !== 'number' || typeof size !== 'number') continue;
    if (!Array.isArray(pts)) continue;
    const points: Point[] = [];
    for (const p of pts) {
      if (!Array.isArray(p) || p.length < 2) continue;
      const [x, y] = p as [unknown, unknown];
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      points.push({ x, y });
    }
    out.push({
      id,
      type: eraseFlag === 1 ? 'erase' : 'draw',
      color: typeof color === 'string' && isHex(color) ? color : FALLBACK_COLOUR,
      alpha,
      size,
      points,
    });
  }
  return out;
}

// ---- helpers ----

function decompressToArray(payload: string): unknown[] | null {
  const raw = LZString.decompressFromEncodedURIComponent(payload);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function coerceMap(v: unknown): MapId {
  if (typeof v !== 'string') return FALLBACK_MAP;
  return KNOWN_MAPS.includes(v as MapId) ? (v as MapId) : FALLBACK_MAP;
}

// v1 ids could be numbers (auto-increment counters) or strings; v2 wants
// strings. Coerce both so cone->player attachment links stay consistent.
function coerceId(v: unknown): string | null {
  if (typeof v === 'string') return v.length > 0 ? v : null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function coerceColour(v: unknown, fallback: Hex): Hex {
  return typeof v === 'string' && isHex(v) ? v : fallback;
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function srcLen(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}
