import { describe, it, expect, vi } from 'vitest';
import { createStore, type StratState } from './store';
import { emptyFrame } from '../types/primitives';
import { hex } from '../types/hex';

function initial(): StratState {
  return {
    mapId: 'miru',
    zoom: 1,
    panX: 0,
    panY: 0,
    frames: [emptyFrame()],
    activeFrameIdx: 0,
    notes: '',
    tool: 'cursor',
    colourSlots: [hex('#00ff88'), null, null, null, null],
    activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
}

describe('store', () => {
  it('reads the current snapshot', () => {
    const s = createStore(initial());
    expect(s.get().mapId).toBe('miru');
  });

  it('fires a subscription only when a listed key changes', () => {
    const s = createStore(initial());
    const toolFn = vi.fn();
    const zoomFn = vi.fn();
    s.subscribe(['tool'], toolFn);
    s.subscribe(['zoom'], zoomFn);

    s._apply({ tool: 'draw' });

    expect(toolFn).toHaveBeenCalledTimes(1);
    expect(zoomFn).not.toHaveBeenCalled();
  });

  it('returns an unsubscribe function', () => {
    const s = createStore(initial());
    const fn = vi.fn();
    const off = s.subscribe(['tool'], fn);
    off();
    s._apply({ tool: 'draw' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('a listener that unsubscribes itself does not make the next one miss the change', () => {
    const s = createStore(initial());
    const off = s.subscribe(['notes'], () => off());
    const next = vi.fn();
    s.subscribe(['notes'], next);
    s._apply({ notes: 'x' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('de-duplicates no-op sets by reference', () => {
    const s = createStore(initial());
    const fn = vi.fn();
    s.subscribe(['tool'], fn);
    const cur = s.get().tool;
    s._apply({ tool: cur });
    expect(fn).not.toHaveBeenCalled();
  });

  it('fires once when multiple subscribed keys change in the same apply', () => {
    const s = createStore(initial());
    const fn = vi.fn();
    s.subscribe(['zoom', 'panX', 'panY'], fn);
    s._apply({ zoom: 2, panX: 10, panY: 20 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('store.ui - mode field', () => {
  it('initializes ui.mode to "frame" when supplied', () => {
    const s = createStore({
      mapId: 'miru', zoom: 1, panX: 0, panY: 0,
      frames: [emptyFrame()], activeFrameIdx: 0,
      notes: '', tool: 'cursor',
      colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
      selection: [],
      ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
    });
    expect(s.get().ui.mode).toBe('frame');
  });

  it('flips ui.mode via _apply', () => {
    const s = createStore({
      mapId: 'miru', zoom: 1, panX: 0, panY: 0,
      frames: [emptyFrame()], activeFrameIdx: 0,
      notes: '', tool: 'cursor',
      colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
      selection: [],
      ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
    });
    s._apply({ ui: { ...s.get().ui, mode: 'animation' } });
    expect(s.get().ui.mode).toBe('animation');
  });
});

describe('store.ui - calloutsVisible + changelogOpen', () => {
  it('initializes calloutsVisible to true and changelogOpen to false when supplied', () => {
    const s = createStore({
      mapId: 'miru', zoom: 1, panX: 0, panY: 0,
      frames: [emptyFrame()], activeFrameIdx: 0,
      notes: '', tool: 'cursor',
      colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
      selection: [],
      ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
    });
    expect(s.get().ui.calloutsVisible).toBe(true);
    expect(s.get().ui.changelogOpen).toBe(false);
  });
});

describe('layoutMode + readOnly store fields', () => {
  it('accepts and notifies on layoutMode/readOnly changes', () => {
    const store = createStore(initial());
    let hits = 0;
    store.subscribe(['layoutMode', 'readOnly'], () => { hits++; });
    store._apply({ layoutMode: 'compact', readOnly: true });
    expect(hits).toBe(1);
    expect(store.get().layoutMode).toBe('compact');
    expect(store.get().readOnly).toBe(true);
  });
});
