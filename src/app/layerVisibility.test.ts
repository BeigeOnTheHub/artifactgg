import { describe, it, expect, beforeEach } from 'vitest';
import {
  LAYER_KEYS,
  getLayerVisibility,
  setLayerVisible,
  attachLayerVisibility,
} from './layerVisibility';
import { createStore, type StratState } from './store';
import { emptyFrame } from '../types/primitives';
import { hex } from '../types/hex';

function initial(): StratState {
  return {
    mapId: 'miru', zoom: 1, panX: 0, panY: 0,
    frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '', tool: 'cursor',
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
}

describe('getLayerVisibility', () => {
  it('defaults every layer to true when the slice is absent', () => {
    const v = getLayerVisibility(initial());
    for (const k of LAYER_KEYS) expect(v[k]).toBe(true);
  });

  it('preserves a populated slice unchanged', () => {
    const state = initial();
    state.ui.layerVisibility = {
      strokes: false, shapes: true, cones: false,
      players: true, textboxes: false, quickadds: true,
    };
    const v = getLayerVisibility(state);
    expect(v.strokes).toBe(false);
    expect(v.shapes).toBe(true);
    expect(v.cones).toBe(false);
    expect(v.players).toBe(true);
    expect(v.textboxes).toBe(false);
    expect(v.quickadds).toBe(true);
  });
});

describe('setLayerVisible', () => {
  it('flips a single layer and leaves the others alone', () => {
    const s = createStore(initial());
    setLayerVisible(s, 'strokes', false);
    const v = getLayerVisibility(s.get());
    expect(v.strokes).toBe(false);
    expect(v.shapes).toBe(true);
    expect(v.cones).toBe(true);
    expect(v.players).toBe(true);
    expect(v.textboxes).toBe(true);
    expect(v.quickadds).toBe(true);
  });

  it('no-ops when the requested value already matches', () => {
    const s = createStore(initial());
    // First toggle creates a slice on the state.
    setLayerVisible(s, 'players', true);
    const before = s.get().ui.layerVisibility;
    // Setting to the same value should not bump references.
    setLayerVisible(s, 'players', true);
    expect(s.get().ui.layerVisibility).toBe(before);
  });

  it('first flip from default populates every key', () => {
    const s = createStore(initial());
    setLayerVisible(s, 'shapes', false);
    const slice = s.get().ui.layerVisibility!;
    expect(slice.strokes).toBe(true);
    expect(slice.shapes).toBe(false);
    expect(slice.cones).toBe(true);
    expect(slice.players).toBe(true);
    expect(slice.textboxes).toBe(true);
    expect(slice.quickadds).toBe(true);
  });
});

describe('attachLayerVisibility', () => {
  let target: HTMLElement;

  beforeEach(() => {
    target = document.createElement('div');
    document.body.appendChild(target);
  });

  it('reflects the default-shown state as data-hide-*="false" on every key', () => {
    const s = createStore(initial());
    const off = attachLayerVisibility(target, s);
    for (const k of LAYER_KEYS) {
      expect(target.dataset[`hide${k.charAt(0).toUpperCase()}${k.slice(1)}`]).toBe('false');
    }
    off();
  });

  it('flips the attribute to "true" when the layer is hidden', () => {
    const s = createStore(initial());
    const off = attachLayerVisibility(target, s);
    setLayerVisible(s, 'cones', false);
    expect(target.dataset['hideCones']).toBe('true');
    expect(target.dataset['hideShapes']).toBe('false');
    off();
  });

  it('teardown removes every data-hide-* attribute', () => {
    const s = createStore(initial());
    const off = attachLayerVisibility(target, s);
    setLayerVisible(s, 'strokes', false);
    off();
    for (const k of LAYER_KEYS) {
      expect(target.dataset[`hide${k.charAt(0).toUpperCase()}${k.slice(1)}`]).toBeUndefined();
    }
  });

  it('updates immediately when the store changes after subscribing', () => {
    const s = createStore(initial());
    const off = attachLayerVisibility(target, s);
    expect(target.dataset['hideTextboxes']).toBe('false');
    setLayerVisible(s, 'textboxes', false);
    expect(target.dataset['hideTextboxes']).toBe('true');
    setLayerVisible(s, 'textboxes', true);
    expect(target.dataset['hideTextboxes']).toBe('false');
    off();
  });
});
