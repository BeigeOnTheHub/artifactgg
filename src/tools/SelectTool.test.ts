import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SelectTool } from './SelectTool';
import { createStore, type StratState } from '../app/store';
import { createHistory } from '../app/history';
import { emptyFrame } from '../types/primitives';
import { hex } from '../types/hex';
import { DEFAULT_CONE_COLOUR } from './cone-presets';
import { StrokeLayer } from '../render/StrokeLayer';
import { ShapeLayer } from '../render/ShapeLayer';
import { ConeLayer } from '../render/ConeLayer';
import { PlayerLayer } from '../render/PlayerLayer';
import { QuickAddLayer } from '../render/QuickAddLayer';
import { TextLayer } from '../render/TextLayer';

// jsdom does not implement HTMLCanvasElement.prototype.getContext - patch it so
// StrokeLayer can construct without throwing.
function fakeCanvasContext(): CanvasRenderingContext2D & Record<string, unknown> {
  const ctx = {} as Record<string, unknown>;
  for (const m of [
    'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'clearRect', 'drawImage',
    'save', 'restore', 'setTransform', 'arc', 'fillRect', 'strokeRect',
    // setLineDash is not optional padding: StrokeLayer.drawStroke calls it on
    // every stroke to apply the dash style, so leaving it off threw inside a
    // rAF callback where vitest could only report it as an unhandled error -
    // the suite showed every test passing and still exited 1.
    'setLineDash',
  ]) {
    ctx[m] = vi.fn();
  }
  for (const p of ['lineCap', 'lineJoin', 'lineWidth', 'globalCompositeOperation', 'globalAlpha', 'strokeStyle', 'fillStyle']) {
    ctx[p] = '';
  }
  return ctx as unknown as CanvasRenderingContext2D & Record<string, unknown>;
}

function patchCanvasGetContext(): void {
  const cache = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string) {
    if (kind !== '2d') return null;
    let ctx = cache.get(this);
    if (!ctx) { ctx = fakeCanvasContext(); cache.set(this, ctx); }
    return ctx;
  } as HTMLCanvasElement['getContext'];
}

