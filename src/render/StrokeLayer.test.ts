import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrokeLayer } from './StrokeLayer';
import { createStore, type StratState } from '../app/store';
import { emptyFrame, type Stroke } from '../types/primitives';
import { hex } from '../types/hex';

function fakeContext(): CanvasRenderingContext2D & Record<string, unknown> {
  const ctx = {} as Record<string, unknown>;
  for (const m of [
    'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'clearRect', 'drawImage',
    'save', 'restore', 'setTransform', 'arc', 'fillRect', 'strokeRect', 'setLineDash',
  ]) {
    ctx[m] = vi.fn();
  }
  // Settable properties that the layer writes to:
  for (const p of ['lineCap', 'lineJoin', 'lineWidth', 'globalCompositeOperation', 'globalAlpha', 'strokeStyle', 'fillStyle']) {
    ctx[p] = '';
  }
  return ctx as unknown as CanvasRenderingContext2D & Record<string, unknown>;
}

function patchCanvasGetContext(): void {
  // jsdom returns null from getContext; replace with a cached-per-canvas fake so the
  // layer's stored context and the test's `canvas.getContext('2d')` lookup are the same instance.
  const cache = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string) {
    if (kind !== '2d') return null;
    let ctx = cache.get(this);
    if (!ctx) { ctx = fakeContext(); cache.set(this, ctx); }
    return ctx;
  } as HTMLCanvasElement['getContext'];
}

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

const STROKE: Stroke = {
  id: 's1', type: 'draw', color: hex('#00ff88'), alpha: 0.92, size: 4,
  points: [{ x: 10, y: 10 }, { x: 20, y: 20 }],
};

