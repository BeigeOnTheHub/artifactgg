import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ShapeHandlesLayer, computeResize } from './ShapeHandlesLayer';
import { createStore, type StratState } from '../app/store';
import { createHistory } from '../app/history';
import { emptyFrame, type Shape, type SelectionRef } from '../types/primitives';
import { hex } from '../types/hex';

function makeStore() {
  const initial: StratState = {
    mapId: 'miru',
    zoom: 1, panX: 0, panY: 0,
    frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '', tool: 'cursor',
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

const RECT: Shape = {
  id: 'r1', kind: 'square', x: 100, y: 100, w: 60, h: 40,
  rotation: 0, stroke: hex('#00ff88'), strokeWidth: 2, fill: false,
};
const LINE: Shape = {
  id: 'l1', kind: 'line', x: 400, y: 400, w: 80, h: 20,
  rotation: 0, stroke: hex('#00ff88'), strokeWidth: 2, fill: false,
};

function setShapes(store: ReturnType<typeof makeStore>, shapes: Shape[]): void {
  store._apply({ frames: [{ ...store.get().frames[0]!, shapes }] });
}
function select(store: ReturnType<typeof makeStore>, refs: SelectionRef[]): void {
  store._apply({ selection: refs });
}

describe('ShapeHandlesLayer - rendering', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let layer: ShapeHandlesLayer;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = makeStore();
    history = createHistory(store);
    layer = new ShapeHandlesLayer(host, store, history, { w: 1920, h: 1080 }, fakeViewport);
    layer.mount();
  });

  afterEach(() => {
    layer.destroy();
    if (host.parentElement) host.parentElement.removeChild(host);
  });

  function handles(): NodeListOf<Element> {
    return host.querySelectorAll('.shape-handle');
  }

  it('renders no handles with nothing selected', () => {
    setShapes(store, [RECT]);
    expect(handles()).toHaveLength(0);
  });

  it('renders 8 perimeter handles for a selected box shape', () => {
    setShapes(store, [RECT]);
    select(store, [{ kind: 'shape', id: 'r1' }]);
    expect(handles()).toHaveLength(8);
    // se handle sits at the bottom-right corner.
    const se = host.querySelector('.shape-handle[data-role="se"]') as SVGRectElement;
    expect(Number(se.getAttribute('x'))).toBeCloseTo(100 + 60 - 7);
    expect(Number(se.getAttribute('y'))).toBeCloseTo(100 + 40 - 7);
  });

  it('renders 2 endpoint handles for a selected line/arrow', () => {
    setShapes(store, [LINE]);
    select(store, [{ kind: 'shape', id: 'l1' }]);
    expect(handles()).toHaveLength(2);
    const end = host.querySelector('.shape-handle[data-role="end"]') as SVGRectElement;
    expect(Number(end.getAttribute('x'))).toBeCloseTo(400 + 80 - 7);
    expect(Number(end.getAttribute('y'))).toBeCloseTo(400 + 20 - 7);
  });

  it('renders no handles when a non-select tool is active', () => {
    setShapes(store, [RECT]);
    select(store, [{ kind: 'shape', id: 'r1' }]);
    store._apply({ tool: 'draw' });
    expect(handles()).toHaveLength(0);
  });

  it('renders no handles when the selection is not exactly one shape', () => {
    setShapes(store, [RECT, LINE]);
    select(store, [{ kind: 'shape', id: 'r1' }, { kind: 'shape', id: 'l1' }]);
    expect(handles()).toHaveLength(0);
    select(store, [{ kind: 'player', id: 'p1' }]);
    expect(handles()).toHaveLength(0);
  });

  it('follows the shape when it moves', () => {
    setShapes(store, [RECT]);
    select(store, [{ kind: 'shape', id: 'r1' }]);
    setShapes(store, [{ ...RECT, x: 500, y: 600 }]);
    const nw = host.querySelector('.shape-handle[data-role="nw"]') as SVGRectElement;
    expect(Number(nw.getAttribute('x'))).toBeCloseTo(500 - 7);
    expect(Number(nw.getAttribute('y'))).toBeCloseTo(600 - 7);
  });

  it('dragging the se handle resizes the shape and dispatches one shape.modify', () => {
    setShapes(store, [RECT]);
    select(store, [{ kind: 'shape', id: 'r1' }]);
    const se = host.querySelector('.shape-handle[data-role="se"]') as SVGRectElement;

    se.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 160, clientY: 140, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, button: 0, clientX: 260, clientY: 240, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 260, clientY: 240, bubbles: true }));

    const sh = store.get().frames[0]!.shapes[0]!;
    expect(sh.x).toBe(100);
    expect(sh.y).toBe(100);
    expect(sh.w).toBe(160); // 260 - 100
    expect(sh.h).toBe(140); // 240 - 100
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(store.get().frames[0]!.shapes[0]!.w).toBe(60);
  });

  it('a no-op drag (released without moving) does not dispatch', () => {
    setShapes(store, [RECT]);
    select(store, [{ kind: 'shape', id: 'r1' }]);
    const se = host.querySelector('.shape-handle[data-role="se"]') as SVGRectElement;
    se.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 160, clientY: 140, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 160, clientY: 140, bubbles: true }));
    expect(history.canUndo()).toBe(false);
    expect(store.get().frames[0]!.shapes[0]!.w).toBe(60);
  });

  it('pointercancel mid-resize reverts the shape and does not dispatch', () => {
    setShapes(store, [RECT]);
    select(store, [{ kind: 'shape', id: 'r1' }]);
    const se = host.querySelector('.shape-handle[data-role="se"]') as SVGRectElement;
    se.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 160, clientY: 140, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, button: 0, clientX: 260, clientY: 240, bubbles: true }));
    expect(store.get().frames[0]!.shapes[0]!.w).toBe(160);
    document.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, button: 0, clientX: 260, clientY: 240, bubbles: true }));
    const sh = store.get().frames[0]!.shapes[0]!;
    expect(sh.w).toBe(60);
    expect(sh.h).toBe(40);
    expect(history.canUndo()).toBe(false);
  });
});

