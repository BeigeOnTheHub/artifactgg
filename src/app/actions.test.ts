import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createStore, type StratState } from './store';
import { createActions, type Action } from './actions';
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

function makeAction(over: Partial<Action> = {}): Action {
  return {
    id: 'tool.cursor', title: 'Cursor', group: 'Tool', run: vi.fn(), ...over,
  };
}

describe('actions registry', () => {
  let store: ReturnType<typeof createStore>;
  let actions: ReturnType<typeof createActions>;

  beforeEach(() => {
    store = createStore(initialState());
    actions = createActions(store);
  });

  it('register stores an action retrievable by id', () => {
    const a = makeAction();
    actions.register(a);
    expect(actions.byId('tool.cursor')).toBe(a);
  });

  it('register throws on duplicate id', () => {
    actions.register(makeAction());
    expect(() => actions.register(makeAction())).toThrow(/duplicate/i);
  });

  it('byId returns null when id is unknown', () => {
    expect(actions.byId('does.not.exist')).toBeNull();
  });

  it('byHotkey is case-insensitive', () => {
    actions.register(makeAction({ id: 'edit.copy', title: 'Copy', group: 'Edit', hotkey: 'Ctrl+C' }));
    expect(actions.byHotkey('CTRL+C')?.id).toBe('edit.copy');
    expect(actions.byHotkey('ctrl+c')?.id).toBe('edit.copy');
  });

  it('byHotkey resolves aliases', () => {
    actions.register(makeAction({ id: 'edit.delete', title: 'Delete', group: 'Edit', hotkey: 'Delete', aliases: ['Backspace'] }));
    expect(actions.byHotkey('Delete')?.id).toBe('edit.delete');
    expect(actions.byHotkey('Backspace')?.id).toBe('edit.delete');
  });

  it('byHotkey returns null when no action matches', () => {
    expect(actions.byHotkey('Ctrl+Q')).toBeNull();
  });

  it('list returns actions in registration order', () => {
    actions.register(makeAction({ id: 'tool.cursor' }));
    actions.register(makeAction({ id: 'tool.draw', title: 'Draw' }));
    expect(actions.list().map((a) => a.id)).toEqual(['tool.cursor', 'tool.draw']);
  });

  it('list filters by group when group arg is provided', () => {
    actions.register(makeAction({ id: 'tool.cursor', group: 'Tool' }));
    actions.register(makeAction({ id: 'edit.copy', title: 'Copy', group: 'Edit' }));
    expect(actions.list('Tool').map((a) => a.id)).toEqual(['tool.cursor']);
    expect(actions.list('Edit').map((a) => a.id)).toEqual(['edit.copy']);
  });

  it('run invokes action.run when canRun is absent', () => {
    const run = vi.fn();
    actions.register(makeAction({ run }));
    expect(actions.run('tool.cursor')).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('run skips when canRun(state) returns false', () => {
    const run = vi.fn();
    const canRun = vi.fn().mockReturnValue(false);
    actions.register(makeAction({ run, canRun }));
    expect(actions.run('tool.cursor')).toBe(false);
    expect(canRun).toHaveBeenCalledWith(store.get());
    expect(run).not.toHaveBeenCalled();
  });

  it('run invokes when canRun(state) returns true', () => {
    const run = vi.fn();
    const canRun = vi.fn().mockReturnValue(true);
    actions.register(makeAction({ run, canRun }));
    expect(actions.run('tool.cursor')).toBe(true);
    expect(run).toHaveBeenCalled();
  });

  it('run returns false when id is unknown', () => {
    expect(actions.run('does.not.exist')).toBe(false);
  });
});
