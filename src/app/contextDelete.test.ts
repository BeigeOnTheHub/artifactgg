import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installContextDelete } from './contextDelete';
import { createStore, type StratState } from './store';
import { createHistory } from './history';
import type { Viewport } from '../render/coords';
import { hex } from '../types/hex';

function makeState(): StratState {
  return {
    mapId: 'suna', zoom: 1, panX: 0, panY: 0,
    frames: [{
      players: [{ id: 'p1', x: 200, y: 200, team: 'colonist', name: '', dead: false }],
      cones: [], shapes: [], textboxes: [], quickadds: [],
      strokes: [{
        id: 'k1', type: 'draw', color: hex('#ff0000'), alpha: 1, size: 8,
        points: [{ x: 600, y: 600 }, { x: 700, y: 600 }],
      }],
      scanner: null,
    }],
    activeFrameIdx: 0,
    notes: '', tool: 'cursor', colourSlots: [null, null, null, null, null],
    activeSlot: 0, selection: [],
    ui: {
      sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false,
      libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false,
      hintsOpen: false, calloutsVisible: false, changelogOpen: false, confirmOpen: null,
    },
  };
}

describe('installContextDelete', () => {
  let viewer: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let history: ReturnType<typeof createHistory>;
  let uninstall: () => void;

  // viewer 800x600 over a 1920x1080 map at zoom 1: tx = -560, ty = -240.
  const clientForMap = (mx: number, my: number) => ({ x: mx - 560, y: my - 240 });
  const vp = (): Viewport => ({
    left: 0, top: 0, width: 800, height: 600, w: 1920, h: 1080,
    zoom: store.get().zoom, panX: store.get().panX, panY: store.get().panY,
  });

  const pointerDown = (type: string): void => {
    viewer.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: type, bubbles: true }));
  };
  const contextMenu = (x: number, y: number): boolean =>
    viewer.dispatchEvent(new MouseEvent('contextmenu', { clientX: x, clientY: y, bubbles: true, cancelable: true }));

  const players = (): string[] => store.get().frames[0]!.players.map((p) => p.id);
  const strokes = (): string[] => store.get().frames[0]!.strokes.map((s) => s.id);

  beforeEach(() => {
    viewer = document.createElement('div');
    viewer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
    document.body.appendChild(viewer);
    store = createStore(makeState());
    history = createHistory(store);
    uninstall = installContextDelete(viewer, { store, history, getViewport: vp });
  });

  afterEach(() => { uninstall(); viewer.remove(); });

  it('right-click deletes the node under the cursor as one undo step', () => {
    const c = clientForMap(200, 200);
    pointerDown('mouse');
    contextMenu(c.x, c.y);
    expect(players()).toEqual([]);
    history.undo();
    expect(players()).toEqual(['p1']);
  });

  it('right-click deletes a stroke too', () => {
    const c = clientForMap(600, 600); // on a stored point, see below
    pointerDown('mouse');
    contextMenu(c.x, c.y);
    expect(strokes()).toEqual([]);
  });

  it('misses a stroke halfway between two stored points', () => {
    // Documenting a real limitation rather than asserting it is desirable.
    // findStrokeAt measures distance to each stored POINT, not to the segment
    // between them, so the midpoint of this two-point stroke is 50 units from
    // anything it tests against and the 8px radius cannot reach. A fast-drawn
    // stroke samples sparsely and has gaps you can click straight through.
    // Pre-existing, and invisible at touch radii - 22 screen px at portrait fit
    // zoom is 108 map units.
    const c = clientForMap(650, 600);
    pointerDown('mouse');
    contextMenu(c.x, c.y);
    expect(strokes()).toEqual(['k1']);
  });

  it('right-click on empty space deletes nothing', () => {
    pointerDown('mouse');
    contextMenu(10, 10);
    expect(players()).toEqual(['p1']);
    expect(strokes()).toEqual(['k1']);
  });

  it('always suppresses the browser menu, hit or miss', () => {
    pointerDown('mouse');
    expect(contextMenu(10, 10)).toBe(false); // preventDefault called
  });

  it('does NOT delete after a touch press', () => {
    // A long press on Android raises contextmenu. That gesture belongs to the
    // per-item action menu now, which offers Delete as a deliberate second tap -
    // holding a player must never make it vanish on the spot.
    const c = clientForMap(200, 200);
    pointerDown('touch');
    contextMenu(c.x, c.y);
    expect(players()).toEqual(['p1']);
  });

  it('does NOT delete after a pen press', () => {
    const c = clientForMap(200, 200);
    pointerDown('pen');
    contextMenu(c.x, c.y);
    expect(players()).toEqual(['p1']);
  });

  it('goes back to deleting when the mouse is used again', () => {
    const c = clientForMap(200, 200);
    pointerDown('touch');
    contextMenu(c.x, c.y);
    expect(players()).toEqual(['p1']);

    // The guard tracks the last pointer, not a mode, so a narrow desktop window
    // that reports a coarse pointer still gets right-click-delete from its mouse.
    pointerDown('mouse');
    contextMenu(c.x, c.y);
    expect(players()).toEqual([]);
  });

  it('unhooks both listeners', () => {
    uninstall();
    const c = clientForMap(200, 200);
    pointerDown('mouse');
    expect(contextMenu(c.x, c.y)).toBe(true); // not prevented any more
    expect(players()).toEqual(['p1']);
  });
});
