import '../styles/strat-library.css';
import type { Store } from '../app/store';
import {
  listStrats,
  storageAvailable,
  renameStrat,
  duplicateStrat,
  deleteStrat,
  parseTagsInput,
  type LibraryEntry,
} from '../app/library';
import { getMap } from '../types/maps';
import { activateModalA11y } from '../app/modalA11y';
import { sanitiseText } from '../app/sanitiseText';
import { toast } from './Toast';

export interface StratLibraryDeps {
  /** Called with the entry id when the user clicks LOAD. main.ts handles the load-conflict guard. */
  onLoad(id: string): void;
  /** Called when the user clicks "+ New save". main.ts captures the thumbnail and prompts for a name. */
  onNewSave(): void;
}

export class StratLibrary {
  private root: HTMLElement | null = null;
  private deactivateA11y: (() => void) | null = null;
  private renameRoot: HTMLElement | null = null;
  private renameDeactivateA11y: (() => void) | null = null;
  private unsub: () => void = () => {};
  /** Case-insensitive substring filter over `entry.name`. Per-instance and
   *  reset every time the modal closes -- it's a here-and-now navigation
   *  aid, not user preference worth persisting. */
  private filterText: string = '';
  private listEl: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;

  constructor(private host: HTMLElement, private store: Store, private deps: StratLibraryDeps) {}

  mount(): void {
    this.unsub = this.store.subscribe(['ui'], () => this.sync());
    this.sync();
  }

  destroy(): void {
    this.unsub();
    this.removeRoot();
  }

  private sync(): void {
    const open = this.store.get().ui.libraryOpen;
    if (!open) {
      this.removeRoot();
      this.filterText = '';
      return;
    }
    // Already open: a rebuild would steal focus from a confirm dialog on top
    // and close any rename prompt. Rows refresh through renderList instead.
    if (this.root) return;
    this.render();
  }

  private render(): void {
    if (this.root) this.removeRoot();
    const root = document.createElement('div');
    root.className = 'strat-library';

    const backdrop = document.createElement('div');
    backdrop.className = 'strat-library-backdrop';
    backdrop.addEventListener('click', () => this.close());

    const panel = document.createElement('div');
    panel.className = 'strat-library-panel';
    panel.addEventListener('click', (e) => e.stopPropagation());

    const header = document.createElement('div');
    header.className = 'strat-library-header';

    const title = document.createElement('div');
    title.className = 'strat-library-title';
    title.textContent = 'STRAT LIBRARY';

    const newSave = document.createElement('button');
    newSave.type = 'button';
    newSave.className = 'strat-library-new-save';
    newSave.textContent = '+ New save';
    newSave.addEventListener('click', () => this.deps.onNewSave());

    header.appendChild(title);
    header.appendChild(newSave);

    const search = document.createElement('div');
    search.className = 'strat-library-search';
    const filter = document.createElement('input');
    filter.type = 'search';
    filter.className = 'strat-library-search-input';
    filter.placeholder = 'Filter by name...';
    filter.autocomplete = 'off';
    filter.value = this.filterText;
    filter.dataset['testid'] = 'strat-library-search-input';
    filter.setAttribute('aria-label', 'Filter saved strats by name');
    filter.addEventListener('input', () => {
      this.filterText = filter.value;
      this.renderList();
    });
    search.appendChild(filter);
    this.searchInput = filter;

    const list = document.createElement('div');
    list.className = 'strat-library-list';
    this.listEl = list;
    this.populateList();

    panel.appendChild(header);
    panel.appendChild(search);
    panel.appendChild(list);
    root.appendChild(backdrop);
    root.appendChild(panel);
    this.host.appendChild(root);
    this.root = root;
    this.deactivateA11y = activateModalA11y({ panel, title });
  }

  /** Rebuild only the list body when the filter input changes. The header /
   *  search box stay put so the input doesn't lose focus or caret position. */
  private renderList(): void {
    if (!this.listEl) return;
    while (this.listEl.firstChild) this.listEl.removeChild(this.listEl.firstChild);
    this.populateList();
  }

