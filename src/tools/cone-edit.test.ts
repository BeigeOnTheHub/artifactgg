import { describe, it, expect } from 'vitest';
import {
  coneOrigin, coneArcTip, coneEffectiveColour, hitConeHandle,
  nearestPlayerForAttach, clampConeLength, coneMoveAttachPayload,
  commitConeEdit, snapshotConeForEdit, liveConeEdit, revertConeEdit,
} from './cone-edit';
import { emptyFrame, type Cone, type Frame, type Player } from '../types/primitives';
import { hex } from '../types/hex';
import { createStore, type StratState } from '../app/store';
import { createHistory } from '../app/history';

function frameWith(players: Player[], cones: Cone[] = []): Frame {
  return { ...emptyFrame(), players, cones };
}

function baseState(frame: Frame): StratState {
  return {
    mapId: 'suna', zoom: 1, panX: 0, panY: 0, frames: [frame], activeFrameIdx: 0, notes: '',
    tool: 'cursor', colourSlots: [null, null, null, null, null], activeSlot: 0, selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false,
      mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: false,
      changelogOpen: false, confirmOpen: null },
  };
}

const CONE: Cone = {
  id: 'c', x: 100, y: 200, angle: 0, length: 130,
  spreadIdx: 1, customHalfAngle: null, color: hex('#aeb6bb'), attachedPlayerId: null,
};

describe('cone-edit helpers', () => {
  it('coneOrigin: free cone uses its own coords', () => {
    expect(coneOrigin(CONE, frameWith([]))).toEqual({ x: 100, y: 200 });
  });

  it('coneOrigin: attached cone uses the player position', () => {
    const f = frameWith([{ id: 'p1', team: 'colonist', x: 50, y: 60, name: '', dead: false }]);
    expect(coneOrigin({ ...CONE, attachedPlayerId: 'p1' }, f)).toEqual({ x: 50, y: 60 });
  });

  it('coneOrigin: attached cone with a missing player falls back to its own coords', () => {
    expect(coneOrigin({ ...CONE, attachedPlayerId: 'gone' }, frameWith([]))).toEqual({ x: 100, y: 200 });
  });

  it('coneArcTip: at angle 0 it is length px to the right of the origin', () => {
    expect(coneArcTip(CONE, { x: 0, y: 0 })).toEqual({ x: 130, y: 0 });
  });

  it('coneArcTip: at angle pi/2 it is length px below the origin', () => {
    const tip = coneArcTip({ ...CONE, angle: Math.PI / 2 }, { x: 0, y: 0 });
    expect(tip.x).toBeCloseTo(0, 6);
    expect(tip.y).toBeCloseTo(130, 6);
  });

  it('coneEffectiveColour: attached -> team colour, else stored colour', () => {
    const f = frameWith([{ id: 'p1', team: 'reyab', x: 0, y: 0, name: '', dead: false }]);
    expect(coneEffectiveColour({ ...CONE, attachedPlayerId: 'p1' }, f)).toBe('#00ccee');
    expect(coneEffectiveColour(CONE, f)).toBe('#aeb6bb');
  });

  it('hitConeHandle: origin / arc / miss; origin wins ties', () => {
    const o = { x: 100, y: 200 };
    expect(hitConeHandle(CONE, o, { x: 102, y: 201 })).toBe('origin');
    expect(hitConeHandle(CONE, o, { x: 232, y: 200 })).toBe('arc'); // arc tip ~ (230, 200)
    expect(hitConeHandle(CONE, o, { x: 800, y: 800 })).toBeNull();
    // A zero-length cone has origin == arc-tip - origin must win.
    expect(hitConeHandle({ ...CONE, length: 0 }, o, { x: 100, y: 200 })).toBe('origin');
  });

  it('nearestPlayerForAttach: closest within threshold, else null', () => {
    const players: Player[] = [
      { id: 'a', team: 'colonist', x: 0, y: 0, name: '', dead: false },
      { id: 'b', team: 'reyab', x: 20, y: 0, name: '', dead: false },
    ];
    expect(nearestPlayerForAttach(players, 5, 0)).toBe('a');
    expect(nearestPlayerForAttach(players, 18, 0)).toBe('b');
    expect(nearestPlayerForAttach(players, 200, 200)).toBeNull();
  });

  it('clampConeLength: clamps to [40, 400] and rounds', () => {
    expect(clampConeLength(10)).toBe(40);
    expect(clampConeLength(999)).toBe(400);
    expect(clampConeLength(123.7)).toBe(124);
  });

  it('coneMoveAttachPayload: unchanged attachment -> position-only payload', () => {
    const f = frameWith([]);
    const { before, after } = coneMoveAttachPayload(f, 300, 400, 100, 200, { attachedPlayerId: null, color: hex('#aeb6bb') });
    expect(before).toEqual({ x: 100, y: 200 });
    expect(after).toEqual({ x: 300, y: 400 });
  });

  it('coneMoveAttachPayload: dropped on a player -> attach + team colour', () => {
    const f = frameWith([{ id: 'p1', team: 'colonist', x: 305, y: 405, name: '', dead: false }]);
    const { before, after } = coneMoveAttachPayload(f, 300, 400, 100, 200, { attachedPlayerId: null, color: hex('#aeb6bb') });
    expect(before).toEqual({ x: 100, y: 200, attachedPlayerId: null, color: '#aeb6bb' });
    expect(after).toEqual({ x: 305, y: 405, attachedPlayerId: 'p1', color: '#ff4444' });
  });

  it('coneMoveAttachPayload: dragged away from its player -> detach + grey', () => {
    const f = frameWith([{ id: 'p1', team: 'colonist', x: 0, y: 0, name: '', dead: false }]);
    const { before, after } = coneMoveAttachPayload(f, 800, 800, 0, 0, { attachedPlayerId: 'p1', color: hex('#ff4444') });
    expect(before).toEqual({ x: 0, y: 0, attachedPlayerId: 'p1', color: '#ff4444' });
    expect(after).toEqual({ x: 800, y: 800, attachedPlayerId: null, color: '#aeb6bb' });
  });
});

