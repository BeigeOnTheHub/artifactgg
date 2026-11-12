import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DrawTool } from './DrawTool';
import { createStore, type StratState } from '../app/store';
import { createHistory } from '../app/history';
import { emptyFrame } from '../types/primitives';
import { hex } from '../types/hex';

function makeStore() {
  const initial: StratState = {
    mapId: 'miru',
    zoom: 1, panX: 0, panY: 0,
    frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '', tool: 'draw',
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
  return createStore(initial);
}

function fakeLayer() {
  return {
    setPreview: vi.fn(),
    setHiddenIds: vi.fn(),
    getHiddenIds: () => new Set<string>(),
  };
}

function fakeViewport(): { left: number; top: number; width: number; height: number; w: number; h: number; zoom: number; panX: number; panY: number } {
  return { left: 0, top: 0, width: 800, height: 600, w: 1920, h: 1080, zoom: 1, panX: 0, panY: 0 };
}

describe('DrawTool', () => {
  let target: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let layer: ReturnType<typeof fakeLayer>;
  let tool: DrawTool;

  beforeEach(() => {
    target = document.createElement('div');
    document.body.appendChild(target);
    store = makeStore();
    history = createHistory(store);
    layer = fakeLayer();
    tool = new DrawTool({
      store, history,
      strokeLayer: layer as unknown as import('../render/StrokeLayer').StrokeLayer,
      getViewport: fakeViewport,
    });
    tool.attach(target);
  });

  it('pointer down -> move -> up commits one stroke.add to history', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 110, clientY: 105, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 110, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup',   { pointerId: 1, button: 0, clientX: 120, clientY: 110, bubbles: true }));
    const strokes = store.get().frames[0]!.strokes;
    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.points.length).toBeGreaterThanOrEqual(3); // start + 2 moves + end-coalesce
  });

  it('a committed stroke carries the chosen dash style', () => {
    tool.setDash('dashed');
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 110, clientY: 105, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup',   { pointerId: 1, button: 0, clientX: 110, clientY: 105, bubbles: true }));
    expect(store.get().frames[0]!.strokes[0]!.dash).toBe('dashed');
  });

  it('a solid stroke does not carry a dash field', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup',   { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    expect(store.get().frames[0]!.strokes[0]!.dash).toBeUndefined();
  });

  it('preview is updated during move and cleared on up', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    expect(layer.setPreview).toHaveBeenCalled();
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 110, clientY: 105, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup',   { pointerId: 1, button: 0, clientX: 110, clientY: 105, bubbles: true }));
    // Final call should be setPreview(null):
    const lastCall = layer.setPreview.mock.calls.at(-1);
    expect(lastCall?.[0]).toBeNull();
  });

  it('press on a textbox / handle / scanner overlay does NOT start a stroke', () => {
    for (const cls of ['tbox', 'tbox-handle', 'shape-handle', 'scanner-el']) {
      const overlay = document.createElement('div');
      overlay.className = cls;
      target.appendChild(overlay);
      overlay.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
      overlay.dispatchEvent(new PointerEvent('pointerup',   { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
      overlay.remove();
    }
    expect(store.get().frames[0]!.strokes).toHaveLength(0);
  });

  it('right-click does not start a stroke', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 2, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup',   { pointerId: 1, button: 2, clientX: 100, clientY: 100, bubbles: true }));
    expect(store.get().frames[0]!.strokes).toHaveLength(0);
  });

  it('stroke uses the active colour slot', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup',   { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    const stroke = store.get().frames[0]!.strokes[0]!;
    expect(stroke.color).toBe('#00ff88');
  });

  it('detach removes listeners - pointerdown after detach has no effect', () => {
    tool.detach();
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup',   { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    expect(store.get().frames[0]!.strokes).toHaveLength(0);
  });

  it('one-click (no movement) still produces a one-point stroke', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup',   { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    expect(store.get().frames[0]!.strokes).toHaveLength(1);
    expect(store.get().frames[0]!.strokes[0]!.points).toHaveLength(1);
  });
});

describe('DrawTool - context panel', () => {
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let layer: ReturnType<typeof fakeLayer>;
  let tool: DrawTool;

  beforeEach(() => {
    store = makeStore();
    history = createHistory(store);
    layer = fakeLayer();
    tool = new DrawTool({
      store, history,
      strokeLayer: layer as unknown as import('../render/StrokeLayer').StrokeLayer,
      getViewport: fakeViewport,
    });
  });

  it('getContextPanel returns a slider with current size, max 100', () => {
    tool.setSize(7);
    const panel = tool.getContextPanel();
    expect(panel).not.toBeNull();
    const slider = panel!.querySelector('.cp-slider') as HTMLInputElement;
    expect(slider).not.toBeNull();
    expect(slider.type).toBe('range');
    expect(slider.min).toBe('1');
    expect(slider.max).toBe('100');
    expect(slider.value).toBe('7');
  });

  it('moving the slider calls setSize and updates the value field', () => {
    tool.setSize(5);
    const panel = tool.getContextPanel();
    const slider = panel!.querySelector('.cp-slider') as HTMLInputElement;
    const valueInput = panel!.querySelector('.cp-value-input') as HTMLInputElement;

    slider.value = '12';
    slider.dispatchEvent(new Event('input', { bubbles: true }));

    expect(tool.getSize()).toBe(12);
    expect(valueInput.value).toBe('12');
  });

  it('typing in the value field drives the size and snaps the slider', () => {
    tool.setSize(5);
    const panel = tool.getContextPanel();
    const slider = panel!.querySelector('.cp-slider') as HTMLInputElement;
    const valueInput = panel!.querySelector('.cp-value-input') as HTMLInputElement;

    valueInput.value = '77';
    valueInput.dispatchEvent(new Event('change', { bubbles: true }));
    expect(tool.getSize()).toBe(77);
    expect(slider.value).toBe('77');

    // Out-of-range / nonsense input clamps and snaps back.
    valueInput.value = '999';
    valueInput.dispatchEvent(new Event('change', { bubbles: true }));
    expect(tool.getSize()).toBe(100);
    expect(valueInput.value).toBe('100');

    valueInput.value = 'abc';
    valueInput.dispatchEvent(new Event('change', { bubbles: true }));
    expect(tool.getSize()).toBe(100);
    expect(valueInput.value).toBe('100');
  });
});

