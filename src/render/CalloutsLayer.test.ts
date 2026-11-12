import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CalloutsLayer } from './CalloutsLayer';
import { createStore, type StratState } from '../app/store';
import { emptyFrame } from '../types/primitives';
import { hex } from '../types/hex';

function initialState(): StratState {
  return {
    mapId: 'miru', zoom: 1, panX: 0, panY: 0,
    frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '', tool: 'cursor',
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
}

describe('CalloutsLayer', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let layer: CalloutsLayer;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore(initialState());
    layer = new CalloutsLayer(host, store);
    layer.mount();
  });

  afterEach(() => {
    layer.destroy();
    document.body.removeChild(host);
  });

  it('mounts an img inside the host', () => {
    const img = host.querySelector<HTMLImageElement>('img.callouts-layer-img');
    expect(img).not.toBeNull();
  });

  it('img.src reflects the current mapId', () => {
    const img = host.querySelector<HTMLImageElement>('img.callouts-layer-img')!;
    expect(img.src).toMatch(/assets\/maps\/miru\/map-callouts\.png$/);
  });

  it('mapId change updates img.src', () => {
    store._apply({ mapId: 'suna' });
    const img = host.querySelector<HTMLImageElement>('img.callouts-layer-img')!;
    expect(img.src).toMatch(/assets\/maps\/suna\/map-callouts\.png$/);
  });

  it('calloutsVisible=false hides the img via display:none', () => {
    store._apply({ ui: { ...store.get().ui, calloutsVisible: false } });
    const img = host.querySelector<HTMLImageElement>('img.callouts-layer-img')!;
    expect(img.style.display).toBe('none');
  });

  it('calloutsVisible=true shows the img', () => {
    store._apply({ ui: { ...store.get().ui, calloutsVisible: false } });
    store._apply({ ui: { ...store.get().ui, calloutsVisible: true } });
    const img = host.querySelector<HTMLImageElement>('img.callouts-layer-img')!;
    expect(img.style.display).toBe('');
  });

  it('img.onerror silently hides via display:none (Kiiro / 404 case)', () => {
    const img = host.querySelector<HTMLImageElement>('img.callouts-layer-img')!;
    img.dispatchEvent(new Event('error'));
    expect(img.style.display).toBe('none');
  });

  it('destroy() removes the img from the host', () => {
    layer.destroy();
    expect(host.querySelector('img.callouts-layer-img')).toBeNull();
    // re-mount for afterEach symmetry
    layer = new CalloutsLayer(host, store);
    layer.mount();
  });
});
