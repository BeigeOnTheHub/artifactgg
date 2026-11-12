import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openItemActionMenu } from './ItemActionMenu';
import { createSheetManager } from './sheetManager';
import { createStore, type StratState } from '../app/store';
import { createHistory } from '../app/history';
import type { SelectionRef } from '../types/primitives';

function makeState(): StratState {
  return {
    mapId: 'suna', zoom: 1, panX: 0, panY: 0,
    frames: [{
      players: [
        { id: 'p1', x: 200, y: 200, team: 'colonist', name: '', dead: false },
        { id: 'p2', x: 400, y: 400, team: 'reyab', name: '', dead: false },
      ],
      cones: [], shapes: [], textboxes: [], quickadds: [], strokes: [], scanner: null,
    }],
    activeFrameIdx: 0,
    notes: '', tool: 'cursor', colourSlots: [null, null, null, null, null],
    activeSlot: 0, selection: [],
    ui: {
      sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false,
      libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false,
      hintsOpen: false, calloutsVisible: false, changelogOpen: false, confirmOpen: null,
    },
  };
}

describe('ItemActionMenu', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let history: ReturnType<typeof createHistory>;
  let sheets: ReturnType<typeof createSheetManager>;
  const ref: SelectionRef = { kind: 'player', id: 'p1' };

  function open(x = 100, y = 100): HTMLElement {
    return openItemActionMenu(ref, x, y, { store, history, host, sheets });
  }
  const pick = (menu: HTMLElement, testid: string): void => {
    (menu.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement).click();
  };

  beforeEach(() => {
    host = document.createElement('div');
    host.getBoundingClientRect = () => ({ left: 0, top: 0, width: 390, height: 844, right: 390, bottom: 844, x: 0, y: 0, toJSON: () => ({}) });
    document.body.appendChild(host);
    store = createStore(makeState());
    history = createHistory(store);
    sheets = createSheetManager();
  });

  afterEach(() => {
    sheets.destroy();
    host.remove();
  });

  it('offers exactly the three actions', () => {
    const menu = open();
    expect(Array.from(menu.querySelectorAll('.mob-itemmenu-row')).map((b) => b.textContent))
      .toEqual(['Delete', 'Duplicate', 'Add to selection']);
  });

  it('deletes the held item as one undo step', () => {
    const menu = open();
    pick(menu, 'mobile-itemmenu-delete');
    expect(store.get().frames[0]!.players.map((p) => p.id)).toEqual(['p2']);
    history.undo();
    // Sorted: undo re-appends rather than reinserting at the original index, so
    // the array order comes back as p2,p1. That is the existing behaviour of
    // deleteRefs/undo and not something this menu introduced.
    expect(store.get().frames[0]!.players.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
  });

  it('duplicates the held item even when something else is selected', () => {
    // duplicate() works on the selection, so holding an unselected item has to
    // point the selection at it first or you would copy the wrong thing.
    store._apply({ selection: [{ kind: 'player', id: 'p2' }] });
    const menu = open();
    pick(menu, 'mobile-itemmenu-duplicate');
    const players = store.get().frames[0]!.players;
    expect(players).toHaveLength(3);
    // The copy is of p1, so two players share p1's team and none was added as p2's.
    expect(players.filter((p) => p.team === 'colonist')).toHaveLength(2);
  });

  it('adds to the selection and switches multi-select on', () => {
    store._apply({ selection: [{ kind: 'player', id: 'p2' }] });
    const menu = open();
    pick(menu, 'mobile-itemmenu-add');
    expect(store.get().selection).toEqual([
      { kind: 'player', id: 'p2' }, { kind: 'player', id: 'p1' },
    ]);
    // This is what let the toggle leave the top bar.
    expect(store.get().ui.touchMultiSelect).toBe(true);
  });

  it('does not add a duplicate entry when the item is already selected', () => {
    store._apply({ selection: [ref] });
    const menu = open();
    pick(menu, 'mobile-itemmenu-add');
    expect(store.get().selection).toEqual([ref]);
  });

  it('closes after any action', () => {
    const menu = open();
    pick(menu, 'mobile-itemmenu-delete');
    expect(menu.isConnected).toBe(false);
    expect(sheets.current()).toBeNull();
  });

  it('is dismissed by a tap outside and by Escape', () => {
    const menu = open();
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(menu.isConnected).toBe(false);

    const again = open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(again.isConnected).toBe(false);
  });

  it('opening a second menu tears the first one down', () => {
    const first = open();
    const second = open(200, 200);
    expect(first.isConnected).toBe(false);
    expect(second.isConnected).toBe(true);
  });

  it('stays inside the host when the press lands near an edge', () => {
    // jsdom reports 0 for offsetWidth/offsetHeight, so this checks the clamping
    // arithmetic rather than a real layout: with a zero-size menu the flip is a
    // no-op and the value must still land inside the host, never negative.
    const menu = open(388, 842);
    const left = parseFloat(menu.style.left);
    const top = parseFloat(menu.style.top);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(left).toBeLessThanOrEqual(390);
    expect(top).toBeLessThanOrEqual(844);
  });
});
