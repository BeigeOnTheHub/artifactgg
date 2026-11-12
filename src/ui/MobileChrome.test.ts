import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MobileChrome, type MobileEditCtx } from './MobileChrome';
import { createStore, type StratState } from '../app/store';
import type { MapId } from '../types/maps';
import { createHistory } from '../app/history';
import { deleteSelection } from '../app/clipboard';
import { emptyFrame } from '../types/primitives';
import { hex } from '../types/hex';

function makeStore(notes = 'rotate short', mapId: MapId = 'suna', mapFrames: Partial<NonNullable<StratState['mapFrames']>> = {}) {
  const s: StratState = { mapId, zoom:1, panX:0, panY:0, frames:[], activeFrameIdx:0, notes, tool:'cursor', colourSlots:[null,null,null,null,null], activeSlot:0, selection:[], mapFrames, ui:{ sidebarTab:'tools', mode:'frame', paletteOpen:false, shareOpen:false, libraryOpen:false, mapDropdownOpen:false, colourPickerOpen:false, hintsOpen:false, calloutsVisible:false, changelogOpen:false, confirmOpen:null }, layoutMode:'compact', readOnly:true };
  return createStore(s);
}

/** The launcher callbacks as vi mocks (one per MobileMenuActions field). */
function makeMenuActions() {
  return {
    save: vi.fn(), newSave: vi.fn(), openLibrary: vi.fn(), importFile: vi.fn(),
    exportPng: vi.fn(), exportGif: vi.fn(), exportJson: vi.fn(), openShare: vi.fn(),
    openChangelog: vi.fn(), openLegal: vi.fn(),
  };
}

describe('MobileChrome', () => {
  let host: HTMLElement;
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); });
  afterEach(() => { host.remove(); });

  it('renders the strat title and a menu button with an aria-label', () => {
    const c = new MobileChrome(host, makeStore(), 'suna - A retake');
    c.mount();
    expect(host.textContent).toContain('suna - A retake');
    const btn = host.querySelector('[data-testid="mobile-menu-btn"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('aria-label')).toBeTruthy();
  });

  it('menu button opens a sheet showing the notes text', () => {
    const c = new MobileChrome(host, makeStore('smoke window first'), 'suna');
    c.mount();
    (host.querySelector('[data-testid="mobile-menu-btn"]') as HTMLButtonElement).click();
    const sheet = host.querySelector('[data-testid="mobile-sheet"]') as HTMLElement;
    expect(sheet).toBeTruthy();
    expect(sheet.textContent).toContain('smoke window first');
    (host.querySelector('[data-testid="mobile-menu-btn"]') as HTMLButtonElement).click();
    expect(host.querySelector('[data-testid="mobile-sheet"]')).toBeNull();
  });

  it('menu sheet closes on Escape', () => {
    const c = new MobileChrome(host, makeStore('hello'), 'suna');
    c.mount();
    (host.querySelector('[data-testid="mobile-menu-btn"]') as HTMLButtonElement).click();
    expect(host.querySelector('[data-testid="mobile-sheet"]')).toBeTruthy();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(host.querySelector('[data-testid="mobile-sheet"]')).toBeNull();
  });

  it('menu sheet closes on outside tap (and keeps open on inside tap)', () => {
    const c = new MobileChrome(host, makeStore('hello'), 'suna');
    c.mount();
    (host.querySelector('[data-testid="mobile-menu-btn"]') as HTMLButtonElement).click();
    const sheet = host.querySelector('[data-testid="mobile-sheet"]') as HTMLElement;
    expect(sheet).toBeTruthy();
    // Tap inside the sheet - stays open.
    sheet.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(host.querySelector('[data-testid="mobile-sheet"]')).toBeTruthy();
    // Tap on bare document - closes.
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(host.querySelector('[data-testid="mobile-sheet"]')).toBeNull();
    outside.remove();
  });

  it('read-only chrome keeps a plain non-button title', () => {
    // No editCtx means no map sheet to open, so the title stays inert text.
    const c = new MobileChrome(host, makeStore(), 'suna');
    c.mount();
    const title = host.querySelector('.mob-title') as HTMLElement;
    expect(title.tagName).toBe('SPAN');
    expect(host.querySelector('[data-testid="mobile-title-btn"]')).toBeNull();
    c.destroy();
  });

  it('document listeners are torn down when the sheet closes (no leak across opens)', () => {
    const c = new MobileChrome(host, makeStore('hello'), 'suna');
    c.mount();
    const btn = host.querySelector('[data-testid="mobile-menu-btn"]') as HTMLButtonElement;
    btn.click();
    btn.click(); // close
    // Escape with no sheet open must not throw or somehow re-fire close.
    expect(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))).not.toThrow();
    expect(host.querySelector('[data-testid="mobile-sheet"]')).toBeNull();
  });

});

