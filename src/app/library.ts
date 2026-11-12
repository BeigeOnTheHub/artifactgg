import type { StratFile } from '../types/stratFile';
import type { MapId } from '../types/maps';
import { nanoid } from 'nanoid';
import { serialize, deserialize } from './persistence';
import { sanitiseTags } from './sanitiseText';

export const INDEX_KEY = 'artifact-gg.v2.library.index';
export const ENTRY_PREFIX = 'artifact-gg.v2.library.';
/** Where a damaged index's raw text goes before a write replaces it. */
export const INDEX_BACKUP_KEY = `${INDEX_KEY}.backup`;

export interface LibraryEntry {
  id: string;
  name: string;
  mapId: MapId;
  updatedAt: number;
  thumbDataUrl: string;
  tags?: string[];
}

export type LibraryErrorCode = 'QUOTA_EXCEEDED' | 'NOT_FOUND' | 'PARSE_FAILED';

export class LibraryError extends Error {
  override readonly name = 'LibraryError';
  constructor(public readonly code: LibraryErrorCode, message?: string) {
    super(message ?? code);
  }
}

export function entryKey(id: string): string {
  return ENTRY_PREFIX + id;
}

/** Sanitise (strip emoji / control chars), trim, drop empties, de-dupe
 *  case-insensitively (first spelling wins), and cap count + length so the
 *  localStorage index can't bloat. */
export function normalizeTags(raw: string[]): string[] {
  return sanitiseTags(raw.join(','));
}

/** Parse a comma-separated tags string into normalized tags. */
export function parseTagsInput(text: string): string[] {
  return sanitiseTags(text);
}

/** False when the browser blocks site data, so getIndex's [] means "can't read", not "empty". */
export function storageAvailable(): boolean {
  try {
    localStorage.getItem(INDEX_KEY);
    return true;
  } catch {
    return false;
  }
}

export function getIndex(): LibraryEntry[] {
  try {
    // getItem itself throws when site data is blocked.
    const raw = localStorage.getItem(INDEX_KEY);
    if (raw == null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLibraryEntry);
  } catch {
    return [];
  }
}

/**
 * Write the index. getIndex drops anything it can't read, so writing its result
 * over a damaged index would orphan every saved strat. Copy the damaged text
 * aside first (once, so a later write can't replace the useful copy).
 * Throws the raw storage error; callers wrap it.
 */
function setIndex(idx: LibraryEntry[]): void {
  const raw = localStorage.getItem(INDEX_KEY);
  if (raw != null && localStorage.getItem(INDEX_BACKUP_KEY) == null) {
    let damaged = true;
    try {
      const parsed = JSON.parse(raw) as unknown;
      damaged = !Array.isArray(parsed) || !parsed.every(isLibraryEntry);
    } catch { /* unparseable: damaged */ }
    if (damaged) localStorage.setItem(INDEX_BACKUP_KEY, raw);
  }
  localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
}

function isLibraryEntry(x: unknown): x is LibraryEntry {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  if (o['tags'] !== undefined) {
    if (!Array.isArray(o['tags']) || !o['tags'].every((t) => typeof t === 'string')) return false;
  }
  return (
    typeof o['id'] === 'string' &&
    typeof o['name'] === 'string' &&
    typeof o['mapId'] === 'string' &&
    typeof o['updatedAt'] === 'number' &&
    typeof o['thumbDataUrl'] === 'string'
  );
}

export interface SaveInput {
  /** When present, overwrites the existing entry. When absent, a fresh id is generated. */
  id?: string;
  name: string;
  file: StratFile;
  thumbDataUrl: string;
  tags?: string[];
}

/**
 * Persist a strat to localStorage. Writes the entry blob first, then the
 * updated index. On `QuotaExceededError` either write throws
 * `LibraryError('QUOTA_EXCEEDED', ...)`. The caller is expected to surface a
 * toast.
 */
