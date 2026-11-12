import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScannerTool } from './ScannerTool';
import { createStore, type StratState } from '../app/store';
import { createHistory } from '../app/history';
import { emptyFrame } from '../types/primitives';
import { hex } from '../types/hex';

function makeStore() {
  const initial: StratState = {
    mapId: 'miru',
    zoom: 1, panX: 0, panY: 0,
    frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '', tool: 'place-scanner',
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
  return createStore(initial);
}

const fakeViewport = () => ({
  left: 0, top: 0, width: 1920, height: 1080,
  w: 1920, h: 1080, zoom: 1, panX: 0, panY: 0,
});

describe('ScannerTool', () => {
  let target: HTMLElement;
  let layerHost: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let tool: ScannerTool;

  beforeEach(() => {
    target = document.createElement('div');
    layerHost = document.createElement('div');
    document.body.appendChild(target);
    document.body.appendChild(layerHost);
    store = makeStore();
    history = createHistory(store);
    tool = new ScannerTool({ store, history, host: layerHost, getViewport: fakeViewport });
    tool.attach(target);
  });

  it('left-click empty space dispatches scanner.place when none exists', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true }));
    const sc = store.get().frames[0]!.scanner;
    expect(sc).not.toBeNull();
    expect(sc!.x).toBe(200);
    expect(sc!.y).toBe(200);
  });

  it('placing creates a div in the host', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, scanner: { x: 100, y: 100 } }] });
    expect(layerHost.querySelector('.scanner-el')).not.toBeNull();
  });

  it('clearing scanner removes the div', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, scanner: { x: 100, y: 100 } }] });
    expect(layerHost.querySelector('.scanner-el')).not.toBeNull();
    store._apply({ frames: [{ ...store.get().frames[0]!, scanner: null }] });
    expect(layerHost.querySelector('.scanner-el')).toBeNull();
  });

  it('drag on the scanner element commits scanner.place at new position', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, scanner: { x: 100, y: 100 } }] });
    const el = layerHost.querySelector('.scanner-el') as HTMLDivElement;
    el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 300, clientY: 250, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 300, clientY: 250, bubbles: true }));
    const sc = store.get().frames[0]!.scanner!;
    expect(sc.x).toBe(300);
    expect(sc.y).toBe(250);
  });

  it('a nudge under the drag threshold snaps back instead of sticking with no undo', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, scanner: { x: 100, y: 100 } }] });
    const el = layerHost.querySelector('.scanner-el') as HTMLDivElement;
    el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 102, clientY: 102, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 102, clientY: 102, bubbles: true }));
    expect(store.get().frames[0]!.scanner).toEqual({ x: 100, y: 100 });
  });

  it('drag commit is undoable', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, scanner: { x: 100, y: 100 } }] });
    const el = layerHost.querySelector('.scanner-el') as HTMLDivElement;
    el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 300, clientY: 250, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 300, clientY: 250, bubbles: true }));
    history.undo();
    expect(store.get().frames[0]!.scanner!.x).toBe(100);
    expect(store.get().frames[0]!.scanner!.y).toBe(100);
  });

  it('contextmenu on the scanner dispatches scanner.place null', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, scanner: { x: 100, y: 100 } }] });
    const el = layerHost.querySelector('.scanner-el') as HTMLDivElement;
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(store.get().frames[0]!.scanner).toBeNull();
  });

  it('placing over existing replaces the scanner', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, scanner: { x: 100, y: 100 } }] });
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 500, clientY: 500, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 500, clientY: 500, bubbles: true }));
    const sc = store.get().frames[0]!.scanner!;
    expect(sc.x).toBe(500);
    expect(sc.y).toBe(500);
  });

  it('right-click in empty space does not place', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 2, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 2, clientX: 100, clientY: 100, bubbles: true }));
    expect(store.get().frames[0]!.scanner).toBeNull();
  });

  it('detach removes the scanner element and listeners', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, scanner: { x: 100, y: 100 } }] });
    tool.detach();
    expect(layerHost.querySelector('.scanner-el')).toBeNull();
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true }));
    expect(store.get().frames[0]!.scanner!.x).toBe(100);
  });

  it('pointercancel mid-drag reverts the scanner and dispatches nothing', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, scanner: { x: 100, y: 100 } }] });
    const el = layerHost.querySelector('.scanner-el') as HTMLDivElement;
    el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 300, clientY: 250, bubbles: true }));
    expect(store.get().frames[0]!.scanner!.x).toBe(300);
    const dispatch = vi.spyOn(history, 'dispatch');
    target.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, button: 0, clientX: 300, clientY: 250, bubbles: true }));
    const sc = store.get().frames[0]!.scanner!;
    expect(sc.x).toBe(100);
    expect(sc.y).toBe(100);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