describe('MobileChrome edit mode', () => {
  let host: HTMLElement;
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); });
  afterEach(() => { host.remove(); });

  it('shows undo/redo/delete and no read-only pill or transitional message', () => {
    const store = makeStore();
    const history = createHistory(store);
    const mc = new MobileChrome(host, store, 'My Strat',
      { history, deleteSelection: () => deleteSelection(store, history), fitView: () => {}, clearFrame: () => {} });
    mc.mount();
    expect(host.querySelector('[data-testid="mobile-undo"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="mobile-redo"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="mobile-delete"]')).not.toBeNull();
    expect(host.querySelector('.mob-pill')).toBeNull();
    mc.destroy();
  });

  it('delete button is disabled with an empty selection and enabled with one', () => {
    const store = makeStore();
    const history = createHistory(store);
    const mc = new MobileChrome(host, store, 'T',
      { history, deleteSelection: () => deleteSelection(store, history), fitView: () => {}, clearFrame: () => {} });
    mc.mount();
    const del = host.querySelector('[data-testid="mobile-delete"]') as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    store._apply({ selection: [{ kind: 'player', id: 'p1' }] });
    expect(del.disabled).toBe(false);
    mc.destroy();
  });

  it('undo button auto-enables after a committed edit changes frames', async () => {
    const store = makeStore();
    // Seed the store with one empty frame so player.add has a valid frame to mutate.
    store._apply({ frames: [emptyFrame()] });
    const history = createHistory(store);
    const mc = new MobileChrome(host, store, 'T',
      { history, deleteSelection: () => deleteSelection(store, history), fitView: () => {}, clearFrame: () => {} });
    mc.mount();
    const undo = host.querySelector('[data-testid="mobile-undo"]') as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    // Dispatch a real undoable command that mutates frames.
    history.dispatch({ t: 'player.add', player: { id: 'mc-test-p1', team: 'colonist', x: 100, y: 200, name: 'T', dead: false } });
    // refreshEdit is scheduled via queueMicrotask so it runs after undoStack is pushed.
    // Flush the microtask queue before asserting.
    await Promise.resolve();
    // After the microtask, history.canUndo() is true and the undo button must be enabled.
    expect(undo.disabled).toBe(false);
    mc.destroy();
  });

  it('has no multi-select toggle - the long-press menu owns that now', () => {
    // The toggle was a fifth 44px target in a 360px row. Holding an item opens
    // the per-item action menu, whose "Add to selection" row switches the mode
    // on (see ItemActionMenu.test.ts), so the button had a better home.
    const store = makeStore();
    const history = createHistory(store);
    const mc = new MobileChrome(host, store, 'T',
      { history, deleteSelection: () => deleteSelection(store, history), fitView: () => {}, clearFrame: () => {} });
    mc.mount();
    expect(host.querySelector('[data-testid="mobile-multi"]')).toBeNull();
    mc.destroy();
  });

  it('edit mode has exactly undo, redo, delete and the menu button', () => {
    const store = makeStore();
    const history = createHistory(store);
    const mc = new MobileChrome(host, store, 'T',
      { history, deleteSelection: () => deleteSelection(store, history), fitView: () => {}, clearFrame: () => {} });
    mc.mount();
    const ids = Array.from(host.querySelectorAll('.mob-topbar button'))
      .map((b) => (b as HTMLElement).dataset['testid']);
    expect(ids).toEqual(['mobile-title-btn', 'mobile-undo', 'mobile-redo', 'mobile-delete', 'mobile-menu-btn']);
    mc.destroy();
  });

  it('shows a dismissible selection sheet for a single editable item', () => {
    const store = makeStore();
    store._apply({ frames: [{ ...emptyFrame(), textboxes: [
      { id: 't1', x: 0, y: 0, w: 100, h: 40, text: 'hi', fontSize: 16, color: hex('#ffffff') },
    ] }] });
    const history = createHistory(store);
    const mc = new MobileChrome(host, store, 'T',
      { history, deleteSelection: () => deleteSelection(store, history), fitView: () => {}, clearFrame: () => {} });
    mc.mount();
    expect(host.querySelector('[data-testid="mobile-selsheet"]')).toBeNull();

    store._apply({ selection: [{ kind: 'textbox', id: 't1' }] });
    const sheet = host.querySelector('[data-testid="mobile-selsheet"]') as HTMLElement;
    expect(sheet).not.toBeNull();
    expect(sheet.querySelector('.cp-slider')).not.toBeNull();

    (host.querySelector('[data-testid="mobile-selsheet-close"]') as HTMLButtonElement).click();
    expect(host.querySelector('[data-testid="mobile-selsheet"]')).toBeNull();
    mc.destroy();
  });

  it('shows no selection sheet for an item with no inline editor', () => {
    const store = makeStore();
    store._apply({ frames: [emptyFrame()] });
    const history = createHistory(store);
    const mc = new MobileChrome(host, store, 'T',
      { history, deleteSelection: () => deleteSelection(store, history), fitView: () => {}, clearFrame: () => {} });
    mc.mount();
    store._apply({ selection: [{ kind: 'player', id: 'p1' }] });
    expect(host.querySelector('[data-testid="mobile-selsheet"]')).toBeNull();
    mc.destroy();
  });

  it('shows no selection sheet when multiple items are selected', () => {
    const store = makeStore();
    store._apply({ frames: [{ ...emptyFrame(), textboxes: [
      { id: 't1', x: 0, y: 0, w: 100, h: 40, text: 'hi', fontSize: 16, color: hex('#ffffff') },
    ] }] });
    const history = createHistory(store);
    const mc = new MobileChrome(host, store, 'T',
      { history, deleteSelection: () => deleteSelection(store, history), fitView: () => {}, clearFrame: () => {} });
    mc.mount();
    store._apply({ selection: [{ kind: 'textbox', id: 't1' }, { kind: 'player', id: 'p1' }] });
    expect(host.querySelector('[data-testid="mobile-selsheet"]')).toBeNull();
    mc.destroy();
  });

  it('auto-opens a tool-settings sheet when switching to a tool with a panel', () => {
    const store = makeStore();
    const history = createHistory(store);
    const panel = document.createElement('div');
    panel.className = 'cp-panel-draw';
    const mc = new MobileChrome(host, store, 'T', {
      history, deleteSelection: () => deleteSelection(store, history), fitView: () => {}, clearFrame: () => {},
      getToolPanel: () => store.get().tool === 'draw' ? panel : null,
    });
    mc.mount();
    expect(host.querySelector('[data-testid="mobile-toolsheet"]')).toBeNull();
    store._apply({ tool: 'draw' });
    const sheet = host.querySelector('[data-testid="mobile-toolsheet"]');
    expect(sheet).not.toBeNull();
    expect(sheet!.contains(panel)).toBe(true);
    mc.destroy();
  });

  it('opens no tool-settings sheet for a tool whose getContextPanel is null', () => {
    const store = makeStore();
    const history = createHistory(store);
    const mc = new MobileChrome(host, store, 'T', {
      history, deleteSelection: () => deleteSelection(store, history), fitView: () => {}, clearFrame: () => {},
      getToolPanel: () => null,
    });
    mc.mount();
    store._apply({ tool: 'erase' });
    expect(host.querySelector('[data-testid="mobile-toolsheet"]')).toBeNull();
    mc.destroy();
  });

  it('the tool-settings sheet is dismissible and reopens via reopenToolSettings', () => {
    const store = makeStore();
    const history = createHistory(store);
    const panel = document.createElement('div');
    const mc = new MobileChrome(host, store, 'T', {
      history, deleteSelection: () => deleteSelection(store, history), fitView: () => {}, clearFrame: () => {},
      getToolPanel: () => panel,
    });
    mc.mount();
    store._apply({ tool: 'draw' });
    expect(host.querySelector('[data-testid="mobile-toolsheet"]')).not.toBeNull();
    (host.querySelector('[data-testid="mobile-toolsheet-close"]') as HTMLButtonElement).click();
    expect(host.querySelector('[data-testid="mobile-toolsheet"]')).toBeNull();
    mc.reopenToolSettings();
    expect(host.querySelector('[data-testid="mobile-toolsheet"]')).not.toBeNull();
    mc.destroy();
  });

  it('the menu sheet renders a File launcher group when menuActions is supplied', () => {
    const store = makeStore();
    const history = createHistory(store);
    const menuActions = makeMenuActions();
    const mc = new MobileChrome(host, store, 'T',
      { history, deleteSelection: () => deleteSelection(store, history), fitView: () => {}, clearFrame: () => {}, menuActions });
    mc.mount();
    (host.querySelector('[data-testid="mobile-menu-btn"]') as HTMLButtonElement).click();
    expect(host.querySelector('[data-testid="mobile-action-save"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="mobile-action-new-save"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="mobile-action-library"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="mobile-action-import"]')).not.toBeNull();
    mc.destroy();
  });

  it('tapping a launcher action runs its callback and closes the menu sheet', () => {
    const store = makeStore();
    const history = createHistory(store);
    const menuActions = makeMenuActions();
    const mc = new MobileChrome(host, store, 'T',
      { history, deleteSelection: () => deleteSelection(store, history), fitView: () => {}, clearFrame: () => {}, menuActions });
    mc.mount();
    (host.querySelector('[data-testid="mobile-menu-btn"]') as HTMLButtonElement).click();
    (host.querySelector('[data-testid="mobile-action-library"]') as HTMLButtonElement).click();
    expect(menuActions.openLibrary).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid="mobile-sheet"]')).toBeNull();
    mc.destroy();
  });

  it('the menu sheet has no launcher group when menuActions is absent', () => {
    const store = makeStore('rotate long');
    const history = createHistory(store);
    const mc = new MobileChrome(host, store, 'T',
      { history, deleteSelection: () => deleteSelection(store, history), fitView: () => {}, clearFrame: () => {} });
    mc.mount();
    (host.querySelector('[data-testid="mobile-menu-btn"]') as HTMLButtonElement).click();
    const sheet = host.querySelector('[data-testid="mobile-sheet"]') as HTMLElement;
    expect(host.querySelector('[data-testid="mobile-action-library"]')).toBeNull();
    expect(sheet.textContent).toContain('rotate long');
    mc.destroy();
  });

  it('the menu sheet renders Export and Share launcher groups', () => {
    const store = makeStore();
    const history = createHistory(store);
    const mc = new MobileChrome(host, store, 'T',
      { history, deleteSelection: () => deleteSelection(store, history), fitView: () => {}, clearFrame: () => {}, menuActions: makeMenuActions() });
    mc.mount();
    (host.querySelector('[data-testid="mobile-menu-btn"]') as HTMLButtonElement).click();
    expect(host.querySelector('[data-testid="mobile-action-export-png"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="mobile-action-export-gif"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="mobile-action-export-json"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="mobile-action-share"]')).not.toBeNull();
    mc.destroy();
  });

  it('tapping the Share action runs openShare and closes the sheet', () => {
    const store = makeStore();
    const history = createHistory(store);
    const menuActions = makeMenuActions();
    const mc = new MobileChrome(host, store, 'T',
      { history, deleteSelection: () => deleteSelection(store, history), fitView: () => {}, clearFrame: () => {}, menuActions });
    mc.mount();
    (host.querySelector('[data-testid="mobile-menu-btn"]') as HTMLButtonElement).click();
    (host.querySelector('[data-testid="mobile-action-share"]') as HTMLButtonElement).click();
    expect(menuActions.openShare).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid="mobile-sheet"]')).toBeNull();
    mc.destroy();
  });

  it('tapping an Export action runs its callback', () => {
    const store = makeStore();
    const history = createHistory(store);
    const menuActions = makeMenuActions();
    const mc = new MobileChrome(host, store, 'T',
      { history, deleteSelection: () => deleteSelection(store, history), fitView: () => {}, clearFrame: () => {}, menuActions });
    mc.mount();
    (host.querySelector('[data-testid="mobile-menu-btn"]') as HTMLButtonElement).click();
    (host.querySelector('[data-testid="mobile-action-export-json"]') as HTMLButtonElement).click();
    expect(menuActions.exportJson).toHaveBeenCalledTimes(1);
    mc.destroy();
  });

  it('the menu sheet renders a Help launcher group', () => {
    const store = makeStore();
    const history = createHistory(store);
    const mc = new MobileChrome(host, store, 'T',
      { history, deleteSelection: () => deleteSelection(store, history), fitView: () => {}, clearFrame: () => {}, menuActions: makeMenuActions() });
    mc.mount();
    (host.querySelector('[data-testid="mobile-menu-btn"]') as HTMLButtonElement).click();
    expect(host.querySelector('[data-testid="mobile-action-changelog"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="mobile-action-legal"]')).not.toBeNull();
    mc.destroy();
  });

  it('tapping the Changelog action runs openChangelog and closes the sheet', () => {
    const store = makeStore();
    const history = createHistory(store);
    const menuActions = makeMenuActions();
    const mc = new MobileChrome(host, store, 'T',
      { history, deleteSelection: () => deleteSelection(store, history), fitView: () => {}, clearFrame: () => {}, menuActions });
    mc.mount();
    (host.querySelector('[data-testid="mobile-menu-btn"]') as HTMLButtonElement).click();
    (host.querySelector('[data-testid="mobile-action-changelog"]') as HTMLButtonElement).click();
    expect(menuActions.openChangelog).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid="mobile-sheet"]')).toBeNull();
    mc.destroy();
  });

  it('tapping the Privacy & legal action runs openLegal', () => {
    const store = makeStore();
    const history = createHistory(store);
    const menuActions = makeMenuActions();
    const mc = new MobileChrome(host, store, 'T',
      { history, deleteSelection: () => deleteSelection(store, history), fitView: () => {}, clearFrame: () => {}, menuActions });
    mc.mount();
    (host.querySelector('[data-testid="mobile-menu-btn"]') as HTMLButtonElement).click();
    (host.querySelector('[data-testid="mobile-action-legal"]') as HTMLButtonElement).click();
    expect(menuActions.openLegal).toHaveBeenCalledTimes(1);
    mc.destroy();
  });
});

