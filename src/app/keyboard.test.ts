import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { createStore, type StratState } from './store';
import { createHistory } from './history';
import { createActions } from './actions';
import { createKeyboard } from './keyboard';
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

function press(opts: KeyboardEventInit & { key: string }): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...opts });
  window.dispatchEvent(ev);
  return ev;
}

describe('keyboard router', () => {
  let store: ReturnType<typeof createStore>;
  let history: ReturnType<typeof createHistory>;
  let actions: ReturnType<typeof createActions>;
  let kb: ReturnType<typeof createKeyboard>;

  beforeEach(() => {
    store = createStore(initialState());
    history = createHistory(store);
    actions = createActions(store);
    void history;
  });

  afterEach(() => {
    if (kb) kb.detach();
  });

  function attach(): void {
    kb = createKeyboard({ store, actions });
    kb.attach();
  }

  it('routes V to tool.cursor (registered with hotkey V)', () => {
    const run = vi.fn();
    actions.register({ id: 'tool.cursor', title: 'Cursor', group: 'Tool', hotkey: 'V', run });
    attach();
    press({ key: 'v' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+C maps to action with hotkey Ctrl+C', () => {
    const run = vi.fn();
    actions.register({ id: 'edit.copy', title: 'Copy', group: 'Edit', hotkey: 'Ctrl+C', run });
    attach();
    press({ key: 'c', ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('Cmd+C (metaKey) is normalised to Ctrl+C', () => {
    const run = vi.fn();
    actions.register({ id: 'edit.copy', title: 'Copy', group: 'Edit', hotkey: 'Ctrl+C', run });
    attach();
    press({ key: 'c', metaKey: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Shift+Z maps to redo', () => {
    const run = vi.fn();
    actions.register({ id: 'edit.redo', title: 'Redo', group: 'Edit', hotkey: 'Ctrl+Shift+Z', run });
    attach();
    press({ key: 'Z', ctrlKey: true, shiftKey: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('? maps to ? (Shift not included in canonical for symbol keys)', () => {
    const run = vi.fn();
    actions.register({ id: 'help.openHints', title: 'Hints', group: 'Help', hotkey: '?', run });
    attach();
    press({ key: '?', shiftKey: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('canRun=false skips the run', () => {
    const run = vi.fn();
    actions.register({ id: 'edit.delete', title: 'Delete', group: 'Edit', hotkey: 'Delete', canRun: () => false, run });
    attach();
    press({ key: 'Delete' });
    expect(run).not.toHaveBeenCalled();
  });

  it('preventDefault is called only when an action ran', () => {
    const run = vi.fn();
    actions.register({ id: 'tool.draw', title: 'Draw', group: 'Tool', hotkey: 'D', run });
    attach();
    const e1 = press({ key: 'd' });
    expect(e1.defaultPrevented).toBe(true);
    const e2 = press({ key: 'q' }); // unbound
    expect(e2.defaultPrevented).toBe(false);
  });

  it('input-focus guard ignores hotkey when input is focused', () => {
    const run = vi.fn();
    actions.register({ id: 'tool.draw', title: 'Draw', group: 'Tool', hotkey: 'D', run });
    attach();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    press({ key: 'd' });
    expect(run).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('input-focus guard lets through allowInInput actions', () => {
    const run = vi.fn();
    actions.register({ id: 'edit.undo', title: 'Undo', group: 'Edit', hotkey: 'Ctrl+Z', allowInInput: true, run });
    attach();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    press({ key: 'z', ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    document.body.removeChild(input);
  });

  it('alias resolves through byHotkey', () => {
    const run = vi.fn();
    actions.register({ id: 'edit.delete', title: 'Delete', group: 'Edit', hotkey: 'Delete', aliases: ['Backspace'], run });
    attach();
    press({ key: 'Backspace' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('Esc closes confirmOpen before walking further', () => {
    attach();
    const ui = store.get().ui;
    store._apply({ ui: { ...ui, confirmOpen: {
      kind: 'discard', title: 'X', body: 'Y', confirmLabel: 'Z', onConfirm: () => {},
    }}});
    press({ key: 'Escape' });
    expect(store.get().ui.confirmOpen).toBeNull();
  });

  it('Esc closes libraryOpen when no higher-precedence modal is open', () => {
    attach();
    const ui = store.get().ui;
    store._apply({ ui: { ...ui, libraryOpen: true } });
    press({ key: 'Escape' });
    expect(store.get().ui.libraryOpen).toBe(false);
  });

  it('confirmOpen takes precedence over libraryOpen', () => {
    attach();
    const ui = store.get().ui;
    store._apply({ ui: { ...ui, libraryOpen: true, confirmOpen: {
      kind: 'discard', title: 'X', body: 'Y', confirmLabel: 'Z', onConfirm: () => {},
    }}});
    press({ key: 'Escape' });
    expect(store.get().ui.confirmOpen).toBeNull();
    expect(store.get().ui.libraryOpen).toBe(true);
  });

  it('Esc closes shareOpen when no higher-precedence modal is open', () => {
    attach();
    const ui = store.get().ui;
    store._apply({ ui: { ...ui, shareOpen: true } });
    press({ key: 'Escape' });
    expect(store.get().ui.shareOpen).toBe(false);
  });

  it('confirmOpen takes precedence over shareOpen', () => {
    attach();
    const ui = store.get().ui;
    store._apply({ ui: { ...ui, shareOpen: true, confirmOpen: {
      kind: 'discard', title: 'X', body: 'Y', confirmLabel: 'Z', onConfirm: () => {},
    }}});
    press({ key: 'Escape' });
    expect(store.get().ui.confirmOpen).toBeNull();
    expect(store.get().ui.shareOpen).toBe(true);
  });

  it('shareOpen takes precedence over libraryOpen', () => {
    attach();
    const ui = store.get().ui;
    store._apply({ ui: { ...ui, shareOpen: true, libraryOpen: true } });
    press({ key: 'Escape' });
    expect(store.get().ui.shareOpen).toBe(false);
    expect(store.get().ui.libraryOpen).toBe(true);
  });
});

describe('keyboard router - Esc precedence', () => {
  let store: ReturnType<typeof createStore>;
  let actions: ReturnType<typeof createActions>;
  let kb: ReturnType<typeof createKeyboard>;
  let toolCursorRun: Mock<() => void>;

  beforeEach(() => {
    store = createStore(initialState());
    actions = createActions(store);
    toolCursorRun = vi.fn();
    actions.register({ id: 'tool.cursor', title: 'Cursor', group: 'Tool', hotkey: 'V', run: toolCursorRun });
    kb = createKeyboard({ store, actions });
    kb.attach();
  });

  afterEach(() => kb.detach());

  it('Esc closes palette before any other layer', () => {
    store._apply({ ui: { ...store.get().ui, paletteOpen: true, hintsOpen: true, colourPickerOpen: true } });
    press({ key: 'Escape' });
    expect(store.get().ui.paletteOpen).toBe(false);
    // Other layers untouched on this Esc - they close on subsequent Esc presses.
    expect(store.get().ui.hintsOpen).toBe(true);
    expect(store.get().ui.colourPickerOpen).toBe(true);
    expect(toolCursorRun).not.toHaveBeenCalled();
  });

  it('Esc closes hints when palette is closed', () => {
    store._apply({ ui: { ...store.get().ui, hintsOpen: true } });
    press({ key: 'Escape' });
    expect(store.get().ui.hintsOpen).toBe(false);
    expect(toolCursorRun).not.toHaveBeenCalled();
  });

  it('Esc closes colour picker when palette + hints are closed', () => {
    store._apply({ ui: { ...store.get().ui, colourPickerOpen: true } });
    press({ key: 'Escape' });
    expect(store.get().ui.colourPickerOpen).toBe(false);
    expect(toolCursorRun).not.toHaveBeenCalled();
  });

  it('Esc closes map dropdown when nothing modal is open', () => {
    store._apply({ ui: { ...store.get().ui, mapDropdownOpen: true } });
    press({ key: 'Escape' });
    expect(store.get().ui.mapDropdownOpen).toBe(false);
    expect(toolCursorRun).not.toHaveBeenCalled();
  });

  it('Esc switches to cursor when no UI overlay is open and tool != cursor', () => {
    store._apply({ tool: 'draw' });
    press({ key: 'Escape' });
    expect(toolCursorRun).toHaveBeenCalledTimes(1);
  });

  it('Esc on already-cursor blurs the active element', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);
    press({ key: 'Escape' });
    expect(document.activeElement).not.toBe(input);
    document.body.removeChild(input);
  });

  it('Esc bypasses the input-focus guard (always processed)', () => {
    store._apply({ ui: { ...store.get().ui, colourPickerOpen: true } });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    press({ key: 'Escape' });
    expect(store.get().ui.colourPickerOpen).toBe(false);
    document.body.removeChild(input);
  });
});

describe('keyboard router - Esc with a non-ui modal (legalModal)', () => {
  let store: ReturnType<typeof createStore>;
  let actions: ReturnType<typeof createActions>;
  let toolCursorRun: Mock<() => void>;
  let legalOpen: boolean;
  let legalCloseCalls: number;
  let kb: ReturnType<typeof createKeyboard>;

  beforeEach(() => {
    store = createStore(initialState());
    actions = createActions(store);
    toolCursorRun = vi.fn();
    actions.register({ id: 'tool.cursor', title: 'Cursor', group: 'Tool', hotkey: 'V', run: toolCursorRun });
    legalOpen = false;
    legalCloseCalls = 0;
    kb = createKeyboard({
      store, actions,
      legalModal: {
        isOpen: () => legalOpen,
        close: () => { legalCloseCalls++; legalOpen = false; },
      },
    });
    kb.attach();
  });

  afterEach(() => kb.detach());

  it('Esc closes the legal modal and short-circuits the walk (tool reset does not fire)', () => {
    store._apply({ tool: 'draw' });
    legalOpen = true;
    press({ key: 'Escape' });
    expect(legalCloseCalls).toBe(1);
    expect(toolCursorRun).not.toHaveBeenCalled();
  });

  it('confirmOpen still wins over the legal modal', () => {
    legalOpen = true;
    store._apply({ ui: { ...store.get().ui, confirmOpen: {
      kind: 'discard', title: 'X', body: 'Y', confirmLabel: 'Z', onConfirm: () => {},
    } } });
    press({ key: 'Escape' });
    expect(store.get().ui.confirmOpen).toBeNull();
    expect(legalCloseCalls).toBe(0);
    expect(legalOpen).toBe(true);
  });
});
