import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStore, type Store, type StratState } from './store';
import { createHistory } from './history';
import { createActions } from './actions';
import { createClipboard } from './clipboard';
import { registerAll, type RegisterDeps } from './registerActions';
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

interface FakeSizeable { setSize: (n: number) => void; getSize: () => number; }
function fakeSizeable(initial: number): FakeSizeable {
  let n = initial;
  return { setSize: (v) => { n = v; }, getSize: () => n };
}

function harness() {
  const store = createStore(initialState());
  const history = createHistory(store);
  const actions = createActions(store);
  const clipboard = createClipboard();
  const drawTool = fakeSizeable(4);
  const eraseTool = fakeSizeable(24);
  registerAll(actions, {
    store, history, clipboard,
    drawTool: drawTool as never, eraseTool: eraseTool as never,
    promptAndSave: () => {},
    openLibrary: () => {},
    exportPng: () => {},
    exportGif: () => {},
    exportContactSheet: () => {},
    setTheme: () => {},
    exportJson: () => {},
    importJson: () => {},
    zoomFit: () => {},
    zoomTo100: () => {},
    resetView: () => {},
    openShare: () => {},
    dispatchClearFrame: () => {},
    focusNotesPane: () => {},
    editSelectedTextbox: () => {},
    openLegal: () => {},
    startTour: () => {},
  });
  return { store, history, actions, clipboard, drawTool, eraseTool };
}

function makeRegisterDeps(store: Store): RegisterDeps {
  const history = createHistory(store);
  return {
    store,
    history,
    clipboard: createClipboard(),
    drawTool: { setSize: vi.fn(), getSize: vi.fn().mockReturnValue(2) },
    eraseTool: { setSize: vi.fn(), getSize: vi.fn().mockReturnValue(2) },
    promptAndSave: vi.fn(),
    openLibrary: vi.fn(),
    exportPng: vi.fn(),
    exportGif: vi.fn(),
    exportContactSheet: vi.fn(),
    setTheme: vi.fn(),
    exportJson: vi.fn(),
    importJson: vi.fn(),
    zoomFit: vi.fn(),
    zoomTo100: vi.fn(),
    resetView: vi.fn(),
    openShare: vi.fn(),
    dispatchClearFrame: vi.fn(),
    focusNotesPane: vi.fn(),
    editSelectedTextbox: vi.fn(),
    openLegal: vi.fn(),
    startTour: vi.fn(),
  };
}

describe('registerAll - Tool group', () => {
  it('registers one tool action per rail-visible ToolId', () => {
    const { actions } = harness();
    const ids = actions.list('Tool').map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining([
      'tool.cursor', 'tool.select', 'tool.lasso',
      'tool.draw', 'tool.erase', 'tool.shapes',
      'tool.cone', 'tool.player', 'tool.text',
      'tool.quickadd',
    ]));
    // place-scanner was folded into the QuickAdd tool - there is no tool.scanner action.
    expect(ids).not.toContain('tool.scanner');
  });

  it('tool.draw sets the tool directly, with no undo entry', () => {
    const { actions, store, history } = harness();
    actions.run('tool.draw');
    expect(store.get().tool).toBe('draw');
    // Tool switches bypass history on purpose.
    expect(history.canUndo()).toBe(false);
  });

  it('byHotkey resolves V -> tool.cursor', () => {
    const { actions } = harness();
    expect(actions.byHotkey('V')?.id).toBe('tool.cursor');
  });

  it('byHotkey resolves D, E, S, L', () => {
    const { actions } = harness();
    expect(actions.byHotkey('D')?.id).toBe('tool.draw');
    expect(actions.byHotkey('E')?.id).toBe('tool.erase');
    expect(actions.byHotkey('S')?.id).toBe('tool.select');
    expect(actions.byHotkey('L')?.id).toBe('tool.lasso');
  });

  it('byHotkey resolves R, C, P, T, Q to the placement tools', () => {
    const { actions } = harness();
    expect(actions.byHotkey('R')?.id).toBe('tool.shapes');
    expect(actions.byHotkey('C')?.id).toBe('tool.cone');
    expect(actions.byHotkey('P')?.id).toBe('tool.player');
    expect(actions.byHotkey('T')?.id).toBe('tool.text');
    expect(actions.byHotkey('Q')?.id).toBe('tool.quickadd');
  });
});

