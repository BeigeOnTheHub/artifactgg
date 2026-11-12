import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TopBar } from './TopBar';
import { createStore, type StratState } from '../app/store';
import { createActions } from '../app/actions';
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

describe('TopBar', () => {
  let host: HTMLElement;
  let bar: TopBar;
  let store: ReturnType<typeof createStore>;
  let actions: ReturnType<typeof createActions>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore(initialState());
    actions = createActions(store);
    bar = new TopBar(host, store, actions);
    bar.mount();
  });

  afterEach(() => {
    bar.destroy();
    document.body.removeChild(host);
  });

  it('does not render FRAME / ANIMATION mode tabs (modes were merged)', () => {
    const tabs = host.querySelectorAll<HTMLButtonElement>('.topbar-mode-tab');
    expect(tabs.length).toBe(0);
  });

  it('renders 6 action buttons (info, hints and command-palette moved/removed)', () => {
    const btns = host.querySelectorAll<HTMLButtonElement>('.topbar-action-btn');
    expect(btns.length).toBe(6);
    const ids = Array.from(btns).map((b) => b.dataset['action']);
    expect(ids).toEqual(['save', 'library', 'import', 'export-png', 'export-json', 'share']);
  });

  it('does not render a command-palette button (Ctrl+K still opens it)', () => {
    expect(host.querySelector('.topbar-action-btn[data-action="palette"]')).toBeNull();
  });

  it('5b buttons are enabled (no disabled placeholders remain)', () => {
    const btnByAction = (id: string): HTMLButtonElement =>
      host.querySelector(`.topbar-action-btn[data-action="${id}"]`) as HTMLButtonElement;
    expect(btnByAction('save').disabled).toBe(false);
    expect(btnByAction('library').disabled).toBe(false);
    expect(btnByAction('import').disabled).toBe(false);
    expect(btnByAction('export-png').disabled).toBe(false);
    expect(btnByAction('export-json').disabled).toBe(false);
    expect(btnByAction('share').disabled).toBe(false);
  });

  it('clicking SAVE runs library.save action', () => {
    const run = vi.fn();
    actions.register({ id: 'library.save', title: 'Save', group: 'File', run });
    bar.destroy();
    bar = new TopBar(host, store, actions);
    bar.mount();
    (host.querySelector('.topbar-action-btn[data-action="save"]') as HTMLElement).click();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('clicking LIBRARY runs library.open action', () => {
    const run = vi.fn();
    actions.register({ id: 'library.open', title: 'Open library', group: 'File', run });
    bar.destroy();
    bar = new TopBar(host, store, actions);
    bar.mount();
    (host.querySelector('.topbar-action-btn[data-action="library"]') as HTMLElement).click();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('clicking IMPORT / PNG / JSON runs the corresponding file.* actions', () => {
    const runImp = vi.fn();
    const runPng = vi.fn();
    const runJson = vi.fn();
    actions.register({ id: 'file.importJson', title: 'Import', group: 'File', run: runImp });
    actions.register({ id: 'file.exportPng', title: 'PNG', group: 'File', run: runPng });
    actions.register({ id: 'file.exportJson', title: 'JSON', group: 'File', run: runJson });
    bar.destroy();
    bar = new TopBar(host, store, actions);
    bar.mount();
    (host.querySelector('.topbar-action-btn[data-action="import"]') as HTMLElement).click();
    expect(runImp).toHaveBeenCalledTimes(1);
    (host.querySelector('.topbar-action-btn[data-action="export-png"]') as HTMLElement).click();
    expect(runPng).toHaveBeenCalledTimes(1);
    (host.querySelector('.topbar-action-btn[data-action="export-json"]') as HTMLElement).click();
    expect(runJson).toHaveBeenCalledTimes(1);
  });

  it('does not render a topbar hints button (moved to sidebar header)', () => {
    expect(host.querySelector('.topbar-action-btn[data-action="hints"]')).toBeNull();
  });

  it('destroy() clears the host', () => {
    bar.destroy();
    expect(host.children.length).toBe(0);
  });

  it('clicking SHARE runs share.open action', () => {
    const run = vi.fn();
    actions.register({ id: 'share.open', title: 'Share', group: 'File', run });
    bar.destroy();
    bar = new TopBar(host, store, actions);
    bar.mount();
    (host.querySelector('.topbar-action-btn[data-action="share"]') as HTMLElement).click();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('renders a theme cycle button separate from the action buttons', () => {
    // distinct class so the "6 action buttons" assertion stays valid
    expect(host.querySelector('.topbar-theme-btn')).not.toBeNull();
    expect(host.querySelectorAll('.topbar-action-btn').length).toBe(6);
  });

  it('clicking the theme button cycles the persisted theme and updates its label', async () => {
    const { getTheme } = await import('../app/themePref');
    localStorage.setItem('artifact-gg.v2.theme', 'dark');
    bar.destroy();
    bar = new TopBar(host, store, actions);
    bar.mount();
    const btn = host.querySelector('.topbar-theme-btn') as HTMLButtonElement;
    btn.click();
    expect(getTheme()).toBe('light');
    expect(btn.textContent).toBe('LIGHT');
    btn.click();
    expect(getTheme()).toBe('high-contrast');
    expect(btn.textContent).toBe('HC');
  });
});

describe('TopBar - no info button', () => {
  // The changelog button sits in the sidebar header (see Sidebar.test.ts).
  let host: HTMLElement;
  let bar: TopBar;
  let store: ReturnType<typeof createStore>;
  let actions: ReturnType<typeof createActions>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore(initialState());
    actions = createActions(store);
    bar = new TopBar(host, store, actions);
    bar.mount();
  });

  afterEach(() => {
    bar.destroy();
    document.body.removeChild(host);
  });

  it('does not render a topbar info button', () => {
    expect(host.querySelector('.topbar-action-btn[data-action="info"]')).toBeNull();
  });
});
