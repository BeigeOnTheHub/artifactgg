import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type StratState } from './store';
import { attachSelectionColourSync } from './selectionColourSync';
import { emptyFrame, type TextBox } from '../types/primitives';
import { hex } from '../types/hex';

function makeBox(overrides: Partial<TextBox> = {}): TextBox {
  return {
    id: 't1', x: 50, y: 50, w: 200, h: 40,
    text: 'hi', fontSize: 14, color: hex('#ff4655'),
    ...overrides,
  };
}

function initial(boxes: TextBox[] = [], selectionId: string | null = null): StratState {
  const f = emptyFrame();
  f.textboxes = boxes;
  return {
    mapId: 'miru', zoom: 1, panX: 0, panY: 0,
    frames: [f], activeFrameIdx: 0,
    notes: '', tool: 'cursor',
    colourSlots: [hex('#00ff88'), hex('#3da9fc'), null, null, null], activeSlot: 0,
    selection: selectionId ? [{ kind: 'textbox', id: selectionId }] : [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
}

describe('attachSelectionColourSync', () => {
  let off: () => void;
  beforeEach(() => { off = () => {}; });

  it('retints the selected textbox when the active slot colour changes', () => {
    const box = makeBox();
    const store = createStore(initial([box], 't1'));
    off = attachSelectionColourSync(store);
    const slots = [...store.get().colourSlots];
    slots[0] = hex('#ffffff');
    store._apply({ colourSlots: slots });
    const after = store.get().frames[0]!.textboxes[0]!;
    expect(after.color).toBe(hex('#ffffff'));
    off();
  });

  it('retints when the active slot changes (switching to a slot with a different colour)', () => {
    const box = makeBox();
    const store = createStore(initial([box], 't1'));
    off = attachSelectionColourSync(store);
    store._apply({ activeSlot: 1 });
    expect(store.get().frames[0]!.textboxes[0]!.color).toBe(hex('#3da9fc'));
    off();
  });

  it('does not retint when no textbox is selected', () => {
    const box = makeBox();
    const store = createStore(initial([box], null));
    off = attachSelectionColourSync(store);
    const before = store.get().frames[0]!.textboxes[0]!.color;
    const slots = [...store.get().colourSlots];
    slots[0] = hex('#ffffff');
    store._apply({ colourSlots: slots });
    expect(store.get().frames[0]!.textboxes[0]!.color).toBe(before);
    off();
  });

  it('does not retint when the selection is not a textbox', () => {
    const box = makeBox();
    const state = initial([box], null);
    state.selection = [{ kind: 'shape', id: 's-anything' }];
    const store = createStore(state);
    off = attachSelectionColourSync(store);
    const before = store.get().frames[0]!.textboxes[0]!.color;
    const slots = [...store.get().colourSlots];
    slots[0] = hex('#ffffff');
    store._apply({ colourSlots: slots });
    expect(store.get().frames[0]!.textboxes[0]!.color).toBe(before);
    off();
  });

  it('does not retint when multiple items are selected', () => {
    const box = makeBox();
    const state = initial([box], 't1');
    state.selection = [
      { kind: 'textbox', id: 't1' },
      { kind: 'shape', id: 's2' },
    ];
    const store = createStore(state);
    off = attachSelectionColourSync(store);
    const before = store.get().frames[0]!.textboxes[0]!.color;
    const slots = [...store.get().colourSlots];
    slots[0] = hex('#ffffff');
    store._apply({ colourSlots: slots });
    expect(store.get().frames[0]!.textboxes[0]!.color).toBe(before);
    off();
  });

  it('selecting a textbox does NOT retint it -- only colour changes trigger the sync', () => {
    const box = makeBox(); // already #ff4655
    const state = initial([box], null);
    const store = createStore(state);
    off = attachSelectionColourSync(store);
    // Active slot is #00ff88 -- different from the box's #ff4655.
    store._apply({ selection: [{ kind: 'textbox', id: 't1' }] });
    expect(store.get().frames[0]!.textboxes[0]!.color).toBe(hex('#ff4655'));
    off();
  });

  it('teardown stops further retinting', () => {
    const box = makeBox();
    const store = createStore(initial([box], 't1'));
    const detach = attachSelectionColourSync(store);
    const slots = [...store.get().colourSlots];
    slots[0] = hex('#ffffff');
    store._apply({ colourSlots: slots });
    expect(store.get().frames[0]!.textboxes[0]!.color).toBe(hex('#ffffff'));
    detach();
    const slots2 = [...store.get().colourSlots];
    slots2[0] = hex('#000000');
    store._apply({ colourSlots: slots2 });
    // Box stays at the previous synced value.
    expect(store.get().frames[0]!.textboxes[0]!.color).toBe(hex('#ffffff'));
  });
});
