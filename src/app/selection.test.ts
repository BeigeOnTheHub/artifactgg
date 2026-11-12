import { describe, it, expect } from 'vitest';
import {
  hitTestMarquee, hitTestLasso, findStrokeAt, pointInPolygon, distToSegment, allRefs,
  mergeRefs, toggleRef,
} from './selection';
import type { StratState } from './store';
import { emptyFrame, type Stroke, type Shape, type Cone, type Player, type TextBox, type QuickAdd, type ScannerPlacement, type SelectionRef } from '../types/primitives';
import { hex } from '../types/hex';

function state(overrides: Partial<ReturnType<typeof emptyFrame>> = {}): StratState {
  return {
    mapId: 'miru', zoom: 1, panX: 0, panY: 0,
    frames: [{ ...emptyFrame(), ...overrides }],
    activeFrameIdx: 0,
    notes: '', tool: 'select',
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
}

const PLAYER: Player = { id: 'p1', team: 'colonist', x: 100, y: 100, name: '', dead: false };
const PLAYER_OUT: Player = { id: 'p2', team: 'reyab', x: 999, y: 999, name: '', dead: false };
const CONE_INSIDE: Cone = {
  id: 'c1', x: 100, y: 100, angle: 0, length: 50,
  spreadIdx: 1, customHalfAngle: null, color: hex('#00ff88'), attachedPlayerId: null,
}; // root (100,100), arc-tip (150,100)
const CONE_HALF: Cone = {
  id: 'c2', x: 100, y: 100, angle: 0, length: 200,
  spreadIdx: 1, customHalfAngle: null, color: hex('#00ff88'), attachedPlayerId: null,
}; // root inside, arc-tip outside
const STROKE_INSIDE: Stroke = {
  id: 's1', type: 'draw', color: hex('#00ff88'), alpha: 1, size: 2,
  points: [{ x: 100, y: 100 }, { x: 110, y: 110 }],
};
const STROKE_OUT: Stroke = {
  id: 's2', type: 'draw', color: hex('#00ff88'), alpha: 1, size: 2,
  points: [{ x: 999, y: 999 }, { x: 1000, y: 1000 }],
};
const STROKE_ERASE: Stroke = {
  id: 's3', type: 'erase', color: hex('#000000'), alpha: 1, size: 4,
  points: [{ x: 100, y: 100 }],
};
const SHAPE_INSIDE: Shape = {
  id: 'sh1', kind: 'square', x: 80, y: 80, w: 40, h: 40,
  rotation: 0, stroke: hex('#00ff88'), strokeWidth: 2, fill: false,
};
const SHAPE_OUT: Shape = {
  id: 'sh2', kind: 'square', x: 800, y: 800, w: 20, h: 20,
  rotation: 0, stroke: hex('#00ff88'), strokeWidth: 2, fill: false,
};
const TBOX: TextBox = {
  id: 't1', x: 90, y: 90, w: 20, h: 20, text: '', fontSize: 13, color: hex('#00ff88'),
};
const QA: QuickAdd = { id: 'q1', type: 'grenade', x: 100, y: 100, rangeVisible: false };
const SCANNER: ScannerPlacement = { x: 100, y: 100 };

describe('pointInPolygon', () => {
  const square = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
  ];

  it('detects interior points', () => {
    expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(true);
  });

  it('detects exterior points', () => {
    expect(pointInPolygon({ x: 200, y: 200 }, square)).toBe(false);
  });

  it('handles non-convex polygons', () => {
    const concave = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 },
      { x: 50, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 100 },
    ];
    expect(pointInPolygon({ x: 25, y: 75 }, concave)).toBe(true);   // in the L
    expect(pointInPolygon({ x: 75, y: 75 }, concave)).toBe(false);  // in the notch
  });
});

