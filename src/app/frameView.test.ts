import { describe, it, expect } from 'vitest';
import { createStore, type StratState } from './store';
import { directFrameView, diffFrames, applyItemEffect } from './frameView';
import { emptyFrame, type Frame } from '../types/primitives';

function baseState(): StratState {
  return {
    mapId: 'suna', zoom: 1, panX: 0, panY: 0, frames: [emptyFrame()], activeFrameIdx: 0, notes: '',
    tool: 'cursor', colourSlots: [null, null, null, null, null], activeSlot: 0, selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false,
      mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: false,
      changelogOpen: false, confirmOpen: null },
  };
}
const player = (id: string, x: number, y: number): Frame['players'][number] =>
  ({ id, team: 'colonist', x, y, name: '', dead: false });

describe('directFrameView', () => {
  it('getView returns the live active frame with no effects', () => {
    const f0 = { ...emptyFrame(), players: [player('a', 1, 1)] };
    const f1 = { ...emptyFrame(), players: [player('b', 2, 2)] };
    const store = createStore({ ...baseState(), frames: [f0, f1], activeFrameIdx: 0 });
    const view = directFrameView(store);
    expect(view.getView().frame).toBe(f0);
    expect(view.getView().effects.size).toBe(0);
    store._apply({ activeFrameIdx: 1 });
    expect(view.getView().frame).toBe(f1);
  });

  it('subscribe fires on frames / activeFrameIdx changes and unsub stops it', () => {
    const store = createStore({ ...baseState(), frames: [emptyFrame()], activeFrameIdx: 0 });
    const view = directFrameView(store);
    let n = 0; const off = view.subscribe(() => { n++; });
    store._apply({ frames: [emptyFrame(), emptyFrame()] }); expect(n).toBe(1);
    store._apply({ activeFrameIdx: 1 }); expect(n).toBe(2);
    off();
    store._apply({ activeFrameIdx: 0 }); expect(n).toBe(2);
  });
});

