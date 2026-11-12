import '../styles/legal.css';
// Same trick as ChangelogModal: the body is a static file in the repo,
// parsed via DOMParser and reparented with appendChild. DOMParser does not
// run scripts or inline handlers, and the source is hand-authored next to
// this code, so the no-raw-HTML-setter rule still holds.
import legalBody from '../app/legal.html?raw';
import { CONTACT_URL } from '../app/contact';
import { activateModalA11y } from '../app/modalA11y';

/**
 * Privacy & legal notice. Deliberately NOT driven off the store's `ui`
 * slice: adding a flag there would mean touching every test that spells
 * out the full ui object. It owns its own open state and is opened via the
 * `legal.open` action (deps.openLegal -> this.open()).
 */
export class LegalModal {
  private root: HTMLElement;
  private panel: HTMLElement;
  private title: HTMLElement;
  private open_ = false;
  private deactivateA11y: (() => void) | null = null;

  isOpen(): boolean { return this.open_; }

  constructor(private host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'legal-modal';
    this.root.hidden = true;

    const backdrop = document.createElement('div');
    backdrop.className = 'legal-modal-backdrop';

    this.panel = document.createElement('div');
    this.panel.className = 'legal-modal-panel';

    const header = document.createElement('div');
    header.className = 'legal-modal-header';

    this.title = document.createElement('div');
    this.title.className = 'legal-modal-title';
    this.title.textContent = 'TERMS, PRIVACY & LEGAL';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'legal-modal-close';
    closeBtn.textContent = 'x';
    closeBtn.title = 'Close (Esc)';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => this.close());

    header.appendChild(this.title);
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'legal-modal-body';
    const parsed = new DOMParser().parseFromString(legalBody, 'text/html');
    for (const node of Array.from(parsed.body.childNodes)) {
      body.appendChild(node);
    }

    const contact = body.querySelector<HTMLAnchorElement>('.legal-contact');
    if (contact) contact.href = CONTACT_URL;

    const reportBtn = body.querySelector<HTMLButtonElement>('.legal-report-btn');
    const reportHint = body.querySelector<HTMLElement>('.legal-report-hint');
    if (reportBtn && reportHint) {
      reportBtn.addEventListener('click', () => {
        window.open(CONTACT_URL, '_blank', 'noopener,noreferrer');
        reportHint.textContent = 'Discord opened. Paste the link to the strat you are reporting.';
      });
    }

    this.panel.appendChild(header);
    this.panel.appendChild(body);
    this.root.appendChild(backdrop);
    this.root.appendChild(this.panel);

    backdrop.addEventListener('click', () => this.close());
    this.panel.addEventListener('click', (e) => e.stopPropagation());
  }

  mount(): void {
    this.host.appendChild(this.root);
  }

  destroy(): void {
    if (this.deactivateA11y) {
      this.deactivateA11y();
      this.deactivateA11y = null;
    }
    if (this.root.parentElement) this.root.parentElement.removeChild(this.root);
  }

  open(): void {
    if (this.open_) return;
    this.open_ = true;
    this.root.hidden = false;
    this.deactivateA11y = activateModalA11y({ panel: this.panel, title: this.title });
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.root.hidden = true;
    if (this.deactivateA11y) {
      this.deactivateA11y();
      this.deactivateA11y = null;
    }
  }
}