describe('registerAll - Brush group', () => {
  it('brush.shrink decreases drawTool size when draw is active', () => {
    const { actions, history, drawTool } = harness();
    history.dispatch({ t: 'tool.set', tool: 'draw' });
    actions.run('brush.shrink');
    expect(drawTool.getSize()).toBe(3);
  });

  it('brush.grow increases drawTool size when draw is active', () => {
    const { actions, history, drawTool } = harness();
    history.dispatch({ t: 'tool.set', tool: 'draw' });
    actions.run('brush.grow');
    expect(drawTool.getSize()).toBe(5);
  });

  it('brush.grow targets eraseTool when erase is active', () => {
    const { actions, history, eraseTool } = harness();
    history.dispatch({ t: 'tool.set', tool: 'erase' });
    actions.run('brush.grow');
    expect(eraseTool.getSize()).toBe(25);
  });

  it('brush.grow is a no-op when neither draw nor erase is active (canRun=false)', () => {
    const { actions, drawTool, eraseTool } = harness();
    expect(actions.run('brush.grow')).toBe(false);
    expect(drawTool.getSize()).toBe(4);
    expect(eraseTool.getSize()).toBe(24);
  });

  it('byHotkey resolves [ and ] to brush actions', () => {
    const { actions } = harness();
    expect(actions.byHotkey('[')?.id).toBe('brush.shrink');
    expect(actions.byHotkey(']')?.id).toBe('brush.grow');
  });
});

describe('registerAll - Map group', () => {
  it('registers one action per map', () => {
    const { actions } = harness();
    expect(actions.list('Map').map((a) => a.id)).toEqual([
      'map.suna', 'map.miru', 'map.khidi', 'map.cliffside', 'map.frio', 'map.kiiro',
    ]);
  });

  it('map.khidi dispatches map.select', () => {
    const { actions, store } = harness();
    actions.run('map.khidi');
    expect(store.get().mapId).toBe('khidi');
  });
});

describe('registerAll - Edit group', () => {
  it('edit.undo allows in input and calls history.undo', () => {
    const { actions, history } = harness();
    history.dispatch({ t: 'tool.set', tool: 'draw' });
    expect(actions.byId('edit.undo')?.allowInInput).toBe(true);
    actions.run('edit.undo');
    expect(history.canUndo()).toBe(false);
  });

  it('edit.redo allows in input', () => {
    const { actions } = harness();
    expect(actions.byId('edit.redo')?.allowInInput).toBe(true);
  });

  it('edit.copy canRun depends on selection length', () => {
    const { actions, store } = harness();
    expect(actions.run('edit.copy')).toBe(false);
    store._apply({ selection: [{ kind: 'player', id: 'p1' }] });
    expect(actions.byId('edit.copy')?.canRun?.(store.get())).toBe(true);
  });

  it('edit.delete has Backspace as alias', () => {
    const { actions } = harness();
    expect(actions.byHotkey('Delete')?.id).toBe('edit.delete');
    expect(actions.byHotkey('Backspace')?.id).toBe('edit.delete');
  });

  it('edit.duplicate canRun=false when selection is empty', () => {
    const { actions, store } = harness();
    expect(actions.byId('edit.duplicate')?.canRun?.(store.get())).toBe(false);
  });

  it('byHotkey resolves Ctrl+Z / Ctrl+Shift+Z / Ctrl+C / Ctrl+V / Ctrl+D', () => {
    const { actions } = harness();
    expect(actions.byHotkey('Ctrl+Z')?.id).toBe('edit.undo');
    expect(actions.byHotkey('Ctrl+Shift+Z')?.id).toBe('edit.redo');
    expect(actions.byHotkey('Ctrl+C')?.id).toBe('edit.copy');
    expect(actions.byHotkey('Ctrl+V')?.id).toBe('edit.paste');
    expect(actions.byHotkey('Ctrl+D')?.id).toBe('edit.duplicate');
  });
});

describe('registerAll - Help group', () => {
  it('help.openPalette toggles ui.paletteOpen', () => {
    const { actions, store } = harness();
    actions.run('help.openPalette');
    expect(store.get().ui.paletteOpen).toBe(true);
  });

  it('help.openHints toggles ui.hintsOpen', () => {
    const { actions, store } = harness();
    actions.run('help.openHints');
    expect(store.get().ui.hintsOpen).toBe(true);
  });

  it('byHotkey resolves Ctrl+K -> help.openPalette and ? -> help.openHints', () => {
    const { actions } = harness();
    expect(actions.byHotkey('Ctrl+K')?.id).toBe('help.openPalette');
    expect(actions.byHotkey('?')?.id).toBe('help.openHints');
  });
});

