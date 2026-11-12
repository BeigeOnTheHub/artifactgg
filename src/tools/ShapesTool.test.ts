import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShapesTool } from './ShapesTool';
import { createStore, type StratState } from '../app/store';
import { createHistory } from '../app/history';
import { emptyFrame } from '../types/primitives';
import { hex } from '../types/hex';

function makeStore() {
  const initial: StratState = {
    mapId: 'miru',
    zoom: 1, panX: 0, panY: 0,
    frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '', tool: 'shapes',
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
  return createStore(initial);
}

function fakeLayer() {
  return { setPreview: vi.fn() };
}

const fakeViewport = () => ({ left: 0, top: 0, width: 1920, height: 1080, w: 1920, h: 1080, zoom: 1, panX: 0, panY: 0 });

describe('ShapesTool', () => {
  let target: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let layer: ReturnType<typeof fakeLayer>;
  let tool: ShapesTool;

  beforeEach(() => {
    target = document.createElement('div');
    document.body.appendChild(target);
    store = makeStore();
    history = createHistory(store);
    layer = fakeLayer();
    tool = new ShapesTool({
      store, history,
      shapeLayer: layer as unknown as import('../render/ShapeLayer').ShapeLayer,
      getViewport: fakeViewport,
    });
    tool.attach(target);
  });

  it('default kind is square', () => {
    expect(tool.getKind()).toBe('square');
  });

  it('drag dispatches one shape.add with size = (end-start)', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 200, clientY: 150, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup',   { pointerId: 1, button: 0, clientX: 200, clientY: 150, bubbles: true }));
    const shapes = store.get().frames[0]!.shapes;
    expect(shapes).toHaveLength(1);
    expect(shapes[0]!.kind).toBe('square');
    expect(shapes[0]!.w).toBe(100);
    expect(shapes[0]!.h).toBe(50);
  });

  it('preview is updated during drag and cleared on up', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 150, clientY: 130, bubbles: true }));
    expect(layer.setPreview).toHaveBeenCalled();
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 150, clientY: 130, bubbles: true }));
    expect(layer.setPreview.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it('pointerdown does not preview a default shape (no cut when the drag starts)', () => {
    tool.setKind('arrow');
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    // Nothing is previewed on the bare press, so a following drag grows the
    // real shape from the start instead of jumping down from a big default.
    expect(layer.setPreview.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it('a sub-threshold move previews nothing (still a click)', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 100, clientY: 100, bubbles: true }));
    expect(layer.setPreview.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it('a real drag previews the live shape growing from the start, not a default', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 110, bubbles: true }));
    const small = layer.setPreview.mock.calls.at(-1)?.[0] as { w: number; h: number };
    expect(small.w).toBe(20);
    expect(small.h).toBe(10);
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 200, clientY: 180, bubbles: true }));
    const big = layer.setPreview.mock.calls.at(-1)?.[0] as { w: number; h: number };
    // It keeps growing with the cursor - never snaps back to the 60x60 default.
    expect(big.w).toBe(100);
    expect(big.h).toBe(80);
  });

  it('setKind switches the next placement', () => {
    tool.setKind('circle');
    expect(tool.getKind()).toBe('circle');
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup',   { pointerId: 1, button: 0, clientX: 140, clientY: 140, bubbles: true }));
    expect(store.get().frames[0]!.shapes[0]!.kind).toBe('circle');
  });

  it('zero-size click commits a default-sized shape centred on the click point', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup',   { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    const shapes = store.get().frames[0]!.shapes;
    expect(shapes).toHaveLength(1);
    // 60x60 square centred on (100, 100) -> top-left at (70, 70).
    expect(shapes[0]!.w).toBe(60);
    expect(shapes[0]!.h).toBe(60);
  });

  it('right-click does not start placement', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 2, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 200, clientY: 200, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup',   { pointerId: 1, button: 2, clientX: 200, clientY: 200, bubbles: true }));
    expect(store.get().frames[0]!.shapes).toHaveLength(0);
  });

  it('detach during drag clears preview', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 150, clientY: 130, bubbles: true }));
    tool.detach();
    expect(layer.setPreview.mock.calls.at(-1)?.[0]).toBeNull();
  });

  describe('ShapesTool - context panel', () => {
    it('renders 5 segmented buttons, one per ShapeKind, in a wrapping control', () => {
      const panel = tool.getContextPanel();
      const segmented = panel.querySelector('.cp-segmented') as HTMLElement;
      expect(segmented.classList.contains('cp-segmented--wrap')).toBe(true);
      const buttons = panel.querySelectorAll('.cp-segmented-btn');
      expect(buttons).toHaveLength(5);
      const kinds = Array.from(buttons).map(b => b.getAttribute('data-kind'));
      expect(kinds).toEqual(['square', 'circle', 'triangle', 'line', 'arrow']);
    });

    it('the kind matching getKind() has .active class', () => {
      tool.setKind('triangle');
      const panel = tool.getContextPanel();
      const activeButton = panel.querySelector('.cp-segmented-btn.active');
      expect(activeButton?.getAttribute('data-kind')).toBe('triangle');
    });

    it('clicking a button calls setKind and re-syncs active class', () => {
      const panel = tool.getContextPanel();
      const arrowButton = Array.from(panel.querySelectorAll('.cp-segmented-btn')).find(b => b.getAttribute('data-kind') === 'arrow');
      const squareButton = Array.from(panel.querySelectorAll('.cp-segmented-btn')).find(b => b.getAttribute('data-kind') === 'square');

      (arrowButton as HTMLElement).click();

      expect(tool.getKind()).toBe('arrow');
      expect(arrowButton?.classList.contains('active')).toBe(true);
      expect(squareButton?.classList.contains('active')).toBe(false);
    });
  });
});

