import LZString from 'lz-string';
import type { StratFile } from '../types/stratFile';
import {
  emptyFrame,
  type Cone,
  type DashStyle,
  type Frame,
  type Player,
  type Point,
  type QuickAdd,
  type QuickAddType,
  type ScannerPlacement,
  type Shape,
  type ShapeKind,
  type Stroke,
  type Team,
  type TextBox,
} from '../types/primitives';
import { MAPS, type MapId } from '../types/maps';
import { isHex, type Hex } from '../types/hex';
import { sanitiseText } from './sanitiseText';

export type { StratFile };

// Caps so a malicious / corrupted strat from a hash, file, or share link
// can't lock the renderer or blow localStorage. Picked well above any real
// strat we have seen.
const MAX_NOTES_LEN = 64 * 1024;
const MAX_FRAMES = 500;
const MAX_ITEMS_PER_ARRAY = 2000;
const MAX_POINTS_PER_STROKE = 50_000;
const MAX_STRING_LEN = 4096;
const MAX_CAPTION_LEN = 200;
const COORD_MIN = -1e6;
const COORD_MAX = 1e6;

const KNOWN_MAP_IDS: ReadonlySet<MapId> = new Set(MAPS.map((m) => m.id));
const SHAPE_KINDS: ReadonlySet<ShapeKind> = new Set([
  'square', 'circle', 'triangle', 'line', 'arrow',
]);
const QUICK_ADD_TYPES: ReadonlySet<QuickAddType> = new Set([
  'grenade', 'impact_grenade', 'smoke', 'flash', 'thermite', 'vortex_mine', 'scanner',
]);
const TEAMS: ReadonlySet<Team> = new Set(['colonist', 'reyab']);
const STROKE_TYPES: ReadonlySet<'draw' | 'erase'> = new Set(['draw', 'erase']);
const DASH_STYLES_SET: ReadonlySet<DashStyle> = new Set(['solid', 'dashed', 'dotted']);

// Same length-cap as the inline slices, but also strips emoji / control /
// zero-width chars so imported or shared strats get cleaned like typed text.
// Whitespace is left as-is so loading a strat doesn't reflow stored prose.
function cleanText(s: string, maxLen: number, allowNewlines = false): string {
  return sanitiseText(s, { maxLen, allowNewlines, collapseWhitespace: false });
}

export function serialize(f: StratFile): string {
  return JSON.stringify(f);
}

// Same data as serialize() but indented with newlines so a human opening the
// downloaded .strat.json can actually read it. Only used for file exports --
// the #s= hash still rides on the compact serialize() so share links stay short.
export function serializePretty(f: StratFile): string {
  return JSON.stringify(f, null, 2);
}

export function deserialize(s: string): StratFile {
  const parsed = JSON.parse(s) as unknown;
  return normalizeStratFile(parsed);
}

/**
 * Validate and normalise an untrusted strat payload (hash, file, share link or
 * localStorage). A bad top-level shape throws `Invalid strat file`; bad nested
 * items are dropped so one stroke doesn't trash the strat. Numbers are clamped
 * (NaN/Infinity would poison the canvas transform) and arrays/strings capped
 * so a huge notes blob can't blow localStorage.
 */
