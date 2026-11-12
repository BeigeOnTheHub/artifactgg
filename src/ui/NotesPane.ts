import '../styles/notes-pane.css';
import type { Store } from '../app/store';
import type { History } from '../app/history';
import { buildNotesEditor } from './notesEditor';

/**
 * Sidebar notes pane. Thin mount around the shared editor in ui/notesEditor.ts
 * so the mobile Notes sheet gets the identical textarea, debounce and undo
 * behaviour.
 */
export class NotesPane {
  private built: { el: HTMLElement; destroy: () => void; focus: () => void } | null = null;

  constructor(private host: HTMLElement, private store: Store, private history: History) {}

  mount(): void {
    this.built = buildNotesEditor(this.store, this.history);
    this.host.appendChild(this.built.el);
  }

  destroy(): void {
    const el = this.built?.el;
    this.built?.destroy();
    this.built = null;
    if (el?.parentElement) el.parentElement.removeChild(el);
  }

  /** Move keyboard focus to the textarea. Called by the `notes.focus` action. */
  focus(): void {
    this.built?.focus();
  }
}