function makeStore(): ReturnType<typeof createStore> {
  const initial: StratState = {
    mapId: 'miru',
    zoom: 1, panX: 0, panY: 0,
    frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '', tool: 'select',
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

interface Harness {
  target: HTMLElement;
  zoomViewport: HTMLElement;
  store: ReturnType<typeof makeStore>;
  history: ReturnType<typeof createHistory>;
  strokeLayer: StrokeLayer;
  shapeLayer: ShapeLayer;
  coneLayer: ConeLayer;
  playerLayer: PlayerLayer;
  quickAddLayer: QuickAddLayer;
  textLayer: TextLayer;
  tool: SelectTool;
}

function harness(mode: 'cursor' | 'select' | 'lasso'): Harness {
  const target = document.createElement('div');
  Object.defineProperty(target, 'clientWidth',  { value: 1920, configurable: true });
  Object.defineProperty(target, 'clientHeight', { value: 1080, configurable: true });
  document.body.appendChild(target);

  const zoomViewport = document.createElement('div');
  Object.defineProperty(zoomViewport, 'clientWidth',  { value: 1920, configurable: true });
  Object.defineProperty(zoomViewport, 'clientHeight', { value: 1080, configurable: true });
  target.appendChild(zoomViewport);

  const mapWrap = document.createElement('div');
  Object.defineProperty(mapWrap, 'clientWidth',  { value: 1920, configurable: true });
  Object.defineProperty(mapWrap, 'clientHeight', { value: 1080, configurable: true });
  zoomViewport.appendChild(mapWrap);

  const store = makeStore();
  const history = createHistory(store);
  const mapSize = { w: 1920, h: 1080 };

  const strokeLayer = new StrokeLayer(zoomViewport, store, mapSize);
  strokeLayer.mount();
  const shapeLayer = new ShapeLayer(mapWrap, store, mapSize);
  shapeLayer.mount();
  const coneLayer = new ConeLayer(mapWrap, store, mapSize);
  coneLayer.mount();
  const playerLayer = new PlayerLayer(zoomViewport, store, mapSize, fakeViewport);
  playerLayer.mount();
  const quickAddLayer = new QuickAddLayer(mapWrap, store, mapSize);
  quickAddLayer.mount();
  const textLayer = new TextLayer(mapWrap, store, history, fakeViewport);
  textLayer.mount();

  const tool = new SelectTool({
    mode, store, history,
    zoomViewport,
    strokeLayer, shapeLayer, coneLayer, playerLayer, quickAddLayer, textLayer,
    getViewport: fakeViewport,
  });
  tool.attach(target);
  return { target, zoomViewport, store, history,
           strokeLayer, shapeLayer, coneLayer, playerLayer, quickAddLayer, textLayer, tool };
}

// Patch canvas before any harness is created.
patchCanvasGetContext();

describe('SelectTool - skeleton', () => {
  let h: Harness;
  beforeEach(() => { h = harness('select'); });
  afterEach(() => { h.tool.detach(); });

  it('exposes the mode-specific id', () => {
    const c = harness('cursor');     expect(c.tool.id).toBe('cursor');
    const s = harness('select');     expect(s.tool.id).toBe('select');
    const l = harness('lasso');      expect(l.tool.id).toBe('lasso');
  });

  it('attach is idempotent and detach removes listeners cleanly', () => {
    h.tool.detach();
    // Re-attaching after detach should not throw.
    h.tool.attach(h.target);
    h.tool.detach();
  });

  it('does not dispatch any command on attach with empty frame', () => {
    expect(h.history.canUndo()).toBe(false);
  });
});

describe('SelectTool - select mode (marquee)', () => {
  let h: Harness;
  beforeEach(() => { h = harness('select'); });
  afterEach(() => { h.tool.detach(); });

  it('shift+drag from empty space creates a marquee rectangle in zoomViewport', () => {
    h.target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 100, clientY: 100, shiftKey: true, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, button: 0, clientX: 200, clientY: 200, shiftKey: true, bubbles: true,
    }));
    const rect = h.zoomViewport.querySelector('#marquee-rect') as HTMLElement | null;
    expect(rect).not.toBeNull();
    expect(rect!.style.display).not.toBe('none');
  });

  it('plain empty drag (no shift) starts a marquee, not a pan', () => {
    h.store._apply({
      frames: [{
        ...h.store.get().frames[0]!,
        players: [{ id: 'p1', team: 'colonist', x: 150, y: 150, name: '', dead: false }],
      }],
    });
    h.target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, button: 0, clientX: 240, clientY: 240, bubbles: true,
    }));
    const rect = h.zoomViewport.querySelector('#marquee-rect') as HTMLElement | null;
    expect(rect).not.toBeNull();
    expect(rect!.style.display).not.toBe('none');
    expect(h.store.get().panX).toBe(0);
    h.target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 240, clientY: 240, bubbles: true,
    }));
    expect(h.store.get().selection).toContainEqual({ kind: 'player', id: 'p1' });
  });

  it('marquee release selects players whose centre lies inside the rect (with shift)', () => {
    h.store._apply({
      frames: [{
        ...h.store.get().frames[0]!,
        players: [
          { id: 'p1', team: 'colonist', x: 150, y: 150, name: '', dead: false },
          { id: 'p2', team: 'reyab', x: 800, y: 800, name: '', dead: false },
        ],
      }],
    });
    h.target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 100, clientY: 100, shiftKey: true, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, button: 0, clientX: 200, clientY: 200, shiftKey: true, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 200, clientY: 200, shiftKey: true, bubbles: true,
    }));
    expect(h.store.get().selection).toContainEqual({ kind: 'player', id: 'p1' });
    expect(h.store.get().selection).not.toContainEqual({ kind: 'player', id: 'p2' });
  });

  it('marquee drag below 4px threshold clears selection without hit-testing', () => {
    h.store._apply({ selection: [{ kind: 'player', id: 'pre' }] });
    h.target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 100, clientY: 100, shiftKey: true, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 102, clientY: 102, shiftKey: true, bubbles: true,
    }));
    expect(h.store.get().selection).toEqual([]);
  });

  it('Ctrl+Shift+drag merges new selection with the prior selection', () => {
    h.store._apply({
      frames: [{
        ...h.store.get().frames[0]!,
        players: [
          { id: 'a', team: 'colonist', x: 150, y: 150, name: '', dead: false },
          { id: 'b', team: 'colonist', x: 250, y: 250, name: '', dead: false },
        ],
      }],
      selection: [{ kind: 'player', id: 'a' }],
    });
    h.target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 200, clientY: 200, ctrlKey: true, shiftKey: true, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, button: 0, clientX: 300, clientY: 300, ctrlKey: true, shiftKey: true, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 300, clientY: 300, ctrlKey: true, shiftKey: true, bubbles: true,
    }));
    const sel = h.store.get().selection;
    expect(sel).toContainEqual({ kind: 'player', id: 'a' });
    expect(sel).toContainEqual({ kind: 'player', id: 'b' });
  });

  it('marquee drag dispatches no command (selection is not undoable)', () => {
    h.target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 100, clientY: 100, shiftKey: true, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 200, clientY: 200, shiftKey: true, bubbles: true,
    }));
    expect(h.history.canUndo()).toBe(false);
  });
});

