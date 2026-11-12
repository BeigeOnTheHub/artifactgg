import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type StratState } from './store';
import { apply } from './commands';
import { ViewportController, clampZoom, anchoredZoomPan, pinchTransform, fitZoomFor, compactViewZoom, MIN_ZOOM, MAX_ZOOM, STANDARD_ZOOM_100 } from './viewport';
import { clientToMap, type Viewport } from '../render/coords';
import { emptyFrame } from '../types/primitives';
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

describe('clampZoom', () => {
  it('clamps below min', () => { expect(clampZoom(0.01)).toBe(MIN_ZOOM); });
  it('clamps above max', () => { expect(clampZoom(999)).toBe(MAX_ZOOM); });
  it('passes valid through', () => { expect(clampZoom(2.5)).toBe(2.5); });
});

describe('ViewportController', () => {
  let target: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let vc: ViewportController;

  beforeEach(() => {
    target = document.createElement('div');
    Object.defineProperty(target, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(target, 'clientHeight', { value: 600, configurable: true });
    document.body.appendChild(target);
    store = makeStore();
    vc = new ViewportController(target, store);
    vc.attach();
  });

  it('a map switch fits the whole map to this viewer', () => {
    target.getBoundingClientRect = () => ({ width: 960, height: 400 }) as DOMRect;
    apply(store, { t: 'map.select', mapId: store.get().mapId === 'suna' ? 'miru' : 'suna' });
    expect(store.get().zoom).toBeCloseTo(fitZoomFor(960, 400), 10);
  });

  it('wheel up applies a higher zoom directly to the store (no history entry)', () => {
    target.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    expect(store.get().zoom).toBeGreaterThan(1);
  });

  it('a horizontal-only wheel (trackpad swipe) does not zoom', () => {
    target.dispatchEvent(new WheelEvent('wheel', { deltaX: 100, deltaY: 0, bubbles: true, cancelable: true }));
    expect(store.get().zoom).toBe(1);
  });

  it('wheel down at zoom 1 zooms below 1 - the 100% floor was removed', () => {
    target.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
    expect(store.get().zoom).toBeLessThan(1);
    expect(store.get().zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
  });

  it('middle-mouse drag pans by the cumulative delta and bypasses history', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 1, clientX: 100, clientY: 100, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, clientX: 150, clientY: 130, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 1, clientX: 150, clientY: 130, bubbles: true,
    }));
    expect(store.get().panX).toBe(50);
    expect(store.get().panY).toBe(30);
  });

  it('pointercancel mid-pan snaps pan back to its pre-drag origin', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 1, clientX: 100, clientY: 100, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, clientX: 220, clientY: 180, bubbles: true,
    }));
    expect(store.get().panX).toBe(120);
    expect(store.get().panY).toBe(80);
    target.dispatchEvent(new PointerEvent('pointercancel', {
      pointerId: 1, button: 1, clientX: 220, clientY: 180, bubbles: true,
    }));
    expect(store.get().panX).toBe(0);
    expect(store.get().panY).toBe(0);
  });

  it('left-mouse press is ignored (left button is for tools)', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, clientX: 200, clientY: 200, bubbles: true,
    }));
    expect(store.get().panX).toBe(0);
  });

  it('detach removes listeners - wheel after detach has no effect', () => {
    vc.detach();
    target.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    expect(store.get().zoom).toBe(1);
  });

  it('zoomIn / zoomOut step the zoom by one wheel notch (1.1x) around the viewer centre', () => {
    Object.defineProperty(target, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    });
    vc.zoomIn();
    expect(store.get().zoom).toBeCloseTo(1.1, 6);
    vc.zoomOut();
    expect(store.get().zoom).toBeCloseTo(1.0, 6);
    vc.zoomOut();
    expect(store.get().zoom).toBeCloseTo(1 / 1.1, 6);
  });

  it('zoomIn / zoomOut clamp at the MIN_ZOOM / MAX_ZOOM bounds', () => {
    Object.defineProperty(target, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    });
    store._apply({ zoom: MAX_ZOOM });
    vc.zoomIn();
    expect(store.get().zoom).toBe(MAX_ZOOM);
    store._apply({ zoom: MIN_ZOOM });
    vc.zoomOut();
    expect(store.get().zoom).toBe(MIN_ZOOM);
  });

  it('resetView falls back to zoomFit when markInitialView has not run yet', () => {
    Object.defineProperty(target, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    });
    store._apply({ zoom: 5, panX: 200, panY: -50 });
    vc.resetView();
    // zoomFit centres pan and sets zoom to the fit for an 800x600 viewer.
    expect(store.get().panX).toBe(0);
    expect(store.get().panY).toBe(0);
    expect(store.get().zoom).not.toBe(5);
  });

  it('markInitialView captures the current view; resetView restores it', () => {
    Object.defineProperty(target, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    });
    store._apply({ zoom: 0.75, panX: 30, panY: -10 });
    vc.markInitialView();
    store._apply({ zoom: 3, panX: 400, panY: 200 });
    vc.resetView();
    expect(store.get().zoom).toBe(0.75);
    expect(store.get().panX).toBe(30);
    expect(store.get().panY).toBe(-10);
  });
});

