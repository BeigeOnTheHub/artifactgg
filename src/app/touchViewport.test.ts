import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { createStore, type StratState } from './store';
import { TouchViewportController } from './touchViewport';
import { fitZoomFor, compactViewZoom } from './viewport';
import { createHistory } from './history';
import type { Viewport } from '../render/coords';
import { hex } from '../types/hex';
import type { ToolController } from './tools';

function makeStore() {
  const s: StratState = { mapId:'miru', zoom:1, panX:0, panY:0, frames:[], activeFrameIdx:0, notes:'', tool:'cursor', colourSlots:[null,null,null,null,null], activeSlot:0, selection:[], ui:{ sidebarTab:'tools', mode:'frame', paletteOpen:false, shareOpen:false, libraryOpen:false, mapDropdownOpen:false, colourPickerOpen:false, hintsOpen:false, calloutsVisible:false, changelogOpen:false, confirmOpen:null } };
  return createStore(s);
}

describe('TouchViewportController one-finger pan', () => {
  let target: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let tc: TouchViewportController;

  beforeEach(() => {
    target = document.createElement('div');
    Object.defineProperty(target, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(target, 'clientHeight', { value: 600, configurable: true });
    (target as unknown as { setPointerCapture(id: number): void }).setPointerCapture = () => {};
    (target as unknown as { releasePointerCapture(id: number): void }).releasePointerCapture = () => {};
    document.body.appendChild(target);
    store = makeStore();
    tc = new TouchViewportController(target, store);
    tc.attach();
  });

  it('one finger drag pans by the cumulative delta', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 140, clientY: 120, bubbles: true }));
    expect(store.get().panX).toBe(40);
    expect(store.get().panY).toBe(20);
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 140, clientY: 120, bubbles: true }));
  });
});

describe('TouchViewportController 2->1 finger transition panning', () => {
  let target: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let tc: TouchViewportController;

  beforeEach(() => {
    target = document.createElement('div');
    Object.defineProperty(target, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(target, 'clientHeight', { value: 600, configurable: true });
    (target as unknown as { setPointerCapture(id: number): void }).setPointerCapture = () => {};
    (target as unknown as { releasePointerCapture(id: number): void }).releasePointerCapture = () => {};
    target.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
    document.body.appendChild(target);
    store = makeStore();
    tc = new TouchViewportController(target, store);
    tc.attach();
  });

  it('surviving finger resumes panning after second finger lifts', () => {
    // put two touch pointers down
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 200, bubbles: true }));
    // lift pointer 2, leaving pointer 1 at (100, 100)
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 200, bubbles: true }));
    const panBefore = { x: store.get().panX, y: store.get().panY };
    // move surviving pointer 1 by delta (+30, +15)
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 130, clientY: 115, bubbles: true }));
    expect(store.get().panX).toBe(panBefore.x + 30);
    expect(store.get().panY).toBe(panBefore.y + 15);
  });
});

describe('TouchViewportController pinch + double-tap + fit', () => {
  let target: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let tc: TouchViewportController;

  beforeEach(() => {
    target = document.createElement('div');
    Object.defineProperty(target, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(target, 'clientHeight', { value: 600, configurable: true });
    (target as unknown as { setPointerCapture(id: number): void }).setPointerCapture = () => {};
    (target as unknown as { releasePointerCapture(id: number): void }).releasePointerCapture = () => {};
    target.getBoundingClientRect = () => ({ left:0, top:0, width:800, height:600, right:800, bottom:600, x:0, y:0, toJSON: () => ({}) });
    document.body.appendChild(target);
    store = makeStore();
    tc = new TouchViewportController(target, store);
    tc.attach();
  });

  it('two-finger spread zooms in', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:300, clientY:300, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:2, pointerType:'touch', clientX:500, clientY:300, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId:2, pointerType:'touch', clientX:700, clientY:300, bubbles:true }));
    expect(store.get().zoom).toBeCloseTo(2);
  });

  it('resetToDefaultView centres the map at the compact default zoom', () => {
    tc.resetToDefaultView();
    // Not plain fit any more. 800x600 is width-limited for a 16:9 map, so the
    // doubling applies and the height cap binds: min(0.4167 * 2, 600/1080).
    expect(store.get().zoom).toBeCloseTo(compactViewZoom(800, 600));
    expect(store.get().zoom).toBeCloseTo(600 / 1080);
    expect(store.get().panX).toBe(0);
    expect(store.get().panY).toBe(0);
  });

  const doubleTap = (target: HTMLElement): void => {
    const tap = (): void => {
      target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:9, pointerType:'touch', clientX:400, clientY:300, bubbles:true }));
      target.dispatchEvent(new PointerEvent('pointerup', { pointerId:9, pointerType:'touch', clientX:400, clientY:300, bubbles:true }));
    };
    tap(); tap();
  };

  it('double-tap from the default view zooms OUT to the whole map', () => {
    // This is the overview escape hatch. toggleZoom compares against plain
    // fitZoomFor, so once the default overshoots fit a double-tap goes the other
    // way - which is what keeps "show me the whole map" one gesture away after
    // the default stopped being fit.
    tc.resetToDefaultView();
    const z0 = store.get().zoom;
    doubleTap(target);
    expect(store.get().zoom).toBeLessThan(z0);
    expect(store.get().zoom).toBeCloseTo(fitZoomFor(800, 600));
  });

  it('double-tap from fit zooms back in', () => {
    store._apply({ zoom: fitZoomFor(800, 600), panX: 0, panY: 0 });
    const z0 = store.get().zoom;
    doubleTap(target);
    expect(store.get().zoom).toBeGreaterThan(z0);
  });
});

