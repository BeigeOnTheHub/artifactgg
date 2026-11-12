import '../styles/map-dropdown.css';
import type { Store } from '../app/store';
import type { History } from '../app/history';
import { register as registerOutsideClick } from '../app/outsideClick';
import { MAPS } from '../types/maps';
import { buildMapPicker } from './mapPicker';

export class MapDropdown {
  private button: HTMLButtonElement;
  private list: HTMLElement | null = null;
  private picker: { el: HTMLElement; destroy: () => void } | null = null;
  private unsubMap: () => void = () => {};
  private unsubUi: () => void = () => {};
  private offDocClick: () => void = () => {};

  constructor(
    private host: HTMLElement,
    private store: Store,
    private history: History,
  ) {
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'map-dropdown-btn';
    this.button.setAttribute('aria-haspopup', 'listbox');
  }

  mount(): void {
    this.host.appendChild(this.button);

    this.picker = buildMapPicker(this.store, this.history, {
      onSelect: () => this.setOpen(false),
    });
    // Captured in a local so the offDocClick closure below stays non-null
    // without needing to re-check this.list (which destroy() can null out).
    const list = this.picker.el;
    this.list = list;
    list.hidden = true;
    this.host.appendChild(list);

    this.renderButton();
    this.syncOpenState();

    this.button.addEventListener('click', this.onButtonClick);
    this.button.addEventListener('keydown', this.onButtonKeydown);
    list.addEventListener('keydown', this.onListKeydown);

    // The picker keeps its own rows and callouts row in sync; the button label
    // is all that is left for the dropdown to track.
    this.unsubMap = this.store.subscribe(['mapId'], () => this.renderButton());
    this.unsubUi = this.store.subscribe(['ui'], () => this.syncOpenState());

    this.offDocClick = registerOutsideClick(
      (target) => {
        // Predicate returns true to mean "ignore - click is inside or popover is closed".
        if (!this.store.get().ui.mapDropdownOpen) return true;
        const node = target as Node | null;
        return Boolean(node && (this.button.contains(node) || list.contains(node)));
      },
      () => this.setOpen(false),
    );
  }

  destroy(): void {
    this.unsubMap();
    this.unsubUi();
    this.offDocClick();
    this.picker?.destroy();
    this.picker = null;
    this.button.removeEventListener('click', this.onButtonClick);
    this.button.removeEventListener('keydown', this.onButtonKeydown);
    // mount() may never have run (destroy() called on a fresh instance) -
    // this.list stays null in that case, same guard NotesPane/LayerVisibilityPanel use.
    this.list?.removeEventListener('keydown', this.onListKeydown);
    while (this.host.firstChild) this.host.removeChild(this.host.firstChild);
  }

  private onButtonClick = (): void => {
    this.setOpen(!this.store.get().ui.mapDropdownOpen);
  };

  /** Open the listbox on ArrowDown / ArrowUp / Enter / Space and move focus
   *  into it -- matches the WAI-ARIA collapsible-listbox pattern. */
  private onButtonKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      if (e.key === ' ' || e.key === 'Enter') {
        if (this.store.get().ui.mapDropdownOpen) return;
      }
      e.preventDefault();
      this.setOpen(true);
      // Wait for syncOpenState to unhide the list, then move focus to the
      // active map (or first enabled row).
      queueMicrotask(() => this.focusInitialOption());
    }
  };

  private onListKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.setOpen(false);
      this.button.focus();
      return;
    }
    if (e.key === 'Tab') {
      // Don't trap -- let Tab move out, but close the listbox so the user
      // doesn't leave it stuck open.
      this.setOpen(false);
      return;
    }
    const focusables = this.listFocusables();
    if (focusables.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const i = active ? focusables.indexOf(active) : -1;
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = (i + 1) % focusables.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + focusables.length) % focusables.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = focusables.length - 1;
    if (next == null) return;
    e.preventDefault();
    focusables[next]?.focus();
  };

  private listFocusables(): HTMLElement[] {
    return Array.from(this.list?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
  }

  private focusInitialOption(): void {
    const active = this.store.get().mapId;
    const target = this.list?.querySelector<HTMLElement>(`.map-dropdown-row[data-mapid="${active}"]`);
    if (target && !target.hasAttribute('disabled')) {
      target.focus();
      return;
    }
    this.listFocusables()[0]?.focus();
  }

  private setOpen(open: boolean): void {
    const ui = this.store.get().ui;
    if (ui.mapDropdownOpen === open) return;
    this.store._apply({ ui: { ...ui, mapDropdownOpen: open } });
  }

  private renderButton(): void {
    while (this.button.firstChild) this.button.removeChild(this.button.firstChild);

    const m = MAPS.find((mm) => mm.id === this.store.get().mapId);
    if (!m) return;

    const thumb = document.createElement('img');
    thumb.className = 'map-dropdown-thumb';
    thumb.src = `${import.meta.env.BASE_URL}${m.folder}/thumbnail.png`;
    thumb.alt = '';
    thumb.draggable = false;

    const label = document.createElement('span');
    label.className = 'map-dropdown-label';
    label.textContent = m.name;

    const chev = document.createElement('span');
    chev.className = 'map-dropdown-chev';
    chev.setAttribute('aria-hidden', 'true');
    chev.textContent = '▾';

    this.button.appendChild(thumb);
    this.button.appendChild(label);
    if (m.wip) {
      const badge = document.createElement('span');
      badge.className = 'map-dropdown-wip-badge';
      badge.textContent = 'WIP';
      this.button.appendChild(badge);
    }
    this.button.appendChild(chev);
  }

  private syncOpenState(): void {
    const open = this.store.get().ui.mapDropdownOpen;
    if (this.list) this.list.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
  }
}
