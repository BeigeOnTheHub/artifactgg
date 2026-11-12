import type { Store } from './store';

/** Touch device OR a narrow window both trigger the compact (touch-optimised) layout. */
export const COMPACT_QUERY = '(pointer: coarse), (max-width: 900px)';

export type LayoutMode = 'desktop' | 'compact';

export function resolveLayoutMode(matches: boolean): LayoutMode {
  return matches ? 'compact' : 'desktop';
}

export function currentLayoutMode(store: Store): LayoutMode {
  return store.get().layoutMode ?? 'desktop';
}

export function isReadOnly(store: Store): boolean {
  return store.get().readOnly ?? false;
}

/**
 * Subscribe the store's `layoutMode`/`readOnly` to the compact media query.
 * Compact is an editable touch layout, so readOnly stays false.
 * Returns an unsubscribe. If the environment has no `matchMedia` (very old
 * browsers / some test envs) we stay on desktop - guaranteed no regression.
 */
export function watchLayoutMode(store: Store, win: Window = window): () => void {
  if (typeof win.matchMedia !== 'function') {
    store._apply({ layoutMode: 'desktop', readOnly: false });
    return () => {};
  }
  const mql = win.matchMedia(COMPACT_QUERY);
  const push = (matches: boolean): void => {
    const mode = resolveLayoutMode(matches);
    store._apply({ layoutMode: mode, readOnly: false });
  };
  push(mql.matches);
  const handler = (e: MediaQueryListEvent | { matches: boolean }): void => push(e.matches);
  mql.addEventListener('change', handler as (e: MediaQueryListEvent) => void);
  return () => mql.removeEventListener('change', handler as (e: MediaQueryListEvent) => void);
}
