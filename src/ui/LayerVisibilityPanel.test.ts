import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStore, type StratState } from '../app/store';
import { LayerVisibilityPanel } from './LayerVisibilityPanel';
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

describe('LayerVisibilityPanel', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let panel: LayerVisibilityPanel;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore(initial());
    panel = new LayerVisibilityPanel(host, store);
    panel.mount();
  });

  afterEach(() => {
    panel.destroy();
    if (host.parentElement) host.parentElement.removeChild(host);
  });

  function btn(layer: string): HTMLButtonElement {
    return host.querySelector(`.layer-visibility-btn[data-layer="${layer}"]`) as HTMLButtonElement;
  }

  it('renders one toggle per layer', () => {
    const buttons = host.querySelectorAll('.layer-visibility-btn');
    expect(buttons.length).toBe(6);
    for (const k of ['strokes', 'shapes', 'cones', 'players', 'textboxes', 'quickadds']) {
      expect(btn(k)).not.toBeNull();
    }
  });

  it('initial aria-pressed reads "true" for every layer (default shown)', () => {
    for (const k of ['strokes', 'shapes', 'cones', 'players', 'textboxes', 'quickadds']) {
      expect(btn(k).getAttribute('aria-pressed')).toBe('true');
    }
  });

  it('clicking a toggle flips the store slice for that layer', () => {
    btn('cones').click();
    expect(store.get().ui.layerVisibility!.cones).toBe(false);
    expect(store.get().ui.layerVisibility!.shapes).toBe(true);
  });

  it('aria-pressed updates from the store without rebuilding the button', () => {
    const node = btn('players');
    expect(node.getAttribute('aria-pressed')).toBe('true');
    btn('players').click();
    // Same DOM node, attribute flipped.
    expect(btn('players')).toBe(node);
    expect(node.getAttribute('aria-pressed')).toBe('false');
    expect(node.getAttribute('aria-label')).toContain('hidden');
  });

  it('clicking a hidden layer toggles it back to visible', () => {
    btn('strokes').click();
    expect(store.get().ui.layerVisibility!.strokes).toBe(false);
    btn('strokes').click();
    expect(store.get().ui.layerVisibility!.strokes).toBe(true);
  });

  it('is a labelled group for screen readers', () => {
    const group = host.querySelector('[role="group"]');
    expect(group).not.toBeNull();
    expect(group!.getAttribute('aria-label')).toBe('Layer visibility toggles');
  });
});
