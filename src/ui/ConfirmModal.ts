import '../styles/confirm-modal.css';
import type { Store } from '../app/store';
import { activateModalA11y } from '../app/modalA11y';

export class ConfirmModal {
  private root: HTMLElement | null = null;
  private deactivateA11y: (() => void) | null = null;
  private unsub: () => void = () => {};

  constructor(private host: HTMLElement, private store: Store) {}

  mount(): void {
    this.unsub = this.store.subscribe(['ui'], () => this.sync());
    this.sync();
  }

  destroy(): void {
    this.unsub();
    this.removeRoot();
  }

  private sync(): void {
    const payload = this.store.get().ui.confirmOpen;
    if (!payload) {
      this.removeRoot();
      return;
    }
    if (this.root) this.removeRoot();

    const root = document.createElement('div');
    root.className = 'confirm-modal';

    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-modal-backdrop';
    backdrop.addEventListener('click', () => this.close());

    const panel = document.createElement('div');
    panel.className = 'confirm-modal-panel';
    panel.addEventListener('click', (e) => e.stopPropagation());

    const title = document.createElement('div');
    title.className = 'confirm-modal-title';
    title.textContent = payload.title;

    const body = document.createElement('div');
    body.className = 'confirm-modal-body';
    body.textContent = payload.body;

    const buttons = document.createElement('div');
    buttons.className = 'confirm-modal-buttons';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'confirm-modal-cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.close());

    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = `confirm-modal-confirm confirm-modal-confirm--${payload.kind}`;
    confirm.textContent = payload.confirmLabel;
    confirm.addEventListener('click', () => {
      const fn = payload.onConfirm;
      this.close();
      fn();
    });

    buttons.appendChild(cancel);
    buttons.appendChild(confirm);
    panel.appendChild(title);
    panel.appendChild(body);
    panel.appendChild(buttons);
    root.appendChild(backdrop);
    root.appendChild(panel);
    this.host.appendChild(root);
    this.root = root;
    this.deactivateA11y = activateModalA11y({ panel, title, initialFocus: confirm });
  }

  private close(): void {
    const ui = this.store.get().ui;
    this.store._apply({ ui: { ...ui, confirmOpen: null } });
  }

  private removeRoot(): void {
    if (this.deactivateA11y) {
      this.deactivateA11y();
      this.deactivateA11y = null;
    }
    if (this.root && this.root.parentElement) this.root.parentElement.removeChild(this.root);
    this.root = null;
  }
}
