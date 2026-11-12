/**
 * Shared a11y plumbing for dialog-style modals. Each call returns a
 * `deactivate()` for the caller to invoke on close or rebuild; idempotent both ways.
 *
 * Sets dialog roles/aria on the panel, moves focus in (`initialFocus`, else the
 * first focusable, else the panel), traps Tab, and restores the previously
 * focused element on deactivate. Escape and visibility are not handled here
 * (the central keyboard router owns Escape).
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable]',
].join(',');

export interface ModalA11yOptions {
  /** The dialog panel (the focus-trap boundary, not the backdrop). */
  panel: HTMLElement;
  /** Optional title element; given an id and wired via aria-labelledby. */
  title?: HTMLElement;
  /** Fallback accessible name when there isn't a separate title element
   *  (e.g. the command palette, whose input is the entry point). */
  ariaLabel?: string;
  /** Optional explicit element to focus on activate (defaults to first focusable). */
  initialFocus?: HTMLElement;
}

let titleSeq = 0;

export function activateModalA11y(opts: ModalA11yOptions): () => void {
  const { panel, title, ariaLabel, initialFocus } = opts;

  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  if (title) {
    if (!title.id) title.id = `modal-title-${++titleSeq}`;
    panel.setAttribute('aria-labelledby', title.id);
  } else if (ariaLabel) {
    panel.setAttribute('aria-label', ariaLabel);
  }
  // Make the panel itself focusable as a last-resort target - never visible
  // in the tab order otherwise.
  if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');

  const previouslyFocused = document.activeElement as HTMLElement | null;

  const focusTarget = initialFocus ?? firstFocusable(panel) ?? panel;
  try { focusTarget.focus(); } catch { /* element may have been removed */ }

  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab') return;
    const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusables.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (active === first || !panel.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  panel.addEventListener('keydown', onKey);

  let deactivated = false;
  return (): void => {
    if (deactivated) return;
    deactivated = true;
    panel.removeEventListener('keydown', onKey);
    if (previouslyFocused && document.body.contains(previouslyFocused)) {
      try { previouslyFocused.focus(); } catch { /* */ }
    }
  };
}

function firstFocusable(panel: HTMLElement): HTMLElement | null {
  const el = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
  return el ?? null;
}
