import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStore, type StratState } from './store';
import { TransitionController, FRAME_TRANSITION_MS } from './transitions';
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

describe('TransitionController', () => {
  let now = 0;
  let rafCbs: FrameRequestCallback[] = [];
  beforeEach(() => {
    now = 0; rafCbs = [];
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { rafCbs.push(cb); return rafCbs.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const advance = (ms: number): void => { now += ms; const cbs = rafCbs; rafCbs = []; cbs.forEach((cb) => cb(now)); };

  it('idle: getView is the live frame, no effects', () => {
    const f0 = { ...emptyFrame(), players: [player('a', 0, 0)] };
    const store = createStore({ ...baseState(), frames: [f0, { ...emptyFrame() }], activeFrameIdx: 0 });
    const tc = new TransitionController(store);
    expect(tc.getView().frame).toBe(f0);
    expect(tc.getView().effects.size).toBe(0);
  });

  it('on frame.switch: tweens moved players and resolves whenIdle at the end', async () => {
    const f0 = { ...emptyFrame(), players: [player('a', 0, 0)] };
    const f1 = { ...emptyFrame(), players: [player('a', 100, 0)] };
    const store = createStore({ ...baseState(), frames: [f0, f1], activeFrameIdx: 0 });
    const tc = new TransitionController(store);
    let ticks = 0; tc.subscribe(() => { ticks++; });
    store._apply({ activeFrameIdx: 1 });
    const idle = tc.whenIdle();
    advance(FRAME_TRANSITION_MS / 2);
    const mid = tc.getView().frame.players.find((p) => p.id === 'a')!;
    expect(mid.x).toBeGreaterThan(0); expect(mid.x).toBeLessThan(100);
    advance(FRAME_TRANSITION_MS);
    expect(tc.getView().frame).toBe(f1);
    expect(tc.getView().effects.size).toBe(0);
    expect(ticks).toBeGreaterThan(1);
    await expect(idle).resolves.toBeUndefined();
  });

  it('created players fade in, deleted ones fade out at their old spot', () => {
    // 'gone' is reyab and 'new' is colonist -- intentionally on different
    // teams so the diff's (team, per-team number) alias pass doesn't pair
    // them as a moved instance. Same-team unmatched players are exercised
    // by the team-number aliasing test below.
    const gone: Frame['players'][number] = { id: 'gone', team: 'reyab', x: 50, y: 50, name: '', dead: false };
    const f0 = { ...emptyFrame(), players: [gone] };
    const f1 = { ...emptyFrame(), players: [player('new', 10, 10)] };
    const store = createStore({ ...baseState(), frames: [f0, f1], activeFrameIdx: 0 });
    const tc = new TransitionController(store);
    store._apply({ activeFrameIdx: 1 });
    advance(1);
    const v = tc.getView();
    expect(v.frame.players.map((p) => p.id).sort()).toEqual(['gone', 'new']);
    expect(v.frame.players.find((p) => p.id === 'gone')).toMatchObject({ x: 50, y: 50 });
    expect(v.effects.get('new')!.flash).toBe('in');
    expect(v.effects.get('gone')!.flash).toBe('out');
    expect(v.effects.get('new')!.opacity).toBeLessThan(1);
    expect(v.effects.get('gone')!.opacity).toBeGreaterThan(0);
  });

  it('two separately-placed same-team-same-number players animate as a single moved player', () => {
    // The user places colonist #1 in frame 0 and again in frame 1 (rather
    // than duplicating the previous frame). The diff aliases them by
    // (team, per-team number), so the transition lerps from the source
    // position to the destination -- no fade in / fade out.
    const f0 = { ...emptyFrame(), players: [player('a', 100, 100)] };
    const f1 = { ...emptyFrame(), players: [player('b', 200, 200)] };
    const store = createStore({ ...baseState(), frames: [f0, f1], activeFrameIdx: 0 });
    const tc = new TransitionController(store);
    store._apply({ activeFrameIdx: 1 });
    advance(FRAME_TRANSITION_MS / 2); // halfway through the tween
    const v = tc.getView();
    // Destination id wins (this is the moved instance the diff settles on),
    // no fade effect emitted because the aliased pair is a moved player.
    expect(v.frame.players.map((p) => p.id)).toEqual(['b']);
    expect(v.effects.has('a')).toBe(false);
    expect(v.effects.has('b')).toBe(false);
    const b = v.frame.players[0]!;
    // Halfway through the ease-out the position has covered most of the
    // distance from (100,100) toward (200,200) -- check it's strictly
    // between source and destination.
    expect(b.x).toBeGreaterThan(100);
    expect(b.x).toBeLessThan(200);
    expect(b.y).toBeGreaterThan(100);
    expect(b.y).toBeLessThan(200);
  });

  it('interrupting a transition settles it and starts a fresh one', () => {
    const f0 = { ...emptyFrame(), players: [player('a', 0, 0)] };
    const f1 = { ...emptyFrame(), players: [player('a', 100, 0)] };
    const f2 = { ...emptyFrame(), players: [player('a', 100, 100)] };
    const store = createStore({ ...baseState(), frames: [f0, f1, f2], activeFrameIdx: 0 });
    const tc = new TransitionController(store);
    store._apply({ activeFrameIdx: 1 });
    advance(FRAME_TRANSITION_MS / 2);
    store._apply({ activeFrameIdx: 2 });
    advance(1);
    const a = tc.getView().frame.players.find((p) => p.id === 'a')!;
    expect(a.x).toBe(100);
    expect(a.y).toBeGreaterThanOrEqual(0); expect(a.y).toBeLessThan(100);
    advance(FRAME_TRANSITION_MS);
    expect(tc.getView().frame).toBe(f2);
  });

  it('a frames-array change while running aborts with no new transition', () => {
    const f0 = { ...emptyFrame(), players: [player('a', 0, 0)] };
    const f1 = { ...emptyFrame(), players: [player('a', 100, 0)] };
    const store = createStore({ ...baseState(), frames: [f0, f1], activeFrameIdx: 0 });
    const tc = new TransitionController(store);
    store._apply({ activeFrameIdx: 1 });
    advance(FRAME_TRANSITION_MS / 2);
    const f1b = { ...emptyFrame(), players: [player('a', 100, 0), player('b', 7, 7)] };
    store._apply({ frames: [f0, f1b] });
    advance(1);
    expect(tc.getView().frame).toBe(f1b);
    expect(tc.getView().effects.size).toBe(0);
  });

  it('destroy resolves any outstanding whenIdle promises (no hanging awaiters)', async () => {
    const f0 = { ...emptyFrame(), players: [player('a', 0, 0)] };
    const f1 = { ...emptyFrame(), players: [player('a', 100, 0)] };
    const store = createStore({ ...baseState(), frames: [f0, f1], activeFrameIdx: 0 });
    const tc = new TransitionController(store);
    store._apply({ activeFrameIdx: 1 });
    const idle = tc.whenIdle();
    tc.destroy();
    await expect(idle).resolves.toBeUndefined();
  });

  it('reduced-motion: no tween, instant settle, whenIdle resolves immediately', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList));
    const f0 = { ...emptyFrame() }; const f1 = { ...emptyFrame(), players: [player('a', 1, 1)] };
    const store = createStore({ ...baseState(), frames: [f0, f1], activeFrameIdx: 0 });
    const tc = new TransitionController(store);
    let ticks = 0; tc.subscribe(() => { ticks++; });
    store._apply({ activeFrameIdx: 1 });
    const idle = tc.whenIdle();
    expect(tc.getView().frame).toBe(f1);
    expect(ticks).toBe(1);
    await expect(idle).resolves.toBeUndefined();
  });
});