describe('diffFrames', () => {
  it('classifies created / deleted / moved / unchanged players', () => {
    // 'gone' is reyab and 'new' is a third colonist -- the team-number alias
    // pass below pairs same-team-same-number unmatched players, so this test
    // intentionally avoids that overlap to keep exercising the pure id-based
    // diff. See the "team-number aliasing" describe block for the alias path.
    const goneReyab: Frame['players'][number] = { id: 'gone', team: 'reyab', x: 5, y: 5, name: '', dead: false };
    const from = { ...emptyFrame(), players: [player('keep', 0, 0), player('move', 0, 0), goneReyab] };
    const to   = { ...emptyFrame(), players: [player('keep', 0, 0), player('move', 9, 9), player('new', 1, 1)] };
    const d = diffFrames(from, to);
    expect(d.created).toEqual(new Set(['new']));
    expect(d.deleted).toEqual(new Set(['gone']));
    expect(d.moved).toEqual(new Set(['move']));
  });

  it('treats the scanner singleton as created/deleted/moved by presence + position', () => {
    expect(diffFrames({ ...emptyFrame(), scanner: { x: 1, y: 1 } }, { ...emptyFrame() }).deleted.has('scanner')).toBe(true);
    expect(diffFrames({ ...emptyFrame() }, { ...emptyFrame(), scanner: { x: 1, y: 1 } }).created.has('scanner')).toBe(true);
    expect(diffFrames({ ...emptyFrame(), scanner: { x: 1, y: 1 } }, { ...emptyFrame(), scanner: { x: 2, y: 2 } }).moved.has('scanner')).toBe(true);
  });

  it('classifies a moved cone by any of x/y/angle/length', () => {
    const cone = (id: string, over: Partial<Frame['cones'][number]> = {}): Frame['cones'][number] =>
      ({ id, x: 0, y: 0, angle: 0, length: 100, spreadIdx: 1, customHalfAngle: null, color: '#000000' as never, attachedPlayerId: null, ...over });
    const from = { ...emptyFrame(), cones: [cone('c'), cone('d')] };
    const to   = { ...emptyFrame(), cones: [cone('c', { angle: 1 }), cone('d')] };
    const d = diffFrames(from, to);
    expect(d.moved).toEqual(new Set(['c']));
  });

  describe('player team-number aliasing', () => {
    const reyab = (id: string, x: number, y: number): Frame['players'][number] =>
      ({ id, team: 'reyab', x, y, name: '', dead: false });

    it('two separately-placed colonist #1 players in adjacent frames pair up as a move', () => {
      const from = { ...emptyFrame(), players: [player('a', 100, 100)] };
      const to   = { ...emptyFrame(), players: [player('b', 200, 200)] };
      const d = diffFrames(from, to);
      // 'b' was a created player by id, 'a' a deleted player by id, but they
      // share team=colonist and per-team number 1 -> paired up.
      expect(d.created.size).toBe(0);
      expect(d.deleted.size).toBe(0);
      expect(d.moved).toEqual(new Set(['b']));
      expect(d.aliases.get('b')).toBe('a');
    });

    it('per-team number is independent: colonist #1 does not pair with reyab #1', () => {
      const from = { ...emptyFrame(), players: [player('a', 100, 100)] };
      const to   = { ...emptyFrame(), players: [reyab('b', 200, 200)] };
      const d = diffFrames(from, to);
      expect(d.created).toEqual(new Set(['b']));
      expect(d.deleted).toEqual(new Set(['a']));
      expect(d.moved.size).toBe(0);
      expect(d.aliases.size).toBe(0);
    });

    it('aliases the right pair when two of the same team need matching', () => {
      const from = { ...emptyFrame(), players: [player('a1', 10, 10), player('a2', 20, 20)] };
      const to   = { ...emptyFrame(), players: [player('b1', 30, 30), player('b2', 40, 40)] };
      const d = diffFrames(from, to);
      // a1 -> b1 (both C1), a2 -> b2 (both C2).
      expect(d.moved).toEqual(new Set(['b1', 'b2']));
      expect(d.aliases.get('b1')).toBe('a1');
      expect(d.aliases.get('b2')).toBe('a2');
      expect(d.created.size).toBe(0);
      expect(d.deleted.size).toBe(0);
    });

    it('per-id matches still take precedence over team-number aliasing', () => {
      // p1 is in both frames by id; the other to-player matches the deleted
      // from-player by team-number 2.
      const from = { ...emptyFrame(), players: [player('p1', 10, 10), player('old', 20, 20)] };
      const to   = { ...emptyFrame(), players: [player('p1', 11, 11), player('new', 22, 22)] };
      const d = diffFrames(from, to);
      // p1 moved (geom differs), new aliases to old as C2.
      expect(d.moved).toEqual(new Set(['p1', 'new']));
      expect(d.aliases.get('new')).toBe('old');
      expect(d.created.size).toBe(0);
      expect(d.deleted.size).toBe(0);
    });

    it('does not alias when only one side has a player at that team-number', () => {
      const from = { ...emptyFrame(), players: [player('a', 100, 100)] };
      const to   = { ...emptyFrame(), players: [player('b', 200, 200), player('c', 300, 300)] };
      const d = diffFrames(from, to);
      // 'b' aliases to 'a' (both C1). 'c' is genuinely new (no C2 in from).
      expect(d.moved).toEqual(new Set(['b']));
      expect(d.created).toEqual(new Set(['c']));
      expect(d.deleted.size).toBe(0);
      expect(d.aliases.get('b')).toBe('a');
    });
  });
});

describe('applyItemEffect', () => {
  it('sets inline opacity + flash class, and clears them when undefined', () => {
    const el = document.createElement('div');
    applyItemEffect(el, { opacity: 0.5, flash: 'in' });
    expect(el.style.opacity).toBe('0.5');
    expect(el.classList.contains('frame-flash-in')).toBe(true);
    applyItemEffect(el, { opacity: 0.2, flash: 'out' });
    expect(el.classList.contains('frame-flash-in')).toBe(false);
    expect(el.classList.contains('frame-flash-out')).toBe(true);
    applyItemEffect(el, undefined);
    expect(el.style.opacity).toBe('');
    expect(el.classList.contains('frame-flash-out')).toBe(false);
  });
});