describe('registerAll - Colour-slot hotkeys', () => {
  it('1-5 actions exist with corresponding hotkeys', () => {
    const { actions } = harness();
    for (let i = 0; i < 5; i++) {
      const a = actions.byHotkey(String(i + 1));
      expect(a?.id).toBe(`colour.slot.${i}`);
    }
  });

  it('colour.slot.2 sets activeSlot=2', () => {
    const { actions, store } = harness();
    actions.run('colour.slot.2');
    expect(store.get().activeSlot).toBe(2);
  });
});

describe('File + View actions', () => {
  let store: Store;
  let actions: ReturnType<typeof createActions>;

  beforeEach(() => {
    store = createStore(initialState());
    actions = createActions(store);
    registerAll(actions, makeRegisterDeps(store));
  });

  it('registers library.save with Ctrl+S hotkey and allowInInput', () => {
    const a = actions.byId('library.save');
    expect(a).not.toBeNull();
    expect(a!.group).toBe('File');
    expect(a!.hotkey).toBe('Ctrl+S');
    expect(a!.allowInInput).toBe(true);
  });

  it('registers library.open with Ctrl+Shift+L hotkey and allowInInput', () => {
    const a = actions.byId('library.open');
    expect(a).not.toBeNull();
    expect(a!.group).toBe('File');
    expect(a!.hotkey).toBe('Ctrl+Shift+L');
    expect(a!.allowInInput).toBe(true);
  });

  it('registers file.exportPng / file.exportJson / file.importJson without hotkeys', () => {
    expect(actions.byId('file.exportPng')!.group).toBe('File');
    expect(actions.byId('file.exportPng')!.hotkey).toBeUndefined();
    expect(actions.byId('file.exportJson')!.group).toBe('File');
    expect(actions.byId('file.importJson')!.group).toBe('File');
  });

  it('registers file.exportGif under the File group without a hotkey', () => {
    expect(actions.byId('file.exportGif')).not.toBeNull();
    expect(actions.byId('file.exportGif')!.group).toBe('File');
    expect(actions.byId('file.exportGif')!.hotkey).toBeUndefined();
  });

  it('file.exportGif run() calls deps.exportGif', () => {
    const callDeps = makeRegisterDeps(store);
    callDeps.exportGif = vi.fn();
    const acts = createActions(store);
    registerAll(acts, callDeps);
    acts.run('file.exportGif');
    expect(callDeps.exportGif).toHaveBeenCalled();
  });

  it('registers file.exportContactSheet under the File group without a hotkey', () => {
    expect(actions.byId('file.exportContactSheet')).not.toBeNull();
    expect(actions.byId('file.exportContactSheet')!.group).toBe('File');
    expect(actions.byId('file.exportContactSheet')!.hotkey).toBeUndefined();
  });

  it('file.exportContactSheet run() calls deps.exportContactSheet', () => {
    const callDeps = makeRegisterDeps(store);
    callDeps.exportContactSheet = vi.fn();
    const acts = createActions(store);
    registerAll(acts, callDeps);
    acts.run('file.exportContactSheet');
    expect(callDeps.exportContactSheet).toHaveBeenCalled();
  });

  it('registers the three theme actions under the View group without hotkeys', () => {
    for (const id of ['view.themeDark', 'view.themeLight', 'view.themeHighContrast']) {
      expect(actions.byId(id)).not.toBeNull();
      expect(actions.byId(id)!.group).toBe('View');
      expect(actions.byId(id)!.hotkey).toBeUndefined();
    }
  });

  it('theme actions run() call deps.setTheme with the matching theme', () => {
    const callDeps = makeRegisterDeps(store);
    callDeps.setTheme = vi.fn();
    const acts = createActions(store);
    registerAll(acts, callDeps);
    acts.run('view.themeDark');
    acts.run('view.themeLight');
    acts.run('view.themeHighContrast');
    expect(callDeps.setTheme).toHaveBeenNthCalledWith(1, 'dark');
    expect(callDeps.setTheme).toHaveBeenNthCalledWith(2, 'light');
    expect(callDeps.setTheme).toHaveBeenNthCalledWith(3, 'high-contrast');
  });

  it('registers view.zoomFit and view.zoom100', () => {
    expect(actions.byId('view.zoomFit')!.group).toBe('View');
    expect(actions.byId('view.zoom100')!.group).toBe('View');
  });

  it('library.save run() calls deps.promptAndSave', () => {
    const callDeps = makeRegisterDeps(store);
    callDeps.promptAndSave = vi.fn();
    const acts = createActions(store);
    registerAll(acts, callDeps);
    acts.run('library.save');
    expect(callDeps.promptAndSave).toHaveBeenCalled();
  });

  it('view.zoomFit run() calls deps.zoomFit', () => {
    const callDeps = makeRegisterDeps(store);
    callDeps.zoomFit = vi.fn();
    const acts = createActions(store);
    registerAll(acts, callDeps);
    acts.run('view.zoomFit');
    expect(callDeps.zoomFit).toHaveBeenCalled();
  });
});

