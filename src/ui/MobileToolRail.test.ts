import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MobileToolRail } from './MobileToolRail';
import { createStore, type StratState } from '../app/store';
import { hex } from '../types/hex';

function makeStore() {
  const s: StratState = {
    mapId: 'miru', zoom: 1, panX: 0, panY: 0, frames: [], activeFrameIdx: 0,
    notes: '', tool: 'cursor',
    colourSlots: [hex('#ff4655'), hex('#00ff88'), null, null, null], activeSlot: 0,
    selection: [], ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false,
    shareOpen: false, libraryOpen: false, mapDropdownOpen: false,
    colourPickerOpen: false, hintsOpen: false, calloutsVisible: false,
    changelogOpen: false, confirmOpen: null },
  };
  return createStore(s);
}

describe('MobileToolRail', () => {
  let host: HTMLElement;
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); });
  afterEach(() => { host.remove(); });

  it('renders the eight tool buttons and the colour swatch', () => {
    const store = makeStore();
    const rail = new MobileToolRail(host, store, { onReopenSettings: () => {} });
    rail.mount();
    for (const id of ['cursor', 'draw', 'erase', 'shapes', 'place-cone', 'place-player', 'place-text', 'place-quickadd']) {
      expect(host.querySelector(`[data-testid="mobile-tool-${id}"]`)).not.toBeNull();
    }
    expect(host.querySelector('[data-testid="mobile-colour-swatch"]')).not.toBeNull();
    rail.destroy();
  });

  it('tapping a tool button writes store.tool and moves the active highlight', () => {
    const store = makeStore();
    const rail = new MobileToolRail(host, store, { onReopenSettings: () => {} });
    rail.mount();
    const draw = host.querySelector('[data-testid="mobile-tool-draw"]') as HTMLButtonElement;
    const cursor = host.querySelector('[data-testid="mobile-tool-cursor"]') as HTMLButtonElement;
    expect(cursor.classList.contains('active')).toBe(true);
    draw.click();
    expect(store.get().tool).toBe('draw');
    expect(draw.classList.contains('active')).toBe(true);
    expect(cursor.classList.contains('active')).toBe(false);
    rail.destroy();
  });

  it('re-tapping the active tool button calls onReopenSettings, not a store write', () => {
    const store = makeStore();
    const onReopenSettings = vi.fn();
    const rail = new MobileToolRail(host, store, { onReopenSettings });
    rail.mount();
    store._apply({ tool: 'draw' });
    const draw = host.querySelector('[data-testid="mobile-tool-draw"]') as HTMLButtonElement;
    draw.click();
    expect(onReopenSettings).toHaveBeenCalledTimes(1);
    expect(store.get().tool).toBe('draw');
    rail.destroy();
  });

  it('the swatch shows the active colour and tracks the active slot', () => {
    const store = makeStore();
    const rail = new MobileToolRail(host, store, { onReopenSettings: () => {} });
    rail.mount();
    const swatch = host.querySelector('[data-testid="mobile-colour-swatch"]') as HTMLButtonElement;
    expect(swatch.style.backgroundColor).toBe('rgb(255, 70, 85)'); // #ff4655
    store._apply({ activeSlot: 1 });
    expect(swatch.style.backgroundColor).toBe('rgb(0, 255, 136)'); // #00ff88
    rail.destroy();
  });

  it('tapping the swatch opens the colour sheet via ui.colourPickerOpen', () => {
    const store = makeStore();
    const rail = new MobileToolRail(host, store, { onReopenSettings: () => {} });
    rail.mount();
    (host.querySelector('[data-testid="mobile-colour-swatch"]') as HTMLButtonElement).click();
    expect(store.get().ui.colourPickerOpen).toBe(true);
    rail.destroy();
  });
});
