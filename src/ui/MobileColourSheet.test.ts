import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MobileColourSheet } from './MobileColourSheet';
import { createSheetManager } from './sheetManager';
import { createStore, type StratState } from '../app/store';
import { createHistory } from '../app/history';
import { emptyFrame } from '../types/primitives';
import { hex } from '../types/hex';

function makeStore() {
  const s: StratState = {
    mapId: 'miru', zoom: 1, panX: 0, panY: 0, frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '', tool: 'draw',
    colourSlots: [hex('#00ff88'), hex('#ff4655'), null, null, null], activeSlot: 0,
    selection: [], ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false,
    shareOpen: false, libraryOpen: false, mapDropdownOpen: false,
    colourPickerOpen: false, hintsOpen: false, calloutsVisible: false,
    changelogOpen: false, confirmOpen: null },
  };
  return createStore(s);
}

describe('MobileColourSheet', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let sheet: MobileColourSheet;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = makeStore();
    history = createHistory(store);
    sheet = new MobileColourSheet(host, store, history);
    sheet.mount();
  });

  afterEach(() => { sheet.destroy(); host.remove(); });

  it('is hidden until ui.colourPickerOpen is true', () => {
    const root = host.querySelector('[data-testid="mobile-coloursheet"]') as HTMLElement;
    expect(root.hidden).toBe(true);
    store._apply({ ui: { ...store.get().ui, colourPickerOpen: true } });
    expect(root.hidden).toBe(false);
  });

  it('renders five slot buttons; tapping one activates that slot', () => {
    store._apply({ ui: { ...store.get().ui, colourPickerOpen: true } });
    const slot1 = host.querySelector('[data-testid="mobile-colour-slot-1"]') as HTMLButtonElement;
    expect(slot1).not.toBeNull();
    slot1.click();
    expect(store.get().activeSlot).toBe(1);
  });

  it('the close button clears ui.colourPickerOpen', () => {
    store._apply({ ui: { ...store.get().ui, colourPickerOpen: true } });
    (host.querySelector('[data-testid="mobile-coloursheet-close"]') as HTMLButtonElement).click();
    expect(store.get().ui.colourPickerOpen).toBe(false);
  });

  it('the brightness slider live-previews via _apply and commits one colour.set', () => {
    store._apply({ ui: { ...store.get().ui, colourPickerOpen: true } });
    const dispatch = vi.spyOn(history, 'dispatch');
    const slider = host.querySelector('.mcs-brightness') as HTMLInputElement;
    slider.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    slider.value = '50';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(store.get().colourSlots[0]).not.toBe(hex('#00ff88'));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    const calls = dispatch.mock.calls.filter((c) => (c[0] as { t: string }).t === 'colour.set');
    expect(calls.length).toBe(1);
  });

  it('a valid hex commit dispatches colour.set with the right before/after', () => {
    store._apply({ ui: { ...store.get().ui, colourPickerOpen: true } });
    const dispatch = vi.spyOn(history, 'dispatch');
    const input = host.querySelector('.mcs-hex') as HTMLInputElement;
    input.value = '3da9fc';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(dispatch).toHaveBeenCalledWith({
      t: 'colour.set', slot: 0, before: hex('#00ff88'), after: hex('#3da9fc'),
    });
  });

  it('a wheel drag commits one colour.set on release', () => {
    store._apply({ ui: { ...store.get().ui, colourPickerOpen: true } });
    const canvas = host.querySelector('.mcs-wheel-canvas') as HTMLCanvasElement;
    canvas.getBoundingClientRect = () => ({ left:0, top:0, width:240, height:240, right:240, bottom:240, x:0, y:0, toJSON: () => ({}) });
    const dispatch = vi.spyOn(history, 'dispatch');
    canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, clientX:200, clientY:120, bubbles:true }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId:1, clientX:200, clientY:120, bubbles:true }));
    const calls = dispatch.mock.calls.filter((c) => (c[0] as { t: string }).t === 'colour.set');
    expect(calls.length).toBe(1);
  });
});

describe('MobileColourSheet - shared sheet manager', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = makeStore();
    history = createHistory(store);
  });
  afterEach(() => { host.remove(); });

  it('opening the colour sheet closes whatever else was open', () => {
    // It is a separate component from MobileChrome, so before it joined the
    // manager it could sit open underneath the menu sheet.
    const manager = createSheetManager();
    const other = document.createElement('div');
    document.body.appendChild(other);
    const otherClosed = vi.fn();
    manager.open({ el: other, onClose: otherClosed, dismiss: 'swallow' });

    const sheet = new MobileColourSheet(host, store, history, manager);
    sheet.mount();
    store._apply({ ui: { ...store.get().ui, colourPickerOpen: true } });

    expect(otherClosed).toHaveBeenCalledTimes(1);
    expect(manager.current()).toBe(host.querySelector('[data-testid="mobile-coloursheet"]'));
    sheet.destroy(); other.remove(); manager.destroy();
  });

  it('the manager closing it clears the store flag', () => {
    const manager = createSheetManager();
    const sheet = new MobileColourSheet(host, store, history, manager);
    sheet.mount();
    store._apply({ ui: { ...store.get().ui, colourPickerOpen: true } });
    manager.close();
    expect(store.get().ui.colourPickerOpen).toBe(false);
    expect((host.querySelector('[data-testid="mobile-coloursheet"]') as HTMLElement).hidden).toBe(true);
    sheet.destroy(); manager.destroy();
  });

  it('a tap outside closes it', () => {
    const manager = createSheetManager();
    const sheet = new MobileColourSheet(host, store, history, manager);
    sheet.mount();
    store._apply({ ui: { ...store.get().ui, colourPickerOpen: true } });
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    expect(store.get().ui.colourPickerOpen).toBe(false);
    sheet.destroy(); manager.destroy();
  });
});
