import type { Store } from '../app/store';
import type { History } from '../app/history';
import { sanitiseText } from '../app/sanitiseText';

const DEBOUNCE_MS = 500;

/**
 * Strat notes editor: a plain textarea bound to state.notes, shared by the
 * desktop sidebar pane and the mobile Notes sheet.
 *
 * Undo coarseness is one debounce window (~500 ms) of typing, not one
 * character - character-level undo for prose is disorienting.
 */
export function buildNotesEditor(
  store: Store,
  history: History,
): { el: HTMLElement; destroy: () => void; focus: () => void } {
  const root = document.createElement('div');
  root.className = 'notes-pane';

  const textarea = document.createElement('textarea');
  textarea.className = 'notes-pane-textarea';
  textarea.dataset['testid'] = 'notes-textarea';
  textarea.setAttribute('name', 'notes');
  textarea.setAttribute('placeholder', 'Notes about this strat...');
  textarea.setAttribute('spellcheck', 'true');
  // No visible label in either layout, so a screen reader needs this.
  textarea.setAttribute('aria-label', 'Strat notes');
  root.appendChild(textarea);

  textarea.value = store.get().notes;

  let pending: ReturnType<typeof setTimeout> | null = null;
  let pendingValue: string | null = null;

  const flush = (): void => {
    if (pending != null) {
      clearTimeout(pending);
      pending = null;
    }
    if (pendingValue == null) return;
    // Clean on commit (strip emoji / control chars) but keep line breaks and
    // spacing - collapsing prose whitespace mid-typing is nasty.
    const value = sanitiseText(pendingValue, {
      allowNewlines: true,
      collapseWhitespace: false,
      maxLen: 64 * 1024,
    });
    pendingValue = null;
    if (value === store.get().notes) {
      if (value !== textarea.value) textarea.value = value;
      return;
    }
    history.dispatch({ t: 'notes.set', notes: value });
  };

  const onInput = (): void => {
    const next = textarea.value;
    if (next === store.get().notes) return;
    pendingValue = next;
    if (pending != null) clearTimeout(pending);
    pending = setTimeout(flush, DEBOUNCE_MS);
  };

  textarea.addEventListener('input', onInput);

  const unsub = store.subscribe(['notes'], () => {
    const v = store.get().notes;
    if (textarea.value !== v) textarea.value = v;
  });

  return {
    el: root,
    destroy: (): void => {
      unsub();
      // Flush before unbinding: closing the sheet mid-sentence must not bin
      // the last debounce window.
      flush();
      textarea.removeEventListener('input', onInput);
    },
    focus: (): void => textarea.focus(),
  };
}
