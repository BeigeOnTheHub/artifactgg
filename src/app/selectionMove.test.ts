import { describe, it, expect } from 'vitest';
import { hitTestPoint, snapshotSelectionForMove, applyMoveDelta, measureMoveDelta, buildMoveCommands } from './selectionMove';
import type { StratState } from './store';
import type { Frame, Stroke } from '../types/primitives';
import { hex } from '../types/hex';
import { createStore } from './store';

function frame(partial: Partial<Frame> = {}): Frame {
  return {
    players: [], cones: [], shapes: [], textboxes: [], quickadds: [],
    strokes: [], scanner: null, ...partial,
  } as Frame;
}
function state(f: Frame): StratState {
  return {
    mapId: 'suna', zoom: 1, panX: 0, panY: 0, frames: [f], activeFrameIdx: 0,
    notes: '', tool: 'cursor', colourSlots: [null, null, null, null, null],
    activeSlot: 0, selection: [], ui: { sidebarTab: 'tools', mode: 'frame',
    paletteOpen: false, shareOpen: false, libraryOpen: false,
    mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false,
    calloutsVisible: false, changelogOpen: false, confirmOpen: null },
  };
}

describe('hitTestPoint', () => {
  it('hits a player within the hit radius (topmost wins)', () => {
    const s = state(frame({
      players: [
        { id: 'p1', x: 100, y: 100, team: 'colonist', name: '', dead: false },
        { id: 'p2', x: 105, y: 100, team: 'colonist', name: '', dead: false },
      ],
    }));
    expect(hitTestPoint(s, { x: 103, y: 100 }, 16)).toEqual({ kind: 'player', id: 'p2' });
  });

  it('returns null when nothing is within the radius', () => {
    const s = state(frame({
      players: [{ id: 'p1', x: 100, y: 100, team: 'colonist', name: '', dead: false }],
    }));
    expect(hitTestPoint(s, { x: 400, y: 400 }, 16)).toBeNull();
  });

  it('hits a shape rectangle by its rotated-AABB envelope', () => {
    const s = state(frame({
      shapes: [{ id: 's1', kind: 'square', x: 50, y: 50, w: 100, h: 80,
        rotation: 0, stroke: hex('#3da9fc'), strokeWidth: 2, fill: false }],
    }));
    expect(hitTestPoint(s, { x: 100, y: 90 }, 16)).toEqual({ kind: 'shape', id: 's1' });
  });
});

describe('hitTestPoint strokes', () => {
  // A stroke was the one primitive hitTestPoint did not know about. SelectTool
  // chained a second call to findStrokeAt after this one, so strokes were
  // clickable on desktop and invisible to every other caller - the touch input
  // controller and long-press delete both call this function alone.
  const stroke = (id: string, type: 'draw' | 'erase' = 'draw'): Stroke => ({
    id, type, color: hex('#ff0000'), alpha: 1, size: 8,
    points: [{ x: 100, y: 100 }, { x: 200, y: 100 }],
  });

  it('hits a stroke', () => {
    const s = state(frame({ strokes: [stroke('k1')] }));
    expect(hitTestPoint(s, { x: 100, y: 104 }, 16)).toEqual({ kind: 'stroke', id: 'k1' });
  });

  it('lets a player on top of a stroke win', () => {
    const s = state(frame({
      strokes: [stroke('k1')],
      players: [{ id: 'p1', x: 100, y: 100, team: 'colonist', name: '', dead: false }],
    }));
    expect(hitTestPoint(s, { x: 100, y: 104 }, 16)).toEqual({ kind: 'player', id: 'p1' });
  });

  it('never returns an erase stroke', () => {
    const s = state(frame({ strokes: [stroke('k1', 'erase')] }));
    expect(hitTestPoint(s, { x: 100, y: 104 }, 16)).toBeNull();
  });

  it('defaults the stroke radius to the point radius', () => {
    const s = state(frame({ strokes: [stroke('k1')] }));
    // 40 away from the line, well outside size/2 = 4, so only a big radius hits.
    expect(hitTestPoint(s, { x: 100, y: 140 }, 50)).toEqual({ kind: 'stroke', id: 'k1' });
    expect(hitTestPoint(s, { x: 100, y: 140 }, 16)).toBeNull();
  });

  it('takes a separate stroke radius so the desktop tool can keep a tighter one', () => {
    const s = state(frame({ strokes: [stroke('k1')] }));
    // Inside the 50 point radius, outside the 8 stroke radius: no hit.
    expect(hitTestPoint(s, { x: 100, y: 140 }, 50, 8)).toBeNull();
    expect(hitTestPoint(s, { x: 100, y: 140 }, 50, 50)).toEqual({ kind: 'stroke', id: 'k1' });
  });
});

describe('move helpers', () => {
  it('snapshots, live-moves and builds one modify command for a player', () => {
    const f = frame({
      players: [{ id: 'p1', x: 100, y: 100, team: 'colonist', name: '', dead: false }],
    });
    const store = createStore(state(f));
    const items = snapshotSelectionForMove(f, [{ kind: 'player', id: 'p1' }]);
    expect(items).toEqual([{ ref: { kind: 'player', id: 'p1' }, beforeX: 100, beforeY: 100 }]);

    applyMoveDelta(store, items, 30, -10);
    const live = store.get().frames[0]!.players[0]!;
    expect([live.x, live.y]).toEqual([130, 90]);

    const d = measureMoveDelta(store.get().frames[0]!, items[0]!);
    expect(d).toEqual({ dx: 30, dy: -10 });

    applyMoveDelta(store, items, 0, 0); // drag-revert
    expect(store.get().frames[0]!.players[0]!.x).toBe(100);

    const cmds = buildMoveCommands(store.get().frames[0]!, items, 30, -10);
    expect(cmds).toEqual([{
      t: 'player.modify', id: 'p1',
      before: { x: 100, y: 100 }, after: { x: 130, y: 90 },
    }]);
  });

  it('keeps an attached cone attached when moved with its player, even if its stored x/y is stale', () => {
    // The player was dragged on its own earlier, which never rewrites cone.x/y.
    const f = frame({
      players: [{ id: 'p1', x: 500, y: 500, team: 'colonist', name: '', dead: false }],
      cones: [{ id: 'c1', x: 100, y: 100, angle: 0, length: 100, spreadIdx: 0,
        customHalfAngle: null, color: null, attachedPlayerId: 'p1' }],
    });
    const items = snapshotSelectionForMove(f, [{ kind: 'player', id: 'p1' }, { kind: 'cone', id: 'c1' }]);
    const store = createStore(state(f));
    applyMoveDelta(store, items, 50, 50);
    const cmds = buildMoveCommands(store.get().frames[0]!, items, 50, 50);
    const cone = cmds.find((c) => c.t === 'cone.modify');
    expect(cone && 'after' in cone ? cone.after.attachedPlayerId : 'missing').toBeUndefined();
  });
});
