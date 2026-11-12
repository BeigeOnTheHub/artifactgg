export type Theme = 'dark' | 'light' | 'high-contrast';

const KEY = 'artifact-gg.v2.theme';
const ORDER: readonly Theme[] = ['dark', 'light', 'high-contrast'];
const listeners = new Set<(t: Theme) => void>();

function isTheme(v: unknown): v is Theme {
  return v === 'dark' || v === 'light' || v === 'high-contrast';
}

function readStored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return isTheme(v) ? v : null;
  } catch {
    return null;
  }
}

/** First-visit default from OS hints: contrast wins over colour-scheme. */
function resolveFromOS(): Theme {
  try {
    if (window.matchMedia('(prefers-contrast: more)').matches) return 'high-contrast';
    if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  } catch {
    /* jsdom / old browsers: fall through */
  }
  return 'dark';
}

/** The effective theme: a valid stored choice, else the OS-resolved default. */
export function getTheme(): Theme {
  return readStored() ?? resolveFromOS();
}

/** Persist + lock the choice; notify subscribers only when the effective theme changes. */
export function setTheme(t: Theme): void {
  const prev = getTheme();
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
  if (t !== prev) for (const cb of [...listeners]) cb(t);
}

export function subscribeTheme(cb: (t: Theme) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** dark -> light -> high-contrast -> dark. Sets and returns the next theme. */
export function cycleTheme(): Theme {
  const next = ORDER[(ORDER.indexOf(getTheme()) + 1) % ORDER.length]!;
  setTheme(next);
  return next;
}

/** Reflect a theme onto the DOM (default target = <html>). */
export function applyTheme(t: Theme, target: HTMLElement = document.documentElement): void {
  target.dataset.theme = t;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Like applyTheme, but crossfades from the old colours to the new rather than
 * cutting, using the View Transitions API when it's there. Falls back to an
 * instant swap when the browser doesn't support it or the user prefers reduced
 * motion. The fade timing is tuned in themes.css.
 */
export function applyThemeAnimated(t: Theme, target: HTMLElement = document.documentElement): void {
  const start = (document as Document & {
    startViewTransition?: (cb: () => void) => unknown;
  }).startViewTransition;
  if (typeof start !== 'function' || prefersReducedMotion()) {
    applyTheme(t, target);
    return;
  }
  start.call(document, () => applyTheme(t, target));
}

/** Apply the current theme now and on every change. Returns an unsubscribe.
 *  First paint is instant (no fade on load); later switches crossfade. */
export function attachTheme(target: HTMLElement = document.documentElement): () => void {
  applyTheme(getTheme(), target);
  return subscribeTheme((t) => applyThemeAnimated(t, target));
}
