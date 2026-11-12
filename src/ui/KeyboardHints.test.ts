import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, type StratState } from '../app/store';
import { createActions } from '../app/actions';
import { KeyboardHints } from './KeyboardHints';
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

describe('KeyboardHints', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let actions: ReturnType<typeof createActions>;
  let hints: KeyboardHints;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore(initialState());
    actions = createActions(store);
    actions.register({ id: 'tool.draw', title: 'Tool · Draw', group: 'Tool', hotkey: 'D', run: vi.fn() });
    actions.register({ id: 'tool.shapes', title: 'Tool · Shapes', group: 'Tool', run: vi.fn() }); // no hotkey
    actions.register({ id: 'edit.undo', title: 'Undo', group: 'Edit', hotkey: 'Ctrl+Z', run: vi.fn() });
    actions.register({ id: 'edit.delete', title: 'Delete', group: 'Edit', hotkey: 'Delete', aliases: ['Backspace'], run: vi.fn() });
    actions.register({ id: 'help.openPalette', title: 'Open palette', group: 'Help', hotkey: 'Ctrl+K', run: vi.fn() });
    hints = new KeyboardHints(host, store, actions);
    hints.mount();
  });

  afterEach(() => {
    hints.destroy();
    document.body.removeChild(host);
  });

  function open(): void {
    store._apply({ ui: { ...store.get().ui, hintsOpen: true } });
  }

  it('starts hidden', () => {
    const root = host.querySelector('.keyboard-hints') as HTMLElement;
    expect(root.hidden).toBe(true);
  });

  it('opens when ui.hintsOpen=true', () => {
    open();
    const root = host.querySelector('.keyboard-hints') as HTMLElement;
    expect(root.hidden).toBe(false);
  });

  it('renders a row per action that has a hotkey', () => {
    open();
    // tool.shapes was registered without a hotkey, so it is not listed.
    const rows = host.querySelectorAll('.kh-row');
    expect(rows.length).toBe(4);
  });

  it('groups rows under their action.group label', () => {
    open();
    const groupHeads = Array.from(host.querySelectorAll('.kh-group-head')).map((g) => g.textContent);
    expect(groupHeads).toEqual(expect.arrayContaining(['Tool', 'Edit', 'Help']));
  });

  it('omits actions that have no hotkey', () => {
    open();
    const shapesRow = Array.from(host.querySelectorAll<HTMLElement>('.kh-row'))
      .find((r) => r.textContent?.includes('Shapes'));
    expect(shapesRow).toBeUndefined();
  });

  it('row hotkey chip shows primary hotkey only (aliases hidden)', () => {
    open();
    const deleteRow = Array.from(host.querySelectorAll<HTMLElement>('.kh-row'))
      .find((r) => r.textContent?.includes('Delete'));
    expect(deleteRow?.querySelector('.kh-key')?.textContent).toBe('Delete');
    expect(deleteRow?.textContent).not.toContain('Backspace');
  });

  it('hides when ui.hintsOpen flips back to false', () => {
    open();
    store._apply({ ui: { ...store.get().ui, hintsOpen: false } });
    const root = host.querySelector('.keyboard-hints') as HTMLElement;
    expect(root.hidden).toBe(true);
  });
});