describe('commitConeEdit', () => {
  it('origin edit with no movement dispatches nothing and leaves the cone attached', () => {
    // The player has moved away from the cone's stale (x, y) attach-time coords - 
    // a plain click must not be mistaken for "dragged off the player".
    const player: Player = { id: 'p1', team: 'colonist', x: 500, y: 500, name: '', dead: false };
    const cone: Cone = {
      id: 'c1', x: 100, y: 100, angle: 0, length: 200, spreadIdx: 1,
      customHalfAngle: null, color: hex('#00ff88'), attachedPlayerId: 'p1',
    };
    const store = createStore(baseState(frameWith([player], [cone])));
    const history = createHistory(store);
    const dispatched: unknown[] = [];
    const orig = history.dispatch.bind(history);
    history.dispatch = (c) => { dispatched.push(c); orig(c); };

    commitConeEdit(store, history, { id: 'c1', mode: 'origin', before: snapshotConeForEdit(cone) });

    expect(dispatched).toEqual([]);
    expect(store.get().frames[0]!.cones[0]!.attachedPlayerId).toBe('p1');
  });

  it('origin drag that lands back on the same player keeps the cone attached (no-op commit)', () => {
    // Reproduces the bug where dropping the cone within attach-threshold of the
    // original player left attachedPlayerId: null in the store even though
    // commit decided "attach didn't change".
    const player: Player = { id: 'p1', team: 'colonist', x: 100, y: 100, name: '', dead: false };
    const cone: Cone = {
      id: 'c1', x: 100, y: 100, angle: 0, length: 200, spreadIdx: 1,
      customHalfAngle: null, color: hex('#00ff88'), attachedPlayerId: 'p1',
    };
    const store = createStore(baseState(frameWith([player], [cone])));
    const history = createHistory(store);
    const dispatched: unknown[] = [];
    const orig = history.dispatch.bind(history);
    history.dispatch = (c) => { dispatched.push(c); orig(c); };
    const before = snapshotConeForEdit(cone);
    // Live drag detached and moved a hair, still well within attach threshold.
    store._apply({
      frames: store.get().frames.map((f) => ({ ...f, cones: [{ ...cone, x: 102, y: 101, attachedPlayerId: null }] })),
    });

    commitConeEdit(store, history, { id: 'c1', mode: 'origin', before });

    expect(dispatched).toEqual([]);
    const c = store.get().frames[0]!.cones[0]!;
    expect(c.attachedPlayerId).toBe('p1');
    expect(c.x).toBe(100);
    expect(c.y).toBe(100);
  });

  it('origin edit that actually moved the cone away dispatches one cone.modify that detaches it', () => {
    const player: Player = { id: 'p1', team: 'colonist', x: 0, y: 0, name: '', dead: false };
    const cone: Cone = {
      id: 'c1', x: 0, y: 0, angle: 0, length: 200, spreadIdx: 1,
      customHalfAngle: null, color: hex('#ff4444'), attachedPlayerId: 'p1',
    };
    const store = createStore(baseState(frameWith([player], [cone])));
    const history = createHistory(store);
    const dispatched: unknown[] = [];
    const orig = history.dispatch.bind(history);
    history.dispatch = (c) => { dispatched.push(c); orig(c); };
    const before = snapshotConeForEdit(cone);
    // Simulate the live drag: the cone followed the cursor and detached.
    store._apply({
      frames: store.get().frames.map((f) => ({ ...f, cones: [{ ...cone, x: 800, y: 800, attachedPlayerId: null }] })),
    });

    commitConeEdit(store, history, { id: 'c1', mode: 'origin', before });

    expect(dispatched).toHaveLength(1);
    const c = store.get().frames[0]!.cones[0]!;
    expect(c.attachedPlayerId).toBeNull();
    expect(c.x).toBe(800);
    expect(c.y).toBe(800);
  });
});