describe('TouchViewportController touch editing', () => {
  let target: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let history: ReturnType<typeof createHistory>;
  let tc: TouchViewportController;

  function vp(): Viewport {
    return { left: 0, top: 0, width: 800, height: 600, w: 1920, h: 1080,
      zoom: store.get().zoom, panX: store.get().panX, panY: store.get().panY };
  }

  beforeEach(() => {
    target = document.createElement('div');
    Object.defineProperty(target, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(target, 'clientHeight', { value: 600, configurable: true });
    (target as unknown as { setPointerCapture(id: number): void }).setPointerCapture = () => {};
    (target as unknown as { releasePointerCapture(id: number): void }).releasePointerCapture = () => {};
    target.getBoundingClientRect = () => ({ left:0, top:0, width:800, height:600, right:800, bottom:600, x:0, y:0, toJSON: () => ({}) });
    document.body.appendChild(target);

    const base = makeStore().get();
    // Build a store whose active frame has one player at map (200,200)
    const editState: StratState = {
      ...base,
      frames: [{ players: [{ id:'p1', x:200, y:200, team:'colonist', name:'', dead:false }], cones:[], shapes:[], textboxes:[], quickadds:[], strokes:[], scanner:null }],
      activeFrameIdx: 0,
    };
    store = createStore(editState);
    history = createHistory(store);
    tc = new TouchViewportController(target, store, { getViewport: vp, history });
    tc.attach();
  });

  // map (200,200) with zoom 1, pan 0, viewer 800x600, w/h 1920x1080:
  // translation tx = (800-1920)/2 = -560, ty = (600-1080)/2 = -240
  // clientToMap(cx,cy) => x = cx - (-560) = cx + 560; y = cy + 240
  // so to hit map (200,200): cx = 200 - 560 = -360, cy = 200 - 240 = -40
  function clientForMap(mx: number, my: number) {
    return { x: mx + (800 - 1920) / 2, y: my + (600 - 1080) / 2 };
  }

  /** Client coords for a map point at an arbitrary zoom (clientForMap is zoom-1). */
  function atZoom(mx: number, my: number, z: number) {
    return { x: mx * z + (800 - 1920 * z) / 2, y: my * z + (600 - 1080 * z) / 2 };
  }

  it('selects a node when the tap lands near it at a zoomed-out fit', () => {
    // The hit radius used to be a fixed 16 MAP units, which at the portrait fit
    // zoom of 0.2 is a 3.2px radius on screen - you had to land within 5px of the
    // node centre with a finger. It is screen px now.
    store._apply({ zoom: 0.2, selection: [] });
    const c = atZoom(200, 200, 0.2);
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:c.x + 20, clientY:c.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId:1, pointerType:'touch', clientX:c.x + 20, clientY:c.y, bubbles:true }));
    expect(store.get().selection).toEqual([{ kind:'player', id:'p1' }]);
  });

  it('does not select a node the tap is nowhere near', () => {
    store._apply({ zoom: 0.2, selection: [] });
    const c = atZoom(200, 200, 0.2);
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:c.x + 60, clientY:c.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId:1, pointerType:'touch', clientX:c.x + 60, clientY:c.y, bubbles:true }));
    expect(store.get().selection).toEqual([]);
  });

  it('clears the selection on an empty-space tap that wobbles a little', () => {
    // A finger never lifts on exactly the pixel it landed on. This was an exact
    // equality check, so real taps missed it - the code said as much in a comment.
    store._apply({ selection: [{ kind:'player', id:'p1' }] });
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:700, clientY:500, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId:1, pointerType:'touch', clientX:703, clientY:502, bubbles:true }));
    expect(store.get().selection).toEqual([]);
  });

  it('a real drag on empty space pans instead of deselecting', () => {
    store._apply({ selection: [{ kind:'player', id:'p1' }] });
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:700, clientY:500, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId:1, pointerType:'touch', clientX:760, clientY:540, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId:1, pointerType:'touch', clientX:760, clientY:540, bubbles:true }));
    expect(store.get().selection).toEqual([{ kind:'player', id:'p1' }]);
  });

  it('a pointerup for a pointer that was never captured does not throw', () => {
    // setPointerCapture is wrapped in try/catch for exactly this case ("synthetic
    // /inactive pointer"); releasePointerCapture was called bare, so the release
    // side threw where the capture side had shrugged.
    // jsdom swallows exceptions thrown inside a listener and reports them as an
    // uncaught error instead, so dispatchEvent never rethrows - watch for the
    // report rather than asserting on .not.toThrow(), which passes either way.
    (target as unknown as { releasePointerCapture(id: number): void }).releasePointerCapture = () => {
      throw new DOMException('No active pointer with the given id is found.', 'NotFoundError');
    };
    const uncaught: string[] = [];
    const onError = (e: ErrorEvent): void => { uncaught.push(e.message); e.preventDefault(); };
    window.addEventListener('error', onError);
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 77, pointerType: 'touch', clientX: 700, clientY: 500, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 77, pointerType: 'touch', clientX: 700, clientY: 500, bubbles: true }));
    window.removeEventListener('error', onError);
    expect(uncaught).toEqual([]);
  });

  it('tap on an item selects it and dispatches no command', () => {
    const c = clientForMap(200, 200);
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    expect(store.get().selection).toEqual([{ kind:'player', id:'p1' }]);
    expect(history.canUndo()).toBe(false);
  });

  it('drag an item past the threshold commits exactly one move command', () => {
    const c = clientForMap(200, 200);
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId:1, pointerType:'touch', clientX:c.x+60, clientY:c.y+40, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId:1, pointerType:'touch', clientX:c.x+60, clientY:c.y+40, bubbles:true }));
    const p = store.get().frames[0]!.players[0]!;
    expect([p.x, p.y]).toEqual([260, 240]);
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(store.get().frames[0]!.players[0]!.x).toBe(200);
  });

  it('tap on empty space clears the selection', () => {
    store._apply({ selection: [{ kind:'player', id:'p1' }] });
    const c = clientForMap(900, 900); // far from the player
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    expect(store.get().selection).toEqual([]);
  });

  it('drag on empty space pans and dispatches no command', () => {
    const c = clientForMap(900, 900);
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId:1, pointerType:'touch', clientX:c.x+50, clientY:c.y+20, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId:1, pointerType:'touch', clientX:c.x+50, clientY:c.y+20, bubbles:true }));
    expect(store.get().panX).toBe(50);
    expect(history.canUndo()).toBe(false);
  });

  it('a second finger mid-move reverts the live move (no command)', () => {
    const c = clientForMap(200, 200);
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId:1, pointerType:'touch', clientX:c.x+60, clientY:c.y+40, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:2, pointerType:'touch', clientX:c.x+200, clientY:c.y, bubbles:true }));
    expect(store.get().frames[0]!.players[0]!.x).toBe(200); // reverted
    expect(history.canUndo()).toBe(false);
  });

  it('pointercancel mid-move reverts the live move (no command)', () => {
    const c = clientForMap(200, 200);
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId:1, pointerType:'touch', clientX:c.x+60, clientY:c.y+40, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointercancel', { pointerId:1, pointerType:'touch', clientX:c.x+60, clientY:c.y+40, bubbles:true }));
    expect(store.get().frames[0]!.players[0]!.x).toBe(200);
    expect(history.canUndo()).toBe(false);
  });
});