  /** Set the search box to a tag and re-filter - used when a row chip is clicked. */
  private filterToTag(tag: string): void {
    this.filterText = tag;
    if (this.searchInput) this.searchInput.value = tag;
    this.renderList();
  }

  private populateList(): void {
    if (!this.listEl) return;
    const all = listStrats();
    const needle = this.filterText.trim().toLowerCase();
    const entries = needle === ''
      ? all
      : all.filter((e) =>
          e.name.toLowerCase().includes(needle) ||
          (e.tags ?? []).some((t) => t.toLowerCase().includes(needle)),
        );

    if (all.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'strat-library-empty';
      empty.textContent = storageAvailable()
        ? 'No saved strats yet. Click "+ New save" to add one.'
        : "Browser storage is blocked for this site, so strats can't be saved here.";
      this.listEl.appendChild(empty);
      return;
    }
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'strat-library-empty';
      empty.textContent = `No strats match "${this.filterText.trim()}".`;
      this.listEl.appendChild(empty);
      return;
    }
    for (const entry of entries) this.listEl.appendChild(this.renderRow(entry));
  }

  private renderRow(entry: LibraryEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = 'strat-library-row';
    row.dataset['id'] = entry.id;

    const thumb = document.createElement('img');
    thumb.className = 'strat-library-row-thumb';
    // Thumbnails are always generated as data:image/... URLs. Only honour that
    // shape - guards against a tampered localStorage index pointing src at a
    // remote URL (a tracking-beacon vector); anything else just renders blank.
    if (entry.thumbDataUrl.startsWith('data:image/')) thumb.src = entry.thumbDataUrl;
    thumb.alt = '';
    thumb.draggable = false;

    const meta = document.createElement('div');
    meta.className = 'strat-library-row-meta';

    const name = document.createElement('div');
    name.className = 'strat-library-row-name';
    name.textContent = entry.name;

    const sub = document.createElement('div');
    sub.className = 'strat-library-row-sub';
    sub.textContent = `${getMap(entry.mapId).name} · ${formatRelative(entry.updatedAt)}`;

    meta.appendChild(name);
    meta.appendChild(sub);

    const tags = entry.tags ?? [];
    if (tags.length > 0) {
      const tagsRow = document.createElement('div');
      tagsRow.className = 'strat-library-row-tags';
      for (const tag of tags) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'strat-library-row-tag';
        chip.textContent = tag;
        chip.addEventListener('click', () => this.filterToTag(tag));
        tagsRow.appendChild(chip);
      }
      meta.appendChild(tagsRow);
    }

    const buttons = document.createElement('div');
    buttons.className = 'strat-library-row-buttons';

    buttons.appendChild(this.makeRowButton('strat-library-row-load', 'Load', () => this.deps.onLoad(entry.id)));
    buttons.appendChild(this.makeRowButton('strat-library-row-rename', 'Rename', () => this.handleRename(entry)));
    buttons.appendChild(this.makeRowButton('strat-library-row-duplicate', 'Duplicate', () => this.handleDuplicate(entry)));
    buttons.appendChild(this.makeRowButton('strat-library-row-delete', 'Delete', () => this.handleDelete(entry)));

    row.appendChild(thumb);
    row.appendChild(meta);
    row.appendChild(buttons);
    return row;
  }

  private makeRowButton(cls: string, label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  private handleRename(entry: LibraryEntry): void {
    this.closeRenamePrompt();

    const root = document.createElement('div');
    root.className = 'strat-library-rename';

    const backdrop = document.createElement('div');
    backdrop.className = 'strat-library-rename-backdrop';
    backdrop.addEventListener('click', () => this.closeRenamePrompt());

    const panel = document.createElement('div');
    panel.className = 'strat-library-rename-panel';
    panel.addEventListener('click', (e) => e.stopPropagation());

    const title = document.createElement('div');
    title.className = 'strat-library-rename-title';
    title.textContent = 'Edit name & tags';

    const inputId = `strat-rename-input-${entry.id}`;
    const label = document.createElement('label');
    label.className = 'strat-library-rename-label';
    label.htmlFor = inputId;
    label.textContent = 'New name';

    const input = document.createElement('input');
    input.id = inputId;
    input.type = 'text';
    input.className = 'strat-library-rename-input';
    input.value = entry.name;
    input.dataset['testid'] = 'strat-library-rename-input';
    input.autocomplete = 'off';

    const tagsId = `strat-rename-tags-${entry.id}`;
    const tagsLabel = document.createElement('label');
    tagsLabel.className = 'strat-library-rename-label';
    tagsLabel.htmlFor = tagsId;
    tagsLabel.textContent = 'Tags (comma separated)';

    const tagsInput = document.createElement('input');
    tagsInput.id = tagsId;
    tagsInput.type = 'text';
    tagsInput.className = 'strat-library-rename-input';
    tagsInput.value = (entry.tags ?? []).join(', ');
    tagsInput.dataset['testid'] = 'strat-library-rename-tags';
    tagsInput.autocomplete = 'off';

    const buttons = document.createElement('div');
    buttons.className = 'strat-library-rename-buttons';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'strat-library-rename-cancel';
    cancel.textContent = 'Cancel';
    cancel.dataset['testid'] = 'strat-library-rename-cancel';
    cancel.addEventListener('click', () => this.closeRenamePrompt());

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'strat-library-rename-save';
    save.textContent = 'Save';
    save.dataset['testid'] = 'strat-library-rename-save';

    const commit = (): void => {
      const trimmed = sanitiseText(input.value, { maxLen: 200 });
      if (trimmed.length === 0) return;
      if (!this.tryStorage(() => renameStrat(entry.id, trimmed, parseTagsInput(tagsInput.value)))) return;
      this.closeRenamePrompt();
      this.renderList();
    };

    save.addEventListener('click', commit);
    const onFieldKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.closeRenamePrompt(); }
    };
    input.addEventListener('keydown', onFieldKey);
    tagsInput.addEventListener('keydown', onFieldKey);

    buttons.appendChild(cancel);
    buttons.appendChild(save);
    panel.appendChild(title);
    panel.appendChild(label);
    panel.appendChild(input);
    panel.appendChild(tagsLabel);
    panel.appendChild(tagsInput);
    panel.appendChild(buttons);
    root.appendChild(backdrop);
    root.appendChild(panel);
    this.host.appendChild(root);
    this.renameRoot = root;
    this.renameDeactivateA11y = activateModalA11y({ panel, title, initialFocus: input });
    input.select();
  }

  private closeRenamePrompt(): void {
    if (this.renameDeactivateA11y) {
      this.renameDeactivateA11y();
      this.renameDeactivateA11y = null;
    }
    if (this.renameRoot && this.renameRoot.parentElement) {
      this.renameRoot.parentElement.removeChild(this.renameRoot);
    }
    this.renameRoot = null;
  }

  private handleDuplicate(entry: LibraryEntry): void {
    this.tryStorage(() => duplicateStrat(entry.id));
    this.renderList();
  }

  /** Run a library write, toasting the error if storage is full, blocked or the
   *  entry has gone. Returns false on failure. */
  private tryStorage(fn: () => unknown): boolean {
    try {
      fn();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      this.renderList();
      return false;
    }
  }

  private handleDelete(entry: LibraryEntry): void {
    const ui = this.store.get().ui;
    this.store._apply({
      ui: {
        ...ui,
        confirmOpen: {
          kind: 'delete-strat',
          title: 'Delete strat?',
          body: `"${entry.name}" will be removed permanently.`,
          confirmLabel: 'Delete',
          onConfirm: () => {
            this.tryStorage(() => deleteStrat(entry.id));
            this.renderList();
          },
        },
      },
    });
  }

  private close(): void {
    const ui = this.store.get().ui;
    this.store._apply({ ui: { ...ui, libraryOpen: false } });
  }

  private removeRoot(): void {
    this.closeRenamePrompt();
    if (this.deactivateA11y) {
      this.deactivateA11y();
      this.deactivateA11y = null;
    }
    if (this.root && this.root.parentElement) this.root.parentElement.removeChild(this.root);
    this.root = null;
  }
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