export function normalizeStratFile(input: unknown): StratFile {
  if (!isPlainObject(input)) throw new Error('Invalid strat file');
  const o = input;

  if (o['v'] !== 2) throw new Error('Invalid strat file');

  const mapRaw = o['map'];
  if (typeof mapRaw !== 'string' || !KNOWN_MAP_IDS.has(mapRaw as MapId)) {
    throw new Error('Invalid strat file');
  }
  const map = mapRaw as MapId;

  if (typeof o['notes'] !== 'string') throw new Error('Invalid strat file');
  const notes = cleanText(o['notes'] as string, MAX_NOTES_LEN, true);

  if (!isPlainObject(o['view'])) throw new Error('Invalid strat file');
  const viewRaw = o['view'];
  const view = {
    zoom: cleanNum(viewRaw['zoom'], 1, 0.01, 100),
    panX: cleanNum(viewRaw['panX'], 0, COORD_MIN, COORD_MAX),
    panY: cleanNum(viewRaw['panY'], 0, COORD_MIN, COORD_MAX),
  };

  if (!Array.isArray(o['frames'])) throw new Error('Invalid strat file');
  if (typeof o['activeFrame'] !== 'number') throw new Error('Invalid strat file');

  const rawFrames = (o['frames'] as unknown[]).slice(0, MAX_FRAMES);
  const frames: Frame[] = [];
  for (const fr of rawFrames) {
    const v = validateFrame(fr);
    if (v) frames.push(v);
  }
  if (frames.length === 0) frames.push(emptyFrame());

  let activeFrame = Math.floor(o['activeFrame'] as number);
  if (!Number.isFinite(activeFrame) || activeFrame < 0 || activeFrame >= frames.length) {
    activeFrame = 0;
  }

  return { v: 2, map, notes, view, frames, activeFrame };
}

function validateFrame(input: unknown): Frame | null {
  if (!isPlainObject(input)) return null;
  if (!Array.isArray(input['strokes'])) return null;
  if (!Array.isArray(input['shapes'])) return null;
  if (!Array.isArray(input['cones'])) return null;
  if (!Array.isArray(input['players'])) return null;
  if (!Array.isArray(input['textboxes'])) return null;
  if (!Array.isArray(input['quickadds'])) return null;
  // scanner is `ScannerPlacement | null`; anything else means a corrupt frame
  if (input['scanner'] !== null && !isPlainObject(input['scanner'])) return null;

  const frame: Frame = {
    strokes: pickValid(input['strokes'] as unknown[], validateStroke),
    shapes: pickValid(input['shapes'] as unknown[], validateShape),
    cones: pickValid(input['cones'] as unknown[], validateCone),
    players: pickValid(input['players'] as unknown[], validatePlayer),
    textboxes: pickValid(input['textboxes'] as unknown[], validateTextBox),
    quickadds: pickValid(input['quickadds'] as unknown[], validateQuickAdd),
    scanner: validateScannerPlacement(input['scanner']),
  };

  const d = input['durationMs'];
  if (typeof d === 'number' && Number.isFinite(d) && d > 0) {
    frame.durationMs = d;
  }
  // Caption: keep only non-empty strings (absent / null / wrong type / empty
  // all collapse to "no caption"). Cap so a malicious payload can't park a
  // million chars next to every frame.
  const c = input['caption'];
  if (typeof c === 'string' && c.length > 0) {
    const cleaned = cleanText(c, MAX_CAPTION_LEN);
    if (cleaned.length > 0) frame.caption = cleaned;
  }
  return frame;
}

function pickValid<T>(items: unknown[], fn: (x: unknown) => T | null): T[] {
  const out: T[] = [];
  const capped = items.slice(0, MAX_ITEMS_PER_ARRAY);
  for (const item of capped) {
    const v = fn(item);
    if (v) out.push(v);
  }
  return out;
}

function validateStroke(input: unknown): Stroke | null {
  if (!isPlainObject(input)) return null;
  const id = cleanId(input['id']);
  if (id == null) return null;
  if (typeof input['type'] !== 'string' || !STROKE_TYPES.has(input['type'] as 'draw' | 'erase')) return null;
  const color = cleanHex(input['color']);
  if (color == null) return null;
  if (!Array.isArray(input['points'])) return null;
  const points: Point[] = [];
  for (const p of (input['points'] as unknown[]).slice(0, MAX_POINTS_PER_STROKE)) {
    const pt = validatePoint(p);
    if (pt) points.push(pt);
  }
  const dashRaw = input['dash'];
  const dash: DashStyle | undefined =
    typeof dashRaw === 'string' && DASH_STYLES_SET.has(dashRaw as DashStyle)
      ? (dashRaw as DashStyle)
      : undefined;
  return {
    id,
    type: input['type'] as 'draw' | 'erase',
    color,
    alpha: cleanNum(input['alpha'], 1, 0, 1),
    size: cleanNum(input['size'], 4, 0.1, 1000),
    points,
    // omit when solid so old saves round-trip unchanged
    ...(dash && dash !== 'solid' ? { dash } : {}),
  };
}