describe('DrawTool - brush slider sync', () => {
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let layer: ReturnType<typeof fakeLayer>;
  let tool: DrawTool;

  beforeEach(() => {
    store = makeStore();
    history = createHistory(store);
    layer = fakeLayer();
    tool = new DrawTool({
      store, history,
      strokeLayer: layer as unknown as import('../render/StrokeLayer').StrokeLayer,
      getViewport: fakeViewport,
    });
  });

  it('setSize after getContextPanel updates the rendered slider and value field', () => {
    const panel = tool.getContextPanel();
    document.body.appendChild(panel);

    const slider = panel.querySelector<HTMLInputElement>('.cp-slider');
    const valueInput = panel.querySelector<HTMLInputElement>('.cp-value-input');
    expect(slider?.value).toBe('4');
    expect(valueInput?.value).toBe('4');

    tool.setSize(12);
    expect(slider?.value).toBe('12');
    expect(valueInput?.value).toBe('12');

    document.body.removeChild(panel);
  });

  it('setSize after detach does NOT throw on null refs', () => {
    const panel = tool.getContextPanel();
    document.body.appendChild(panel);
    const target = document.createElement('div');
    document.body.appendChild(target);
    tool.attach(target);
    tool.detach();
    expect(() => tool.setSize(20)).not.toThrow();
    document.body.removeChild(panel);
    document.body.removeChild(target);
  });
});

describe('DrawTool - settings interface', () => {
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let layer: ReturnType<typeof fakeLayer>;
  let tool: DrawTool;

  beforeEach(() => {
    store = makeStore();
    history = createHistory(store);
    layer = fakeLayer();
    tool = new DrawTool({
      store, history,
      strokeLayer: layer as unknown as import('../render/StrokeLayer').StrokeLayer,
      getViewport: fakeViewport,
    });
  });

  it('getSettings reflects the current size', () => {
    expect(tool.getSettings()).toEqual({ size: 4, dash: 'solid' });
    tool.setSize(20);
    expect(tool.getSettings()).toEqual({ size: 20, dash: 'solid' });
  });

  it('getSettings carries the dash style and setSettings restores it', () => {
    tool.setDash('dotted');
    expect(tool.getSettings()).toEqual({ size: 4, dash: 'dotted' });
    const fresh = new DrawTool({
      store, history,
      strokeLayer: layer as unknown as import('../render/StrokeLayer').StrokeLayer,
      getViewport: fakeViewport,
    });
    fresh.setSettings({ size: 12, dash: 'dashed' });
    expect(fresh.getDash()).toBe('dashed');
    expect(fresh.getSize()).toBe(12);
  });

  it('setDash fires onSettingsChanged and ignores an unknown value', () => {
    const cb = vi.fn();
    tool.onSettingsChanged(cb);
    tool.setDash('dashed');
    expect(cb).toHaveBeenCalledTimes(1);
    tool.setDash('zigzag' as unknown as import('../types/primitives').DashStyle);
    expect(tool.getDash()).toBe('dashed');
  });

  it('setSettings applies size via the same clamping as setSize', () => {
    tool.setSettings({ size: 999 });
    expect(tool.getSize()).toBe(100); // MAX_BRUSH_SIZE
    tool.setSettings({ size: -5 });
    expect(tool.getSize()).toBe(1); // MIN_BRUSH_SIZE
  });

  it('onSettingsChanged fires after setSize', () => {
    const cb = vi.fn();
    tool.onSettingsChanged(cb);
    tool.setSize(8);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('onSettingsChanged unsubscribe stops further calls', () => {
    const cb = vi.fn();
    const off = tool.onSettingsChanged(cb);
    off();
    tool.setSize(10);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('DrawTool - cancel()', () => {
  let target: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let layer: ReturnType<typeof fakeLayer>;
  let tool: DrawTool;

  beforeEach(() => {
    target = document.createElement('div');
    document.body.appendChild(target);
    store = makeStore();
    history = createHistory(store);
    layer = fakeLayer();
    tool = new DrawTool({
      store, history,
      strokeLayer: layer as unknown as import('../render/StrokeLayer').StrokeLayer,
      getViewport: fakeViewport,
    });
    tool.attach(target);
  });

  it('drops an in-flight stroke, clears the preview and dispatches nothing', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 110, clientY: 105, bubbles: true }));
    const dispatch = vi.spyOn(history, 'dispatch');
    tool.cancel();
    expect(layer.setPreview.mock.calls.at(-1)?.[0]).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
    // A subsequent pointerup must not commit the aborted stroke.
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 110, clientY: 105, bubbles: true }));
    expect(store.get().frames[0]!.strokes).toHaveLength(0);
  });

  it('is a no-op with no in-flight stroke', () => {
    expect(() => tool.cancel()).not.toThrow();
  });

  it('pointercancel event routes through cancel() instead of committing the stroke', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 110, clientY: 105, bubbles: true }));
    const dispatch = vi.spyOn(history, 'dispatch');
    target.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, button: 0, clientX: 110, clientY: 105, bubbles: true }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(store.get().frames[0]!.strokes).toHaveLength(0);
  });
});