export function saveStrat(input: SaveInput): string {
  const id = input.id ?? nanoid();
  const now = Date.now();
  const tags = normalizeTags(input.tags ?? []);
  const entry: LibraryEntry = {
    id,
    name: input.name,
    mapId: input.file.map,
    updatedAt: now,
    thumbDataUrl: input.thumbDataUrl,
    ...(tags.length > 0 ? { tags } : {}),
  };
  const blob = serialize(input.file);
  const index = getIndex();
  const i = index.findIndex((e) => e.id === id);
  const isNew = i < 0;

  try {
    localStorage.setItem(entryKey(id), blob);
  } catch (err) {
    throw wrapStorageError(err);
  }

  if (isNew) index.push(entry);
  else index[i] = entry;

  try {
    setIndex(index);
  } catch (err) {
    // Roll back so we don't leak an unreachable blob into quota. We only do this
    // for fresh saves - for overwrites the previous blob is already gone (the
    // entry.setItem above clobbered it), and removing it would also strand the
    // old index row's loadStrat.
    if (isNew) {
      try { localStorage.removeItem(entryKey(id)); } catch { /* best effort */ }
    }
    throw wrapStorageError(err);
  }

  return id;
}

/** Read a strat from storage. Throws LibraryError on missing or corrupt blob. */
export function loadStrat(id: string): StratFile {
  const idx = getIndex();
  if (!idx.find((e) => e.id === id)) {
    throw new LibraryError('NOT_FOUND', `No strat with id ${id}`);
  }
  const raw = localStorage.getItem(entryKey(id));
  if (raw == null) {
    throw new LibraryError('NOT_FOUND', `Entry blob missing for id ${id}`);
  }
  try {
    return deserialize(raw);
  } catch {
    throw new LibraryError('PARSE_FAILED', `Could not parse strat ${id}`);
  }
}

/** Return the library index sorted newest-first by `updatedAt`. */
export function listStrats(): LibraryEntry[] {
  return getIndex().slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Delete an entry blob and its index row. No-op when id is unknown. */
export function deleteStrat(id: string): void {
  const idx = getIndex().filter((e) => e.id !== id);
  try {
    setIndex(idx);
  } catch (err) {
    throw wrapStorageError(err);
  }
  // Blob last: if the index write fails the row still points at real data.
  localStorage.removeItem(entryKey(id));
}

/** Update an entry's `name` and `updatedAt`. When `tags` is given, set the
 *  normalized tags (or remove the field if that's empty); when omitted, leave
 *  the existing tags untouched. Throws when id is unknown. */
export function renameStrat(id: string, name: string, tags?: string[]): void {
  const idx = getIndex();
  const i = idx.findIndex((e) => e.id === id);
  if (i < 0) throw new LibraryError('NOT_FOUND', `No strat with id ${id}`);
  let next: LibraryEntry = { ...idx[i]!, name, updatedAt: Date.now() };
  if (tags !== undefined) {
    const norm = normalizeTags(tags);
    if (norm.length > 0) {
      next = { ...next, tags: norm };
    } else {
      const { tags: _omit, ...rest } = next;
      next = rest;
    }
  }
  idx[i] = next;
  try {
    setIndex(idx);
  } catch (err) {
    throw wrapStorageError(err);
  }
}

/**
 * Duplicate an existing entry: deep-clone the StratFile, generate a fresh id,
 * append a `' (copy)'` suffix to the name, re-use the source's thumbnail.
 * Returns the new id.
 */
export function duplicateStrat(id: string): string {
  const idx = getIndex();
  const src = idx.find((e) => e.id === id);
  if (!src) throw new LibraryError('NOT_FOUND', `No strat with id ${id}`);
  const file = loadStrat(id);
  const cloned: StratFile = JSON.parse(JSON.stringify(file)) as StratFile;
  return saveStrat({
    name: `${src.name} (copy)`,
    file: cloned,
    thumbDataUrl: src.thumbDataUrl,
  });
}

function wrapStorageError(err: unknown): Error {
  if (err instanceof Error) {
    const name = (err as { name?: string }).name ?? '';
    const code = (err as { code?: number }).code;
    if (name === 'QuotaExceededError' || code === 22) {
      return new LibraryError('QUOTA_EXCEEDED', 'Browser storage is full. Delete a strat to make room.');
    }
  }
  return err instanceof Error ? err : new Error(String(err));
}
