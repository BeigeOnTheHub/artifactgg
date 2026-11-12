import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EraseTool } from './EraseTool';
import { createStore, type StratState } from '../app/store';
import { createHistory } from '../app/history';
import { emptyFrame, type Stroke } from '../types/primitives';
import { hex } from '../types/hex';

function makeStore() {
  const initial: StratState = {
    mapId: 'miru',
    zoom: 1, panX: 0, panY: 0,
    frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '', tool: 'erase',
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

const fakeViewport = () => ({ left: 0, top: 0, width: 1920, height: 1080, w: 1920, h: 1080, zoom: 1, panX: 0, panY: 0 });

const STROKE_AT_50_50: Stroke = {
  id: 'sA', type: 'draw', color: hex('#00ff88'), alpha: 0.92, size: 4,
  points: [{ x: 50, y: 50 }, { x: 60, y: 50 }],
};
const STROKE_AT_500_500: Stroke = {
  id: 'sB', type: 'draw', color: hex('#00ff88'), alpha: 0.92, size: 4,
  points: [{ x: 500, y: 500 }, { x: 510, y: 500 }],
};

describe('EraseTool', () => {
  let target: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let layer: ReturnType<typeof fakeLayer>;
  let tool: EraseTool;

  beforeEach(() => {
    target = document.createElement('div');
    document.body.appendChild(target);
    store = makeStore();
    history = createHistory(store);
    store._apply({
      frames: [{ ...store.get().frames[0]!, strokes: [STROKE_AT_50_50, STROKE_AT_500_500] }],
    });
    layer = fakeLayer();
    tool = new EraseTool({
      store, history,
      strokeLayer: layer as unknown as import('../render/StrokeLayer').StrokeLayer,
      getViewport: fakeViewport,
    });
    tool.attach(target);
  });

  it('drag over one stroke erases only that stroke', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 50, clientY: 50, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 55, clientY: 50, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup',   { pointerId: 1, button: 0, clientX: 55, clientY: 50, bubbles: true }));
    expect(store.get().frames[0]!.strokes.map((s) => s.id)).toEqual(['sB']);
  });

  it('drag over both strokes erases both in a single command (one undo entry)', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 50, clientY: 50, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 500, clientY: 500, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup',   { pointerId: 1, button: 0, clientX: 500, clientY: 500, bubbles: true }));
    expect(store.get().frames[0]!.strokes).toHaveLength(0);
    history.undo();
    expect(store.get().frames[0]!.strokes).toHaveLength(2);
  });

  it('a fast drag erases a thin stroke it jumped over between two pointer events', () => {
    const thin: Stroke = { ...STROKE_AT_50_50, id: 'sC', size: 2, points: [{ x: 300, y: 200 }, { x: 300, y: 400 }] };
    store._apply({ frames: [{ ...store.get().frames[0]!, strokes: [thin] }] });
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 300, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 600, clientY: 300, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup',   { pointerId: 1, button: 0, clientX: 600, clientY: 300, bubbles: true }));
    expect(store.get().frames[0]!.strokes).toHaveLength(0);
  });

  it('drag through empty space erases nothing and pushes no history entry', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 1000, clientY: 1000, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup',   { pointerId: 1, button: 0, clientX: 1000, clientY: 1000, bubbles: true }));
    expect(store.get().frames[0]!.strokes).toHaveLength(2);
    expect(history.canUndo()).toBe(false);
  });

  it('preview hidden ids are cleared on pointer up', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 50, clientY: 50, bubbles: true }));
    expect(layer.setHiddenIds).toHaveBeenCalledWith(new Set(['sA']));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 55, clientY: 50, bubbles: true }));
    const lastCall = layer.setHiddenIds.mock.calls.at(-1);
    expect((lastCall?.[0] as Set<string>).size).toBe(0);
  });

  it('detach clears active session', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 50, clientY: 50, bubbles: true }));
    tool.detach();
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 55, clientY: 50, bubbles: true }));
    // After detach, no commands should be dispatched (both strokes still present):
    expect(store.get().frames[0]!.strokes).toHaveLength(2);
  });
});

describe('EraseTool - context panel', () => {
  it('returns null - the eraser size slider was removed', () => {
    const store = makeStore();
    const history = createHistory(store);
    const layer = fakeLayer();
    const tool = new EraseTool({
      store, history,
      strokeLayer: layer as unknown as import('../render/StrokeLayer').StrokeLayer,
      getViewport: fakeViewport,
    });
    expect(tool.getContextPanel()).toBeNull();
  });
});

describe('EraseTool - settings interface', () => {
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let layer: ReturnType<typeof fakeLayer>;
  let tool: EraseTool;

  beforeEach(() => {
    store = makeStore();
    history = createHistory(store);
    layer = fakeLayer();
    tool = new EraseTool({
      store, history,
      strokeLayer: layer as unknown as import('../render/StrokeLayer').StrokeLayer,
      getViewport: fakeViewport,
    });
  });

  it('getSettings reflects the current size', () => {
    expect(tool.getSettings()).toEqual({ size: 6 });
    tool.setSize(50);
    expect(tool.getSettings()).toEqual({ size: 50 });
  });

  it('setSettings clamps via setSize', () => {
    tool.setSettings({ size: 999 });
    expect(tool.getSize()).toBe(80);
    tool.setSettings({ size: 0 });
    expect(tool.getSize()).toBe(4);
  });

  it('onSettingsChanged fires after setSize', () => {
    const cb = vi.fn();
    tool.onSettingsChanged(cb);
    tool.setSize(20);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('onSettingsChanged unsubscribe stops further calls', () => {
    const cb = vi.fn();
    const off = tool.onSettingsChanged(cb);
    off();
    tool.setSize(30);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('EraseTool - cancel()', () => {
  let target: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let layer: ReturnType<typeof fakeLayer>;
  let tool: EraseTool;

  beforeEach(() => {
    target = document.createElement('div');
    document.body.appendChild(target);
    store = makeStore();
    history = createHistory(store);
    store._apply({
      frames: [{ ...store.get().frames[0]!, strokes: [STROKE_AT_50_50, STROKE_AT_500_500] }],
    });
    layer = fakeLayer();
    tool = new EraseTool({
      store, history,
      strokeLayer: layer as unknown as import('../render/StrokeLayer').StrokeLayer,
      getViewport: fakeViewport,
    });
    tool.attach(target);
  });

  it('drops the erase session, unhides strokes and dispatches nothing', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 50, clientY: 50, bubbles: true }));
    const dispatch = vi.spyOn(history, 'dispatch');
    tool.cancel();
    // The last setHiddenIds call clears the hidden set.
    expect((layer.setHiddenIds.mock.calls.at(-1)?.[0] as Set<string>).size).toBe(0);
    expect(store.get().frames[0]!.strokes).toHaveLength(2);
    // A subsequent pointerup must not erase anything.
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 55, clientY: 50, bubbles: true }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(store.get().frames[0]!.strokes).toHaveLength(2);
  });

  it('is a no-op with no active session', () => {
    expect(() => tool.cancel()).not.toThrow();
  });

  it('pointercancel event routes through cancel() instead of committing the erase', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 50, clientY: 50, bubbles: true }));
    const dispatch = vi.spyOn(history, 'dispatch');
    target.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, button: 0, clientX: 55, clientY: 50, bubbles: true }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(store.get().frames[0]!.strokes).toHaveLength(2);
  });
});
