import { needsPrompt, setConsent } from '../app/consent';

// Bottom consent banner. Honest copy: today only essential local storage is
// used. The analytics toggle governs any future analytics via hasConsent().
// Built with plain DOM methods (no innerHTML) so there's no injection surface.
export class ConsentBanner {
  private root: HTMLElement;
  private el: HTMLDivElement | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  /** Show the banner only if the user hasn't made a current choice yet. */
  maybeShow(): void {
    if (!needsPrompt()) return;
    if (this.el) return;
    this.render();
  }

  private close(): void {
    this.el?.remove();
    this.el = null;
  }

  private render(): void {
    const el = document.createElement('div');
    el.id = 'consent-banner';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-labelledby', 'consent-title');

    const h = document.createElement('h2');
    h.id = 'consent-title';
    h.textContent = 'Your privacy';

    const p = document.createElement('p');
    p.textContent =
      "Your saved strats and settings are kept in this browser's local storage. Nothing tracks you here: no analytics, no tracking cookies and no third-party scripts.";

    const custom = document.createElement('div');
    custom.className = 'consent-customise';
    custom.id = 'consent-custom';
    custom.appendChild(
      this.row('consent-essential', 'Essential storage', 'Your saves, theme and tool settings. Always on, the app needs it.', true, true),
    );
    const analyticsRow = this.row('consent-analytics', 'Analytics', 'Not used. This switch only matters if that ever changes.', false, false);
    custom.appendChild(analyticsRow);
    const analytics = analyticsRow.querySelector('input') as HTMLInputElement;

    const actions = document.createElement('div');
    actions.className = 'consent-actions';
    const acceptAll = this.button('Accept all', 'consent-accept');
    const reject = this.button('Reject non-essential');
    const customise = this.button('Customise');
    const save = this.button('Save choices');
    save.style.display = 'none';
    actions.append(acceptAll, reject, customise, save);

    acceptAll.addEventListener('click', () => { setConsent({ analytics: true }); this.close(); });
    reject.addEventListener('click', () => { setConsent({ analytics: false }); this.close(); });
    customise.addEventListener('click', () => {
      custom.classList.add('is-open');
      customise.style.display = 'none';
      save.style.display = '';
    });
    save.addEventListener('click', () => { setConsent({ analytics: analytics.checked }); this.close(); });

    el.append(h, p, custom, actions);
    this.root.appendChild(el);
    this.el = el;
  }

  private button(label: string, cls?: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (cls) b.className = cls;
    return b;
  }

  private row(id: string, title: string, desc: string, checked: boolean, disabled: boolean): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'consent-row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = checked;
    input.disabled = disabled;
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = title;
    const small = document.createElement('small');
    small.textContent = desc;
    label.appendChild(small);
    row.append(input, label);
    return row;
  }
}
