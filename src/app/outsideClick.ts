/**
 * Outside-click manager: one shared document listener walks the registry.
 * An entry's `predicate(target)` returns true when the click is INside its
 * popover (ignored) and false when outside (fires `close()`).
 *
 * Uses `pointerdown`, not `mousedown`: on mobile `mousedown` fires late or not
 * at all, leaving popovers stuck open. The listener attaches on first
 * registration and detaches when the last entry goes.
 */

interface Entry {
  predicate: (target: EventTarget | null) => boolean;
  close: () => void;
}

const entries: Set<Entry> = new Set();
let attached = false;

function onDocPointerDown(e: Event): void {
  // Walk a snapshot - close() may unregister itself, mutating the set.
  const snapshot = Array.from(entries);
  for (const entry of snapshot) {
    if (!entries.has(entry)) continue; // Already removed by an earlier close().
    if (!entry.predicate(e.target)) entry.close();
  }
}

function ensureAttached(): void {
  if (attached) return;
  document.addEventListener('pointerdown', onDocPointerDown);
  attached = true;
}

function detachIfEmpty(): void {
  if (!attached) return;
  if (entries.size > 0) return;
  document.removeEventListener('pointerdown', onDocPointerDown);
  attached = false;
}

export function register(
  predicate: (target: EventTarget | null) => boolean,
  close: () => void,
): () => void {
  const entry: Entry = { predicate, close };
  entries.add(entry);
  ensureAttached();
  return () => {
    entries.delete(entry);
    detachIfEmpty();
  };
}

/** Test-only - wipes the registry between specs. */
export function _resetForTests(): void {
  entries.clear();
  detachIfEmpty();
}
