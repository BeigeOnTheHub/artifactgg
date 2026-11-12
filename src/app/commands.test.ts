import { describe, it, expect } from 'vitest';
import { apply, invert } from './commands';
import { createStore, type StratState } from './store';
import { emptyFrame, type Stroke, type Shape, type Cone, type Player, type QuickAdd, type TextBox, type ScannerPlacement } from '../types/primitives';
import { hex } from '../types/hex';
import { STANDARD_ZOOM_100 } from './viewport';

function initial(): StratState {
  return {
    mapId: 'miru',
    zoom: 1,
    panX: 0,
    panY: 0,
    frames: [emptyFrame()],
    activeFrameIdx: 0,
    notes: '',
    tool: 'cursor',
    colourSlots: [hex('#00ff88'), null, null, null, null],
    activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
}

const STROKE: Stroke = {
  id: 's1',
  type: 'draw',
  color: hex('#00ff88'),
  alpha: 0.92,
  size: 4,
  points: [{ x: 10, y: 10 }, { x: 20, y: 20 }],
};

describe('commands - apply/invert round-trips', () => {
  it('tool.set', () => {
    const s = createStore(initial());
    const inv = apply(s, { t: 'tool.set', tool: 'draw' });
    expect(s.get().tool).toBe('draw');
    apply(s, inv);
    expect(s.get().tool).toBe('cursor');
  });

  it('map.select', () => {
    const s = createStore(initial());
    const inv = apply(s, { t: 'map.select', mapId: 'suna' });
    expect(s.get().mapId).toBe('suna');
    apply(s, inv);
    expect(s.get().mapId).toBe('miru');
  });

  describe('map.select - per-map frame memory + zoom reset', () => {
    const PLAYER: Player = { id: 'p1', team: 'reyab', x: 50, y: 60, name: 'A', dead: false };

    it('switching to a never-visited map clears the frames and resets the view to 100%', () => {
      const s = createStore({ ...initial(), zoom: 3, panX: 80, panY: -40 });
      // 'miru' (the initial map) gets a player; switching away should hide it.
      s._apply({ frames: [{ ...emptyFrame(), players: [PLAYER] }] });
      apply(s, { t: 'map.select', mapId: 'suna' });
      expect(s.get().mapId).toBe('suna');
      expect(s.get().frames).toEqual([emptyFrame()]);
      expect(s.get().activeFrameIdx).toBe(0);
      expect(s.get().zoom).toBe(STANDARD_ZOOM_100);
      expect(s.get().panX).toBe(0);
      expect(s.get().panY).toBe(0);
    });

    it('switching back to a visited map restores its frames and active index', () => {
      const s = createStore(initial()); // mapId 'miru'
      s._apply({ frames: [emptyFrame(), { ...emptyFrame(), players: [PLAYER] }], activeFrameIdx: 1 });
      apply(s, { t: 'map.select', mapId: 'suna' });
      // Draw something different on suna so the round-trip is unambiguous.
      s._apply({ frames: [{ ...emptyFrame(), players: [{ ...PLAYER, id: 's1', team: 'colonist' }] }] });
      apply(s, { t: 'map.select', mapId: 'miru' });
      expect(s.get().mapId).toBe('miru');
      expect(s.get().frames).toHaveLength(2);
      expect(s.get().frames[1]!.players).toEqual([PLAYER]);
      expect(s.get().activeFrameIdx).toBe(1);
      // And suna's frame is still remembered if we go back again.
      apply(s, { t: 'map.select', mapId: 'suna' });
      expect(s.get().frames[0]!.players.map((p) => p.id)).toEqual(['s1']);
    });

    it('re-selecting the already-active map is a no-op (does not touch zoom/pan)', () => {
      const s = createStore({ ...initial(), zoom: 2.5, panX: 30, panY: 40 });
      s._apply({ frames: [{ ...emptyFrame(), players: [PLAYER] }] });
      apply(s, { t: 'map.select', mapId: 'miru' }); // already on miru
      expect(s.get().mapId).toBe('miru');
      expect(s.get().zoom).toBe(2.5);
      expect(s.get().panX).toBe(30);
      expect(s.get().panY).toBe(40);
      expect(s.get().frames[0]!.players).toEqual([PLAYER]);
    });

    it('undo of a map switch restores the previous map, its frames, and its view', () => {
      const s = createStore({ ...initial(), zoom: 4, panX: 11, panY: 22 });
      const miruFrames = [{ ...emptyFrame(), players: [PLAYER] }];
      s._apply({ frames: miruFrames, activeFrameIdx: 0 });
      const inv = apply(s, { t: 'map.select', mapId: 'suna' });
      expect(s.get().mapId).toBe('suna');
      expect(s.get().zoom).toBe(STANDARD_ZOOM_100);
      apply(s, inv); // undo
      expect(s.get().mapId).toBe('miru');
      expect(s.get().frames).toEqual(miruFrames);
      expect(s.get().zoom).toBe(4);
      expect(s.get().panX).toBe(11);
      expect(s.get().panY).toBe(22);
    });

    it('redo of a map switch re-applies it (zoom back to 100%)', () => {
      const s = createStore({ ...initial(), zoom: 4 });
      const inv = apply(s, { t: 'map.select', mapId: 'suna' });
      const redo = apply(s, inv); // undo
      expect(s.get().mapId).toBe('miru');
      expect(s.get().zoom).toBe(4);
      apply(s, redo); // redo
      expect(s.get().mapId).toBe('suna');
      expect(s.get().zoom).toBe(STANDARD_ZOOM_100);
    });
  });

  it('view.zoom', () => {
    const s = createStore(initial());
    const inv = apply(s, { t: 'view.zoom', zoom: 2.5 });
    expect(s.get().zoom).toBe(2.5);
    apply(s, inv);
    expect(s.get().zoom).toBe(1);
  });

  it('view.pan', () => {
    const s = createStore(initial());
    const inv = apply(s, { t: 'view.pan', panX: 40, panY: -60 });
    expect(s.get().panX).toBe(40);
    expect(s.get().panY).toBe(-60);
    apply(s, inv);
    expect(s.get().panX).toBe(0);
    expect(s.get().panY).toBe(0);
  });

  it('stroke.add', () => {
    const s = createStore(initial());
    const inv = apply(s, { t: 'stroke.add', stroke: STROKE });
    expect(s.get().frames[0]!.strokes).toHaveLength(1);
    apply(s, inv);
    expect(s.get().frames[0]!.strokes).toHaveLength(0);
  });

  it('stroke.erase', () => {
    const s = createStore(initial());
    apply(s, { t: 'stroke.add', stroke: STROKE });
    const inv = apply(s, { t: 'stroke.erase', ids: ['s1'] });
    expect(s.get().frames[0]!.strokes).toHaveLength(0);
    apply(s, inv);
    expect(s.get().frames[0]!.strokes).toHaveLength(1);
  });

  it('invert() returns the correct inverse without mutating state', () => {
    const s = createStore(initial());
    const inv = invert(s.get(), { t: 'tool.set', tool: 'draw' });
    expect(inv).toEqual({ t: 'tool.set', tool: 'cursor' });
    expect(s.get().tool).toBe('cursor');
  });

});

describe('commands - stroke', () => {
  const STROKE_A: Stroke = {
    id: 'sA', type: 'draw', color: hex('#00ff88'), alpha: 0.92, size: 4,
    points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
  };
  const STROKE_B: Stroke = {
    id: 'sB', type: 'draw', color: hex('#5bffb0'), alpha: 0.8, size: 6,
    points: [{ x: 50, y: 50 }, { x: 60, y: 60 }],
  };

  it('stroke.addMany round-trip', () => {
    const s = createStore(initial());
    const inv = apply(s, { t: 'stroke.addMany', strokes: [STROKE_A, STROKE_B] });
    expect(s.get().frames[0]!.strokes).toHaveLength(2);
    expect(inv).toEqual({ t: 'stroke.erase', ids: ['sA', 'sB'] });
    apply(s, inv);
    expect(s.get().frames[0]!.strokes).toHaveLength(0);
  });

  it('stroke.modify changes the dash and the inverse restores it', () => {
    const s = createStore(initial());
    apply(s, { t: 'stroke.add', stroke: STROKE_A });
    const inv = apply(s, { t: 'stroke.modify', id: 'sA', before: { dash: 'solid' }, after: { dash: 'dotted' } });
    expect(s.get().frames[0]!.strokes[0]!.dash).toBe('dotted');
    expect(inv).toEqual({ t: 'stroke.modify', id: 'sA', before: { dash: 'dotted' }, after: { dash: 'solid' } });
    apply(s, inv);
    expect(s.get().frames[0]!.strokes[0]!.dash).toBe('solid');
  });

  it('stroke.modify on a missing id throws', () => {
    const s = createStore(initial());
    expect(() => apply(s, { t: 'stroke.modify', id: 'nope', before: {}, after: { dash: 'dashed' } })).toThrow();
  });

  it('stroke.erase with multiple ids returns stroke.addMany inverse', () => {
    const s = createStore(initial());
    apply(s, { t: 'stroke.add', stroke: STROKE_A });
    apply(s, { t: 'stroke.add', stroke: STROKE_B });
    const inv = apply(s, { t: 'stroke.erase', ids: ['sA', 'sB'] });
    expect(s.get().frames[0]!.strokes).toHaveLength(0);
    expect(inv.t).toBe('stroke.addMany');
    apply(s, inv);
    expect(s.get().frames[0]!.strokes).toHaveLength(2);
  });

  it('stroke.erase preserves order on multi-id round-trip', () => {
    const s = createStore(initial());
    apply(s, { t: 'stroke.add', stroke: STROKE_A });
    apply(s, { t: 'stroke.add', stroke: STROKE_B });
    const before = s.get().frames[0]!.strokes.map((x) => x.id);
    const inv = apply(s, { t: 'stroke.erase', ids: ['sA', 'sB'] });
    apply(s, inv);
    const after = s.get().frames[0]!.strokes.map((x) => x.id);
    expect(after).toEqual(before);
  });
});

describe('commands - shape', () => {
  const SHAPE_A: Shape = {
    id: 'shA', kind: 'square', x: 100, y: 100, w: 50, h: 30,
    rotation: 0, stroke: hex('#00ff88'), strokeWidth: 2, fill: false,
  };
  const SHAPE_B: Shape = {
    id: 'shB', kind: 'circle', x: 200, y: 150, w: 40, h: 40,
    rotation: 0, stroke: hex('#ff4655'), strokeWidth: 3, fill: true,
  };

  it('shape.add round-trip', () => {
    const s = createStore(initial());
    const inv = apply(s, { t: 'shape.add', shape: SHAPE_A });
    expect(s.get().frames[0]!.shapes).toHaveLength(1);
    expect(inv).toEqual({ t: 'shape.delete', ids: ['shA'] });
    apply(s, inv);
    expect(s.get().frames[0]!.shapes).toHaveLength(0);
  });

  it('shape.addMany round-trip', () => {
    const s = createStore(initial());
    const inv = apply(s, { t: 'shape.addMany', shapes: [SHAPE_A, SHAPE_B] });
    expect(s.get().frames[0]!.shapes).toHaveLength(2);
    expect(inv).toEqual({ t: 'shape.delete', ids: ['shA', 'shB'] });
    apply(s, inv);
    expect(s.get().frames[0]!.shapes).toHaveLength(0);
  });

  it('shape.delete with single id returns shape.add inverse', () => {
    const s = createStore(initial());
    apply(s, { t: 'shape.add', shape: SHAPE_A });
    const inv = apply(s, { t: 'shape.delete', ids: ['shA'] });
    expect(s.get().frames[0]!.shapes).toHaveLength(0);
    expect(inv).toEqual({ t: 'shape.add', shape: SHAPE_A });
    apply(s, inv);
    expect(s.get().frames[0]!.shapes).toHaveLength(1);
  });

  it('shape.delete with multiple ids returns shape.addMany inverse', () => {
    const s = createStore(initial());
    apply(s, { t: 'shape.add', shape: SHAPE_A });
    apply(s, { t: 'shape.add', shape: SHAPE_B });
    const inv = apply(s, { t: 'shape.delete', ids: ['shA', 'shB'] });
    expect(s.get().frames[0]!.shapes).toHaveLength(0);
    expect(inv.t).toBe('shape.addMany');
    apply(s, inv);
    expect(s.get().frames[0]!.shapes).toHaveLength(2);
  });

  it('shape.modify changes only the named id', () => {
    const s = createStore(initial());
    apply(s, { t: 'shape.add', shape: SHAPE_A });
    apply(s, { t: 'shape.add', shape: SHAPE_B });
    const inv = apply(s, {
      t: 'shape.modify', id: 'shA',
      before: { x: 100, y: 100 },
      after: { x: 400, y: 400 },
    });
    expect(s.get().frames[0]!.shapes.find((sh) => sh.id === 'shA')!.x).toBe(400);
    expect(s.get().frames[0]!.shapes.find((sh) => sh.id === 'shB')!.x).toBe(200);
    apply(s, inv);
    expect(s.get().frames[0]!.shapes.find((sh) => sh.id === 'shA')!.x).toBe(100);
  });

  it('shape.modify inverse swaps before/after', () => {
    const s = createStore(initial());
    apply(s, { t: 'shape.add', shape: SHAPE_A });
    const inv = apply(s, {
      t: 'shape.modify', id: 'shA',
      before: { rotation: 0 },
      after: { rotation: 45 },
    });
    expect(inv).toEqual({
      t: 'shape.modify', id: 'shA',
      before: { rotation: 45 },
      after: { rotation: 0 },
    });
  });

  it('shape.modify on missing id throws', () => {
    const s = createStore(initial());
    expect(() => apply(s, {
      t: 'shape.modify', id: 'nope',
      before: { x: 0 }, after: { x: 1 },
    })).toThrow(/shape\.modify/);
  });

  it('shape.delete on missing id throws', () => {
    const s = createStore(initial());
    expect(() => apply(s, { t: 'shape.delete', ids: ['nope'] })).toThrow(/shape\.delete/);
  });
});

describe('commands - cone', () => {
  const CONE_A: Cone = {
    id: 'coneA', x: 100, y: 100, angle: 0, length: 130,
    spreadIdx: 1, customHalfAngle: null, color: hex('#00ff88'), attachedPlayerId: null,
  };
  const CONE_B: Cone = {
    id: 'coneB', x: 300, y: 200, angle: Math.PI / 2, length: 80,
    spreadIdx: 0, customHalfAngle: null, color: hex('#ff4655'), attachedPlayerId: null,
  };

  it('cone.add round-trip', () => {
    const s = createStore(initial());
    const inv = apply(s, { t: 'cone.add', cone: CONE_A });
    expect(s.get().frames[0]!.cones).toHaveLength(1);
    expect(inv).toEqual({ t: 'cone.delete', ids: ['coneA'] });
    apply(s, inv);
    expect(s.get().frames[0]!.cones).toHaveLength(0);
  });

  it('cone.addMany round-trip', () => {
    const s = createStore(initial());
    const inv = apply(s, { t: 'cone.addMany', cones: [CONE_A, CONE_B] });
    expect(s.get().frames[0]!.cones).toHaveLength(2);
    expect(inv).toEqual({ t: 'cone.delete', ids: ['coneA', 'coneB'] });
    apply(s, inv);
    expect(s.get().frames[0]!.cones).toHaveLength(0);
  });

  it('cone.delete with single id returns cone.add inverse', () => {
    const s = createStore(initial());
    apply(s, { t: 'cone.add', cone: CONE_A });
    const inv = apply(s, { t: 'cone.delete', ids: ['coneA'] });
    expect(s.get().frames[0]!.cones).toHaveLength(0);
    expect(inv).toEqual({ t: 'cone.add', cone: CONE_A });
    apply(s, inv);
    expect(s.get().frames[0]!.cones).toHaveLength(1);
  });

  it('cone.delete with multiple ids returns cone.addMany inverse', () => {
    const s = createStore(initial());
    apply(s, { t: 'cone.add', cone: CONE_A });
    apply(s, { t: 'cone.add', cone: CONE_B });
    const inv = apply(s, { t: 'cone.delete', ids: ['coneA', 'coneB'] });
    expect(s.get().frames[0]!.cones).toHaveLength(0);
    expect(inv.t).toBe('cone.addMany');
    apply(s, inv);
    expect(s.get().frames[0]!.cones).toHaveLength(2);
  });

  it('cone.delete on missing id throws', () => {
    const s = createStore(initial());
    expect(() => apply(s, { t: 'cone.delete', ids: ['nope'] })).toThrow(/cone\.delete/);
  });

  it('cone.modify changes only the named id', () => {
    const s = createStore(initial());
    apply(s, { t: 'cone.add', cone: CONE_A });
    apply(s, { t: 'cone.add', cone: CONE_B });
    const inv = apply(s, {
      t: 'cone.modify', id: 'coneA',
      before: { x: 100, y: 100 },
      after: { x: 500, y: 500 },
    });
    expect(s.get().frames[0]!.cones.find((c) => c.id === 'coneA')!.x).toBe(500);
    expect(s.get().frames[0]!.cones.find((c) => c.id === 'coneB')!.x).toBe(300);
    apply(s, inv);
    expect(s.get().frames[0]!.cones.find((c) => c.id === 'coneA')!.x).toBe(100);
  });

  it('cone.modify inverse swaps before/after', () => {
    const s = createStore(initial());
    apply(s, { t: 'cone.add', cone: CONE_A });
    const inv = apply(s, {
      t: 'cone.modify', id: 'coneA',
      before: { angle: 0 },
      after: { angle: Math.PI },
    });
    expect(inv).toEqual({
      t: 'cone.modify', id: 'coneA',
      before: { angle: Math.PI },
      after: { angle: 0 },
    });
  });

  it('cone.modify on missing id throws', () => {
    const s = createStore(initial());
    expect(() => apply(s, {
      t: 'cone.modify', id: 'nope',
      before: { x: 0 }, after: { x: 1 },
    })).toThrow(/cone\.modify/);
  });
});

describe('commands - player', () => {
  const PLAYER_A: Player = {
    id: 'pA', team: 'colonist', x: 100, y: 100, name: 'Alpha', dead: false,
  };
  const PLAYER_B: Player = {
    id: 'pB', team: 'reyab', x: 300, y: 200, name: '', dead: false,
  };

  it('player.add round-trip', () => {
    const s = createStore(initial());
    const inv = apply(s, { t: 'player.add', player: PLAYER_A });
    expect(s.get().frames[0]!.players).toHaveLength(1);
    expect(inv).toEqual({ t: 'player.delete', ids: ['pA'] });
    apply(s, inv);
    expect(s.get().frames[0]!.players).toHaveLength(0);
  });

  it('player.addMany round-trip', () => {
    const s = createStore(initial());
    const inv = apply(s, { t: 'player.addMany', players: [PLAYER_A, PLAYER_B] });
    expect(s.get().frames[0]!.players).toHaveLength(2);
    expect(inv).toEqual({ t: 'player.delete', ids: ['pA', 'pB'] });
    apply(s, inv);
    expect(s.get().frames[0]!.players).toHaveLength(0);
  });

  it('player.delete single id returns player.add inverse', () => {
    const s = createStore(initial());
    apply(s, { t: 'player.add', player: PLAYER_A });
    const inv = apply(s, { t: 'player.delete', ids: ['pA'] });
    expect(s.get().frames[0]!.players).toHaveLength(0);
    expect(inv).toEqual({ t: 'player.add', player: PLAYER_A });
    apply(s, inv);
    expect(s.get().frames[0]!.players).toHaveLength(1);
  });

  it('player.delete multiple ids returns player.addMany inverse', () => {
    const s = createStore(initial());
    apply(s, { t: 'player.add', player: PLAYER_A });
    apply(s, { t: 'player.add', player: PLAYER_B });
    const inv = apply(s, { t: 'player.delete', ids: ['pA', 'pB'] });
    expect(s.get().frames[0]!.players).toHaveLength(0);
    expect(inv.t).toBe('player.addMany');
    apply(s, inv);
    expect(s.get().frames[0]!.players).toHaveLength(2);
  });

  it('player.modify changes only the named id', () => {
    const s = createStore(initial());
    apply(s, { t: 'player.add', player: PLAYER_A });
    apply(s, { t: 'player.add', player: PLAYER_B });
    const inv = apply(s, {
      t: 'player.modify', id: 'pA',
      before: { x: 100, y: 100 },
      after: { x: 500, y: 500 },
    });
    expect(s.get().frames[0]!.players.find((p) => p.id === 'pA')!.x).toBe(500);
    expect(s.get().frames[0]!.players.find((p) => p.id === 'pB')!.x).toBe(300);
    apply(s, inv);
    expect(s.get().frames[0]!.players.find((p) => p.id === 'pA')!.x).toBe(100);
  });

  it('player.modify inverse swaps before/after', () => {
    const s = createStore(initial());
    apply(s, { t: 'player.add', player: PLAYER_A });
    const inv = apply(s, {
      t: 'player.modify', id: 'pA',
      before: { dead: false },
      after: { dead: true },
    });
    expect(inv).toEqual({
      t: 'player.modify', id: 'pA',
      before: { dead: true },
      after: { dead: false },
    });
  });

  it('player.modify on missing id throws', () => {
    const s = createStore(initial());
    expect(() => apply(s, {
      t: 'player.modify', id: 'nope',
      before: { x: 0 }, after: { x: 1 },
    })).toThrow(/player\.modify/);
  });
});

describe('commands - quickadd', () => {
  const QA_A: QuickAdd = {
    id: 'qaA', type: 'grenade', x: 100, y: 100, rangeVisible: false,
  };
  const QA_B: QuickAdd = {
    id: 'qaB', type: 'smoke', x: 300, y: 200, rangeVisible: true,
  };

  it('quickadd.add round-trip', () => {
    const s = createStore(initial());
    const inv = apply(s, { t: 'quickadd.add', qa: QA_A });
    expect(s.get().frames[0]!.quickadds).toHaveLength(1);
    expect(inv).toEqual({ t: 'quickadd.delete', ids: ['qaA'] });
    apply(s, inv);
    expect(s.get().frames[0]!.quickadds).toHaveLength(0);
  });

  it('quickadd.addMany round-trip', () => {
    const s = createStore(initial());
    const inv = apply(s, { t: 'quickadd.addMany', quickadds: [QA_A, QA_B] });
    expect(s.get().frames[0]!.quickadds).toHaveLength(2);
    expect(inv).toEqual({ t: 'quickadd.delete', ids: ['qaA', 'qaB'] });
    apply(s, inv);
    expect(s.get().frames[0]!.quickadds).toHaveLength(0);
  });

  it('quickadd.delete single id returns quickadd.add inverse', () => {
    const s = createStore(initial());
    apply(s, { t: 'quickadd.add', qa: QA_A });
    const inv = apply(s, { t: 'quickadd.delete', ids: ['qaA'] });
    expect(s.get().frames[0]!.quickadds).toHaveLength(0);
    expect(inv).toEqual({ t: 'quickadd.add', qa: QA_A });
    apply(s, inv);
    expect(s.get().frames[0]!.quickadds).toHaveLength(1);
  });

  it('quickadd.delete multiple ids returns quickadd.addMany inverse', () => {
    const s = createStore(initial());
    apply(s, { t: 'quickadd.add', qa: QA_A });
    apply(s, { t: 'quickadd.add', qa: QA_B });
    const inv = apply(s, { t: 'quickadd.delete', ids: ['qaA', 'qaB'] });
    expect(s.get().frames[0]!.quickadds).toHaveLength(0);
    expect(inv.t).toBe('quickadd.addMany');
    apply(s, inv);
    expect(s.get().frames[0]!.quickadds).toHaveLength(2);
  });

  it('quickadd.delete on missing id throws', () => {
    const s = createStore(initial());
    expect(() => apply(s, { t: 'quickadd.delete', ids: ['nope'] })).toThrow(/quickadd\.delete/);
  });

  it('quickadd.modify changes only the named id', () => {
    const s = createStore(initial());
    apply(s, { t: 'quickadd.add', qa: QA_A });
    const inv = apply(s, {
      t: 'quickadd.modify', id: 'qaA',
      before: { rangeVisible: false },
      after: { rangeVisible: true },
    });
    expect(s.get().frames[0]!.quickadds[0]!.rangeVisible).toBe(true);
    apply(s, inv);
    expect(s.get().frames[0]!.quickadds[0]!.rangeVisible).toBe(false);
  });

  it('quickadd.modify on missing id throws', () => {
    const s = createStore(initial());
    expect(() => apply(s, {
      t: 'quickadd.modify', id: 'nope',
      before: { x: 0 }, after: { x: 1 },
    })).toThrow(/quickadd\.modify/);
  });
});

describe('commands - textbox', () => {
  const BOX_A: TextBox = {
    id: 'tA', x: 100, y: 100, w: 120, h: 40,
    text: 'hello', fontSize: 13, color: hex('#00ff88'),
  };
  const BOX_B: TextBox = {
    id: 'tB', x: 300, y: 200, w: 80, h: 32,
    text: '', fontSize: 16, color: hex('#ff4655'),
  };

  it('textbox.add round-trip', () => {
    const s = createStore(initial());
    const inv = apply(s, { t: 'textbox.add', box: BOX_A });
    expect(s.get().frames[0]!.textboxes).toHaveLength(1);
    expect(inv).toEqual({ t: 'textbox.delete', ids: ['tA'] });
    apply(s, inv);
    expect(s.get().frames[0]!.textboxes).toHaveLength(0);
  });

  it('textbox.addMany round-trip', () => {
    const s = createStore(initial());
    const inv = apply(s, { t: 'textbox.addMany', boxes: [BOX_A, BOX_B] });
    expect(s.get().frames[0]!.textboxes).toHaveLength(2);
    expect(inv).toEqual({ t: 'textbox.delete', ids: ['tA', 'tB'] });
    apply(s, inv);
    expect(s.get().frames[0]!.textboxes).toHaveLength(0);
  });

  it('textbox.delete single id returns textbox.add inverse', () => {
    const s = createStore(initial());
    apply(s, { t: 'textbox.add', box: BOX_A });
    const inv = apply(s, { t: 'textbox.delete', ids: ['tA'] });
    expect(s.get().frames[0]!.textboxes).toHaveLength(0);
    expect(inv).toEqual({ t: 'textbox.add', box: BOX_A });
    apply(s, inv);
    expect(s.get().frames[0]!.textboxes).toHaveLength(1);
  });

  it('textbox.delete multiple ids returns textbox.addMany inverse', () => {
    const s = createStore(initial());
    apply(s, { t: 'textbox.add', box: BOX_A });
    apply(s, { t: 'textbox.add', box: BOX_B });
    const inv = apply(s, { t: 'textbox.delete', ids: ['tA', 'tB'] });
    expect(s.get().frames[0]!.textboxes).toHaveLength(0);
    expect(inv.t).toBe('textbox.addMany');
    apply(s, inv);
    expect(s.get().frames[0]!.textboxes).toHaveLength(2);
  });

  it('textbox.delete on missing id throws', () => {
    const s = createStore(initial());
    expect(() => apply(s, { t: 'textbox.delete', ids: ['nope'] })).toThrow(/textbox\.delete/);
  });

  it('textbox.modify changes only the named id', () => {
    const s = createStore(initial());
    apply(s, { t: 'textbox.add', box: BOX_A });
    const inv = apply(s, {
      t: 'textbox.modify', id: 'tA',
      before: { text: 'hello' },
      after: { text: 'world' },
    });
    expect(s.get().frames[0]!.textboxes[0]!.text).toBe('world');
    apply(s, inv);
    expect(s.get().frames[0]!.textboxes[0]!.text).toBe('hello');
  });

  it('textbox.modify on missing id throws', () => {
    const s = createStore(initial());
    expect(() => apply(s, {
      t: 'textbox.modify', id: 'nope',
      before: { x: 0 }, after: { x: 1 },
    })).toThrow(/textbox\.modify/);
  });
});

describe('commands - scanner', () => {
  const POS_A: ScannerPlacement = { x: 100, y: 100 };
  const POS_B: ScannerPlacement = { x: 300, y: 200 };

  it('scanner.place from null places the scanner', () => {
    const s = createStore(initial());
    const inv = apply(s, { t: 'scanner.place', scanner: POS_A });
    expect(s.get().frames[0]!.scanner).toEqual(POS_A);
    expect(inv).toEqual({ t: 'scanner.place', scanner: null });
    apply(s, inv);
    expect(s.get().frames[0]!.scanner).toBeNull();
  });

  it('scanner.place over existing replaces and inverse restores previous', () => {
    const s = createStore(initial());
    apply(s, { t: 'scanner.place', scanner: POS_A });
    const inv = apply(s, { t: 'scanner.place', scanner: POS_B });
    expect(s.get().frames[0]!.scanner).toEqual(POS_B);
    expect(inv).toEqual({ t: 'scanner.place', scanner: POS_A });
    apply(s, inv);
    expect(s.get().frames[0]!.scanner).toEqual(POS_A);
  });

  it('scanner.place null when scanner exists clears and inverse restores', () => {
    const s = createStore(initial());
    apply(s, { t: 'scanner.place', scanner: POS_A });
    const inv = apply(s, { t: 'scanner.place', scanner: null });
    expect(s.get().frames[0]!.scanner).toBeNull();
    expect(inv).toEqual({ t: 'scanner.place', scanner: POS_A });
    apply(s, inv);
    expect(s.get().frames[0]!.scanner).toEqual(POS_A);
  });

  it('scanner.place null when scanner is already null is a no-op (inverse same)', () => {
    const s = createStore(initial());
    const inv = apply(s, { t: 'scanner.place', scanner: null });
    expect(s.get().frames[0]!.scanner).toBeNull();
    expect(inv).toEqual({ t: 'scanner.place', scanner: null });
  });
});

describe('commands - batch', () => {
  const STROKE_X: Stroke = {
    id: 'sX', type: 'draw', color: hex('#00ff88'), alpha: 0.92, size: 4,
    points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
  };
  const SHAPE_X: Shape = {
    id: 'shX', kind: 'square', x: 100, y: 100, w: 50, h: 30,
    rotation: 0, stroke: hex('#00ff88'), strokeWidth: 2, fill: false,
  };

  it('batch with no children is a no-op', () => {
    const s = createStore(initial());
    const inv = apply(s, { t: 'batch', cmds: [] });
    expect(s.get().frames[0]!.strokes).toHaveLength(0);
    expect(inv).toEqual({ t: 'batch', cmds: [] });
  });

  it('a batch whose second child throws leaves the first child unapplied', () => {
    const s = createStore(initial());
    apply(s, { t: 'stroke.add', stroke: STROKE_X });
    expect(() => apply(s, { t: 'batch', cmds: [
      { t: 'stroke.erase', ids: ['sX'] },
      { t: 'shape.delete', ids: ['missing'] },
    ] })).toThrow();
    expect(s.get().frames[0]!.strokes.map((x) => x.id)).toEqual(['sX']);
  });

  it('batch with one child behaves identically to that child', () => {
    const s = createStore(initial());
    const inv = apply(s, { t: 'batch', cmds: [{ t: 'stroke.add', stroke: STROKE_X }] });
    expect(s.get().frames[0]!.strokes).toHaveLength(1);
    expect(inv).toEqual({ t: 'batch', cmds: [{ t: 'stroke.erase', ids: ['sX'] }] });
    apply(s, inv);
    expect(s.get().frames[0]!.strokes).toHaveLength(0);
  });

  it('batch of mixed-kind add commands round-trips', () => {
    const s = createStore(initial());
    const inv = apply(s, {
      t: 'batch',
      cmds: [
        { t: 'stroke.add', stroke: STROKE_X },
        { t: 'shape.add', shape: SHAPE_X },
      ],
    });
    expect(s.get().frames[0]!.strokes).toHaveLength(1);
    expect(s.get().frames[0]!.shapes).toHaveLength(1);
    apply(s, inv);
    expect(s.get().frames[0]!.strokes).toHaveLength(0);
    expect(s.get().frames[0]!.shapes).toHaveLength(0);
  });

  it('batch inverse runs children in reverse order', () => {
    const s = createStore(initial());
    apply(s, { t: 'stroke.add', stroke: STROKE_X });
    // Erase then re-add - inverse must re-apply in reverse: erase the re-add, then add back.
    const inv = apply(s, {
      t: 'batch',
      cmds: [
        { t: 'stroke.erase', ids: ['sX'] },
        { t: 'stroke.add', stroke: STROKE_X },
      ],
    });
    // After batch: stroke is back (erase undid then re-add put it back).
    expect(s.get().frames[0]!.strokes).toHaveLength(1);
    apply(s, inv);
    // After inverting the batch, we should be exactly where we started (one stroke).
    expect(s.get().frames[0]!.strokes).toHaveLength(1);
    expect(s.get().frames[0]!.strokes[0]!.id).toBe('sX');
  });

  it('nested batches round-trip', () => {
    const s = createStore(initial());
    const inv = apply(s, {
      t: 'batch',
      cmds: [
        { t: 'batch', cmds: [{ t: 'stroke.add', stroke: STROKE_X }] },
        { t: 'shape.add', shape: SHAPE_X },
      ],
    });
    expect(s.get().frames[0]!.strokes).toHaveLength(1);
    expect(s.get().frames[0]!.shapes).toHaveLength(1);
    apply(s, inv);
    expect(s.get().frames[0]!.strokes).toHaveLength(0);
    expect(s.get().frames[0]!.shapes).toHaveLength(0);
  });

  it('invert(batch) throws - batch inverses are computed during apply()', () => {
    expect(() =>
      invert(createStore(initial()).get(), { t: 'batch', cmds: [] }),
    ).toThrow(/batch/);
  });
});

describe('commands - colour', () => {
  it('colour.set replaces slot and inverse restores', () => {
    const s = createStore(initial());
    const inv = apply(s, { t: 'colour.set', slot: 0, before: hex('#00ff88'), after: hex('#ff4655') });
    expect(s.get().colourSlots[0]).toBe(hex('#ff4655'));
    expect(inv).toEqual({ t: 'colour.set', slot: 0, before: hex('#ff4655'), after: hex('#00ff88') });
    apply(s, inv);
    expect(s.get().colourSlots[0]).toBe(hex('#00ff88'));
  });

  it('colour.set with before=null sets a previously empty slot', () => {
    const s = createStore(initial());
    const inv = apply(s, { t: 'colour.set', slot: 2, before: null, after: hex('#5b8dff') });
    expect(s.get().colourSlots[2]).toBe(hex('#5b8dff'));
    apply(s, inv);
    expect(s.get().colourSlots[2]).toBeNull();
  });

  it('colour.set with after=null clears a slot', () => {
    const s = createStore(initial());
    apply(s, { t: 'colour.set', slot: 1, before: null, after: hex('#ff4655') });
    apply(s, { t: 'colour.set', slot: 1, before: hex('#ff4655'), after: null });
    expect(s.get().colourSlots[1]).toBeNull();
  });
});

describe('commands - frame.delete (basic)', () => {
  it('removes the frame at idx', () => {
    const s = createStore(initial());
    apply(s, { t: 'frame.add' });
    apply(s, { t: 'frame.add' });
    expect(s.get().frames).toHaveLength(3);
    apply(s, { t: 'frame.delete', idx: 1 });
    expect(s.get().frames).toHaveLength(2);
  });

  it('throws when only one frame remains', () => {
    const s = createStore(initial());
    expect(() => apply(s, { t: 'frame.delete', idx: 0 })).toThrow(/only frame/i);
  });

  it('snaps activeFrameIdx to max 0 when deleting an idx <= active', () => {
    const s = createStore(initial());
    apply(s, { t: 'frame.add' });
    apply(s, { t: 'frame.add' });
    s._apply({ activeFrameIdx: 2 });
    apply(s, { t: 'frame.delete', idx: 1 });
    expect(s.get().activeFrameIdx).toBe(1);
  });

  it('clears selection when active frame is deleted', () => {
    const s = createStore(initial());
    apply(s, { t: 'frame.add' });
    s._apply({ activeFrameIdx: 1, selection: [{ kind: 'stroke', id: 'x' }] });
    apply(s, { t: 'frame.delete', idx: 1 });
    expect(s.get().selection).toEqual([]);
    expect(s.get().activeFrameIdx).toBe(0);
  });

  it('inverse restores frames + active + selection', () => {
    const s = createStore(initial());
    apply(s, { t: 'frame.add' });
    s._apply({ activeFrameIdx: 1, selection: [{ kind: 'stroke', id: 'x' }] });
    const before = s.get();
    const inv = apply(s, { t: 'frame.delete', idx: 1 });
    apply(s, inv);
    expect(s.get().frames).toEqual(before.frames);
    expect(s.get().activeFrameIdx).toBe(1);
    expect(s.get().selection).toEqual([{ kind: 'stroke', id: 'x' }]);
  });
});

describe('commands - frame.add (copies the last frame)', () => {
  const PLAYER: Player = { id: 'p1', team: 'colonist', x: 1, y: 2, name: '', dead: false };

  it('appends a copy of the LAST frame, keeping item ids, and makes it active with cleared selection', () => {
    const s = createStore({
      ...initial(),
      frames: [
        emptyFrame(),
        { ...emptyFrame(), players: [PLAYER, { id: 'p2', team: 'reyab', x: 3, y: 3, name: '', dead: false }] },
      ],
      activeFrameIdx: 0,
      selection: [{ kind: 'player', id: 'p1' }],
    });
    apply(s, { t: 'frame.add' });
    const st = s.get();
    expect(st.frames).toHaveLength(3);
    expect(st.activeFrameIdx).toBe(2);
    expect(st.selection).toEqual([]);
    expect(st.frames[2]!.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(st.frames[2]!.players).not.toBe(st.frames[1]!.players);   // new array
    expect(st.frames[2]!.players[0]).toBe(st.frames[1]!.players[0]); // item shared (copy-on-write)
  });

  it('inverse restores frames, activeFrameIdx and selection', () => {
    const s = createStore({ ...initial(), frames: [emptyFrame(), emptyFrame()], activeFrameIdx: 0 });
    s._apply({ selection: [{ kind: 'player', id: 'p1' }] });
    const inv = apply(s, { t: 'frame.add' });
    expect(inv).toEqual({ t: 'frame._removeLast', activeFrameIdx: 0, selection: [{ kind: 'player', id: 'p1' }] });
    apply(s, inv);
    const st = s.get();
    expect(st.frames).toHaveLength(2);
    expect(st.activeFrameIdx).toBe(0);
    expect(st.selection).toEqual([{ kind: 'player', id: 'p1' }]);
  });

  it('frame._removeLast inverts back to frame.add', () => {
    const s = createStore({ ...initial(), frames: [emptyFrame(), emptyFrame()], activeFrameIdx: 1 });
    expect(apply(s, { t: 'frame._removeLast', activeFrameIdx: 1, selection: [] })).toEqual({ t: 'frame.add' });
  });
});

describe('commands - frame.switch', () => {
  it('sets activeFrameIdx', () => {
    const s = createStore(initial());
    apply(s, { t: 'frame.add' });
    s._apply({ activeFrameIdx: 0 });
    apply(s, { t: 'frame.switch', idx: 1 });
    expect(s.get().activeFrameIdx).toBe(1);
  });

  it('throws on out-of-bounds idx', () => {
    const s = createStore(initial());
    expect(() => apply(s, { t: 'frame.switch', idx: 5 })).toThrow(/out of bounds/i);
    expect(() => apply(s, { t: 'frame.switch', idx: -1 })).toThrow(/out of bounds/i);
  });

  it('clears selection on switch', () => {
    const s = createStore(initial());
    apply(s, { t: 'frame.add' });
    s._apply({ activeFrameIdx: 0, selection: [{ kind: 'stroke', id: 'x' }] });
    apply(s, { t: 'frame.switch', idx: 1 });
    expect(s.get().selection).toEqual([]);
  });

  it('inverse restores prior idx + selection', () => {
    const s = createStore(initial());
    apply(s, { t: 'frame.add' });
    s._apply({ activeFrameIdx: 0, selection: [{ kind: 'stroke', id: 'x' }] });
    const inv = apply(s, { t: 'frame.switch', idx: 1 });
    apply(s, inv);
    expect(s.get().activeFrameIdx).toBe(0);
    expect(s.get().selection).toEqual([{ kind: 'stroke', id: 'x' }]);
  });
});

describe('commands - frame.reorder', () => {
  it('moves a frame from one index to another', () => {
    const s = createStore(initial());
    apply(s, { t: 'frame.add' });
    apply(s, { t: 'frame.add' });
    const f0 = s.get().frames[0]!;
    const f1 = s.get().frames[1]!;
    const f2 = s.get().frames[2]!;
    apply(s, { t: 'frame.reorder', from: 0, to: 2 });
    expect(s.get().frames[0]).toBe(f1);
    expect(s.get().frames[1]).toBe(f2);
    expect(s.get().frames[2]).toBe(f0);
  });

  it('updates activeFrameIdx when the moved frame was active', () => {
    const s = createStore(initial());
    apply(s, { t: 'frame.add' });
    apply(s, { t: 'frame.add' });
    s._apply({ activeFrameIdx: 0 });
    apply(s, { t: 'frame.reorder', from: 0, to: 2 });
    expect(s.get().activeFrameIdx).toBe(2);
  });

  it('updates activeFrameIdx when reorder straddles it', () => {
    const s = createStore(initial());
    apply(s, { t: 'frame.add' });
    apply(s, { t: 'frame.add' });
    s._apply({ activeFrameIdx: 1 });
    // Move frame 0 to position 2 - frame 1 shifts down to position 0.
    apply(s, { t: 'frame.reorder', from: 0, to: 2 });
    expect(s.get().activeFrameIdx).toBe(0);
  });

  it('inverse restores order + active', () => {
    const s = createStore(initial());
    apply(s, { t: 'frame.add' });
    apply(s, { t: 'frame.add' });
    s._apply({ activeFrameIdx: 1 });
    const beforeFrames = s.get().frames;
    const inv = apply(s, { t: 'frame.reorder', from: 0, to: 2 });
    apply(s, inv);
    expect(s.get().frames).toEqual(beforeFrames);
    expect(s.get().activeFrameIdx).toBe(1);
  });

  it('throws on out-of-bounds from/to', () => {
    const s = createStore(initial());
    expect(() => apply(s, { t: 'frame.reorder', from: 0, to: 5 })).toThrow(/out of bounds/i);
    expect(() => apply(s, { t: 'frame.reorder', from: -1, to: 0 })).toThrow(/out of bounds/i);
  });
});

describe('commands - frame.clear', () => {
  it('replaces the active frame content with emptyFrame()', () => {
    const s = createStore(initial());
    apply(s, { t: 'stroke.add', stroke: { id: 's1', type: 'draw', color: hex('#00ff88'), alpha: 1, size: 4, points: [{ x: 0, y: 0 }] } });
    expect(s.get().frames[0]!.strokes).toHaveLength(1);
    const before = s.get().frames[0]!;
    apply(s, { t: 'frame.clear', before });
    expect(s.get().frames[0]).toEqual(emptyFrame());
  });

  it('clears selection on apply', () => {
    const s = createStore(initial());
    s._apply({ selection: [{ kind: 'stroke', id: 'x' }] });
    const before = s.get().frames[0]!;
    apply(s, { t: 'frame.clear', before });
    expect(s.get().selection).toEqual([]);
  });

  it('inverse restores frame content + selection', () => {
    const s = createStore(initial());
    apply(s, { t: 'stroke.add', stroke: { id: 's1', type: 'draw', color: hex('#00ff88'), alpha: 1, size: 4, points: [{ x: 0, y: 0 }] } });
    s._apply({ selection: [{ kind: 'stroke', id: 's1' }] });
    const before = s.get().frames[0]!;
    const beforeSel = s.get().selection;
    const inv = apply(s, { t: 'frame.clear', before });
    apply(s, inv);
    expect(s.get().frames[0]).toEqual(before);
    expect(s.get().selection).toEqual(beforeSel);
  });
});

describe('commands - notes.set', () => {
  it('sets state.notes', () => {
    const s = createStore(initial());
    apply(s, { t: 'notes.set', notes: 'hello' });
    expect(s.get().notes).toBe('hello');
  });

  it('inverse restores prior notes', () => {
    const s = createStore(initial());
    s._apply({ notes: 'first' });
    const inv = apply(s, { t: 'notes.set', notes: 'second' });
    apply(s, inv);
    expect(s.get().notes).toBe('first');
  });
});

describe('commands - frame.setDuration', () => {
  it('frame.setDuration sets the duration and inverts to the prior value', () => {
    const s = createStore({
      ...initial(),
      frames: [emptyFrame(), emptyFrame()],
      activeFrameIdx: 0,
    });
    // frames[0].durationMs is initially undefined
    expect(s.get().frames[0]!.durationMs).toBeUndefined();

    // 1. Set to 2500; inverse restores to undefined
    const inv = apply(s, { t: 'frame.setDuration', frameIdx: 0, durationMs: 2500 });
    expect(s.get().frames[0]!.durationMs).toBe(2500);
    apply(s, inv);
    expect(s.get().frames[0]!.durationMs).toBeUndefined();

    // Re-apply to get back to 2500 for step 3
    apply(s, { t: 'frame.setDuration', frameIdx: 0, durationMs: 2500 });

    // 2. From 2500 -> 4000; inverse restores to 2500
    const inv2 = apply(s, { t: 'frame.setDuration', frameIdx: 0, durationMs: 4000 });
    expect(s.get().frames[0]!.durationMs).toBe(4000);
    apply(s, inv2);
    expect(s.get().frames[0]!.durationMs).toBe(2500);
  });

  it("frame.add copies the last frame's durationMs onto the new frame", () => {
    const s = createStore({
      ...initial(),
      frames: [emptyFrame(), emptyFrame()],
      activeFrameIdx: 0,
    });
    // give the last frame a per-frame duration
    apply(s, { t: 'frame.setDuration', frameIdx: 1, durationMs: 2500 });

    apply(s, { t: 'frame.add' });
    const st = s.get();
    expect(st.frames).toHaveLength(3);
    expect(st.frames[2]!.durationMs).toBe(2500);
    // the copy must not alias the source frame's arrays/object
    expect(st.frames[2]).not.toBe(st.frames[1]);
    expect(st.frames[2]!.strokes).not.toBe(st.frames[1]!.strokes);
    expect(st.frames[2]!.players).not.toBe(st.frames[1]!.players);

    // adding from a frame with NO durationMs yields no durationMs key
    const s2 = createStore({
      ...initial(),
      frames: [emptyFrame(), emptyFrame()],
      activeFrameIdx: 0,
    });
    expect(s2.get().frames[1]!.durationMs).toBeUndefined();
    apply(s2, { t: 'frame.add' });
    expect(s2.get().frames[2]!.durationMs).toBeUndefined();
  });
});

describe('commands - frame.setCaption', () => {
  it('sets and clears caption; inverse round-trips both ways', () => {
    const s = createStore({
      ...initial(),
      frames: [emptyFrame(), emptyFrame()],
      activeFrameIdx: 0,
    });
    expect(s.get().frames[0]!.caption).toBeUndefined();

    // undefined -> "hello"; inverse drops it back to undefined.
    const inv = apply(s, { t: 'frame.setCaption', frameIdx: 0, caption: 'hello' });
    expect(s.get().frames[0]!.caption).toBe('hello');
    apply(s, inv);
    expect(s.get().frames[0]!.caption).toBeUndefined();

    // "hello" -> "world"; inverse restores "hello".
    apply(s, { t: 'frame.setCaption', frameIdx: 0, caption: 'hello' });
    const inv2 = apply(s, { t: 'frame.setCaption', frameIdx: 0, caption: 'world' });
    expect(s.get().frames[0]!.caption).toBe('world');
    apply(s, inv2);
    expect(s.get().frames[0]!.caption).toBe('hello');
  });

  it('empty-string caption is normalised to undefined (no caption)', () => {
    const s = createStore({ ...initial() });
    apply(s, { t: 'frame.setCaption', frameIdx: 0, caption: 'something' });
    expect(s.get().frames[0]!.caption).toBe('something');
    apply(s, { t: 'frame.setCaption', frameIdx: 0, caption: '' });
    expect(s.get().frames[0]!.caption).toBeUndefined();
  });

  it('throws on an out-of-range frameIdx', () => {
    const s = createStore({ ...initial() });
    expect(() => apply(s, { t: 'frame.setCaption', frameIdx: 5, caption: 'x' })).toThrow();
  });

  it('only mutates the targeted frame', () => {
    const s = createStore({
      ...initial(),
      frames: [emptyFrame(), emptyFrame(), emptyFrame()],
    });
    apply(s, { t: 'frame.setCaption', frameIdx: 1, caption: 'mid' });
    expect(s.get().frames[0]!.caption).toBeUndefined();
    expect(s.get().frames[1]!.caption).toBe('mid');
    expect(s.get().frames[2]!.caption).toBeUndefined();
  });
});

describe('commands - callouts.toggle', () => {
  it('flips state.ui.calloutsVisible', () => {
    const s = createStore(initial());
    expect(s.get().ui.calloutsVisible).toBe(true);
    apply(s, { t: 'callouts.toggle', visible: false });
    expect(s.get().ui.calloutsVisible).toBe(false);
  });

  it('inverse swaps the visible flag', () => {
    const s = createStore(initial());
    const inv = apply(s, { t: 'callouts.toggle', visible: false });
    expect(inv).toEqual({ t: 'callouts.toggle', visible: true });
  });

  it('round-trip restores prior state', () => {
    const s = createStore(initial());
    s._apply({ ui: { ...s.get().ui, calloutsVisible: false } });
    const inv = apply(s, { t: 'callouts.toggle', visible: true });
    apply(s, inv);
    expect(s.get().ui.calloutsVisible).toBe(false);
  });
});