describe('ViewportController - cursor-anchored wheel zoom', () => {
  function makeViewer(width: number, height: number): HTMLDivElement {
    const el = document.createElement('div');
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }),
    });
    document.body.appendChild(el);
    return el;
  }
  function vp(width: number, height: number, zoom: number, panX: number, panY: number): Viewport {
    return { left: 0, top: 0, width, height, w: 1920, h: 1080, zoom, panX, panY };
  }

  it('keeps the map point under the cursor fixed when wheeling', () => {
    const store = makeStore();
    const viewer = makeViewer(1000, 1000);
    const vc = new ViewportController(viewer, store);
    vc.attach();

    const before = clientToMap(750, 500, vp(1000, 1000, 1, 0, 0));
    viewer.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 750, clientY: 500, bubbles: true, cancelable: true }));
    const s = store.get();
    expect(s.zoom).toBeCloseTo(1.1, 6);
    const after = clientToMap(750, 500, vp(1000, 1000, s.zoom, s.panX, s.panY));
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
  });

  it('respects an existing pan when re-anchoring', () => {
    const store = makeStore();
    store._apply({ panX: 120, panY: -60 });
    const viewer = makeViewer(800, 600);
    const vc = new ViewportController(viewer, store);
    vc.attach();

    const before = clientToMap(300, 420, vp(800, 600, 1, 120, -60));
    viewer.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, clientX: 300, clientY: 420, bubbles: true, cancelable: true }));
    const s = store.get();
    expect(s.zoom).toBeLessThan(1);
    const after = clientToMap(300, 420, vp(800, 600, s.zoom, s.panX, s.panY));
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
  });
});

describe('anchoredZoomPan', () => {
  it('keeps the anchor point invariant across a zoom', () => {
    const r = anchoredZoomPan({ zoom: 1, panX: 0, panY: 0 }, 2, 100, 50, 800, 600);
    // panX' = k*panX + (1-k)*(cx - w/2), k = next/cur = 2
    expect(r.panX).toBeCloseTo(2 * 0 + (1 - 2) * (100 - 400));
    expect(r.panY).toBeCloseTo(2 * 0 + (1 - 2) * (50 - 300));
    expect(r.zoom).toBe(2);
  });

  it('scales the existing pan by k as well as anchoring', () => {
    // cur = { zoom: 1, panX: 100, panY: -50 }, nextZoom = 2, cursor (100,50), viewer 800x600
    // k = 2; panX' = 2*100 + (1-2)*(100-400) = 200 + 300 = 500
    //       panY' = 2*(-50) + (1-2)*(50-300) = -100 + 250 = 150
    const r = anchoredZoomPan({ zoom: 1, panX: 100, panY: -50 }, 2, 100, 50, 800, 600);
    expect(r.panX).toBeCloseTo(500);
    expect(r.panY).toBeCloseTo(150);
    expect(r.zoom).toBe(2);
  });
});

describe('ViewportController.zoomFit / zoomTo100', () => {
  function makeViewer(width: number, height: number): HTMLDivElement {
    const el = document.createElement('div');
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }),
    });
    document.body.appendChild(el);
    return el;
  }

  it('zoomTo100 snaps to the standard 100% reference and recentres pan', () => {
    const store = makeStore();
    store._apply({ zoom: 4, panX: 200, panY: -50 });
    const viewer = makeViewer(1920, 1080);
    const ctl = new ViewportController(viewer, store);
    ctl.zoomTo100();
    expect(store.get().zoom).toBe(STANDARD_ZOOM_100);
    expect(store.get().panX).toBe(0);
    expect(store.get().panY).toBe(0);
  });

  it('zoomFit shrinks small viewers below 1.0 to fit the whole map', () => {
    const store = makeStore();
    // 960x540 viewer fits the 1920x1080 map at 0.5.
    const viewer = makeViewer(960, 540);
    const ctl = new ViewportController(viewer, store);
    ctl.zoomFit();
    expect(store.get().zoom).toBe(0.5);

    // Viewers larger than 1920x1080 still fit-zoom in (up to MAX_ZOOM).
    const store2 = makeStore();
    const viewer2 = makeViewer(3840, 2160);
    const ctl2 = new ViewportController(viewer2, store2);
    ctl2.zoomFit();
    expect(store2.get().zoom).toBe(2);
  });
});

