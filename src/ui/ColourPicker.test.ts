import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, type StratState } from '../app/store';
import { createHistory } from '../app/history';
import { ColourPicker } from './ColourPicker';
import { emptyFrame } from '../types/primitives';
import { hex } from '../types/hex';

function initialState(): StratState {
  return {
    mapId: 'miru',
    zoom: 1, panX: 0, panY: 0,
    frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '',
    tool: 'cursor',
    colourSlots: [hex('#00ff88'), null, null, null, null],
    activeSlot: 0,
    selection: [],
    ui: {
      sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false,
      libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false,
      hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null,
    },
  };
}

describe('ColourPicker', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let history: ReturnType<typeof createHistory>;
  let picker: ColourPicker;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore(initialState());
    history = createHistory(store);
    picker = new ColourPicker(host, store, history);
    picker.mount();
  });

  afterEach(() => {
    picker.destroy();
    document.body.removeChild(host);
  });

  it('starts hidden', () => {
    const root = host.querySelector('.colour-picker') as HTMLElement;
    expect(root.hidden).toBe(true);
  });

  it('shows when ui.colourPickerOpen is true', () => {
    store._apply({ ui: { ...store.get().ui, colourPickerOpen: true } });
    const root = host.querySelector('.colour-picker') as HTMLElement;
    expect(root.hidden).toBe(false);
  });

  it('hex input shows the active slot colour without leading #', () => {
    store._apply({ ui: { ...store.get().ui, colourPickerOpen: true } });
    const input = host.querySelector<HTMLInputElement>('.cp-hex-input');
    expect(input?.value).toBe('00ff88');
  });

  it('valid hex commit dispatches colour.set with correct before/after', () => {
    store._apply({ ui: { ...store.get().ui, colourPickerOpen: true } });
    const dispatch = vi.spyOn(history, 'dispatch');
    const input = host.querySelector<HTMLInputElement>('.cp-hex-input')!;
    input.value = 'ff4655';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(dispatch).toHaveBeenCalledWith({
      t: 'colour.set', slot: 0, before: hex('#00ff88'), after: hex('#ff4655'),
    });
  });

  it('invalid hex does not dispatch and reverts the input', () => {
    store._apply({ ui: { ...store.get().ui, colourPickerOpen: true } });
    const dispatch = vi.spyOn(history, 'dispatch');
    const input = host.querySelector<HTMLInputElement>('.cp-hex-input')!;
    input.value = 'zzzzzz';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(input.value).toBe('00ff88'); // reverted
  });

  it('outside-click closes the picker', () => {
    store._apply({ ui: { ...store.get().ui, colourPickerOpen: true } });
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(store.get().ui.colourPickerOpen).toBe(false);
  });

  it('clicking inside the colour-slots row does NOT close the picker', () => {
    // Switching the active slot via a slot click should let the picker stay
    // open and rebind to the new slot, not flash closed-then-open.
    const slots = document.createElement('div');
    slots.className = 'colour-slots';
    const slotBtn = document.createElement('button');
    slotBtn.className = 'colour-slot';
    slots.appendChild(slotBtn);
    document.body.appendChild(slots);
    store._apply({ ui: { ...store.get().ui, colourPickerOpen: true } });
    slotBtn.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(store.get().ui.colourPickerOpen).toBe(true);
    slots.remove();
  });

  it('brightness slider applies the new colour live without pushing history', () => {
    // Wheel/brightness drags bypass history like zoom/pan -- they're
    // exploratory view-state, not a discrete edit that belongs on the undo
    // stack. The hex input commit still goes through history; that one IS
    // a discrete intentional change.
    store._apply({ ui: { ...store.get().ui, colourPickerOpen: true } });
    const dispatch = vi.spyOn(history, 'dispatch');
    const slider = host.querySelector<HTMLInputElement>('.cp-brightness-slider')!;
    slider.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    slider.value = '50';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    const colourSetCalls = dispatch.mock.calls.filter((c) => (c[0] as { t: string }).t === 'colour.set');
    expect(colourSetCalls.length).toBe(0);
    // But the slot did move -- the live preview via _apply is intact.
    expect(store.get().colourSlots[0]).not.toBe(hex('#00ff88'));
  });

  it('renders the HS wheel canvas', () => {
    store._apply({ ui: { ...store.get().ui, colourPickerOpen: true } });
    const canvas = host.querySelector<HTMLCanvasElement>('.cp-wheel-canvas');
    expect(canvas).not.toBeNull();
  });
});