describe('MobileChrome map sheet', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let mc: MobileChrome | null = null;

  // Fresh store/history/chrome per call. mapId + the constructor's title
  // snapshot both start at 'miru' so 'the top bar title follows the active
  // map' can assert the pre-subscription value before dispatching a switch.
  // The Map launcher row lives in the same menuActions-gated group as
  // File/Export/Share (production always supplies menuActions alongside
  // history - see main.ts), so menuActions is included by default here too.
  function mountChrome(editCtxOverrides: Partial<MobileEditCtx> = {}): void {
    mc?.destroy();
    host.replaceChildren();
    store = makeStore('n', 'miru');
    history = createHistory(store);
    mc = new MobileChrome(host, store, 'miru', {
      history,
      deleteSelection: () => deleteSelection(store, history),
      fitView: () => {}, clearFrame: () => {},
      menuActions: makeMenuActions(),
      ...editCtxOverrides,
    });
    mc.mount();
  }

  function openMenu(): void {
    (document.querySelector('[data-testid="mobile-menu-btn"]') as HTMLButtonElement).click();
  }

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    mountChrome();
  });
  afterEach(() => { mc?.destroy(); host.remove(); });

  it('the menu sheet has a Map launcher row', () => {
    openMenu();
    expect(document.querySelector('[data-testid="mobile-action-map"]')).not.toBeNull();
  });

  it('opening the menu closes an open map sheet', () => {
    (document.querySelector('[data-testid="mobile-title-btn"]') as HTMLButtonElement).click();
    expect(document.querySelector('[data-testid="mobile-mapsheet"]')).not.toBeNull();
    openMenu();
    expect(document.querySelector('[data-testid="mobile-mapsheet"]')).toBeNull();
    expect(document.querySelector('[data-testid="mobile-sheet"]')).not.toBeNull();
  });

  it('a pointerdown outside closes whichever sheet is open', () => {
    (document.querySelector('[data-testid="mobile-title-btn"]') as HTMLButtonElement).click();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    expect(document.querySelector('[data-testid="mobile-mapsheet"]')).toBeNull();
  });

  it('the map name shows whether its sheet is open', () => {
    const title = document.querySelector('[data-testid="mobile-title-btn"]') as HTMLButtonElement;
    expect(title.getAttribute('aria-expanded')).toBe('false');
    title.click();
    expect(title.getAttribute('aria-expanded')).toBe('true');
    (document.querySelector('[data-testid="mobile-mapsheet-close"]') as HTMLButtonElement).click();
    expect(title.getAttribute('aria-expanded')).toBe('false');
  });

  it('the map name resets its open state when another sheet takes over', () => {
    const title = document.querySelector('[data-testid="mobile-title-btn"]') as HTMLButtonElement;
    title.click();
    expect(title.getAttribute('aria-expanded')).toBe('true');
    // closeAllSheets runs when a launcher opens something else
    openMenu();
    (document.querySelector('[data-testid="mobile-action-view"]') as HTMLButtonElement).click();
    expect(title.getAttribute('aria-expanded')).toBe('false');
  });

  it('the launcher rows read as sentences', () => {
    openMenu();
    const label = (id: string): string | null =>
      document.querySelector(`[data-testid="mobile-action-${id}"]`)!.textContent;
    expect(label('map')).toBe('Change map & callouts');
    expect(label('view')).toBe('Layers, reset view & clear frame');
    expect(label('notes')).toBe('Write strat notes');
    expect(label('import')).toBe('Import a .strat.json file');
    expect(label('share')).toBe('Copy a share link');
  });

  it('tapping the map name in the top bar opens the map sheet', () => {
    const title = document.querySelector('[data-testid="mobile-title-btn"]') as HTMLButtonElement;
    expect(title).not.toBeNull();
    expect(title.tagName).toBe('BUTTON');
    expect(title.getAttribute('aria-label')).toBe('Change map');
    title.click();
    expect(document.querySelector('[data-testid="mobile-mapsheet"]')).not.toBeNull();
  });

  it('the Map group leads the menu sheet so map switching is above the fold', () => {
    // It used to sit at offsetTop 526 in a 530px-tall sheet, i.e. exactly on the
    // fold, which is why map switching felt hidden.
    openMenu();
    const groups = Array.from(document.querySelectorAll('.mob-menu-group h3')).map((h) => h.textContent);
    expect(groups.slice(0, 3)).toEqual(['Map', 'View', 'Notes']);
  });

  it('tapping Map opens the map sheet with the picker inside', () => {
    openMenu();
    (document.querySelector('[data-testid="mobile-action-map"]') as HTMLButtonElement).click();
    const sheet = document.querySelector('[data-testid="mobile-mapsheet"]');
    expect(sheet).not.toBeNull();
    expect(sheet!.querySelectorAll('.map-dropdown-row').length).toBe(6);
    // opening a sub-sheet closes the menu sheet - one sheet at a time
    expect(document.querySelector('[data-testid="mobile-sheet"]')).toBeNull();
  });

  it('choosing a map switches, refits the view and closes the sheet', () => {
    let fitCalls = 0;
    mountChrome({ fitView: () => { fitCalls += 1; } });
    openMenu();
    (document.querySelector('[data-testid="mobile-action-map"]') as HTMLButtonElement).click();
    (document.querySelector('.map-dropdown-row[data-mapid="suna"]') as HTMLButtonElement).click();
    expect(store.get().mapId).toBe('suna');
    expect(fitCalls).toBe(1);
    expect(document.querySelector('[data-testid="mobile-mapsheet"]')).toBeNull();
  });

  it('the top bar title follows the active map', () => {
    const title = document.querySelector('.mob-title') as HTMLElement;
    expect(title.textContent).toBe('miru');
    history.dispatch({ t: 'map.select', mapId: 'frio' });
    expect(title.textContent).toBe('frio');
  });

  it('no longer renders the dead map-switch text row', () => {
    openMenu();
    expect(document.querySelector('[data-testid="mobile-mapswitch"]')).toBeNull();
  });

  it('the menu sheet has a View launcher row', () => {
    openMenu();
    expect(document.querySelector('[data-testid="mobile-action-view"]')).not.toBeNull();
  });

  it('the view sheet carries the layer toggles', () => {
    openMenu();
    (document.querySelector('[data-testid="mobile-action-view"]') as HTMLButtonElement).click();
    const sheet = document.querySelector('[data-testid="mobile-viewsheet"]');
    expect(sheet).not.toBeNull();
    expect(sheet!.querySelectorAll('.layer-visibility-btn').length).toBe(6);
  });

  it('the view sheet carries the playback delay stepper', () => {
    // It lives here rather than in the strip on a phone: the strip's actions
    // cluster was 224px of a 390px screen.
    mountChrome({ playback: { delayMs: 1500, setDelay: () => {} } });
    openMenu();
    (document.querySelector('[data-testid="mobile-action-view"]') as HTMLButtonElement).click();
    const input = document.querySelector('[data-testid="mobile-viewsheet"] .frame-timeline-delay') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('1.5');
  });

  it('the delay stepper writes through to the playback controller', () => {
    let set = -1;
    mountChrome({ playback: { delayMs: 1000, setDelay: (ms: number) => { set = ms; } } });
    openMenu();
    (document.querySelector('[data-testid="mobile-action-view"]') as HTMLButtonElement).click();
    const input = document.querySelector('[data-testid="mobile-viewsheet"] .frame-timeline-delay') as HTMLInputElement;
    input.value = '3';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(set).toBe(3000);
  });

  it('no stepper when the chrome was built without a playback controller', () => {
    openMenu();
    (document.querySelector('[data-testid="mobile-action-view"]') as HTMLButtonElement).click();
    expect(document.querySelector('[data-testid="mobile-viewsheet"] .frame-timeline-delay')).toBeNull();
  });

  it('a layer toggle in the view sheet flips the store', () => {
    openMenu();
    (document.querySelector('[data-testid="mobile-action-view"]') as HTMLButtonElement).click();
    (document.querySelector('.layer-visibility-btn[data-layer="cones"]') as HTMLButtonElement).click();
    expect(store.get().ui.layerVisibility!.cones).toBe(false);
  });

  it('the Clear frame button is disabled when the active frame is empty', () => {
    // mountChrome's store has frames: [] - no active frame at all, the
    // emptiest case dispatchClearFrame treats the same as an empty frame.
    openMenu();
    (document.querySelector('[data-testid="mobile-action-view"]') as HTMLButtonElement).click();
    const clear = document.querySelector('[data-testid="mobile-clear-frame"]') as HTMLButtonElement;
    expect(clear.disabled).toBe(true);
    expect(clear.title).toBeTruthy();
  });

  it('the Clear frame button is enabled when the active frame has content', () => {
    store._apply({ frames: [{ ...emptyFrame(), players: [{ id: 'p1', team: 'colonist', x: 0, y: 0, name: 'p', dead: false }] }] });
    openMenu();
    (document.querySelector('[data-testid="mobile-action-view"]') as HTMLButtonElement).click();
    const clear = document.querySelector('[data-testid="mobile-clear-frame"]') as HTMLButtonElement;
    expect(clear.disabled).toBe(false);
  });

  it('reset view and clear frame invoke their wired callbacks, and clear frame closes the sheet', () => {
    let fitCalls = 0;
    let clearCalls = 0;
    mountChrome({ fitView: () => { fitCalls += 1; }, clearFrame: () => { clearCalls += 1; } });
    // Non-empty active frame so the Clear frame button (FIX 3: disabled on an
    // empty frame) is actually enabled for this click.
    store._apply({ frames: [{ ...emptyFrame(), players: [{ id: 'p1', team: 'colonist', x: 0, y: 0, name: 'p', dead: false }] }] });
    openMenu();
    (document.querySelector('[data-testid="mobile-action-view"]') as HTMLButtonElement).click();
    (document.querySelector('[data-testid="mobile-reset-view"]') as HTMLButtonElement).click();
    expect(fitCalls).toBe(1);
    (document.querySelector('[data-testid="mobile-clear-frame"]') as HTMLButtonElement).click();
    expect(clearCalls).toBe(1);
    // clearFrame here is a bare counter stub - it proves nothing about the real
    // confirm flow. What source guarantees is close-before-clear ordering: the
    // view sheet is gone by the time clearFrame() runs.
    expect(document.querySelector('[data-testid="mobile-viewsheet"]')).toBeNull();
  });

  it('opening a launcher sheet (e.g. Map) closes an open tool-settings sheet', () => {
    const panel = document.createElement('div');
    mountChrome({ getToolPanel: () => panel });
    store._apply({ tool: 'draw' });
    expect(document.querySelector('[data-testid="mobile-toolsheet"]')).not.toBeNull();
    openMenu();
    (document.querySelector('[data-testid="mobile-action-map"]') as HTMLButtonElement).click();
    expect(document.querySelector('[data-testid="mobile-toolsheet"]')).toBeNull();
    expect(document.querySelector('[data-testid="mobile-mapsheet"]')).not.toBeNull();
  });

  it('opening the view sheet closes the map sheet', () => {
    openMenu();
    (document.querySelector('[data-testid="mobile-action-map"]') as HTMLButtonElement).click();
    expect(document.querySelector('[data-testid="mobile-mapsheet"]')).not.toBeNull();
    openMenu();
    (document.querySelector('[data-testid="mobile-action-view"]') as HTMLButtonElement).click();
    expect(document.querySelector('[data-testid="mobile-mapsheet"]')).toBeNull();
    expect(document.querySelector('[data-testid="mobile-viewsheet"]')).not.toBeNull();
  });

  it('the menu sheet has a Notes launcher row instead of a read-only block', () => {
    openMenu();
    expect(document.querySelector('[data-testid="mobile-action-notes"]')).not.toBeNull();
    expect(document.querySelector('.mob-notes')).toBeNull();
  });

  it('the notes sheet holds an editable textarea seeded from the store', () => {
    history.dispatch({ t: 'notes.set', notes: 'smoke mid' });
    openMenu();
    (document.querySelector('[data-testid="mobile-action-notes"]') as HTMLButtonElement).click();
    const ta = document.querySelector('[data-testid="mobile-notessheet"] textarea') as HTMLTextAreaElement;
    expect(ta).not.toBeNull();
    expect(ta.value).toBe('smoke mid');
    expect(ta.readOnly).toBe(false);
  });

  it('closing the notes sheet flushes a pending edit', () => {
    openMenu();
    (document.querySelector('[data-testid="mobile-action-notes"]') as HTMLButtonElement).click();
    const ta = document.querySelector('[data-testid="mobile-notessheet"] textarea') as HTMLTextAreaElement;
    ta.value = 'flank A';
    ta.dispatchEvent(new Event('input'));
    (document.querySelector('[data-testid="mobile-notessheet-close"]') as HTMLButtonElement).click();
    expect(store.get().notes).toBe('flank A');
  });
});