describe('SelectTool - lasso mode', () => {
  let h: Harness;
  beforeEach(() => { h = harness('lasso'); });
  afterEach(() => { h.tool.detach(); });

  it('shift+drag from empty space creates a lasso path in zoomViewport', () => {
    h.target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 100, clientY: 100, shiftKey: true, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, button: 0, clientX: 200, clientY: 100, shiftKey: true, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, button: 0, clientX: 200, clientY: 200, shiftKey: true, bubbles: true,
    }));
    const path = h.zoomViewport.querySelector('#lasso-path') as SVGPathElement | null;
    expect(path).not.toBeNull();
    expect(path!.getAttribute('d') ?? '').toMatch(/^M/);
  });

  it('plain empty drag (no shift) draws a lasso, not a pan', () => {
    h.target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, button: 0, clientX: 200, clientY: 100, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true,
    }));
    const path = h.zoomViewport.querySelector('#lasso-path') as SVGPathElement | null;
    expect(path).not.toBeNull();
    expect(path!.getAttribute('d') ?? '').toMatch(/^M/);
    expect(h.store.get().panX).toBe(0);
    h.target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true,
    }));
  });

  it('lasso release selects players whose centre is inside the polygon (with shift)', () => {
    h.store._apply({
      frames: [{
        ...h.store.get().frames[0]!,
        players: [
          { id: 'inside', team: 'colonist', x: 150, y: 150, name: '', dead: false },
          { id: 'outside', team: 'reyab', x: 800, y: 800, name: '', dead: false },
        ],
      }],
    });
    h.target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 100, clientY: 100, shiftKey: true, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, button: 0, clientX: 200, clientY: 100, shiftKey: true, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, button: 0, clientX: 200, clientY: 200, shiftKey: true, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, button: 0, clientX: 100, clientY: 200, shiftKey: true, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 100, clientY: 200, shiftKey: true, bubbles: true,
    }));
    expect(h.store.get().selection).toContainEqual({ kind: 'player', id: 'inside' });
    expect(h.store.get().selection).not.toContainEqual({ kind: 'player', id: 'outside' });
  });

  it('lasso polygon with fewer than 3 points clears selection (treated as click)', () => {
    h.store._apply({ selection: [{ kind: 'player', id: 'pre' }] });
    h.target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 100, clientY: 100, shiftKey: true, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 100, clientY: 100, shiftKey: true, bubbles: true,
    }));
    expect(h.store.get().selection).toEqual([]);
  });
});

