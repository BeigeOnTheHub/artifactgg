import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStore, type StratState } from '../app/store';
import { buildLayerToggles } from './layerToggles';
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

describe('buildLayerToggles', () => {
  let store: ReturnType<typeof createStore>;
  let built: ReturnType<typeof buildLayerToggles>;

  beforeEach(() => {
    store = createStore(initial());
    built = buildLayerToggles(store);
    document.body.appendChild(built.el);
  });

  afterEach(() => {
    built.destroy();
    built.el.remove();
  });

  function btn(layer: string): HTMLButtonElement {
    return built.el.querySelector(`.layer-visibility-btn[data-layer="${layer}"]`) as HTMLButtonElement;
  }

  it('renders one toggle per layer inside a labelled group', () => {
    expect(built.el.getAttribute('role')).toBe('group');
    expect(built.el.getAttribute('aria-label')).toBe('Layer visibility toggles');
    expect(built.el.querySelectorAll('.layer-visibility-btn').length).toBe(6);
  });

  it('clicking a toggle flips that layer in the store', () => {
    btn('cones').click();
    expect(store.get().ui.layerVisibility!.cones).toBe(false);
    expect(store.get().ui.layerVisibility!.shapes).toBe(true);
  });

  it('patches aria state in place rather than rebuilding the button', () => {
    const node = btn('players');
    node.click();
    expect(btn('players')).toBe(node);
    expect(node.getAttribute('aria-pressed')).toBe('false');
    expect(node.getAttribute('aria-label')).toContain('hidden');
  });

  it('reflects a store change made from outside the toggles', () => {
    const ui = store.get().ui;
    store._apply({ ui: { ...ui, layerVisibility: { ...({ strokes: true, shapes: true, cones: true, players: true, textboxes: true, quickadds: true }), strokes: false } } });
    expect(btn('strokes').getAttribute('aria-pressed')).toBe('false');
  });

  it('destroy unsubscribes so later store changes are ignored', () => {
    const node = btn('cones');
    built.destroy();
    const ui = store.get().ui;
    store._apply({ ui: { ...ui, layerVisibility: { strokes: true, shapes: true, cones: false, players: true, textboxes: true, quickadds: true } } });
    expect(node.getAttribute('aria-pressed')).toBe('true');
  });
});
