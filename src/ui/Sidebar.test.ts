import { describe, it, expect } from 'vitest';
import { Sidebar } from './Sidebar';
import { createStore, type StratState } from '../app/store';
import { emptyFrame } from '../types/primitives';
import { hex } from '../types/hex';

function initialState(): StratState {
  return {
    mapId: 'miru', zoom: 1, panX: 0, panY: 0,
    frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '', tool: 'cursor',
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
}

describe('Sidebar', () => {
  it('mount() builds header + tab strip + child slots inside the host', () => {
    const host = document.createElement('div');
    const store = createStore(initialState());
    const sidebar = new Sidebar(host, store);
    sidebar.mount();

    expect(host.querySelector('.sidebar-header')).not.toBeNull();
    expect(host.querySelector('.sidebar-logo')).not.toBeNull();
    expect(host.querySelector('.sidebar-tabs')).not.toBeNull();

    expect(sidebar.getMapDropdownSlot()).not.toBeNull();
    expect(sidebar.getToolRailSlot()).not.toBeNull();
    expect(sidebar.getContextPanelSlot()).not.toBeNull();
    expect(sidebar.getColourSlotsSlot()).not.toBeNull();
    expect(sidebar.getNotesPaneSlot()).not.toBeNull();

    sidebar.destroy();
  });

  it('renders TOOLS and NOTES tab buttons', () => {
    const host = document.createElement('div');
    const store = createStore(initialState());
    const sidebar = new Sidebar(host, store);
    sidebar.mount();

    const tabs = host.querySelectorAll<HTMLButtonElement>('.sidebar-tab');
    expect(tabs.length).toBe(2);
    expect(tabs[0]?.textContent).toBe('TOOLS');
    expect(tabs[1]?.textContent).toBe('NOTES');

    sidebar.destroy();
  });

  it('initial sidebarTab=tools -> notes-pane slot has hidden class', () => {
    const host = document.createElement('div');
    const store = createStore(initialState());
    const sidebar = new Sidebar(host, store);
    sidebar.mount();

    expect(sidebar.getNotesPaneSlot().classList.contains('sidebar-content--hidden')).toBe(true);
    expect(sidebar.getToolRailSlot().classList.contains('sidebar-content--hidden')).toBe(false);

    sidebar.destroy();
  });

  it('clicking NOTES flips sidebarTab and toggles slot visibility', () => {
    const host = document.createElement('div');
    const store = createStore(initialState());
    const sidebar = new Sidebar(host, store);
    sidebar.mount();

    const notesTab = host.querySelector<HTMLButtonElement>('.sidebar-tab[data-tab="notes"]');
    notesTab?.click();

    expect(store.get().ui.sidebarTab).toBe('notes');
    expect(sidebar.getNotesPaneSlot().classList.contains('sidebar-content--hidden')).toBe(false);
    expect(sidebar.getToolRailSlot().classList.contains('sidebar-content--hidden')).toBe(true);
    expect(sidebar.getContextPanelSlot().classList.contains('sidebar-content--hidden')).toBe(true);
    expect(sidebar.getColourSlotsSlot().classList.contains('sidebar-content--hidden')).toBe(true);

    sidebar.destroy();
  });

  it('logo text is "ARTIFACTGG.COM" with .logo-gg accent on the GG.COM portion', () => {
    const host = document.createElement('div');
    const store = createStore(initialState());
    const sidebar = new Sidebar(host, store);
    sidebar.mount();

    const logo = host.querySelector('.sidebar-logo');
    expect(logo?.textContent).toBe('ARTIFACTGG.COM');
    expect(logo?.querySelector('.logo-gg')?.textContent).toBe('GG.COM');

    sidebar.destroy();
  });

  it('the Privacy & legal link runs the legal.open action', () => {
    const host = document.createElement('div');
    const store = createStore(initialState());
    const ran: string[] = [];
    const actions = {
      register: () => {},
      byId: () => null,
      byHotkey: () => null,
      list: () => [],
      run: (id: string) => { ran.push(id); return true; },
    };
    const sidebar = new Sidebar(host, store, actions);
    sidebar.mount();

    const link = host.querySelector<HTMLButtonElement>('.sidebar-legal-link');
    expect(link).not.toBeNull();
    expect(link!.textContent).toBe('Privacy & legal');
    link!.click();
    expect(ran).toContain('legal.open');

    sidebar.destroy();
  });

  it('shows a version tag next to the legal link', async () => {
    const { APP_VERSION } = await import('../app/version');
    const host = document.createElement('div');
    const store = createStore(initialState());
    const sidebar = new Sidebar(host, store, {
      register: () => {}, byId: () => null, byHotkey: () => null, list: () => [], run: () => true,
    });
    sidebar.mount();
    const tag = host.querySelector('.sidebar-version');
    expect(tag).not.toBeNull();
    expect(tag!.textContent).toBe(`v${APP_VERSION}`);
    sidebar.destroy();
  });

  it('destroy() removes all sidebar DOM from the host', () => {
    const host = document.createElement('div');
    const store = createStore(initialState());
    const sidebar = new Sidebar(host, store);
    sidebar.mount();

    expect(host.children.length).toBeGreaterThan(0);
    sidebar.destroy();
    expect(host.children.length).toBe(0);
  });

  it('aria-selected reflects the active tab (full tablist pattern)', () => {
    const host = document.createElement('div');
    const store = createStore(initialState());
    const sidebar = new Sidebar(host, store);
    sidebar.mount();

    const toolsTab = host.querySelector<HTMLButtonElement>('.sidebar-tab[data-tab="tools"]');
    const notesTab = host.querySelector<HTMLButtonElement>('.sidebar-tab[data-tab="notes"]');
    expect(toolsTab?.getAttribute('aria-selected')).toBe('true');
    expect(notesTab?.getAttribute('aria-selected')).toBe('false');
    // Roving tabindex: only the active tab is in the natural tab order.
    expect(toolsTab?.tabIndex).toBe(0);
    expect(notesTab?.tabIndex).toBe(-1);

    store._apply({ ui: { ...store.get().ui, sidebarTab: 'notes' } });
    expect(toolsTab?.getAttribute('aria-selected')).toBe('false');
    expect(notesTab?.getAttribute('aria-selected')).toBe('true');
    expect(toolsTab?.tabIndex).toBe(-1);
    expect(notesTab?.tabIndex).toBe(0);

    sidebar.destroy();
  });

  it('the tablist has role=tablist and each tab role=tab', () => {
    const host = document.createElement('div');
    const store = createStore(initialState());
    const sidebar = new Sidebar(host, store);
    sidebar.mount();

    expect(host.querySelector('.sidebar-tabs')?.getAttribute('role')).toBe('tablist');
    const tabs = host.querySelectorAll<HTMLButtonElement>('.sidebar-tab');
    tabs.forEach((t) => expect(t.getAttribute('role')).toBe('tab'));

    sidebar.destroy();
  });
});