describe('SelectTool - cursor mode', () => {
  let h: Harness;
  beforeEach(() => { h = harness('cursor'); });
  afterEach(() => { h.tool.detach(); });

  it('click on empty space clears selection', () => {
    h.store._apply({ selection: [{ kind: 'player', id: 'pre' }] });
    h.target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 50, clientY: 50, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 50, clientY: 50, bubbles: true,
    }));
    expect(h.store.get().selection).toEqual([]);
  });

  it('empty-space left-drag pans the map (cursor tool only)', () => {
    h.target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, button: 0, clientX: 240, clientY: 180, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 240, clientY: 180, bubbles: true,
    }));
    expect(h.store.get().panX).toBe(140);
    expect(h.store.get().panY).toBe(80);
  });

  it('click on a player <g> selects that player', () => {
    h.store._apply({
      frames: [{
        ...h.store.get().frames[0]!,
        players: [{ id: 'p1', team: 'colonist', x: 200, y: 200, name: '', dead: false }],
      }],
    });
    const node = h.playerLayer.getNode('p1');
    expect(node).not.toBeNull();
    node!.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true,
    }));
    node!.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true,
    }));
    expect(h.store.get().selection).toContainEqual({ kind: 'player', id: 'p1' });
  });

  it('Ctrl+click on a non-selected item adds to selection', () => {
    h.store._apply({
      frames: [{
        ...h.store.get().frames[0]!,
        players: [
          { id: 'a', team: 'colonist', x: 200, y: 200, name: '', dead: false },
          { id: 'b', team: 'reyab', x: 400, y: 400, name: '', dead: false },
        ],
      }],
      selection: [{ kind: 'player', id: 'a' }],
    });
    const nodeB = h.playerLayer.getNode('b')!;
    nodeB.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 400, clientY: 400, ctrlKey: true, bubbles: true,
    }));
    nodeB.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 400, clientY: 400, ctrlKey: true, bubbles: true,
    }));
    const sel = h.store.get().selection;
    expect(sel).toContainEqual({ kind: 'player', id: 'a' });
    expect(sel).toContainEqual({ kind: 'player', id: 'b' });
  });

  it('Ctrl+click on an already-selected item removes it from selection', () => {
    h.store._apply({
      frames: [{
        ...h.store.get().frames[0]!,
        players: [{ id: 'a', team: 'colonist', x: 200, y: 200, name: '', dead: false }],
      }],
      selection: [{ kind: 'player', id: 'a' }],
    });
    const nodeA = h.playerLayer.getNode('a')!;
    nodeA.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 200, clientY: 200, ctrlKey: true, bubbles: true,
    }));
    nodeA.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 200, clientY: 200, ctrlKey: true, bubbles: true,
    }));
    expect(h.store.get().selection).not.toContainEqual({ kind: 'player', id: 'a' });
  });

  it('cursor click on empty space falls back to stroke hit-test', () => {
    h.store._apply({
      frames: [{
        ...h.store.get().frames[0]!,
        strokes: [{
          id: 'sx', type: 'draw', color: hex('#00ff88'), alpha: 1, size: 2,
          points: [{ x: 300, y: 300 }],
        }],
      }],
    });
    h.target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 300, clientY: 300, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 300, clientY: 300, bubbles: true,
    }));
    expect(h.store.get().selection).toContainEqual({ kind: 'stroke', id: 'sx' });
  });

  it('clicking inside a cone body (not just root or arc-tip) selects it', () => {
    h.store._apply({
      frames: [{
        ...h.store.get().frames[0]!,
        cones: [{
          id: 'cone1', x: 200, y: 200, angle: 0, length: 200,
          spreadIdx: 1, customHalfAngle: null, color: hex('#00ff88'), attachedPlayerId: null,
        }],
      }],
    });
    // Cone at (200,200) facing right (angle=0), length=200, 45° half-angle.
    // A point at (300,200) is 100 units along the facing axis - well inside
    // the sector body, but ~100 units from both root and arc-tip so the old
    // root/tip-only hit-test missed it.
    h.target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 300, clientY: 200, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 300, clientY: 200, bubbles: true,
    }));
    expect(h.store.get().selection).toContainEqual({ kind: 'cone', id: 'cone1' });
  });

  it('clicking outside a cone body does not select it', () => {
    h.store._apply({
      frames: [{
        ...h.store.get().frames[0]!,
        cones: [{
          id: 'cone1', x: 200, y: 200, angle: 0, length: 200,
          spreadIdx: 1, customHalfAngle: null, color: hex('#00ff88'), attachedPlayerId: null,
        }],
      }],
    });
    // Behind the cone root - opposite the facing direction.
    h.target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 100, clientY: 200, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 100, clientY: 200, bubbles: true,
    }));
    expect(h.store.get().selection).not.toContainEqual({ kind: 'cone', id: 'cone1' });
  });

  it('cones can be dragged once selected via the body', () => {
    h.store._apply({
      frames: [{
        ...h.store.get().frames[0]!,
        cones: [{
          id: 'cone1', x: 200, y: 200, angle: 0, length: 200,
          spreadIdx: 1, customHalfAngle: null, color: hex('#00ff88'), attachedPlayerId: null,
        }],
      }],
    });
    h.target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 300, clientY: 200, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, button: 0, clientX: 380, clientY: 250, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 380, clientY: 250, bubbles: true,
    }));
    const cone = h.store.get().frames[0]!.cones[0]!;
    expect(cone.x).toBe(280);
    expect(cone.y).toBe(250);
  });

  it('press + drag on a player-attached cone detaches it and follows the cursor', () => {
    h.store._apply({
      frames: [{
        ...h.store.get().frames[0]!,
        players: [{ id: 'p1', team: 'colonist', x: 400, y: 300, name: '', dead: false }],
        cones: [{
          id: 'cone1', x: 400, y: 300, angle: 0, length: 200,
          spreadIdx: 1, customHalfAngle: null, color: hex('#ff4444'), attachedPlayerId: 'p1',
        }],
      }],
    });
    const dispatched: unknown[] = [];
    const orig = h.history.dispatch.bind(h.history);
    h.history.dispatch = (c) => { dispatched.push(c); orig(c); };

    // Press on the cone body (60 map-units along the facing axis, clear of the
    // player's hit radius), drag well away from the player.
    h.target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 460, clientY: 300, bubbles: true }));
    h.target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, button: 0, clientX: 560, clientY: 350, bubbles: true }));
    // mid-drag: detached and at the cursor
    expect(h.store.get().frames[0]!.cones[0]!.attachedPlayerId).toBeNull();
    h.target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 560, clientY: 350, bubbles: true }));

    const c = h.store.get().frames[0]!.cones[0]!;
    expect(c.attachedPlayerId).toBeNull();
    expect(c.color).toBe(DEFAULT_CONE_COLOUR);
    expect(c.x).toBe(560);
    expect(c.y).toBe(350);
    expect(dispatched.filter((d) => (d as { t: string }).t === 'cone.modify')).toHaveLength(1);
  });

  it('press without drag on a player-attached cone just selects it (no detach, no dispatch)', () => {
    h.store._apply({
      frames: [{
        ...h.store.get().frames[0]!,
        players: [{ id: 'p1', team: 'colonist', x: 400, y: 300, name: '', dead: false }],
        cones: [{
          id: 'cone1', x: 400, y: 300, angle: 0, length: 200,
          spreadIdx: 1, customHalfAngle: null, color: hex('#ff4444'), attachedPlayerId: 'p1',
        }],
      }],
    });
    const dispatched: unknown[] = [];
    const orig = h.history.dispatch.bind(h.history);
    h.history.dispatch = (c) => { dispatched.push(c); orig(c); };

    h.target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 460, clientY: 300, bubbles: true }));
    h.target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 460, clientY: 300, bubbles: true }));

    expect(h.store.get().frames[0]!.cones[0]!.attachedPlayerId).toBe('p1');
    expect(h.store.get().selection).toEqual([{ kind: 'cone', id: 'cone1' }]);
    expect(dispatched.filter((d) => (d as { t: string }).t === 'cone.modify')).toHaveLength(0);
  });

  it('a shape can be dragged twice in a row without losing the ability to move on the second drag', () => {
    h.store._apply({
      frames: [{
        ...h.store.get().frames[0]!,
        shapes: [{
          id: 'sq1', kind: 'square', x: 100, y: 100, w: 80, h: 80,
          rotation: 0, stroke: hex('#00ff88'), strokeWidth: 2, fill: false,
        }],
      }],
    });
    // First drag: click on the square (centre is 140,140), drag to 240,240.
    h.target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 140, clientY: 140, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, button: 0, clientX: 240, clientY: 240, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 240, clientY: 240, bubbles: true,
    }));
    expect(h.store.get().frames[0]!.shapes[0]!.x).toBe(200);

    // Second drag - pointer down on the new shape position and drag again.
    // The bug: the shape stops responding to drags after the first release.
    h.target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 2, button: 0, clientX: 240, clientY: 240, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 2, button: 0, clientX: 290, clientY: 290, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 2, button: 0, clientX: 290, clientY: 290, bubbles: true,
    }));
    expect(h.store.get().frames[0]!.shapes[0]!.x).toBe(250);
    expect(h.store.get().frames[0]!.shapes[0]!.y).toBe(250);
  });

  it('clicking near a horizontal arrow selects it (segment hit-test, not bbox)', () => {
    h.store._apply({
      frames: [{
        ...h.store.get().frames[0]!,
        shapes: [{
          id: 'arr1', kind: 'arrow', x: 300, y: 400, w: 200, h: 0,
          rotation: 0, stroke: hex('#00ff88'), strokeWidth: 2, fill: false,
        }],
      }],
    });
    // Click a few units off the segment; the old zero-height AABB test missed this.
    h.target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 400, clientY: 406, bubbles: true,
    }));
    expect(h.store.get().selection).toEqual([{ kind: 'shape', id: 'arr1' }]);
  });

  it('clicking well clear of a line does not select it', () => {
    h.store._apply({
      frames: [{
        ...h.store.get().frames[0]!,
        shapes: [{
          id: 'ln1', kind: 'line', x: 300, y: 400, w: 200, h: 0,
          rotation: 0, stroke: hex('#00ff88'), strokeWidth: 2, fill: false,
        }],
      }],
    });
    h.target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 400, clientY: 460, bubbles: true,
    }));
    expect(h.store.get().selection).toEqual([]);
  });
});