describe('TouchViewportController cone reshape', () => {
  let target: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let history: ReturnType<typeof createHistory>;
  let tc: TouchViewportController;

  function vp(): Viewport {
    return { left: 0, top: 0, width: 800, height: 600, w: 1920, h: 1080,
      zoom: store.get().zoom, panX: store.get().panX, panY: store.get().panY };
  }
  // viewer 800x600, map 1920x1080, zoom 1 => translation (-560, -240);
  // clientToMap(cx,cy) = (cx + 560, cy + 240). Inverse below.
  function clientForMap(mx: number, my: number) {
    return { x: mx + (800 - 1920) / 2, y: my + (600 - 1080) / 2 };
  }

  beforeEach(() => {
    target = document.createElement('div');
    Object.defineProperty(target, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(target, 'clientHeight', { value: 600, configurable: true });
    (target as unknown as { setPointerCapture(id: number): void }).setPointerCapture = () => {};
    (target as unknown as { releasePointerCapture(id: number): void }).releasePointerCapture = () => {};
    target.getBoundingClientRect = () => ({ left:0, top:0, width:800, height:600, right:800, bottom:600, x:0, y:0, toJSON: () => ({}) });
    document.body.appendChild(target);

    const base = makeStore().get();
    // One free cone at origin (300,300), angle 0, length 130 -> arc tip at (430,300).
    const editState: StratState = {
      ...base,
      frames: [{ players: [], cones: [{ id:'c1', x:300, y:300, angle:0, length:130, spreadIdx:1, customHalfAngle:null, color:hex('#aeb6bb'), attachedPlayerId:null }], shapes:[], textboxes:[], quickadds:[], strokes:[], scanner:null }],
      activeFrameIdx: 0,
      selection: [{ kind:'cone', id:'c1' }],
    };
    store = createStore(editState);
    history = createHistory(store);
    tc = new TouchViewportController(target, store, { getViewport: vp, history });
    tc.attach();
  });

  it('the arc handle is still grabbable when zoomed out', () => {
    // At zoom 0.2 the old fixed 28 map-unit radius was 5.6px on screen. Press 35
    // map units off the arc tip: inside the new 44-screen-px radius (44/0.2 = 220
    // map units) and outside the old 28, so this press used to miss the handle
    // entirely and fall through to a plain selection.
    const z = 0.2;
    store._apply({ zoom: z });
    // clientForMap above is zoom-1 only; at another zoom the translation changes.
    const at = (mx: number, my: number) => ({
      x: mx * z + (800 - 1920 * z) / 2,
      y: my * z + (600 - 1080 * z) / 2,
    });
    const c = at(430 + 35, 300);
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    const to = at(300, 500);
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId:1, pointerType:'touch', clientX:to.x, clientY:to.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId:1, pointerType:'touch', clientX:to.x, clientY:to.y, bubbles:true }));
    // the cone reshaped, i.e. the press was read as a handle grab
    expect(store.get().frames[0]!.cones[0]!.length).not.toBe(130);
    expect(history.canUndo()).toBe(true);
  });

  it('dragging the arc handle of the selected cone reshapes it with one cone.modify', () => {
    const c = clientForMap(430, 300); // arc tip
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    const to = clientForMap(300, 500);
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId:1, pointerType:'touch', clientX:to.x, clientY:to.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId:1, pointerType:'touch', clientX:to.x, clientY:to.y, bubbles:true }));
    const cone = store.get().frames[0]!.cones[0]!;
    expect(cone.length).toBe(200);
    expect(cone.angle).toBeCloseTo(Math.PI / 2);
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(store.get().frames[0]!.cones[0]!.length).toBe(130);
    expect(store.get().frames[0]!.cones[0]!.angle).toBe(0);
  });

  it('dragging the origin handle moves the cone with one cone.modify', () => {
    const c = clientForMap(300, 300); // origin
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    const to = clientForMap(600, 400);
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId:1, pointerType:'touch', clientX:to.x, clientY:to.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId:1, pointerType:'touch', clientX:to.x, clientY:to.y, bubbles:true }));
    const cone = store.get().frames[0]!.cones[0]!;
    expect([cone.x, cone.y]).toEqual([600, 400]);
    expect(history.canUndo()).toBe(true);
    history.undo();
    const reverted = store.get().frames[0]!.cones[0]!;
    expect([reverted.x, reverted.y]).toEqual([300, 300]);
  });

  it('a cone-handle press is ignored when the cone is not selected (plain select instead)', () => {
    store._apply({ selection: [] });
    const c = clientForMap(430, 300); // arc tip
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    expect(store.get().selection).toEqual([{ kind:'cone', id:'c1' }]);
    expect(store.get().frames[0]!.cones[0]!.length).toBe(130); // not reshaped
    expect(history.canUndo()).toBe(false);
  });

  it('a second finger mid-reshape reverts the cone (no command)', () => {
    const c = clientForMap(430, 300);
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    const to = clientForMap(300, 500);
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId:1, pointerType:'touch', clientX:to.x, clientY:to.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:2, pointerType:'touch', clientX:c.x+200, clientY:c.y, bubbles:true }));
    expect(store.get().frames[0]!.cones[0]!.length).toBe(130);
    expect(history.canUndo()).toBe(false);
  });

  it('pointercancel mid-reshape reverts the cone (no command)', () => {
    const c = clientForMap(430, 300);
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    const to = clientForMap(300, 500);
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId:1, pointerType:'touch', clientX:to.x, clientY:to.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointercancel', { pointerId:1, pointerType:'touch', clientX:to.x, clientY:to.y, bubbles:true }));
    expect(store.get().frames[0]!.cones[0]!.length).toBe(130);
    expect(history.canUndo()).toBe(false);
  });
});

