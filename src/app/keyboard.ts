import type { Store } from './store';
import type { Actions } from './actions';

export interface Keyboard {
  attach(): void;
  detach(): void;
}

/** A small surface for modals whose open state isn't in store.ui but still
 *  need to participate in the Escape precedence walk (LegalModal). */
export interface EscModal {
  isOpen(): boolean;
  close(): void;
}

export interface KeyboardDeps {
  store: Store;
  actions: Actions;
  /** Optional modal slots checked at appropriate priority during Escape. */
  legalModal?: EscModal;
}

/**
 * Build the canonical hotkey string for a KeyboardEvent.
 *
 *   { key: 'd' }                                  -> 'D'
 *   { key: 'c', metaKey: true }                   -> 'Ctrl+C'   (Cmd folds to Ctrl)
 *   { key: 'Z', ctrlKey: true, shiftKey: true }   -> 'Ctrl+Shift+Z'
 *   { key: '?', shiftKey: true }                  -> '?'         (Shift omitted for symbol keys)
 */
export function canonical(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');

  let key = e.key;
  const isAlpha = key.length === 1 && /[a-zA-Z]/.test(key);
  const isNamed = key.length > 1; // 'Escape', 'Delete', 'Tab', etc.

  if (e.shiftKey && (isAlpha || isNamed)) parts.push('Shift');
  if (isAlpha) key = key.toUpperCase();
  parts.push(key);
  return parts.join('+');
}

function isEditableTarget(): boolean {
  const ae = document.activeElement;
  if (!ae) return false;
  const tag = (ae as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  return (ae as HTMLElement).isContentEditable === true;
}

export function createKeyboard(deps: KeyboardDeps): Keyboard {
  const { store, actions, legalModal } = deps;
  let onKey: ((e: KeyboardEvent) => void) | null = null;

  function handleEsc(e: KeyboardEvent): void {
    e.preventDefault();
    const ui = store.get().ui;

    // Precedence walk - stop at the first match. Order matches brainstorm §4
    // (Plans 5a/5b/5c add their modals between hints and colourPicker).
    if (ui.paletteOpen) {
      store._apply({ ui: { ...ui, paletteOpen: false } });
      return;
    }
    if (ui.hintsOpen) {
      store._apply({ ui: { ...ui, hintsOpen: false } });
      return;
    }
    if (ui.confirmOpen) {
      store._apply({ ui: { ...ui, confirmOpen: null } });
      return;
    }
    // Legal modal owns its own open state (doc'd in LegalModal.ts) so it sits
    // outside the ui slice; check it here so Escape closes it and nothing
    // else fires for the same key.
    if (legalModal?.isOpen()) {
      legalModal.close();
      return;
    }
    if (ui.shareOpen) {
      store._apply({ ui: { ...ui, shareOpen: false } });
      return;
    }
    if (ui.libraryOpen) {
      store._apply({ ui: { ...ui, libraryOpen: false } });
      return;
    }
    if (ui.colourPickerOpen) {
      store._apply({ ui: { ...ui, colourPickerOpen: false } });
      return;
    }
    if (ui.changelogOpen) {
      store._apply({ ui: { ...ui, changelogOpen: false } });
      return;
    }
    if (ui.mapDropdownOpen) {
      store._apply({ ui: { ...ui, mapDropdownOpen: false } });
      return;
    }
    if (store.get().tool !== 'cursor') {
      actions.run('tool.cursor');
      return;
    }
    const ae = document.activeElement;
    if (ae && ae !== document.body) (ae as HTMLElement).blur();
  }

  return {
    attach() {
      onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
          handleEsc(e);
          return;
        }

        const combo = canonical(e);
        const action = actions.byHotkey(combo);
        if (!action) return;

        if (isEditableTarget() && !action.allowInInput) return;

        if (action.canRun && !action.canRun(store.get())) return;

        e.preventDefault();
        actions.run(action.id);
      };
      window.addEventListener('keydown', onKey);
    },
    detach() {
      if (onKey) window.removeEventListener('keydown', onKey);
      onKey = null;
    },
  };
}