describe('SelectTool - cone handle edits (cursor mode, single cone selected)', () => {
  let h: Harness;
  beforeEach(() => { h = harness('cursor'); });
  afterEach(() => { h.tool.detach(); });

  function withCone(cone: Partial<import('../types/primitives').Cone> = {}, players: import('../types/primitives').Player[] = []): void {
    h.store._apply({
      frames: [{
        ...h.store.get().frames[0]!,
        cones: [{ id: 'c1', x: 100, y: 100, angle: 0, length: 200, spreadIdx: 1, customHalfAngle: null, color: hex('#aeb6bb'), attachedPlayerId: null, ...cone }],
        players,
      }],
      selection: [{ kind: 'cone', id: 'c1' }],
    });
  }

  it('dragging the arc-centre dot reshapes the selected cone', () => {
    withCone();
    // Arc tip is at (100 + 200, 100) = (300, 100). Drag it to (100, 250).
    h.target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 300, clientY: 100, bubbles: true }));
    h.target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, button: 0, clientX: 100, clientY: 250, bubbles: true }));
    h.target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 100, clientY: 250, bubbles: true }));
    const c = h.store.get().frames[0]!.cones[0]!;
    expect(c.length).toBe(150);
    expect(c.angle).toBeCloseTo(Math.PI / 2, 4);
    expect(c.x).toBe(100); // origin unchanged
    expect(h.history.canUndo()).toBe(true);
  });

  it('dragging the origin dot onto a player attaches the selected cone', () => {
    withCone({}, [{ id: 'p1', team: 'colonist', x: 500, y: 500, name: '', dead: false }]);
    h.target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    h.target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, button: 0, clientX: 500, clientY: 500, bubbles: true }));
    h.target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 500, clientY: 500, bubbles: true }));
    const c = h.store.get().frames[0]!.cones[0]!;
    expect(c.attachedPlayerId).toBe('p1');
    expect(c.color).toBe('#ff4444');
  });

  it('dragging the cone body away from its player detaches it', () => {
    withCone({ x: 500, y: 500, attachedPlayerId: 'p1', color: hex('#ff4444') }, [{ id: 'p1', team: 'colonist', x: 500, y: 500, name: '', dead: false }]);
    // Grab the cone body (a point along its facing axis) and drag far away.
    h.target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 560, clientY: 500, bubbles: true }));
    h.target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, button: 0, clientX: 960, clientY: 900, bubbles: true }));
    h.target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 960, clientY: 900, bubbles: true }));
    const c = h.store.get().frames[0]!.cones[0]!;
    expect(c.attachedPlayerId).toBeNull();
    expect(c.color).toBe('#aeb6bb');
  });
});