describe('TouchViewportController multi-select', () => {
  let target: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let history: ReturnType<typeof createHistory>;
  let tc: TouchViewportController;

  function vp(): Viewport {
    return { left: 0, top: 0, width: 800, height: 600, w: 1920, h: 1080,
      zoom: store.get().zoom, panX: store.get().panX, panY: store.get().panY };
  }
  // viewer 800x600, map 1920x1080, zoom 1 => translation (-560, -240).
  function clientForMap(mx: number, my: number) {
    return { x: mx + (800 - 1920) / 2, y: my + (600 - 1080) / 2 };
  }
  function setMulti(on: boolean): void {
    store._apply({ ui: { ...store.get().ui, touchMultiSelect: on } });
  }

  beforeEach(() => {
    target = document.createElement('div');
    Object.defineProperty(target, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(target, 'clientHeight', { value: 600, configurable: true });
    (target as unknown as { setPointerCapture(id: number): void }).setPointerCapture = () => {};
    (target as unknown as { releasePointerCapture(id: number): void }).releasePointerCapture = () => {};
    target.getBoundingClientRect = () => ({ left:0, top:0, width:800, height:600, right:800, bottom:600, x:0, y:0, toJSON: () => ({}) });
    document.body.appendChild(target);

    const base = makeStore().get();
    // Two players: p1 at map (800,500), p2 at map (900,600).
    const editState: StratState = {
      ...base,
      frames: [{
        players: [
          { id:'p1', x:800, y:500, team:'colonist', name:'', dead:false },
          { id:'p2', x:900, y:600, team:'colonist', name:'', dead:false },
        ],
        cones:[], shapes:[], textboxes:[], quickadds:[], strokes:[], scanner:null,
      }],
      activeFrameIdx: 0,
    };
    store = createStore(editState);
    history = createHistory(store);
    tc = new TouchViewportController(target, store, { getViewport: vp, history });
    tc.attach();
  });

  it('multi tap on an item toggles it into the selection', () => {
    setMulti(true);
    const c = clientForMap(800, 500);
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    expect(store.get().selection).toEqual([{ kind:'player', id:'p1' }]);
  });

  it('multi tap on an already-selected item toggles it out', () => {
    setMulti(true);
    store._apply({ selection: [{ kind:'player', id:'p1' }, { kind:'player', id:'p2' }] });
    const c = clientForMap(800, 500);
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    expect(store.get().selection).toEqual([{ kind:'player', id:'p2' }]);
  });

  it('multi empty-space drag marquees and merges the hits into the selection', () => {
    setMulti(true);
    const a = clientForMap(700, 400);
    const b = clientForMap(1000, 700);
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:a.x, clientY:a.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId:1, pointerType:'touch', clientX:b.x, clientY:b.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId:1, pointerType:'touch', clientX:b.x, clientY:b.y, bubbles:true }));
    expect(store.get().selection).toEqual([{ kind:'player', id:'p1' }, { kind:'player', id:'p2' }]);
  });

  it('multi empty-space tap with no travel selects nothing', () => {
    setMulti(true);
    store._apply({ selection: [{ kind:'player', id:'p1' }] });
    const c = clientForMap(50, 50); // far from both players
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    expect(store.get().selection).toEqual([{ kind:'player', id:'p1' }]);
  });

  it('non-multi: pressing a selected item drags the whole selection in one batch', () => {
    store._apply({ selection: [{ kind:'player', id:'p1' }, { kind:'player', id:'p2' }] });
    const c = clientForMap(800, 500);
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId:1, pointerType:'touch', clientX:c.x+60, clientY:c.y+40, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId:1, pointerType:'touch', clientX:c.x+60, clientY:c.y+40, bubbles:true }));
    const f = store.get().frames[0]!;
    expect([f.players[0]!.x, f.players[0]!.y]).toEqual([860, 540]);
    expect([f.players[1]!.x, f.players[1]!.y]).toEqual([960, 640]);
    expect(history.canUndo()).toBe(true);
    history.undo();
    const g = store.get().frames[0]!;
    expect([g.players[0]!.x, g.players[0]!.y]).toEqual([800, 500]);
    expect([g.players[1]!.x, g.players[1]!.y]).toEqual([900, 600]);
  });

  it('non-multi: pressing an unselected item replaces the selection', () => {
    store._apply({ selection: [{ kind:'player', id:'p1' }] });
    const c = clientForMap(900, 600); // p2
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    expect(store.get().selection).toEqual([{ kind:'player', id:'p2' }]);
    expect(history.canUndo()).toBe(false);
  });

  it('a second finger cancels an in-progress marquee (no selection change)', () => {
    setMulti(true);
    const a = clientForMap(700, 400);
    const b = clientForMap(1000, 700);
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:a.x, clientY:a.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId:1, pointerType:'touch', clientX:b.x, clientY:b.y, bubbles:true }));
    // Second finger lands mid-marquee.
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:2, pointerType:'touch', clientX:a.x+10, clientY:a.y, bubbles:true }));
    // Lift both fingers; the marquee was cancelled so nothing is selected.
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId:1, pointerType:'touch', clientX:b.x, clientY:b.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId:2, pointerType:'touch', clientX:a.x+10, clientY:a.y, bubbles:true }));
    expect(store.get().selection).toEqual([]);
  });

  it('pointercancel during a marquee makes no selection change', () => {
    setMulti(true);
    const a = clientForMap(700, 400);
    const b = clientForMap(1000, 700);
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:a.x, clientY:a.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId:1, pointerType:'touch', clientX:b.x, clientY:b.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointercancel', { pointerId:1, pointerType:'touch', clientX:b.x, clientY:b.y, bubbles:true }));
    expect(store.get().selection).toEqual([]);
  });

  it('pointercancel on a pending multi-tap makes no membership change', () => {
    setMulti(true);
    store._apply({ selection: [{ kind:'player', id:'p2' }] });
    const c = clientForMap(800, 500); // p1
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointercancel', { pointerId:1, pointerType:'touch', clientX:c.x, clientY:c.y, bubbles:true }));
    expect(store.get().selection).toEqual([{ kind:'player', id:'p2' }]);
  });
});

