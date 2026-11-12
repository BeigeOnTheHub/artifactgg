import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStore, type StratState } from '../app/store';
import { ColourSlots } from './ColourSlots';
import { emptyFrame } from '../types/primitives';
import { hex } from '../types/hex';

function initialState(): StratState {
  return {
    mapId: 'miru',
    zoom: 1, panX: 0, panY: 0,
    frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '',
    tool: 'cursor',
    colourSlots: [hex('#00ff88'), hex('#ff4655'), null, null, null],
    activeSlot: 0,
    selection: [],
    ui: {
      sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false,
      libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false,
      hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null,
    },
  };
}

describe('ColourSlots', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let slots: ColourSlots;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore(initialState());
    slots = new ColourSlots(host, store);
    slots.mount();
  });

  afterEach(() => {
    slots.destroy();
    document.body.removeChild(host);
  });

  it('renders 5 swatches with data-slot 0..4', () => {
    const sw = host.querySelectorAll<HTMLElement>('.colour-slot');
    expect(sw.length).toBe(5);
    expect(Array.from(sw).map((s) => s.dataset['slot'])).toEqual(['0', '1', '2', '3', '4']);
  });

  it('non-empty slot has its colour as background', () => {
    const slot0 = host.querySelector<HTMLElement>('[data-slot="0"]')!;
    expect(slot0.style.backgroundColor).toMatch(/(0,\s*255,\s*136|#00ff88)/i);
  });

  it('empty slot has .empty class', () => {
    const slot2 = host.querySelector('[data-slot="2"]');
    expect(slot2?.classList.contains('empty')).toBe(true);
  });

  it('active slot has .active class', () => {
    const slot0 = host.querySelector('[data-slot="0"]');
    expect(slot0?.classList.contains('active')).toBe(true);
    const slot1 = host.querySelector('[data-slot="1"]');
    expect(slot1?.classList.contains('active')).toBe(false);
  });

  it('clicking inactive slot activates it', () => {
    (host.querySelector('[data-slot="1"]') as HTMLElement).click();
    expect(store.get().activeSlot).toBe(1);
  });

  it('clicking already-active slot toggles ui.colourPickerOpen', () => {
    (host.querySelector('[data-slot="0"]') as HTMLElement).click();
    expect(store.get().ui.colourPickerOpen).toBe(true);
    (host.querySelector('[data-slot="0"]') as HTMLElement).click();
    expect(store.get().ui.colourPickerOpen).toBe(false);
  });

  it('clicking empty slot activates it AND opens the picker', () => {
    (host.querySelector('[data-slot="2"]') as HTMLElement).click();
    expect(store.get().activeSlot).toBe(2);
    expect(store.get().ui.colourPickerOpen).toBe(true);
  });

  it('pressing Enter on a focused slot selects it and opens the picker', () => {
    const slot1 = host.querySelector('[data-slot="1"]') as HTMLElement;
    slot1.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(store.get().activeSlot).toBe(1);
    expect(store.get().ui.colourPickerOpen).toBe(true);
  });

  it('renders an edit button after the 5 slots', () => {
    const edit = host.querySelector('.colour-slot-edit');
    expect(edit).not.toBeNull();
    // it comes after the swatches in DOM order
    const children = Array.from(host.querySelectorAll('.colour-slots > *'));
    expect(children[children.length - 1]).toBe(edit);
  });

  it('the edit button opens the picker for the active slot without changing it', () => {
    store._apply({ activeSlot: 1 });
    (host.querySelector('.colour-slot-edit') as HTMLElement).click();
    expect(store.get().ui.colourPickerOpen).toBe(true);
    expect(store.get().activeSlot).toBe(1);
  });
});