function validatePoint(input: unknown): Point | null {
  if (!isPlainObject(input)) return null;
  if (typeof input['x'] !== 'number' || !Number.isFinite(input['x'])) return null;
  if (typeof input['y'] !== 'number' || !Number.isFinite(input['y'])) return null;
  return { x: input['x'] as number, y: input['y'] as number };
}

function validateShape(input: unknown): Shape | null {
  if (!isPlainObject(input)) return null;
  const id = cleanId(input['id']);
  if (id == null) return null;
  if (typeof input['kind'] !== 'string' || !SHAPE_KINDS.has(input['kind'] as ShapeKind)) return null;
  const stroke = cleanHex(input['stroke']);
  if (stroke == null) return null;
  return {
    id,
    kind: input['kind'] as ShapeKind,
    x: cleanNum(input['x'], 0, COORD_MIN, COORD_MAX),
    y: cleanNum(input['y'], 0, COORD_MIN, COORD_MAX),
    w: cleanNum(input['w'], 0, COORD_MIN, COORD_MAX),
    h: cleanNum(input['h'], 0, COORD_MIN, COORD_MAX),
    rotation: cleanNum(input['rotation'], 0, -Math.PI * 4, Math.PI * 4),
    stroke,
    strokeWidth: cleanNum(input['strokeWidth'], 2, 0.1, 1000),
    fill: input['fill'] === true,
  };
}

function validateCone(input: unknown): Cone | null {
  if (!isPlainObject(input)) return null;
  const id = cleanId(input['id']);
  if (id == null) return null;
  const attachedPlayerId = input['attachedPlayerId'] === undefined
    ? null
    : cleanIdOrNull(input['attachedPlayerId']);
  if (attachedPlayerId === undefined) return null;
  const color = input['color'] == null ? null : cleanHex(input['color']);
  // Free cones (no attached player) must have a colour - matches freeConeColor's invariant.
  if (attachedPlayerId == null && color == null) return null;
  const spreadIdxRaw = input['spreadIdx'];
  if (spreadIdxRaw !== 0 && spreadIdxRaw !== 1 && spreadIdxRaw !== 2) return null;
  const customHalfAngleRaw = input['customHalfAngle'];
  const customHalfAngle = customHalfAngleRaw == null
    ? null
    : (typeof customHalfAngleRaw === 'number' && Number.isFinite(customHalfAngleRaw)
        ? customHalfAngleRaw
        : null);
  return {
    id,
    x: cleanNum(input['x'], 0, COORD_MIN, COORD_MAX),
    y: cleanNum(input['y'], 0, COORD_MIN, COORD_MAX),
    angle: cleanNum(input['angle'], 0, -Math.PI * 4, Math.PI * 4),
    length: cleanNum(input['length'], 130, 0, COORD_MAX),
    spreadIdx: spreadIdxRaw,
    customHalfAngle,
    color,
    attachedPlayerId,
  };
}

function validatePlayer(input: unknown): Player | null {
  if (!isPlainObject(input)) return null;
  const id = cleanId(input['id']);
  if (id == null) return null;
  if (typeof input['team'] !== 'string' || !TEAMS.has(input['team'] as Team)) return null;
  const name = typeof input['name'] === 'string' ? cleanText(input['name'], MAX_STRING_LEN) : '';
  return {
    id,
    team: input['team'] as Team,
    x: cleanNum(input['x'], 0, COORD_MIN, COORD_MAX),
    y: cleanNum(input['y'], 0, COORD_MIN, COORD_MAX),
    name,
    dead: input['dead'] === true,
  };
}