describe('TouchViewportController tool-aware arbitration', () => {
  let target: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let tc: TouchViewportController;
  let cancelSpy: Mock<() => void>;
  let activeTool: ToolController | null;
  let toolDownCount: number;

  function vp(): Viewport {
    return { left: 0, top: 0, width: 800, height: 600, w: 1920, h: 1080,
      zoom: store.get().zoom, panX: store.get().panX, panY: store.get().panY };
  }

  beforeEach(() => {
    target = document.createElement('div');
    Object.defineProperty(target, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(target, 'clientHeight', { value: 600, configurable: true });
    (target as unknown as { setPointerCapture(id: number): void }).setPointerCapture = () => {};
    (target as unknown as { releasePointerCapture(id: number): void }).releasePointerCapture = () => {};
    target.getBoundingClientRect = () => ({ left:0, top:0, width:800, height:600, right:800, bottom:600, x:0, y:0, toJSON: () => ({}) });
    document.body.appendChild(target);
    store = makeStore();
    // The select-family path (beginEditPress) hit-tests the active frame, so the
    // store needs one frame; makeStore() ships with frames:[] for view-only tests.
    store._apply({ frames: [{ players:[], cones:[], shapes:[], textboxes:[], quickadds:[], strokes:[], scanner:null }], activeFrameIdx: 0 });
    store._apply({ tool: 'draw' });
    history = createHistory(store);
    cancelSpy = vi.fn();
    activeTool = { id: 'draw', attach() {}, detach() {}, cancel: cancelSpy };
    tc = new TouchViewportController(target, store, { getViewport: vp, history, getActiveTool: () => activeTool });
    tc.attach();
    // A fake "tool" bubble listener registered AFTER the controller's capture
    // listener, so the controller's stopImmediatePropagation can suppress it.
    toolDownCount = 0;
    target.addEventListener('pointerdown', () => { toolDownCount++; });
  });

  afterEach(() => { tc.detach(); target.remove(); });

  it('one finger with a creation tool active does not pan and still reaches the tool', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:100, clientY:100, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId:1, pointerType:'touch', clientX:160, clientY:140, bubbles:true }));
    expect(store.get().panX).toBe(0);
    expect(store.get().panY).toBe(0);
    expect(toolDownCount).toBe(1); // the pointerdown still reached the tool's listener
  });

  it('a second finger cancels the active tool and starts pinch', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:100, clientY:100, bubbles:true }));
    const downsBefore = toolDownCount;
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:2, pointerType:'touch', clientX:300, clientY:100, bubbles:true }));
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(toolDownCount).toBe(downsBefore); // finger 2 never reached the tool
    const z0 = store.get().zoom;
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId:2, pointerType:'touch', clientX:500, clientY:100, bubbles:true }));
    expect(store.get().zoom).not.toBe(z0); // two fingers pinch
  });

  it('a third finger is still claimed and never reaches the tool', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:100, clientY:100, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:2, pointerType:'touch', clientX:300, clientY:100, bubbles:true }));
    const downsBefore = toolDownCount;
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:3, pointerType:'touch', clientX:500, clientY:300, bubbles:true }));
    expect(toolDownCount).toBe(downsBefore); // finger 3 never reached the tool
  });

  it('double-tap zoom is suppressed while a creation tool is active', () => {
    const z0 = store.get().zoom;
    const tap = (): void => {
      target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:100, clientY:100, bubbles:true }));
      target.dispatchEvent(new PointerEvent('pointerup', { pointerId:1, pointerType:'touch', clientX:100, clientY:100, bubbles:true }));
    };
    tap(); tap();
    expect(store.get().zoom).toBe(z0);
  });

  it('with a select-family tool active a one-finger drag still pans (edit path)', () => {
    store._apply({ tool: 'cursor' });
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:100, clientY:100, bubbles:true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId:1, pointerType:'touch', clientX:140, clientY:120, bubbles:true }));
    expect(store.get().panX).toBe(40);
    expect(store.get().panY).toBe(20);
  });
});