describe('ShapeHandlesLayer - touch edit', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let layer: ShapeHandlesLayer;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = makeStore();
    history = createHistory(store);
    // 6th arg `true` = touchEdit: enlarged handle hit targets.
    layer = new ShapeHandlesLayer(host, store, history, { w: 1920, h: 1080 }, fakeViewport, true);
    layer.mount();
  });

  afterEach(() => {
    layer.destroy();
    if (host.parentElement) host.parentElement.removeChild(host);
  });

  it('renders enlarged handle rects in touch-edit mode', () => {
    setShapes(store, [RECT]);
    select(store, [{ kind: 'shape', id: 'r1' }]);
    const se = host.querySelector('.shape-handle[data-role="se"]') as SVGRectElement;
    // 44 SCREEN px, and this store is at zoom 1, so 44 map units here. The size is
    // now divided by the live zoom - see the touch handle sizing describe below.
    expect(se.getAttribute('width')).toBe('44');
    expect(se.getAttribute('height')).toBe('44');
    // still centred on the corner: x = corner - size/2
    expect(Number(se.getAttribute('x'))).toBeCloseTo(100 + 60 - 22);
    expect(Number(se.getAttribute('y'))).toBeCloseTo(100 + 40 - 22);
  });

  it('a touch drag on the se handle still resizes and dispatches one shape.modify', () => {
    setShapes(store, [RECT]);
    select(store, [{ kind: 'shape', id: 'r1' }]);
    const se = host.querySelector('.shape-handle[data-role="se"]') as SVGRectElement;
    se.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', button: 0, clientX: 160, clientY: 140, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 260, clientY: 240, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', button: 0, clientX: 260, clientY: 240, bubbles: true }));
    const sh = store.get().frames[0]!.shapes[0]!;
    expect(sh.w).toBe(160); // 260 - 100
    expect(sh.h).toBe(140); // 240 - 100
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(store.get().frames[0]!.shapes[0]!.w).toBe(60);
  });
});

