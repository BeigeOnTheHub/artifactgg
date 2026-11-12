import '../styles/sidebar.css';
import type { Store } from '../app/store';
import type { Actions } from '../app/actions';
import { APP_VERSION } from '../app/version';

export class Sidebar {
  private mapDropdownSlot: HTMLElement;
  private toolRailSlot: HTMLElement;
  private contextPanelSlot: HTMLElement;
  private colourSlotsSlot: HTMLElement;
  private notesPaneSlot: HTMLElement;
  private layerVisibilitySlot: HTMLElement;
  private toolsTab: HTMLButtonElement | null = null;
  private notesTab: HTMLButtonElement | null = null;
  private mounted = false;
  private unsub: () => void = () => {};

  constructor(private host: HTMLElement, private store: Store, private actions?: Actions) {
    this.mapDropdownSlot = document.createElement('section');
    this.toolRailSlot = document.createElement('section');
    this.contextPanelSlot = document.createElement('section');
    this.colourSlotsSlot = document.createElement('section');
    this.notesPaneSlot = document.createElement('section');
    this.layerVisibilitySlot = document.createElement('section');
  }

  mount(): void {
    if (this.mounted) return;
    this.mounted = true;

    while (this.host.firstChild) this.host.removeChild(this.host.firstChild);

    const header = this.buildHeader();
    this.host.appendChild(header);

    this.mapDropdownSlot.className = 'sidebar-section sidebar-map';
    this.toolRailSlot.className = 'sidebar-section sidebar-tools';
    this.contextPanelSlot.className = 'sidebar-section sidebar-context';
    this.colourSlotsSlot.className = 'sidebar-section sidebar-colours';
    this.notesPaneSlot.className = 'sidebar-section sidebar-notes';
    this.layerVisibilitySlot.className = 'sidebar-section sidebar-layer-visibility';

    this.host.appendChild(this.mapDropdownSlot);
    this.host.appendChild(this.buildTabs());
    this.host.appendChild(this.toolRailSlot);
    this.host.appendChild(this.contextPanelSlot);
    this.host.appendChild(this.notesPaneSlot);
    this.host.appendChild(this.layerVisibilitySlot);
    this.host.appendChild(this.colourSlotsSlot);
    this.host.appendChild(this.buildLegalLink());

    this.unsub = this.store.subscribe(['ui'], () => this.syncTabs());
    this.syncTabs();
  }

  destroy(): void {
    if (!this.mounted) return;
    this.mounted = false;
    this.unsub();
    while (this.host.firstChild) this.host.removeChild(this.host.firstChild);
  }

  /** Slot for MapDropdown. */
  getMapDropdownSlot(): HTMLElement { return this.mapDropdownSlot; }
  /** Slot for ToolRail. */
  getToolRailSlot(): HTMLElement { return this.toolRailSlot; }
  /** Slot for ContextPanel. */
  getContextPanelSlot(): HTMLElement { return this.contextPanelSlot; }
  /** Slot for ColourSlots. */
  getColourSlotsSlot(): HTMLElement { return this.colourSlotsSlot; }
  /** Slot for NotesPane. */
  getNotesPaneSlot(): HTMLElement { return this.notesPaneSlot; }
  /** Slot for LayerVisibilityPanel. Lives in the Tools tab. */
  getLayerVisibilitySlot(): HTMLElement { return this.layerVisibilitySlot; }

  private buildHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'sidebar-header';

    const logo = document.createElement('div');
    logo.className = 'sidebar-logo';

    const artifact = document.createElement('span');
    artifact.className = 'logo-artifact';
    artifact.textContent = 'ARTIFACT';

    const gg = document.createElement('span');
    gg.className = 'logo-gg';
    gg.textContent = 'GG.COM';

    logo.appendChild(artifact);
    logo.appendChild(gg);
    header.appendChild(logo);

    // Help buttons (changelog + shortcuts) sit next to the logo so they're
    // anchored to the brand rather than fighting for space at the right edge
    // of the topbar action row.
    const helpRow = document.createElement('div');
    helpRow.className = 'sidebar-header-help';

    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'sidebar-header-help-btn';
    info.textContent = 'i';
    info.title = "What's new (Changelog)";
    info.setAttribute('aria-label', 'Open changelog');
    info.addEventListener('click', () => { this.actions?.run('changelog.open'); });