describe('Share action', () => {
  it('registers share.open under the File group, no hotkey', () => {
    const { actions } = harness();
    const a = actions.byId('share.open');
    expect(a).not.toBeNull();
    expect(a!.group).toBe('File');
    expect(a!.hotkey).toBeUndefined();
  });

  it('share.open run() calls deps.openShare', () => {
    const store = createStore(initialState());
    const callDeps = makeRegisterDeps(store);
    callDeps.openShare = vi.fn();
    const acts = createActions(store);
    registerAll(acts, callDeps);
    acts.run('share.open');
    expect(callDeps.openShare).toHaveBeenCalled();
  });
});

describe('registerAll - Frame + Notes groups (mode actions removed)', () => {
  it('does not register mode.frame / mode.animation (modes were merged)', () => {
    const { actions } = harness();
    expect(actions.byId('mode.frame')).toBeNull();
    expect(actions.byId('mode.animation')).toBeNull();
  });

  it('frame.add appends a copy of the last frame and switches to it', () => {
    const { actions, store } = harness();
    actions.run('frame.add');
    expect(store.get().frames.length).toBe(2);
    expect(store.get().activeFrameIdx).toBe(1);
  });

  it('frame.delete is canRun=false with one frame', () => {
    const { actions, store } = harness();
    expect(actions.byId('frame.delete')?.canRun?.(store.get())).toBe(false);
  });

  it('frame.duplicate action is gone (adding a frame duplicates the last one now)', () => {
    const { actions } = harness();
    expect(actions.byId('frame.duplicate')).toBeNull();
  });

  it('frame.next walks circularly', () => {
    const { actions, history, store } = harness();
    history.dispatch({ t: 'frame.add' });
    store._apply({ activeFrameIdx: 0 });
    actions.run('frame.next');
    expect(store.get().activeFrameIdx).toBe(1);
    actions.run('frame.next');
    expect(store.get().activeFrameIdx).toBe(0);
  });

  it('frame.clear delegates to dispatchClearFrame', () => {
    const dispatchClearFrame = vi.fn();
    const store = createStore(initialState());
    const history = createHistory(store);
    const actions = createActions(store);
    registerAll(actions, {
      ...makeRegisterDeps(store),
      history,
      dispatchClearFrame,
    });
    actions.run('frame.clear');
    expect(dispatchClearFrame).toHaveBeenCalledTimes(1);
  });

  it('notes.focus flips sidebarTab and calls focusNotesPane', () => {
    const focusNotesPane = vi.fn();
    const store = createStore(initialState());
    const history = createHistory(store);
    const actions = createActions(store);
    registerAll(actions, {
      ...makeRegisterDeps(store),
      history,
      focusNotesPane,
    });
    actions.run('notes.focus');
    expect(store.get().ui.sidebarTab).toBe('notes');
    expect(focusNotesPane).toHaveBeenCalledTimes(1);
  });

  it('edit.selectAll (Ctrl+A) selects every node and hops to cursor so the effect shows', () => {
    const store = createStore({ ...initialState(), tool: 'place-player' });
    const history = createHistory(store);
    const actions = createActions(store);
    registerAll(actions, { ...makeRegisterDeps(store), history });

    const a = actions.byHotkey('Ctrl+A');
    expect(a?.id).toBe('edit.selectAll');
    // allowInInput is OFF so native Ctrl+A still works in real inputs.
    expect(a?.allowInInput).toBeFalsy();

    store._apply({
      frames: [{
        ...emptyFrame(),
        players: [{ id: 'p1', team: 'colonist', x: 1, y: 2, name: '', dead: false }],
        shapes: [{ id: 'sh1', kind: 'square', x: 0, y: 0, w: 10, h: 10, rotation: 0, stroke: hex('#ffffff'), strokeWidth: 2, fill: false }],
        strokes: [
          { id: 'dr1', type: 'draw', color: hex('#ffffff'), alpha: 1, size: 3, points: [{ x: 0, y: 0 }] },
          { id: 'er1', type: 'erase', color: hex('#ffffff'), alpha: 1, size: 3, points: [{ x: 0, y: 0 }] },
        ],
        scanner: { x: 5, y: 5 },
      }],
    });

    expect(actions.run('edit.selectAll')).toBe(true);
    const sel = store.get().selection;
    expect(sel).toEqual(expect.arrayContaining([
      { kind: 'player', id: 'p1' },
      { kind: 'shape', id: 'sh1' },
      { kind: 'stroke', id: 'dr1' },
      { kind: 'scanner', id: 'scanner' },
    ]));
    // erase strokes aren't selectable nodes.
    expect(sel).not.toContainEqual({ kind: 'stroke', id: 'er1' });
    // Was on a placement tool -> hopped to cursor so SelectTool paints the
    // selected effect on every node.
    expect(store.get().tool).toBe('cursor');
    // selection + the tool hop are transient - never an undo entry.
    expect(history.canUndo()).toBe(false);
  });

  it('edit.selectAll keeps the active tool when it is already select-family', () => {
    const store = createStore({ ...initialState(), tool: 'lasso' });
    const history = createHistory(store);
    const actions = createActions(store);
    registerAll(actions, { ...makeRegisterDeps(store), history });
    store._apply({ frames: [{ ...emptyFrame(), players: [{ id: 'p1', team: 'reyab', x: 0, y: 0, name: '', dead: false }] }] });

    actions.run('edit.selectAll');
    expect(store.get().selection).toEqual([{ kind: 'player', id: 'p1' }]);
    expect(store.get().tool).toBe('lasso'); // not yanked to cursor
  });

  it('edit.selectAll is overridden by a single selected textbox (edit its text)', () => {
    const editSelectedTextbox = vi.fn();
    const store = createStore(initialState());
    const history = createHistory(store);
    const actions = createActions(store);
    registerAll(actions, { ...makeRegisterDeps(store), history, editSelectedTextbox });
    store._apply({
      frames: [{ ...emptyFrame(),
        players: [{ id: 'p1', team: 'reyab', x: 0, y: 0, name: '', dead: false }],
        textboxes: [{ id: 'b1', x: 0, y: 0, w: 50, h: 20, text: 'hi', fontSize: 12, color: hex('#ffffff') }],
      }],
      selection: [{ kind: 'textbox', id: 'b1' }],
    });

    expect(actions.run('edit.selectAll')).toBe(true);
    expect(editSelectedTextbox).toHaveBeenCalledTimes(1);
    // The textbox override must NOT clobber the selection with all-nodes.
    expect(store.get().selection).toEqual([{ kind: 'textbox', id: 'b1' }]);
  });
});