describe('TouchViewportController chrome insulation', () => {
  let target: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let tc: TouchViewportController;

  beforeEach(() => {
    target = document.createElement('div');
    Object.defineProperty(target, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(target, 'clientHeight', { value: 600, configurable: true });
    (target as unknown as { setPointerCapture(id: number): void }).setPointerCapture = () => {};
    (target as unknown as { releasePointerCapture(id: number): void }).releasePointerCapture = () => {};
    document.body.appendChild(target);
    store = makeStore();
    tc = new TouchViewportController(target, store);
    tc.attach();
  });

  afterEach(() => { tc.detach(); target.remove(); });

  it('ignores a one-finger drag that originates inside the floating chrome', () => {
    const chromeEl = document.createElement('div');
    chromeEl.dataset['touchChrome'] = '';
    target.appendChild(chromeEl);
    let chromeSaw = 0;
    chromeEl.addEventListener('pointerdown', () => { chromeSaw++; });
    chromeEl.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:100, clientY:100, bubbles:true }));
    chromeEl.dispatchEvent(new PointerEvent('pointermove', { pointerId:1, pointerType:'touch', clientX:160, clientY:160, bubbles:true }));
    // The controller did not pan in response to the chrome-origin drag...
    expect(store.get().panX).toBe(0);
    expect(store.get().panY).toBe(0);
    // ...and it did NOT stop the chrome element's own handler from running.
    expect(chromeSaw).toBe(1);
  });

  it('ignores events originating on a descendant of a marked chrome root', () => {
    const chromeRoot = document.createElement('div');
    chromeRoot.dataset['touchChrome'] = '';
    const childBtn = document.createElement('button');
    chromeRoot.appendChild(childBtn);
    target.appendChild(chromeRoot);
    childBtn.dispatchEvent(new PointerEvent('pointerdown', { pointerId:1, pointerType:'touch', clientX:100, clientY:100, bubbles:true }));
    childBtn.dispatchEvent(new PointerEvent('pointermove', { pointerId:1, pointerType:'touch', clientX:170, clientY:150, bubbles:true }));
    expect(store.get().panX).toBe(0);
    expect(store.get().panY).toBe(0);
  });
});