function validateTextBox(input: unknown): TextBox | null {
  if (!isPlainObject(input)) return null;
  const id = cleanId(input['id']);
  if (id == null) return null;
  const color = cleanHex(input['color']);
  if (color == null) return null;
  const text = typeof input['text'] === 'string' ? cleanText(input['text'], MAX_STRING_LEN, true) : '';
  return {
    id,
    x: cleanNum(input['x'], 0, COORD_MIN, COORD_MAX),
    y: cleanNum(input['y'], 0, COORD_MIN, COORD_MAX),
    w: cleanNum(input['w'], 0, COORD_MIN, COORD_MAX),
    h: cleanNum(input['h'], 0, COORD_MIN, COORD_MAX),
    text,
    fontSize: cleanNum(input['fontSize'], 16, 1, 1000),
    color,
  };
}

function validateQuickAdd(input: unknown): QuickAdd | null {
  if (!isPlainObject(input)) return null;
  const id = cleanId(input['id']);
  if (id == null) return null;
  if (typeof input['type'] !== 'string' || !QUICK_ADD_TYPES.has(input['type'] as QuickAddType)) return null;
  return {
    id,
    type: input['type'] as QuickAddType,
    x: cleanNum(input['x'], 0, COORD_MIN, COORD_MAX),
    y: cleanNum(input['y'], 0, COORD_MIN, COORD_MAX),
    rangeVisible: input['rangeVisible'] === true,
  };
}

function validateScannerPlacement(input: unknown): ScannerPlacement | null {
  if (input === null) return null;
  if (!isPlainObject(input)) return null;
  if (typeof input['x'] !== 'number' || !Number.isFinite(input['x'])) return null;
  if (typeof input['y'] !== 'number' || !Number.isFinite(input['y'])) return null;
  return { x: input['x'] as number, y: input['y'] as number };
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function cleanNum(x: unknown, fallback: number, min: number, max: number): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) return fallback;
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

function cleanId(x: unknown): string | null {
  if (typeof x !== 'string' || x.length === 0) return null;
  return x.slice(0, MAX_STRING_LEN);
}

// Returns the cleaned id, null if explicitly null, or undefined on a malformed
// value so callers can tell "absent/null" apart from "garbage".
function cleanIdOrNull(x: unknown): string | null | undefined {
  if (x === null) return null;
  if (typeof x !== 'string' || x.length === 0) return undefined;
  return x.slice(0, MAX_STRING_LEN);
}

function cleanHex(x: unknown): Hex | null {
  if (typeof x !== 'string') return null;
  return isHex(x) ? x : null;
}

export function encodeHash(f: StratFile): string {
  return LZString.compressToEncodedURIComponent(serialize(f));
}

/**
 * Decode a v2-format `#s=...` hash payload. Returns null if the payload is
 * missing, malformed, or a v1-shaped hash. v1 hashes are routed through
 * `app/v1HashDecoder.ts` separately by the boot sequence.
 */
export function decodeHash(s: string): StratFile | null {
  if (!s) return null;
  const raw = LZString.decompressFromEncodedURIComponent(s);
  if (!raw) return null;
  try {
    return deserialize(raw);
  } catch {
    return null;
  }
}

/**
 * Trigger an anchor-click download of the supplied StratFile as a JSON Blob.
 * The filename is the caller's responsibility - produce a stable pattern via
 * the caller (e.g. `artifact-<map>-<YYYYMMDD-HHmm>.strat.json`).
 */
export function writeStratToFile(file: StratFile, filename: string): void {
  const blob = new Blob([serializePretty(file)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the browser actually fires the download on Edge/Chrome.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Parse a `File` (from a `<input type=file>` change event) into a StratFile.
 * Rejects on parse failure or schema mismatch - caller should toast the error.
 */
export function readStratFromFile(file: File): Promise<StratFile> {
  return new Promise<StratFile>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = (): void => reject(reader.error ?? new Error('FileReader error'));
    reader.onload = (): void => {
      try {
        const text = typeof reader.result === 'string' ? reader.result : '';
        resolve(deserialize(text));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    reader.readAsText(file);
  });
}