// The selection-highlight tests moved to render/selectionHighlight.test.ts along
// with the code: painting .sel-highlight is driven off store.selection now, not
// by whichever tool happens to be attached, so compact gets it too.

describe('SelectTool - group move', () => {
  let h: Harness;
  beforeEach(() => { h = harness('select'); });
  afterEach(() => { h.tool.detach(); });

  it('dragging a selected player moves all selected players, dispatching one batch on release', () => {
    h.store._apply({
      frames: [{
        ...h.store.get().frames[0]!,
        players: [
          { id: 'a', team: 'colonist', x: 200, y: 200, name: '', dead: false },
          { id: 'b', team: 'reyab', x: 300, y: 300, name: '', dead: false },
        ],
      }],
      selection: [
        { kind: 'player', id: 'a' },
        { kind: 'player', id: 'b' },
      ],
    });
    const nodeA = h.playerLayer.getNode('a')!;
    nodeA.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, button: 0, clientX: 250, clientY: 250, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 250, clientY: 250, bubbles: true,
    }));
    const players = h.store.get().frames[0]!.players;
    expect(players.find((p) => p.id === 'a')!.x).toBe(250);
    expect(players.find((p) => p.id === 'b')!.x).toBe(350);
    expect(h.history.canUndo()).toBe(true);
  });

  it('one undo restores all moved items at once', () => {
    h.store._apply({
      frames: [{
        ...h.store.get().frames[0]!,
        players: [
          { id: 'a', team: 'colonist', x: 200, y: 200, name: '', dead: false },
          { id: 'b', team: 'reyab', x: 300, y: 300, name: '', dead: false },
        ],
      }],
      selection: [{ kind: 'player', id: 'a' }, { kind: 'player', id: 'b' }],
    });
    const nodeA = h.playerLayer.getNode('a')!;
    nodeA.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, button: 0, clientX: 250, clientY: 250, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 250, clientY: 250, bubbles: true,
    }));
    h.history.undo();
    const players = h.store.get().frames[0]!.players;
    expect(players.find((p) => p.id === 'a')!.x).toBe(200);
    expect(players.find((p) => p.id === 'b')!.x).toBe(300);
  });

  it('sub-threshold drag is a no-op', () => {
    h.store._apply({
      frames: [{
        ...h.store.get().frames[0]!,
        players: [{ id: 'a', team: 'colonist', x: 200, y: 200, name: '', dead: false }],
      }],
      selection: [{ kind: 'player', id: 'a' }],
    });
    const nodeA = h.playerLayer.getNode('a')!;
    nodeA.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, button: 0, clientX: 201, clientY: 201, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 201, clientY: 201, bubbles: true,
    }));
    expect(h.history.canUndo()).toBe(false);
    expect(h.store.get().frames[0]!.players[0]!.x).toBe(200);
  });

  it('drag dispatches a batch when items[0] is a scanner ref (regression - was silently no-op)', () => {
    // Seed scanner singleton + player. Selection lists scanner FIRST so
    // finalizeGroupMove reads its delta from items[0].
    h.store._apply({
      frames: [{
        ...h.store.get().frames[0]!,
        scanner: { x: 500, y: 500 },
        players: [{ id: 'p', team: 'colonist', x: 200, y: 200, name: '', dead: false }],
      }],
      selection: [
        { kind: 'scanner', id: 'scanner' },
        { kind: 'player', id: 'p' },
      ],
    });
    const nodeP = h.playerLayer.getNode('p')!;
    nodeP.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, button: 0, clientX: 250, clientY: 250, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 250, clientY: 250, bubbles: true,
    }));
    expect(h.history.canUndo()).toBe(true);
    expect(h.store.get().frames[0]!.players[0]!.x).toBe(250);
    expect(h.store.get().frames[0]!.scanner).toEqual({ x: 550, y: 550 });
  });

  it('drag dispatches a batch when items[0] is a stroke ref (regression - was silently no-op)', () => {
    h.store._apply({
      frames: [{
        ...h.store.get().frames[0]!,
        strokes: [{
          id: 's', type: 'draw', color: hex('#00ff88'), alpha: 1, size: 2,
          points: [{ x: 100, y: 100 }, { x: 110, y: 110 }],
        }],
        players: [{ id: 'p', team: 'colonist', x: 200, y: 200, name: '', dead: false }],
      }],
      selection: [
        { kind: 'stroke', id: 's' },
        { kind: 'player', id: 'p' },
      ],
    });
    const nodeP = h.playerLayer.getNode('p')!;
    nodeP.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, button: 0, clientX: 250, clientY: 250, bubbles: true,
    }));
    h.target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 250, clientY: 250, bubbles: true,
    }));
    expect(h.history.canUndo()).toBe(true);
    expect(h.store.get().frames[0]!.players[0]!.x).toBe(250);
    // Stroke moved by the same delta - points shifted by +50, +50.
    const stroke = h.store.get().frames[0]!.strokes[0]!;
    expect(stroke.points[0]).toEqual({ x: 150, y: 150 });
    expect(stroke.points[1]).toEqual({ x: 160, y: 160 });
  });
});