describe('distToSegment', () => {
  it('returns the perpendicular distance to the segment interior', () => {
    expect(distToSegment({ x: 50, y: 10 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(10);
  });

  it('clamps to the nearest endpoint when the foot of the perpendicular is past the segment', () => {
    expect(distToSegment({ x: 130, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(30);
    expect(distToSegment({ x: -10, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(10);
  });

  it('handles a zero-length segment as a point distance', () => {
    expect(distToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });

  it('returns 0 for a point on the segment', () => {
    expect(distToSegment({ x: 30, y: 30 }, { x: 0, y: 0 }, { x: 100, y: 100 })).toBeCloseTo(0);
  });
});

describe('hitTestMarquee', () => {
  const tl = { x: 50, y: 50 };
  const br = { x: 150, y: 150 };

  it('selects players whose centre is inside the rect', () => {
    const s = state({ players: [PLAYER, PLAYER_OUT] });
    const refs = hitTestMarquee(s, tl, br);
    expect(refs).toContainEqual({ kind: 'player', id: 'p1' });
    expect(refs).not.toContainEqual({ kind: 'player', id: 'p2' });
  });

  it('selects cones only when BOTH root and arc-tip are inside the rect', () => {
    const s = state({ cones: [CONE_INSIDE, CONE_HALF] });
    const refs = hitTestMarquee(s, tl, br);
    expect(refs).toContainEqual({ kind: 'cone', id: 'c1' });
    expect(refs).not.toContainEqual({ kind: 'cone', id: 'c2' });
  });

  it('uses the attached player position for attached cones, not the cones stale c.x/c.y', () => {
    // Cone is attached to a player at (100,100) but its own (x,y) is way off-screen.
    // The marquee around (100,100) should still pick it up - the player is the origin.
    const attached: Cone = {
      id: 'ca', x: 9999, y: 9999, angle: 0, length: 30,
      spreadIdx: 1, customHalfAngle: null, color: hex('#00ff88'), attachedPlayerId: 'p1',
    };
    const s = state({ players: [PLAYER], cones: [attached] });
    const refs = hitTestMarquee(s, tl, br);
    expect(refs).toContainEqual({ kind: 'cone', id: 'ca' });
  });

  it('selects strokes whose any point is inside the rect (skips erase strokes)', () => {
    const s = state({ strokes: [STROKE_INSIDE, STROKE_OUT, STROKE_ERASE] });
    const refs = hitTestMarquee(s, tl, br);
    expect(refs).toContainEqual({ kind: 'stroke', id: 's1' });
    expect(refs).not.toContainEqual({ kind: 'stroke', id: 's2' });
    expect(refs).not.toContainEqual({ kind: 'stroke', id: 's3' });
  });

  it('selects shapes via rotated AABB overlap', () => {
    const s = state({ shapes: [SHAPE_INSIDE, SHAPE_OUT] });
    const refs = hitTestMarquee(s, tl, br);
    expect(refs).toContainEqual({ kind: 'shape', id: 'sh1' });
    expect(refs).not.toContainEqual({ kind: 'shape', id: 'sh2' });
  });

  it('selects textboxes whose centre is inside the rect', () => {
    const s = state({ textboxes: [TBOX] });
    const refs = hitTestMarquee(s, tl, br);
    expect(refs).toContainEqual({ kind: 'textbox', id: 't1' });
  });

  it('selects quickadds whose centre is inside the rect', () => {
    const s = state({ quickadds: [QA] });
    const refs = hitTestMarquee(s, tl, br);
    expect(refs).toContainEqual({ kind: 'quickadd', id: 'q1' });
  });

  it('returns empty array when nothing is in range', () => {
    const s = state({ players: [PLAYER_OUT] });
    expect(hitTestMarquee(s, tl, br)).toEqual([]);
  });
});

describe('hitTestLasso', () => {
  const square: { x: number; y: number }[] = [
    { x: 50, y: 50 }, { x: 151, y: 50 }, { x: 151, y: 151 }, { x: 50, y: 151 },
  ];

  it('selects players whose centre is inside the polygon', () => {
    const s = state({ players: [PLAYER, PLAYER_OUT] });
    const refs = hitTestLasso(s, square);
    expect(refs).toContainEqual({ kind: 'player', id: 'p1' });
    expect(refs).not.toContainEqual({ kind: 'player', id: 'p2' });
  });

  it('selects cones only when BOTH root and arc-tip are inside the polygon', () => {
    const s = state({ cones: [CONE_INSIDE, CONE_HALF] });
    const refs = hitTestLasso(s, square);
    expect(refs).toContainEqual({ kind: 'cone', id: 'c1' });
    expect(refs).not.toContainEqual({ kind: 'cone', id: 'c2' });
  });

  it('uses the attached player position for attached cones, not the cones stale c.x/c.y', () => {
    const attached: Cone = {
      id: 'ca', x: 9999, y: 9999, angle: 0, length: 30,
      spreadIdx: 1, customHalfAngle: null, color: hex('#00ff88'), attachedPlayerId: 'p1',
    };
    const s = state({ players: [PLAYER], cones: [attached] });
    const refs = hitTestLasso(s, square);
    expect(refs).toContainEqual({ kind: 'cone', id: 'ca' });
  });

  it('selects strokes whose any point is inside the polygon (skips erase)', () => {
    const s = state({ strokes: [STROKE_INSIDE, STROKE_OUT, STROKE_ERASE] });
    const refs = hitTestLasso(s, square);
    expect(refs).toContainEqual({ kind: 'stroke', id: 's1' });
    expect(refs).not.toContainEqual({ kind: 'stroke', id: 's2' });
    expect(refs).not.toContainEqual({ kind: 'stroke', id: 's3' });
  });

  it('selects shapes via centre OR any rotated-corner inside the polygon', () => {
    const s = state({ shapes: [SHAPE_INSIDE, SHAPE_OUT] });
    const refs = hitTestLasso(s, square);
    expect(refs).toContainEqual({ kind: 'shape', id: 'sh1' });
    expect(refs).not.toContainEqual({ kind: 'shape', id: 'sh2' });
  });

  it('selects scanner singleton when centre is inside the polygon', () => {
    const s = state({ scanner: SCANNER });
    const refs = hitTestLasso(s, square);
    expect(refs).toContainEqual({ kind: 'scanner', id: 'scanner' });
  });
});

describe('hitTestMarquee - scanner', () => {
  it('selects scanner singleton when centre is inside the rect', () => {
    const s = state({ scanner: SCANNER });
    const refs = hitTestMarquee(s, { x: 50, y: 50 }, { x: 150, y: 150 });
    expect(refs).toContainEqual({ kind: 'scanner', id: 'scanner' });
  });

  it('does not return a scanner ref when frame.scanner is null', () => {
    const s = state({ scanner: null });
    const refs = hitTestMarquee(s, { x: 50, y: 50 }, { x: 150, y: 150 });
    expect(refs).not.toContainEqual({ kind: 'scanner', id: 'scanner' });
  });
});

describe('findStrokeAt', () => {
  it('returns the topmost stroke id within the hit radius', () => {
    const s = state({ strokes: [STROKE_INSIDE, STROKE_OUT] });
    const id = findStrokeAt(s, { x: 100, y: 100 }, 8);
    expect(id).toBe('s1');
  });

  it('returns null when no stroke is within the hit radius', () => {
    const s = state({ strokes: [STROKE_OUT] });
    const id = findStrokeAt(s, { x: 100, y: 100 }, 8);
    expect(id).toBeNull();
  });

  it('skips erase strokes (matches v1)', () => {
    const s = state({ strokes: [STROKE_ERASE] });
    const id = findStrokeAt(s, { x: 100, y: 100 }, 8);
    expect(id).toBeNull();
  });

  it('iterates in reverse so the topmost stroke wins ties', () => {
    const earlier: Stroke = {
      id: 'first', type: 'draw', color: hex('#00ff88'), alpha: 1, size: 2,
      points: [{ x: 100, y: 100 }],
    };
    const later: Stroke = {
      id: 'last', type: 'draw', color: hex('#5bffb0'), alpha: 1, size: 2,
      points: [{ x: 100, y: 100 }],
    };
    const s = state({ strokes: [earlier, later] });
    const id = findStrokeAt(s, { x: 100, y: 100 }, 8);
    expect(id).toBe('last');
  });
});

describe('allRefs', () => {
  it('returns a ref for every selectable primitive in the active frame', () => {
    const s = state({
      players: [{ id: 'p1', team: 'colonist', x: 0, y: 0, name: '', dead: false }],
      cones: [{ id: 'c1', x: 0, y: 0, angle: 0, length: 100, spreadIdx: 1, customHalfAngle: null, color: hex('#ffffff'), attachedPlayerId: null }],
      shapes: [{ id: 'sh1', kind: 'square', x: 0, y: 0, w: 10, h: 10, rotation: 0, stroke: hex('#ffffff'), strokeWidth: 2, fill: false }],
      textboxes: [{ id: 'b1', x: 0, y: 0, w: 50, h: 20, text: 'hi', fontSize: 12, color: hex('#ffffff') }],
      quickadds: [{ id: 'q1', type: 'smoke', x: 0, y: 0, rangeVisible: false }],
      strokes: [
        { id: 'dr1', type: 'draw', color: hex('#ffffff'), alpha: 1, size: 3, points: [{ x: 0, y: 0 }] },
        { id: 'er1', type: 'erase', color: hex('#ffffff'), alpha: 1, size: 3, points: [{ x: 0, y: 0 }] },
      ],
      scanner: { x: 5, y: 5 },
    });
    const refs = allRefs(s);
    expect(refs).toEqual(expect.arrayContaining([
      { kind: 'player', id: 'p1' },
      { kind: 'cone', id: 'c1' },
      { kind: 'shape', id: 'sh1' },
      { kind: 'textbox', id: 'b1' },
      { kind: 'quickadd', id: 'q1' },
      { kind: 'stroke', id: 'dr1' },
      { kind: 'scanner', id: 'scanner' },
    ]));
    // erase strokes are not selectable (matches the marquee/lasso behaviour).
    expect(refs).not.toContainEqual({ kind: 'stroke', id: 'er1' });
    expect(refs).toHaveLength(7);
  });

  it('returns [] for an empty frame and omits a null scanner', () => {
    expect(allRefs(state())).toEqual([]);
    const s = state({ players: [{ id: 'p1', team: 'reyab', x: 1, y: 1, name: '', dead: false }] });
    expect(allRefs(s)).toEqual([{ kind: 'player', id: 'p1' }]);
  });
});

describe('mergeRefs', () => {
  it('appends new refs and de-duplicates by kind+id, keeping a-order', () => {
    const a: SelectionRef[] = [{ kind: 'player', id: 'p1' }, { kind: 'shape', id: 's1' }];
    const b: SelectionRef[] = [{ kind: 'shape', id: 's1' }, { kind: 'player', id: 'p2' }];
    expect(mergeRefs(a, b)).toEqual([
      { kind: 'player', id: 'p1' }, { kind: 'shape', id: 's1' }, { kind: 'player', id: 'p2' },
    ]);
  });

  it('treats the same id under different kinds as distinct', () => {
    const a: SelectionRef[] = [{ kind: 'player', id: 'x' }];
    const b: SelectionRef[] = [{ kind: 'shape', id: 'x' }];
    expect(mergeRefs(a, b)).toEqual([{ kind: 'player', id: 'x' }, { kind: 'shape', id: 'x' }]);
  });
});

describe('toggleRef', () => {
  it('appends a ref that is absent', () => {
    expect(toggleRef([{ kind: 'player', id: 'p1' }], { kind: 'shape', id: 's1' }))
      .toEqual([{ kind: 'player', id: 'p1' }, { kind: 'shape', id: 's1' }]);
  });

  it('removes a ref that is present, leaving the rest', () => {
    expect(toggleRef([{ kind: 'player', id: 'p1' }, { kind: 'shape', id: 's1' }], { kind: 'player', id: 'p1' }))
      .toEqual([{ kind: 'shape', id: 's1' }]);
  });
});