    const hints = document.createElement('button');
    hints.type = 'button';
    hints.className = 'sidebar-header-help-btn';
    hints.textContent = '?';
    hints.title = 'Keyboard shortcuts';
    hints.setAttribute('aria-label', 'Open keyboard shortcuts');
    hints.addEventListener('click', () => { this.actions?.run('help.openHints'); });

    helpRow.appendChild(info);
    helpRow.appendChild(hints);
    header.appendChild(helpRow);

    return header;
  }

  /** Small always-visible footer link to the privacy & legal notice. Kept
   *  discoverable on purpose - a data/privacy notice buried in the command
   *  palette doesn't really count as notice. */
  private buildLegalLink(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'sidebar-legal';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sidebar-legal-link';
    btn.textContent = 'Privacy & legal';
    btn.addEventListener('click', () => { this.actions?.run('legal.open'); });
    wrap.appendChild(btn);

    // Small version tag pinned to the right of the legal link.
    const version = document.createElement('span');
    version.className = 'sidebar-version';
    version.textContent = `v${APP_VERSION}`;
    wrap.appendChild(version);
    return wrap;
  }

  private buildTabs(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'sidebar-tabs';
    // Full WAI-ARIA tablist pattern: role=tablist on the container with arrow-
    // key roving tabindex, role=tab on each button with aria-selected. Used
    // to be a pair of aria-pressed toggle buttons -- functional but the wrong
    // semantic for two-of-N section selectors.
    wrap.setAttribute('role', 'tablist');
    wrap.setAttribute('aria-label', 'Sidebar sections');

    this.toolsTab = this.makeTab('tools', 'TOOLS');
    this.notesTab = this.makeTab('notes', 'NOTES');

    wrap.appendChild(this.toolsTab);
    wrap.appendChild(this.notesTab);
    wrap.addEventListener('keydown', (e) => this.onTabsKeydown(e));
    return wrap;
  }

  private makeTab(tab: 'tools' | 'notes', label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sidebar-tab';
    btn.dataset['tab'] = tab;
    btn.textContent = label;
    btn.setAttribute('role', 'tab');
    btn.addEventListener('click', () => {
      const ui = this.store.get().ui;
      if (ui.sidebarTab === tab) return;
      this.store._apply({ ui: { ...ui, sidebarTab: tab } });
    });
    return btn;
  }

  /** Roving-tabindex + arrow-key activation for the two-tab strip. */
  private onTabsKeydown(e: KeyboardEvent): void {
    if (!this.toolsTab || !this.notesTab) return;
    const tabs: HTMLButtonElement[] = [this.toolsTab, this.notesTab];
    const active = document.activeElement as HTMLElement | null;
    const i = active ? tabs.indexOf(active as HTMLButtonElement) : -1;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (i + 1) % tabs.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (i - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    if (next == null) return;
    e.preventDefault();
    const target = tabs[next]!;
    target.focus();
    // Auto-activate on focus (the recommended pattern for a 2-tab strip with
    // no expensive panel mount cost).
    target.click();
  }

  private syncTabs(): void {
    const tab = this.store.get().ui.sidebarTab;
    if (this.toolsTab) {
      const on = tab === 'tools';
      this.toolsTab.setAttribute('aria-selected', String(on));
      // Roving tabindex: only the selected tab is in the tab order.
      this.toolsTab.tabIndex = on ? 0 : -1;
    }
    if (this.notesTab) {
      const on = tab === 'notes';
      this.notesTab.setAttribute('aria-selected', String(on));
      this.notesTab.tabIndex = on ? 0 : -1;
    }

    const HIDDEN = 'sidebar-content--hidden';
    const toolsActive = tab === 'tools';
    this.toolRailSlot.classList.toggle(HIDDEN, !toolsActive);
    this.contextPanelSlot.classList.toggle(HIDDEN, !toolsActive);
    this.colourSlotsSlot.classList.toggle(HIDDEN, !toolsActive);
    this.layerVisibilitySlot.classList.toggle(HIDDEN, !toolsActive);
    this.notesPaneSlot.classList.toggle(HIDDEN, toolsActive);
  }
}
