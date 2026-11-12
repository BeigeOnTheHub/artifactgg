import '../styles/top-bar.css';
import type { Actions } from '../app/actions';
import type { Store } from '../app/store';
import { getTheme, cycleTheme, subscribeTheme, type Theme } from '../app/themePref';

interface ActionDef { id: 'save' | 'library' | 'import' | 'export-png' | 'export-json' | 'share'; label: string; title: string; actionId: string | null; }

// Changelog and shortcuts live in the sidebar header, not here, so they don't
// get lost at the right edge of a busy topbar. Ctrl+K opens the palette.
const ACTIONS: readonly ActionDef[] = [
  { id: 'save',        label: 'SAVE',   title: 'Save strat (Ctrl+S)',          actionId: 'library.save' },
  { id: 'library',     label: 'LIB',    title: 'Strat library (Ctrl+Shift+L)', actionId: 'library.open' },
  { id: 'import',      label: 'IMP',    title: 'Import .strat.json',           actionId: 'file.importJson' },
  { id: 'export-png',  label: 'PNG',    title: 'Export PNG',                   actionId: 'file.exportPng' },
  { id: 'export-json', label: 'JSON',   title: 'Export .strat.json',           actionId: 'file.exportJson' },
  { id: 'share',       label: 'SHARE',  title: 'Share strat',                  actionId: 'share.open' },
];

export class TopBar {
  private container: HTMLElement;
  private themeUnsub: () => void = () => {};

  constructor(private host: HTMLElement, _store: Store, private actions?: Actions) {
    this.container = document.createElement('div');
    this.container.className = 'topbar';
  }

  private themeLabel(t: Theme): string {
    return t === 'high-contrast' ? 'HC' : t.toUpperCase();
  }

  mount(): void {
    while (this.host.firstChild) this.host.removeChild(this.host.firstChild);
    this.host.appendChild(this.container);

    // Spacer pushes the action buttons to the right edge.
    const spacer = document.createElement('div');
    spacer.className = 'topbar-spacer';

    const actionsEl = document.createElement('div');
    actionsEl.className = 'topbar-actions';
    for (const a of ACTIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'topbar-action-btn';
      btn.dataset['action'] = a.id;
      btn.textContent = a.label;
      btn.title = a.title;
      btn.disabled = a.actionId === null;
      if (a.actionId !== null) {
        const id = a.actionId;
        btn.addEventListener('click', () => { this.actions?.run(id); });
      }
      actionsEl.appendChild(btn);
    }

    const themeBtn = document.createElement('button');
    themeBtn.type = 'button';
    themeBtn.className = 'topbar-theme-btn';
    const paint = (t: Theme): void => {
      themeBtn.textContent = this.themeLabel(t);
      themeBtn.title = `Theme: ${t} (click to cycle)`;
      themeBtn.setAttribute('aria-label', `Theme: ${t}. Click to cycle theme.`);
    };
    paint(getTheme());
    themeBtn.addEventListener('click', () => { paint(cycleTheme()); });
    this.themeUnsub = subscribeTheme(paint);
    actionsEl.appendChild(themeBtn);

    this.container.appendChild(spacer);
    this.container.appendChild(actionsEl);
  }

  destroy(): void {
    this.themeUnsub();
    this.themeUnsub = () => {};
    while (this.host.firstChild) this.host.removeChild(this.host.firstChild);
  }
}