describe('SelectTool - pointercancel + detach revert in-flight gestures', () => {
  it('marquee: pointercancel hides the overlay and leaves selection alone', () => {
    const h = harness('select');
    h.store._apply({ selection: [{ kind: 'stroke', id: 'pre-existing' }] });
    h.target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    h.target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, button: 0, clientX: 250, clientY: 250, bubbles: true }));
    const marqueeEl = h.zoomViewport.querySelector('#marquee-rect') as HTMLElement;
    expect(marqueeEl.style.display).not.toBe('none');
    h.target.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, button: 0, clientX: 250, clientY: 250, bubbles: true }));
    expect(marqueeEl.style.display).toBe('none');
    expect(h.store.get().selection).toEqual([{ kind: 'stroke', id: 'pre-existing' }]);
    h.tool.detach();
  });

  it('lasso: pointercancel hides the path and leaves selection alone', () => {
    const h = harness('lasso');
    h.store._apply({ selection: [{ kind: 'stroke', id: 'pre-existing' }] });
    h.target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    h.target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true }));
    h.target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, button: 0, clientX: 100, clientY: 300, bubbles: true }));
    const lassoSvg = h.zoomViewport.querySelector('#lasso-svg') as SVGSVGElement;
    expect(lassoSvg.style.display).not.toBe('none');
    h.target.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, button: 0, clientX: 100, clientY: 300, bubbles: true }));
    expect(lassoSvg.style.display).toBe('none');
    expect(h.store.get().selection).toEqual([{ kind: 'stroke', id: 'pre-existing' }]);
    h.tool.detach();
  });

  it('group move: pointercancel reverts moved items and dispatches nothing', () => {
    const h = harness('select');
    h.store._apply({
      frames: [{
        ...h.store.get().frames[0]!,
        players: [{ id: 'a', team: 'colonist', x: 200, y: 200, name: '', dead: false }],
      }],
      selection: [{ kind: 'player', id: 'a' }],
    });
    const nodeA = h.playerLayer.getNode('a')!;
    nodeA.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true }));
    h.target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, button: 0, clientX: 350, clientY: 350, bubbles: true }));
    expect(h.store.get().frames[0]!.players[0]!.x).toBe(350);
    h.target.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, button: 0, clientX: 350, clientY: 350, bubbles: true }));
    expect(h.store.get().frames[0]!.players[0]!.x).toBe(200);
    expect(h.history.canUndo()).toBe(false);
    h.tool.detach();
  });

  it('pan: cancelEdits (frame change) leaves an in-flight pan running', () => {
    const h = harness('cursor');
    h.target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 500, clientY: 500, bubbles: true }));
    h.target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, button: 0, clientX: 700, clientY: 600, bubbles: true }));
    h.tool.cancelEdits();
    h.target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, button: 0, clientX: 800, clientY: 600, bubbles: true }));
    expect(h.store.get().panX).toBe(300);
    h.tool.detach();
  });

  it('pan: pointercancel snaps view back to where the drag started', () => {
    const h = harness('cursor');
    h.target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 500, clientY: 500, bubbles: true }));
    h.target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, button: 0, clientX: 700, clientY: 600, bubbles: true }));
    expect(h.store.get().panX).toBe(200);
    expect(h.store.get().panY).toBe(100);
    h.target.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, button: 0, clientX: 700, clientY: 600, bubbles: true }));
    expect(h.store.get().panX).toBe(0);
    expect(h.store.get().panY).toBe(0);
    h.tool.detach();
  });

  it('cone edit: pointercancel reverts the in-flight reshape and dispatches nothing', () => {
    const h = harness('cursor');
    h.store._apply({
      frames: [{
        ...h.store.get().frames[0]!,
        cones: [{ id: 'c1', x: 100, y: 100, angle: 0, length: 200, spreadIdx: 1, customHalfAngle: null, color: hex('#aeb6bb'), attachedPlayerId: null }],
      }],
      selection: [{ kind: 'cone', id: 'c1' }],
    });
    // Grab the arc-tip (300, 100) and drag it -- live preview kicks in.
    h.target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 300, clientY: 100, bubbles: true }));
    h.target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, button: 0, clientX: 100, clientY: 250, bubbles: true }));
    expect(h.store.get().frames[0]!.cones[0]!.length).not.toBe(200);
    h.target.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, button: 0, clientX: 100, clientY: 250, bubbles: true }));
    const c = h.store.get().frames[0]!.cones[0]!;
    expect(c.length).toBe(200);
    expect(c.angle).toBe(0);
    expect(h.history.canUndo()).toBe(false);
    h.tool.detach();
  });

  it('detach mid-group-move reverts items so the tool swap is clean', () => {
    const h = harness('select');
    h.store._apply({
      frames: [{
        ...h.store.get().frames[0]!,
        players: [{ id: 'a', team: 'colonist', x: 200, y: 200, name: '', dead: false }],
      }],
      selection: [{ kind: 'player', id: 'a' }],
    });
    const nodeA = h.playerLayer.getNode('a')!;
    nodeA.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true }));
    h.target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, button: 0, clientX: 350, clientY: 350, bubbles: true }));
    expect(h.store.get().frames[0]!.players[0]!.x).toBe(350);
    h.tool.detach();
    expect(h.store.get().frames[0]!.players[0]!.x).toBe(200);
    expect(h.history.canUndo()).toBe(false);
  });
});