describe('computeResize', () => {
  const boxBefore = { x: 100, y: 100, w: 60, h: 40 };

  it('se corner grows width/height from the top-left', () => {
    expect(computeResize({ id: 'r1', kind: 'square', role: 'se', before: boxBefore }, { x: 200, y: 180 }))
      .toEqual({ x: 100, y: 100, w: 100, h: 80 });
  });

  it('nw corner shifts x/y and shrinks toward the bottom-right', () => {
    expect(computeResize({ id: 'r1', kind: 'square', role: 'nw', before: boxBefore }, { x: 120, y: 110 }))
      .toEqual({ x: 120, y: 110, w: 40, h: 30 });
  });

  it('e edge only touches width', () => {
    expect(computeResize({ id: 'r1', kind: 'square', role: 'e', before: boxBefore }, { x: 250, y: 999 }))
      .toEqual({ x: 100, y: 100, w: 150, h: 40 });
  });

  it('clamps box dimensions to the minimum', () => {
    const out = computeResize({ id: 'r1', kind: 'square', role: 'se', before: boxBefore }, { x: 101, y: 101 });
    expect(out.w).toBe(8);
    expect(out.h).toBe(8);
  });

  it('line end handle moves the end (w/h are deltas)', () => {
    expect(computeResize({ id: 'l1', kind: 'line', role: 'end', before: { x: 400, y: 400, w: 80, h: 20 } }, { x: 600, y: 450 }))
      .toEqual({ w: 200, h: 50 });
  });

  it('line start handle moves the start and keeps the end pinned', () => {
    // end was at (480, 420); moving start to (410, 405) -> w=70, h=15
    expect(computeResize({ id: 'l1', kind: 'arrow', role: 'start', before: { x: 400, y: 400, w: 80, h: 20 } }, { x: 410, y: 405 }))
      .toEqual({ x: 410, y: 405, w: 70, h: 15 });
  });
});

describe('ShapeHandlesLayer - touch handle sizing', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let layer: ShapeHandlesLayer;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = makeStore();
    history = createHistory(store);
    // touchEdit = true: the compact viewer's enlarged handles.
    layer = new ShapeHandlesLayer(host, store, history, { w: 1920, h: 1080 }, fakeViewport, true);
    layer.mount();
    setShapes(store, [RECT]);
    select(store, [{ kind: 'shape', id: 'r1' }]);
  });

  afterEach(() => {
    layer.destroy();
    if (host.parentElement) host.parentElement.removeChild(host);
  });

  function seWidth(): number {
    return Number((host.querySelector('.shape-handle[data-role="se"]') as SVGRectElement).getAttribute('width'));
  }

  it('holds a constant screen size as zoom changes', () => {
    // The overlay scales with the map, so a fixed map-unit size shrank on screen:
    // 40 map units is 8px at the portrait fit zoom of 0.203, which is not a
    // grabbable handle. Sized in screen px, the map-unit size has to grow as zoom
    // shrinks so the on-screen size stays put.
    store._apply({ zoom: 1 });
    const atOne = seWidth();
    store._apply({ zoom: 0.5 });
    expect(seWidth()).toBeCloseTo(atOne * 2, 4);
    store._apply({ zoom: 0.2 });
    expect(seWidth()).toBeCloseTo(atOne * 5, 4);
  });

  it('is 44 screen px, and stays centred on its corner', () => {
    store._apply({ zoom: 0.5 });
    const se = host.querySelector('.shape-handle[data-role="se"]') as SVGRectElement;
    const size = Number(se.getAttribute('width'));
    expect(size * 0.5).toBeCloseTo(44, 4);
    expect(Number(se.getAttribute('x'))).toBeCloseTo(100 + 60 - size / 2, 4);
    expect(Number(se.getAttribute('y'))).toBeCloseTo(100 + 40 - size / 2, 4);
  });

  it('leaves the desktop handle size alone', () => {
    const desktopHost = document.createElement('div');
    document.body.appendChild(desktopHost);
    const desktop = new ShapeHandlesLayer(desktopHost, store, history, { w: 1920, h: 1080 }, fakeViewport);
    desktop.mount();
    store._apply({ zoom: 0.5 });
    const se = desktopHost.querySelector('.shape-handle[data-role="se"]') as SVGRectElement;
    expect(Number(se.getAttribute('width'))).toBe(14);
    desktop.destroy();
    desktopHost.remove();
  });
});