describe('revertConeEdit', () => {
  it('restores the cone to its pre-drag snapshot and dispatches nothing', () => {
    const cone: Cone = { ...CONE, id: 'c1' };
    const store = createStore(baseState(frameWith([], [cone])));
    const history = createHistory(store);
    const before = snapshotConeForEdit(cone);
    const edit = { id: 'c1', mode: 'arc' as const, before };

    // Live-drag the arc handle: angle + length both change.
    liveConeEdit(store, edit, { x: 100, y: 400 });
    expect(store.get().frames[0]!.cones[0]!.length).not.toBe(130);

    revertConeEdit(store, edit);

    const c = store.get().frames[0]!.cones[0]!;
    expect(c.angle).toBe(before.angle);
    expect(c.length).toBe(before.length);
    expect(c.x).toBe(before.x);
    expect(c.y).toBe(before.y);
    expect(history.canUndo()).toBe(false);
  });
});

describe('hitConeHandle tie-break', () => {
  const cone: Cone = {
    id: 'c1', x: 300, y: 300, angle: 0, length: 130, spreadIdx: 1,
    customHalfAngle: null, color: hex('#aeb6bb'), attachedPlayerId: null,
  };
  const origin = { x: 300, y: 300 };

  it('picks the nearer handle when a large radius puts both in range', () => {
    // Tip is at (430,300). With r=220 (44 screen px at zoom 0.2) both handles are
    // in range from anywhere on the cone, so origin-first would make every
    // reshape a move.
    expect(hitConeHandle(cone, origin, { x: 465, y: 300 }, 220)).toBe('arc');
    expect(hitConeHandle(cone, origin, { x: 320, y: 300 }, 220)).toBe('origin');
    // exactly halfway along leans to the origin (move), the safer default
    expect(hitConeHandle(cone, origin, { x: 365, y: 300 }, 220)).toBe('origin');
  });

  it('still returns null when neither handle is in range', () => {
    expect(hitConeHandle(cone, origin, { x: 900, y: 900 }, 28)).toBeNull();
  });

  it('is unchanged for a normal desktop radius', () => {
    expect(hitConeHandle(cone, origin, { x: 305, y: 300 }, 14)).toBe('origin');
    expect(hitConeHandle(cone, origin, { x: 428, y: 300 }, 14)).toBe('arc');
    expect(hitConeHandle(cone, origin, { x: 365, y: 300 }, 14)).toBeNull();
  });
});