describe('registerAll - callouts', () => {
  it('registers callouts.toggle', () => {
    const { actions } = harness();
    expect(actions.byId('callouts.toggle')).not.toBeNull();
  });

  it('callouts.toggle action flips state.ui.calloutsVisible', () => {
    const { actions, store } = harness();
    expect(store.get().ui.calloutsVisible).toBe(true);
    actions.run('callouts.toggle');
    expect(store.get().ui.calloutsVisible).toBe(false);
    actions.run('callouts.toggle');
    expect(store.get().ui.calloutsVisible).toBe(true);
  });
});

describe('registerAll - changelog', () => {
  it('registers changelog.open', () => {
    const { actions } = harness();
    expect(actions.byId('changelog.open')).not.toBeNull();
  });

  it('changelog.open action flips ui.changelogOpen to true', () => {
    const { actions, store } = harness();
    expect(store.get().ui.changelogOpen).toBe(false);
    actions.run('changelog.open');
    expect(store.get().ui.changelogOpen).toBe(true);
  });

  it('legal.open action calls deps.openLegal', () => {
    const store = createStore(initialState());
    const actions = createActions(store);
    const deps = makeRegisterDeps(store);
    registerAll(actions, deps);
    expect(actions.byId('legal.open')).not.toBeNull();
    actions.run('legal.open');
    expect(deps.openLegal).toHaveBeenCalledTimes(1);
  });
});
