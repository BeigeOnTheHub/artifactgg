/**
 * Polite live-region helper for screen-reader announcements, for keyboard flows
 * that change state out of focus (arrow-key frame switch, map dropdown).
 * Separate from Toast because a toast per arrow press would clutter the screen;
 * this region is clipped off-screen.
 */

const REGION_ID = 'a11y-announcer';

let root: HTMLElement | null = null;
let clearTimer: ReturnType<typeof setTimeout> | null = null;

function ensureRoot(): HTMLElement {
  if (root && root.isConnected) return root;
  const existing = document.getElementById(REGION_ID);
  if (existing) { root = existing; return root; }
  root = document.createElement('div');
  root.id = REGION_ID;
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.setAttribute('aria-atomic', 'true');
  // The standard sr-only / visually-hidden recipe. Off-screen + 1px so AT
  // still computes a name, but no part of it ever lands on the visible
  // canvas. Inline so we don't have to ship a new stylesheet.
  root.style.cssText = [
    'position:absolute',
    'left:-10000px',
    'top:auto',
    'width:1px',
    'height:1px',
    'overflow:hidden',
    'clip:rect(1px,1px,1px,1px)',
    'white-space:nowrap',
  ].join(';');
  document.body.appendChild(root);
  return root;
}

/**
 * Announce a short string. Repeat-safe: announcing the same text twice in
 * a row still gets re-read (we clear the region first so AT registers a
 * change). The region is cleared again ~1.5s later so a stale string
 * isn't sitting around for the next focus event to read.
 */
export function announce(text: string): void {
  if (!text) return;
  const r = ensureRoot();
  // Clear synchronously so a re-announcement of the same string fires a
  // change event for assistive tech.
  r.textContent = '';
  // Defer the new write a microtask so the clear flushes first.
  queueMicrotask(() => {
    r.textContent = text;
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      if (r.textContent === text) r.textContent = '';
    }, 1500);
  });
}

/** Tear-down helper for tests / hot reload. Not used by the app itself. */
export function _resetAnnouncer(): void {
  if (clearTimer) { clearTimeout(clearTimer); clearTimer = null; }
  if (root && root.parentElement) root.parentElement.removeChild(root);
  root = null;
}