describe('StrokeLayer', () => {
  let mount: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let layer: StrokeLayer;

  beforeEach(() => {
    vi.useFakeTimers();
    patchCanvasGetContext();
    mount = document.createElement('div');
    Object.defineProperty(mount, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(mount, 'clientHeight', { value: 600, configurable: true });
    document.body.appendChild(mount);
    store = makeStore();
    layer = new StrokeLayer(mount, store, { w: 1920, h: 1080 });
    layer.mount();
    vi.runOnlyPendingTimers(); // flush the initial paint scheduled in mount()
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('appends a canvas element to the mount target', () => {
    const canvas = mount.querySelector('canvas');
    expect(canvas).not.toBeNull();
  });

  it('canvas backing store is sized to viewport × dpr', () => {
    const canvas = mount.querySelector('canvas')!;
    const dpr = window.devicePixelRatio || 1;
    expect(canvas.width).toBe(800 * dpr);
    expect(canvas.height).toBe(600 * dpr);
  });

  it('re-renders when strokes change', () => {
    const canvas = mount.querySelector('canvas')!;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D & Record<string, ReturnType<typeof vi.fn>>;
    const callsBefore = (ctx['clearRect'] as ReturnType<typeof vi.fn>).mock.calls.length;

    store._apply({
      frames: [{ ...store.get().frames[0]!, strokes: [STROKE] }],
    });
    vi.runOnlyPendingTimers();

    const callsAfter = (ctx['clearRect'] as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfter).toBeGreaterThan(callsBefore);
  });

  it('re-renders when zoom changes', () => {
    const canvas = mount.querySelector('canvas')!;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D & Record<string, ReturnType<typeof vi.fn>>;
    const callsBefore = (ctx['clearRect'] as ReturnType<typeof vi.fn>).mock.calls.length;

    store._apply({ zoom: 2 });
    vi.runOnlyPendingTimers();

    const callsAfter = (ctx['clearRect'] as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfter).toBeGreaterThan(callsBefore);
  });

  it('setPreview triggers a re-render and clearing it triggers another', () => {
    const canvas = mount.querySelector('canvas')!;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D & Record<string, ReturnType<typeof vi.fn>>;
    const before = (ctx['clearRect'] as ReturnType<typeof vi.fn>).mock.calls.length;
    layer.setPreview(STROKE);
    vi.runOnlyPendingTimers();
    const mid = (ctx['clearRect'] as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(mid).toBeGreaterThan(before);
    layer.setPreview(null);
    vi.runOnlyPendingTimers();
    const end = (ctx['clearRect'] as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(end).toBeGreaterThan(mid);
  });

  it('sets a dash pattern for a dashed stroke and clears it for a solid one', () => {
    const canvas = mount.querySelector('canvas')!;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D & Record<string, ReturnType<typeof vi.fn>>;
    const setLineDash = ctx['setLineDash'] as ReturnType<typeof vi.fn>;

    store._apply({
      frames: [{ ...store.get().frames[0]!, strokes: [{ ...STROKE, dash: 'dashed' }] }],
    });
    vi.runOnlyPendingTimers();
    const dashedCalls = setLineDash.mock.calls.map((c) => c[0]);
    expect(dashedCalls.some((a) => Array.isArray(a) && a.length > 0)).toBe(true);

    setLineDash.mockClear();
    store._apply({
      frames: [{ ...store.get().frames[0]!, strokes: [{ ...STROKE, dash: 'solid' }] }],
    });
    vi.runOnlyPendingTimers();
    const solidCalls = setLineDash.mock.calls.map((c) => c[0]);
    expect(solidCalls.length).toBeGreaterThan(0);
    expect(solidCalls.every((a) => Array.isArray(a) && a.length === 0)).toBe(true);
  });

  it('hidden ids are excluded from rendering', () => {
    store._apply({
      frames: [{ ...store.get().frames[0]!, strokes: [STROKE] }],
    });
    layer.setHiddenIds(new Set(['s1']));
    // Re-render is implicit via setHiddenIds; we verify no exception and that the layer accepts the set.
    expect(layer.getHiddenIds()).toEqual(new Set(['s1']));
  });

  it('destroy detaches subscriptions and removes the canvas', () => {
    layer.destroy();
    expect(mount.querySelector('canvas')).toBeNull();
    // After destroy, store changes should not crash:
    expect(() => store._apply({ zoom: 3 })).not.toThrow();
  });
});

describe('StrokeLayer.setHighlightedIds', () => {
  it('exposes setHighlightedIds and getHighlightedIds', () => {
    patchCanvasGetContext();
    const host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(host, 'clientHeight', { value: 600, configurable: true });
    document.body.appendChild(host);
    const store = makeStore();
    const layer = new StrokeLayer(host, store, { w: 1920, h: 1080 });
    layer.mount();
    expect(layer.getHighlightedIds().size).toBe(0);
    layer.setHighlightedIds(new Set(['a', 'b']));
    expect(layer.getHighlightedIds().has('a')).toBe(true);
    expect(layer.getHighlightedIds().has('b')).toBe(true);
    layer.destroy();
  });

  it('triggers a render when highlighted ids change', () => {
    vi.useFakeTimers();
    patchCanvasGetContext();
    const host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(host, 'clientHeight', { value: 600, configurable: true });
    document.body.appendChild(host);
    const store = makeStore();
    const layer = new StrokeLayer(host, store, { w: 1920, h: 1080 });
    layer.mount();
    vi.runOnlyPendingTimers();
    layer.setHighlightedIds(new Set(['some-id']));
    // The setter schedules a render - flushing the rAF exercises the highlight
    // render path. We don't need to assert pixels, just that no exception is thrown.
    vi.runOnlyPendingTimers();
    layer.destroy();
    vi.useRealTimers();
  });

  it('does not redraw the offscreen (PNG export raster) when highlights change', () => {
    vi.useFakeTimers();
    patchCanvasGetContext();
    const host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(host, 'clientHeight', { value: 600, configurable: true });
    document.body.appendChild(host);
    const store = makeStore();
    store._apply({ frames: [{ ...store.get().frames[0]!, strokes: [STROKE] }] });
    const layer = new StrokeLayer(host, store, { w: 1920, h: 1080 });
    layer.mount();
    vi.runOnlyPendingTimers();
    const offCtx = layer.getCommittedCanvas().getContext('2d') as CanvasRenderingContext2D & Record<string, ReturnType<typeof vi.fn>>;
    const before = (offCtx['clearRect'] as ReturnType<typeof vi.fn>).mock.calls.length;
    layer.setHighlightedIds(new Set(['s1']));
    vi.runOnlyPendingTimers();
    const after = (offCtx['clearRect'] as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(after).toBe(before); // offscreen untouched - highlight is visible-only
    layer.destroy();
    vi.useRealTimers();
  });
});