describe('pinchTransform', () => {
  const W = 390, H = 844;
  const start = { dist: 100, midX: 195, midY: 422, zoom: 0.5, panX: 0, panY: 0 };

  it('translates by the midpoint delta when the separation is unchanged', () => {
    // Two fingers moving together. This is the case that did nothing before:
    // applyPinch fed anchoredZoomPan alone, which only compensates pan for a
    // change of zoom, so a same-direction drag left the pan where it was.
    const r = pinchTransform(start, 100, 195 + 80, 422 + 60, W, H);
    expect(r.zoom).toBeCloseTo(0.5, 6);
    expect(r.panX).toBeCloseTo(80, 6);
    expect(r.panY).toBeCloseTo(60, 6);
  });

  it('agrees with anchoredZoomPan when the midpoint does not move', () => {
    const r = pinchTransform(start, 200, 195, 422, W, H);
    const a = anchoredZoomPan({ zoom: 0.5, panX: 0, panY: 0 }, 1.0, 195, 422, W, H);
    expect(r.zoom).toBeCloseTo(1.0, 6);
    expect(r.panX).toBeCloseTo(a.panX, 6);
    expect(r.panY).toBeCloseTo(a.panY, 6);
  });

  it('keeps the anchored map point under the moving midpoint while zooming', () => {
    const r = pinchTransform(start, 150, 245, 462, W, H);
    const tx0 = (W - 1920 * start.zoom) / 2 + start.panX;
    const ty0 = (H - 1080 * start.zoom) / 2 + start.panY;
    const mapX = (start.midX - tx0) / start.zoom;
    const mapY = (start.midY - ty0) / start.zoom;
    expect(mapX * r.zoom + (W - 1920 * r.zoom) / 2 + r.panX).toBeCloseTo(245, 6);
    expect(mapY * r.zoom + (H - 1080 * r.zoom) / 2 + r.panY).toBeCloseTo(462, 6);
  });

  it('clamps zoom at both limits', () => {
    expect(pinchTransform({ ...start, zoom: MAX_ZOOM }, 400, 195, 422, W, H).zoom).toBe(MAX_ZOOM);
    expect(pinchTransform({ ...start, zoom: MIN_ZOOM }, 1, 195, 422, W, H).zoom).toBe(MIN_ZOOM);
  });

  it('does not divide by a zero starting separation', () => {
    const r = pinchTransform({ ...start, dist: 0 }, 50, 195, 422, W, H);
    expect(r.zoom).toBe(start.zoom);
    expect(Number.isFinite(r.panX)).toBe(true);
    expect(Number.isFinite(r.panY)).toBe(true);
  });
});

describe('compactViewZoom', () => {
  // The compact default view. Portrait booted to plain fit, which for a 16:9 map
  // in a 9:19.5 window is width-limited: 390x219 in a 735px clear band, about a
  // quarter of the height, with everything on it too small to read.
  it('doubles fit in portrait', () => {
    expect(compactViewZoom(390, 844)).toBeCloseTo(fitZoomFor(390, 844) * 2, 6);
    expect(compactViewZoom(390, 844)).toBeCloseTo(0.40625, 6);
  });

  it('is a no-op in landscape', () => {
    // The whole reason there is no orientation branch: sideways the map is
    // already height-limited, so the cap and plain fit are the same number and
    // the doubling never applies.
    expect(compactViewZoom(844, 390)).toBeCloseTo(fitZoomFor(844, 390), 6);
    expect(compactViewZoom(844, 390)).toBeCloseTo(390 / 1080, 6);
  });

  it('never zooms past filling the height', () => {
    for (const [w, h] of [[390, 844], [844, 390], [768, 1024], [1024, 768], [320, 900]]) {
      expect(compactViewZoom(w!, h!)).toBeLessThanOrEqual(h! / 1080 + 1e-9);
    }
  });

  it('never returns less than plain fit', () => {
    for (const [w, h] of [[390, 844], [844, 390], [768, 1024], [1024, 768]]) {
      expect(compactViewZoom(w!, h!)).toBeGreaterThanOrEqual(fitZoomFor(w!, h!) - 1e-9);
    }
  });

  it('leaves a degenerate rect alone rather than returning 0 or NaN', () => {
    expect(Number.isFinite(compactViewZoom(0, 0))).toBe(true);
    expect(compactViewZoom(0, 0)).toBeGreaterThan(0);
  });
});
