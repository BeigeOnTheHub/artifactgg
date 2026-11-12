import type { StratFile } from '../types/stratFile';
import type { Store, StratState } from './store';
import { serialize, deserialize } from './persistence';

/**
 * Crash-recovery autosave: the live strat is mirrored into localStorage about
 * once a second, and main.ts can offer to restore it on the next boot if it
 * holds unsaved or diverged work. A soft net for crashes, not a library
 * replacement; explicit Save still goes through the library.
 */

export const RECOVER_KEY = 'artifact-gg.v2.recover';
export const DEFAULT_DEBOUNCE_MS = 1000;

interface RecoverPayload {
  /** The library entry the user was working on, or null for unsaved work. */
  libraryId: string | null;
  /** Serialised StratFile (same format as the library / share / file export). */
  fileJson: string;
  /** Unix ms timestamp when this was written. Useful for diagnostics; not
   *  read by the boot code today. */
  savedAt: number;
}

/**
 * True if the strat has anything worth recovering -- at least one frame with
 * any kind of placed item, or any notes content. Matches the "is there real
 * work here?" check in main.ts (isContentPresent).
 */
export function stratHasContent(file: StratFile): boolean {
  if (file.notes.length > 0) return true;
  for (const f of file.frames) {
    if (
      f.strokes.length > 0 || f.shapes.length > 0 || f.cones.length > 0 ||
      f.players.length > 0 || f.textboxes.length > 0 || f.quickadds.length > 0 ||
      f.scanner !== null
    ) return true;
  }
  return false;
}

/** Write the current strat to the recover slot. Swallows storage errors so a
 *  full localStorage never breaks editing -- the user still has the live
 *  strat in memory. */
export function writeRecover(libraryId: string | null, file: StratFile): void {
  try {
    const payload: RecoverPayload = {
      libraryId,
      fileJson: serialize(file),
      savedAt: Date.now(),
    };
    localStorage.setItem(RECOVER_KEY, JSON.stringify(payload));
  } catch {
    // QuotaExceeded or storage disabled. Recovery is best-effort.
  }
}

export function clearRecover(): void {
  try {
    localStorage.removeItem(RECOVER_KEY);
  } catch {
    // ignore
  }
}

/**
 * Read the recover slot. Returns null if the slot is missing, malformed,
 * empty (no content worth restoring), or fails strat schema validation.
 * The deserialize step doubles as schema validation -- anything weird in
 * localStorage gets thrown out instead of poisoning boot.
 */
export function readRecover(): { libraryId: string | null; file: StratFile } | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(RECOVER_KEY);
  } catch {
    return null;
  }
  if (raw == null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  if (typeof p['fileJson'] !== 'string') return null;
  const libraryId = typeof p['libraryId'] === 'string' ? p['libraryId'] : null;

  let file: StratFile;
  try {
    file = deserialize(p['fileJson']);
  } catch {
    return null;
  }
  if (!stratHasContent(file)) return null;

  return { libraryId, file };
}

export interface AutosaverOpts {
  store: Store;
  currentStratFile: () => StratFile;
  getCurrentLibraryId: () => string | null;
  debounceMs?: number;
}

/**
 * Subscribe to the strat-content keys on the store and write to the recover
 * slot on a debounce. Returns a teardown that unsubscribes and cancels any
 * pending write. Skips writes when the strat is empty -- no point parking an
 * empty default in the slot, since boot would discard it anyway.
 */
export function createAutosaver(opts: AutosaverOpts): () => void {
  const { store, currentStratFile, getCurrentLibraryId } = opts;
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  let timer: ReturnType<typeof setTimeout> | null = null;

  function schedule(): void {
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const file = currentStratFile();
      if (!stratHasContent(file)) {
        // Nothing worth saving. Also clear an old slot so a user who undoes
        // back to empty doesn't see a stale recovery prompt next boot.
        clearRecover();
        return;
      }
      writeRecover(getCurrentLibraryId(), file);
    }, debounceMs);
  }

  // Watch every key serialize() reads. notes lives on the store too, and the
  // mapId / frames / activeFrameIdx / view keys round out the strat shape.
  const keys: (keyof StratState)[] = [
    'mapId', 'frames', 'activeFrameIdx', 'notes', 'zoom', 'panX', 'panY',
  ];
  const off = store.subscribe(keys, schedule);

  return () => {
    off();
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
