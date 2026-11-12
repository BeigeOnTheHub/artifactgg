import '../styles/changelog.css';
// changelog body is a static file in the repo, parsed via
// DOMParser at runtime. The no-raw-HTML-setter rule holds - we reparent
// the parsed body's children via appendChild, never assigning HTML strings.
import changelogBody from '../app/changelog.html?raw';
import type { Store } from '../app/store';
import { activateModalA11y } from '../app/modalA11y';

export class ChangelogModal {
  private root: HTMLElement;
  private backdrop: HTMLElement;
  private panel: HTMLElement;
  private title: HTMLElement;
  private body: HTMLElement;
  private deactivateA11y: (() => void) | null = null;
  private unsub: () => void = () => {};

  constructor(private host: HTMLElement, private store: Store) {
    this.root = document.createElement('div');
    this.root.className = 'changelog-modal';
    this.root.hidden = true;

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'changelog-modal-backdrop';

    this.panel = document.createElement('div');
    this.panel.className = 'changelog-modal-panel';

    const header = document.createElement('div');
    header.className = 'changelog-modal-header';

    this.title = document.createElement('div');
    this.title.className = 'changelog-modal-title';
    this.title.textContent = 'CHANGELOG';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'changelog-modal-close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close (Esc)';
    closeBtn.setAttribute('aria-label', 'Close changelog');
    closeBtn.addEventListener('click', () => this.close());

    header.appendChild(this.title);
    header.appendChild(closeBtn);

    this.body = document.createElement('div');
    this.body.className = 'changelog-modal-body';

    // Parse the static-imported HTML at runtime and reparent its body's
    // children. DOMParser does NOT execute scripts or inline event handlers
    // during parse; the source file is hand-authored alongside this code,
    // so trust is intrinsic. No raw-HTML setter is involved.
    const parser = new DOMParser();
    const parsed = parser.parseFromString(changelogBody, 'text/html');
    const nodes = Array.from(parsed.body.childNodes);
    for (const node of nodes) {
      this.body.appendChild(node);
    }

    this.panel.appendChild(header);
    this.panel.appendChild(this.body);

    this.root.appendChild(this.backdrop);
    this.root.appendChild(this.panel);

    this.backdrop.addEventListener('click', () => this.close());
    this.panel.addEventListener('click', (e) => e.stopPropagation());
  }

  mount(): void {
    this.host.appendChild(this.root);
    this.sync();
    this.unsub = this.store.subscribe(['ui'], () => this.sync());
  }

  destroy(): void {
    this.unsub();
    if (this.deactivateA11y) {
      this.deactivateA11y();
      this.deactivateA11y = null;
    }
    if (this.root.parentElement) this.root.parentElement.removeChild(this.root);
  }

  private sync(): void {
    const open = this.store.get().ui.changelogOpen;
    const wasOpen = !this.root.hidden;
    this.root.hidden = !open;
    if (open && !wasOpen) {
      this.deactivateA11y = activateModalA11y({ panel: this.panel, title: this.title });
    } else if (!open && wasOpen && this.deactivateA11y) {
      this.deactivateA11y();
      this.deactivateA11y = null;
    }
  }

  private close(): void {
    const ui = this.store.get().ui;
    if (!ui.changelogOpen) return;
    this.store._apply({ ui: { ...ui, changelogOpen: false } });
  }
}