describe('ShapesTool - cancel() and touch input', () => {
  let target: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let layer: ReturnType<typeof fakeLayer>;
  let tool: ShapesTool;

  beforeEach(() => {
    target = document.createElement('div');
    document.body.appendChild(target);
    store = makeStore();
    history = createHistory(store);
    layer = fakeLayer();
    tool = new ShapesTool({
      store, history,
      shapeLayer: layer as unknown as import('../render/ShapeLayer').ShapeLayer,
      getViewport: fakeViewport,
    });
    tool.attach(target);
  });

  it('drops an in-flight shape, clears the preview and dispatches nothing', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 200, clientY: 150, bubbles: true }));
    const dispatch = vi.spyOn(history, 'dispatch');
    tool.cancel();
    expect(layer.setPreview.mock.calls.at(-1)?.[0]).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
    // A subsequent pointerup must not commit the aborted shape.
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 200, clientY: 150, bubbles: true }));
    expect(store.get().frames[0]!.shapes).toHaveLength(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('is a no-op with no in-flight shape', () => {
    expect(() => tool.cancel()).not.toThrow();
  });

  it('pointercancel event routes through cancel() instead of committing the shape', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 200, clientY: 150, bubbles: true }));
    const dispatch = vi.spyOn(history, 'dispatch');
    target.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, button: 0, clientX: 200, clientY: 150, bubbles: true }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(store.get().frames[0]!.shapes).toHaveLength(0);
  });

  it('a one-finger touch drag sizes a shape', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 150, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', button: 0, clientX: 200, clientY: 150, bubbles: true }));
    const shapes = store.get().frames[0]!.shapes;
    expect(shapes).toHaveLength(1);
    expect(shapes[0]!.w).toBe(100);
    expect(shapes[0]!.h).toBe(50);
  });

  it('a touch tap without a drag drops a default-sized shape', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', button: 0, clientX: 100, clientY: 100, bubbles: true }));
    const shapes = store.get().frames[0]!.shapes;
    expect(shapes).toHaveLength(1);
    expect(shapes[0]!.w).toBe(60);
    expect(shapes[0]!.h).toBe(60);
  });
});

describe('ShapesTool - settings interface', () => {
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let layer: ReturnType<typeof fakeLayer>;
  let tool: ShapesTool;

  beforeEach(() => {
    store = makeStore();
    history = createHistory(store);
    layer = fakeLayer();
    tool = new ShapesTool({
      store, history,
      shapeLayer: layer as unknown as import('../render/ShapeLayer').ShapeLayer,
      getViewport: fakeViewport,
    });
  });

  it('getSettings reflects the current kind and thickness', () => {
    expect(tool.getSettings()).toEqual({ kind: 'square', strokeWidth: 2 });
    tool.setKind('circle');
    tool.setStrokeWidth(8);
    expect(tool.getSettings()).toEqual({ kind: 'circle', strokeWidth: 8 });
  });

  it('setSettings applies the kind and thickness', () => {
    tool.setSettings({ kind: 'arrow', strokeWidth: 6 });
    expect(tool.getKind()).toBe('arrow');
    expect(tool.getStrokeWidth()).toBe(6);
  });

  it('onSettingsChanged fires after setKind', () => {
    const cb = vi.fn();
    tool.onSettingsChanged(cb);
    tool.setKind('triangle');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('onSettingsChanged unsubscribe stops further calls', () => {
    const cb = vi.fn();
    const off = tool.onSettingsChanged(cb);
    off();
    tool.setKind('line');
    expect(cb).not.toHaveBeenCalled();
  });
});