describe('TouchViewportController long-press', () => {
  let target: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let history: ReturnType<typeof createHistory>;
  let tc: TouchViewportController;
  let fired: Array<{ ref: unknown; x: number; y: number }>;

  function vp(): Viewport {
    return { left: 0, top: 0, width: 800, height: 600, w: 1920, h: 1080,
      zoom: store.get().zoom, panX: store.get().panX, panY: store.get().panY };
  }
  function clientForMap(mx: number, my: number) {
    return { x: mx + (800 - 1920) / 2, y: my + (600 - 1080) / 2 };
  }
  const down = (x: number, y: number): void => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
  };
  const move = (x: number, y: number, id = 1): void => {
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
  };
  const up = (x: number, y: number, id = 1): void => {
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    target = document.createElement('div');
    Object.defineProperty(target, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(target, 'clientHeight', { value: 600, configurable: true });
    (target as unknown as { setPointerCapture(id: number): void }).setPointerCapture = () => {};
    (target as unknown as { releasePointerCapture(id: number): void }).releasePointerCapture = () => {};
    target.getBoundingClientRect = () => ({ left:0, top:0, width:800, height:600, right:800, bottom:600, x:0, y:0, toJSON: () => ({}) });
    document.body.appendChild(target);

    const base = makeStore().get();
    store = createStore({
      ...base,
      frames: [{ players: [{ id:'p1', x:200, y:200, team:'colonist', name:'', dead:false }], cones:[], shapes:[], textboxes:[], quickadds:[], strokes:[], scanner:null }],
      activeFrameIdx: 0,
    } as StratState);
    history = createHistory(store);
    fired = [];
    tc = new TouchViewportController(target, store, {
      getViewport: vp, history,
      onLongPress: (ref, x, y) => { fired.push({ ref, x, y }); },
    });
    tc.attach();
  });

  afterEach(() => {
    tc.detach();
    target.remove();
    vi.useRealTimers();
  });

  it('fires with the hit item and the press point', () => {
    const c = clientForMap(200, 200);
    down(c.x, c.y);
    vi.advanceTimersByTime(500);
    expect(fired).toHaveLength(1);
    expect(fired[0]!.ref).toEqual({ kind: 'player', id: 'p1' });
    expect(fired[0]!.x).toBe(c.x);
    expect(fired[0]!.y).toBe(c.y);
  });

  it('does not fire before the threshold', () => {
    const c = clientForMap(200, 200);
    down(c.x, c.y);
    vi.advanceTimersByTime(400);
    expect(fired).toHaveLength(0);
  });

  it('does not fire on empty space', () => {
    down(10, 10);
    vi.advanceTimersByTime(500);
    expect(fired).toHaveLength(0);
  });

  it('is cancelled by dragging past the tap slop', () => {
    const c = clientForMap(200, 200);
    down(c.x, c.y);
    vi.advanceTimersByTime(200);
    move(c.x + 20, c.y);   // TAP_SLOP_PX is 8
    vi.advanceTimersByTime(400);
    expect(fired).toHaveLength(0);
  });

  it('survives a wobble inside the tap slop', () => {
    const c = clientForMap(200, 200);
    down(c.x, c.y);
    vi.advanceTimersByTime(200);
    move(c.x + 3, c.y + 2);
    vi.advanceTimersByTime(400);
    expect(fired).toHaveLength(1);
  });

  it('is cancelled by a second finger', () => {
    const c = clientForMap(200, 200);
    down(c.x, c.y);
    vi.advanceTimersByTime(200);
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 400, clientY: 400, bubbles: true }));
    vi.advanceTimersByTime(400);
    expect(fired).toHaveLength(0);
  });

  it('is cancelled by lifting early', () => {
    const c = clientForMap(200, 200);
    down(c.x, c.y);
    vi.advanceTimersByTime(200);
    up(c.x, c.y);
    vi.advanceTimersByTime(400);
    expect(fired).toHaveLength(0);
  });

  it('swallows the release, so the press does not also commit a move', () => {
    const c = clientForMap(200, 200);
    down(c.x, c.y);
    vi.advanceTimersByTime(500);
    expect(fired).toHaveLength(1);
    const before = store.get().frames[0]!.players[0]!.x;
    move(c.x + 60, c.y);
    up(c.x + 60, c.y);
    // The long-press took ownership: the finger sliding away afterwards must not
    // drag the player, or the menu would open over an item that has just moved.
    expect(store.get().frames[0]!.players[0]!.x).toBe(before);
    expect(history.canUndo()).toBe(false);
  });
});

describe('TouchViewportController multi-select is self-clearing', () => {
  let target: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let tc: TouchViewportController;

  function vp(): Viewport {
    return { left: 0, top: 0, width: 800, height: 600, w: 1920, h: 1080,
      zoom: store.get().zoom, panX: store.get().panX, panY: store.get().panY };
  }

  beforeEach(() => {
    target = document.createElement('div');
    Object.defineProperty(target, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(target, 'clientHeight', { value: 600, configurable: true });
    (target as unknown as { setPointerCapture(id: number): void }).setPointerCapture = () => {};
    (target as unknown as { releasePointerCapture(id: number): void }).releasePointerCapture = () => {};
    target.getBoundingClientRect = () => ({ left:0, top:0, width:800, height:600, right:800, bottom:600, x:0, y:0, toJSON: () => ({}) });
    document.body.appendChild(target);
    const base = makeStore().get();
    store = createStore({
      ...base,
      frames: [{ players: [{ id:'p1', x:200, y:200, team:'colonist', name:'', dead:false }], cones:[], shapes:[], textboxes:[], quickadds:[], strokes:[], scanner:null }],
      activeFrameIdx: 0,
      selection: [{ kind: 'player', id: 'p1' }],
      ui: { ...base.ui, touchMultiSelect: true },
    } as StratState);
    tc = new TouchViewportController(target, store, { getViewport: vp, history: createHistory(store) });
    tc.attach();
  });

  afterEach(() => { tc.detach(); target.remove(); });

  it('a tap on empty space leaves the mode but keeps the selection', () => {
    // The toggle left the top bar, so the mode needs a way out that is not a
    // button. The selection deliberately survives: it is not undoable, so wiping
    // several picked items on one stray tap would cost real work. Leaving the
    // mode is "done picking", not "start again".
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10, bubbles: true }));
    expect(store.get().ui.touchMultiSelect).toBe(false);
    expect(store.get().selection).toEqual([{ kind: 'player', id: 'p1' }]);
  });
});

