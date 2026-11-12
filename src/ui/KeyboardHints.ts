import '../styles/keyboard-hints.css';
import type { Store } from '../app/store';
import type { Actions, ActionGroup } from '../app/actions';
import { register as registerOutsideClick } from '../app/outsideClick';
import { activateModalA11y } from '../app/modalA11y';

const GROUP_ORDER: readonly ActionGroup[] = ['Tool', 'Map', 'Edit', 'View', 'Help'];

export class KeyboardHints {
  private root: HTMLElement;
  private inner: HTMLElement;
  private head: HTMLElement;
  private list: HTMLElement;
  private deactivateA11y: (() => void) | null = null;
  private unsubUi: () => void = () => {};
  private offDocMouseDown: () => void = () => {};

  constructor(
    private host: HTMLElement,
    private store: Store,
    private actions: Actions,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'keyboard-hints';
    this.root.hidden = true;

    this.inner = document.createElement('div');
    this.inner.className = 'kh-inner';

    this.head = document.createElement('div');
    this.head.className = 'kh-head';
    this.head.textContent = 'KEYBOARD SHORTCUTS';

    this.list = document.createElement('div');
    this.list.className = 'kh-list';

    this.inner.appendChild(this.head);
    this.inner.appendChild(this.list);
    this.root.appendChild(this.inner);
  }

  mount(): void {
    this.host.appendChild(this.root);
    this.renderList();
    this.unsubUi = this.store.subscribe(['ui'], () => this.syncOpenState());
    this.syncOpenState();

    // Close on any mousedown outside the dialog body. The shared
    // outside-click registry is gated on hintsOpen so background clicks
    // are silently ignored when the modal isn't visible.
    this.offDocMouseDown = registerOutsideClick(
      (target) => {
        if (!this.store.get().ui.hintsOpen) return true;
        const node = target as Node | null;
        return Boolean(node && this.inner.contains(node));
      },
      () => this.setOpen(false),
    );
  }

  destroy(): void {
    this.unsubUi();
    this.offDocMouseDown();
    if (this.deactivateA11y) {
      this.deactivateA11y();
      this.deactivateA11y = null;
    }
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
  }

  private setOpen(open: boolean): void {
    const ui = this.store.get().ui;
    if (ui.hintsOpen === open) return;
    this.store._apply({ ui: { ...ui, hintsOpen: open } });
  }

  private syncOpenState(): void {
    const open = this.store.get().ui.hintsOpen;
    const wasOpen = !this.root.hidden;
    this.root.hidden = !open;
    if (open && !wasOpen) {
      this.deactivateA11y = activateModalA11y({ panel: this.inner, title: this.head });
    } else if (!open && wasOpen && this.deactivateA11y) {
      this.deactivateA11y();
      this.deactivateA11y = null;
    }
  }

  private renderList(): void {
    while (this.list.firstChild) this.list.removeChild(this.list.firstChild);

    for (const group of GROUP_ORDER) {
      // Only list actions that actually have a hotkey; a row with a blank key
      // chip is just noise. Functions without a shortcut still live in the
      // command palette (Ctrl+K) and on their UI buttons.
      const items = this.actions.list(group).filter((a) => a.hotkey != null);
      if (items.length === 0) continue;

      const head = document.createElement('div');
      head.className = 'kh-group-head';
      head.textContent = group;
      this.list.appendChild(head);

      for (const a of items) {
        const row = document.createElement('div');
        row.className = 'kh-row';
        row.dataset['id'] = a.id;

        const title = document.createElement('span');
        title.className = 'kh-title';
        title.textContent = a.title;

        const key = document.createElement('span');
        key.className = 'kh-key';
        key.textContent = a.hotkey!;

        row.appendChild(title);
        row.appendChild(key);
        this.list.appendChild(row);
      }
    }
  }
}