describe('TouchViewportController two-finger tap = undo', () => {
  let target: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let history: ReturnType<typeof createHistory>;
  let tc: TouchViewportController;

  function vp(): Viewport {
    return { left: 0, top: 0, width: 800, height: 600, w: 1920, h: 1080,
      zoom: store.get().zoom, panX: store.get().panX, panY: store.get().panY };
  }
  const ev = (type: string, id: number, x: number, y: number): void => {
    target.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
  };
  const players = (): string[] => store.get().frames[0]!.players.map((p) => p.id);

  beforeEach(() => {
    target = document.createElement('div');
    Object.defineProperty(target, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(target, 'clientHeight', { value: 600, configurable: true });
    (target as unknown as { setPointerCapture(id: number): void }).setPointerCapture = () => {};
    (target as unknown as { releasePointerCapture(id: number): void }).releasePointerCapture = () => {};
    target.getBoundingClientRect = () => ({ left:0, top:0, width:800, height:600, right:800, bottom:600, x:0, y:0, toJSON: () => ({}) });
    document.body.appendChild(target);
    const base = makeStore().get();
    store = createStore({
      ...base,
      frames: [{ players: [{ id:'p1', x:200, y:200, team:'colonist', name:'', dead:false }], cones:[], shapes:[], textboxes:[], quickadds:[], strokes:[], scanner:null }],
      activeFrameIdx: 0,
    } as StratState);
    history = createHistory(store);
    // Something on the undo stack to undo.
    history.dispatch({ t: 'player.add', player: { id:'p2', x:400, y:400, team:'reyab', name:'', dead:false } });
    tc = new TouchViewportController(target, store, { getViewport: vp, history });
    tc.attach();
  });

  afterEach(() => { tc.detach(); target.remove(); });

  it('two fingers down and straight back up undoes', () => {
    expect(players()).toEqual(['p1', 'p2']);
    ev('pointerdown', 1, 300, 300);
    ev('pointerdown', 2, 500, 300);
    ev('pointerup', 1, 300, 300);
    ev('pointerup', 2, 500, 300);
    expect(players()).toEqual(['p1']);
  });

  it('a pinch does not undo', () => {
    ev('pointerdown', 1, 300, 300);
    ev('pointerdown', 2, 500, 300);
    ev('pointermove', 2, 700, 300);   // spread
    ev('pointerup', 1, 300, 300);
    ev('pointerup', 2, 700, 300);
    expect(players()).toEqual(['p1', 'p2']);
  });

  it('a two-finger pan does not undo', () => {
    ev('pointerdown', 1, 300, 300);
    ev('pointerdown', 2, 500, 300);
    ev('pointermove', 1, 340, 300);   // both travel together, separation constant
    ev('pointermove', 2, 540, 300);
    ev('pointerup', 1, 340, 300);
    ev('pointerup', 2, 540, 300);
    expect(players()).toEqual(['p1', 'p2']);
  });

  it('survives a wobble inside the tap slop', () => {
    ev('pointerdown', 1, 300, 300);
    ev('pointerdown', 2, 500, 300);
    ev('pointermove', 1, 303, 302);
    ev('pointerup', 1, 303, 302);
    ev('pointerup', 2, 500, 300);
    expect(players()).toEqual(['p1']);
  });

  it('a three-finger tap does not undo', () => {
    ev('pointerdown', 1, 300, 300);
    ev('pointerdown', 2, 500, 300);
    ev('pointerdown', 3, 400, 400);
    ev('pointerup', 1, 300, 300);
    ev('pointerup', 2, 500, 300);
    ev('pointerup', 3, 400, 400);
    expect(players()).toEqual(['p1', 'p2']);
  });

  it('a one-finger tap does not undo', () => {
    ev('pointerdown', 1, 300, 300);
    ev('pointerup', 1, 300, 300);
    expect(players()).toEqual(['p1', 'p2']);
  });

  it('a held two-finger rest past the window does not undo', () => {
    vi.useFakeTimers();
    try {
      ev('pointerdown', 1, 300, 300);
      ev('pointerdown', 2, 500, 300);
      vi.advanceTimersByTime(400);   // TWO_FINGER_TAP_MS is 300
      ev('pointerup', 1, 300, 300);
      ev('pointerup', 2, 500, 300);
      expect(players()).toEqual(['p1', 'p2']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not also deselect when tapped over empty space', () => {
    store._apply({ selection: [{ kind: 'player', id: 'p1' }] });
    ev('pointerdown', 1, 10, 10);     // empty space, arms downEmpty
    ev('pointerdown', 2, 60, 10);
    ev('pointerup', 1, 10, 10);
    ev('pointerup', 2, 60, 10);
    expect(players()).toEqual(['p1']);          // undo happened
    expect(store.get().selection).toEqual([{ kind: 'player', id: 'p1' }]);
  });

  it('two taps in a row do not toggle the zoom', () => {
    // The single-finger double-tap is armed by the first finger of each pair.
    // Without clearing it, the second undo tap would land inside the 300ms
    // window and zoom instead.
    history.dispatch({ t: 'player.add', player: { id:'p3', x:600, y:600, team:'reyab', name:'', dead:false } });
    const zoom0 = store.get().zoom;
    ev('pointerdown', 1, 300, 300); ev('pointerdown', 2, 500, 300);
    ev('pointerup', 1, 300, 300);   ev('pointerup', 2, 500, 300);
    ev('pointerdown', 3, 300, 300); ev('pointerdown', 4, 500, 300);
    ev('pointerup', 3, 300, 300);   ev('pointerup', 4, 500, 300);
    expect(players()).toEqual(['p1']);
    expect(store.get().zoom).toBe(zoom0);
  });
});
