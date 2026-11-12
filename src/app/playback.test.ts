import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStore, type StratState } from './store';
import { createHistory } from './history';
import { PlaybackController, type PlaybackTransitions } from './playback';
import { emptyFrame } from '../types/primitives';

function baseState(): StratState {
  return {
    mapId: 'suna', zoom: 1, panX: 0, panY: 0, frames: [emptyFrame()], activeFrameIdx: 0, notes: '',
    tool: 'cursor', colourSlots: [null, null, null, null, null], activeSlot: 0, selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false,
      mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: false,
      changelogOpen: false, confirmOpen: null },
  };
}

const immediate: PlaybackTransitions = { whenIdle: () => Promise.resolve(), isAnimating: () => false };

function makeTransitions(): { obj: PlaybackTransitions; flush: () => void } {
  let pending: Array<() => void> = [];
  return {
    obj: { whenIdle: () => new Promise<void>((r) => pending.push(r)), isAnimating: () => pending.length > 0 },
    flush() { const p = pending; pending = []; p.forEach((r) => r()); },
  };
}

describe('PlaybackController', () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
  afterEach(() => { vi.useRealTimers(); });

  it('toggle on the last frame is a no-op; canPlay reflects position', () => {
    const store = createStore({ ...baseState(), frames: [emptyFrame(), emptyFrame()], activeFrameIdx: 1 });
    const pb = new PlaybackController(store, createHistory(store), immediate);
    expect(pb.canPlay(store.get())).toBe(false);
    pb.toggle();
    expect(pb.isPlaying()).toBe(false);
  });

  it('plays through to the last frame, advancing via frame.switch, with the delay between steps', async () => {
    const store = createStore({ ...baseState(), frames: [emptyFrame(), emptyFrame(), emptyFrame()], activeFrameIdx: 0 });
    const t = makeTransitions();
    const pb = new PlaybackController(store, createHistory(store), t.obj);
    pb.setDelay(500);
    pb.toggle();
    expect(pb.isPlaying()).toBe(true);
    expect(store.get().activeFrameIdx).toBe(1);
    t.flush(); await Promise.resolve();
    vi.advanceTimersByTime(500);
    expect(store.get().activeFrameIdx).toBe(2);
    t.flush(); await Promise.resolve();
    vi.advanceTimersByTime(500);
    expect(store.get().activeFrameIdx).toBe(2);
    expect(pb.isPlaying()).toBe(false);
  });

  it('toggle while playing stops the loop and ignores stale callbacks', async () => {
    const store = createStore({ ...baseState(), frames: [emptyFrame(), emptyFrame(), emptyFrame()], activeFrameIdx: 0 });
    const t = makeTransitions();
    const pb = new PlaybackController(store, createHistory(store), t.obj);
    pb.toggle();
    pb.toggle();
    expect(pb.isPlaying()).toBe(false);
    t.flush(); await Promise.resolve();
    vi.advanceTimersByTime(10_000);
    expect(store.get().activeFrameIdx).toBe(1);
  });

  it('delay persists to/from localStorage and clamps to 0..10s', () => {
    const store = createStore({ ...baseState(), frames: [emptyFrame()], activeFrameIdx: 0 });
    const mk = (): PlaybackController => new PlaybackController(store, createHistory(store), immediate);
    const pb1 = mk();
    expect(pb1.delayMs).toBe(1000);
    pb1.setDelay(2500);
    expect(localStorage.getItem('artifact.frame-play-delay')).toBe('2500');
    expect(mk().delayMs).toBe(2500);
    const pb2 = mk();
    pb2.setDelay(99999); expect(pb2.delayMs).toBe(10000);
    pb2.setDelay(-5); expect(pb2.delayMs).toBe(0);
  });

  it('destroy clears a pending timer', async () => {
    const store = createStore({ ...baseState(), frames: [emptyFrame(), emptyFrame(), emptyFrame()], activeFrameIdx: 0 });
    const t = makeTransitions();
    const pb = new PlaybackController(store, createHistory(store), t.obj);
    pb.toggle();
    t.flush(); await Promise.resolve();   // a setTimeout(step) is now pending
    pb.destroy();
    vi.advanceTimersByTime(10_000);
    expect(store.get().activeFrameIdx).toBe(1);  // never advanced again
  });

  it('stops if the active frame moves out from under it between steps (e.g. undo)', async () => {
    const store = createStore({ ...baseState(), frames: [emptyFrame(), emptyFrame(), emptyFrame(), emptyFrame()], activeFrameIdx: 0 });
    const t = makeTransitions();
    const pb = new PlaybackController(store, createHistory(store), t.obj);
    pb.setDelay(500);
    pb.toggle();
    expect(store.get().activeFrameIdx).toBe(1);
    // Simulate the user undoing back to frame 0 while the transition is still mid-flight.
    store._apply({ activeFrameIdx: 0 });
    t.flush(); await Promise.resolve();
    expect(pb.isPlaying()).toBe(false);
    // And further timer advances must not nudge the frame forward.
    vi.advanceTimersByTime(10_000);
    expect(store.get().activeFrameIdx).toBe(0);
  });

  it('stops if the active frame moves between whenIdle and the delay timer firing', async () => {
    const store = createStore({ ...baseState(), frames: [emptyFrame(), emptyFrame(), emptyFrame(), emptyFrame()], activeFrameIdx: 0 });
    const t = makeTransitions();
    const pb = new PlaybackController(store, createHistory(store), t.obj);
    pb.setDelay(500);
    pb.toggle();
    expect(store.get().activeFrameIdx).toBe(1);
    t.flush(); await Promise.resolve();   // whenIdle resolved, delay timer queued
    store._apply({ activeFrameIdx: 0 }); // user nav between timer queue and fire
    vi.advanceTimersByTime(500);
    expect(pb.isPlaying()).toBe(false);
    expect(store.get().activeFrameIdx).toBe(0);
  });

  it('uses a frame durationMs when set, else the global delay', async () => {
    const frameA = emptyFrame();                         // frame 0 - start here
    const frameB = { ...emptyFrame(), durationMs: 3000 }; // frame 1 - has per-frame duration
    const frameC = emptyFrame();                         // frame 2 - no durationMs
    const store = createStore({ ...baseState(), frames: [frameA, frameB, frameC], activeFrameIdx: 0 });
    const t = makeTransitions();
    const pb = new PlaybackController(store, createHistory(store), t.obj);
    pb.setDelay(1000); // global delay

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    // --- first step: switches onto frameB (which has durationMs: 3000) ---
    pb.toggle();
    expect(store.get().activeFrameIdx).toBe(1);
    t.flush(); await Promise.resolve(); // resolve whenIdle so .then() runs
    // setTimeout should have been called with 3000, not 1000
    const callsAfterFirst = setTimeoutSpy.mock.calls.filter(
      (c) => typeof c[1] === 'number' && (c[1] === 1000 || c[1] === 3000),
    );
    expect(callsAfterFirst.at(-1)?.[1]).toBe(3000);

    // --- advance into the timeout so step() fires again -> switches onto frameC ---
    vi.advanceTimersByTime(3000);
    expect(store.get().activeFrameIdx).toBe(2);
    t.flush(); await Promise.resolve(); // resolve whenIdle for the second step
    // frameC has no durationMs - should fall back to global delay 1000
    const callsAfterSecond = setTimeoutSpy.mock.calls.filter(
      (c) => typeof c[1] === 'number' && (c[1] === 1000 || c[1] === 3000),
    );
    expect(callsAfterSecond.at(-1)?.[1]).toBe(1000);

    setTimeoutSpy.mockRestore();
  });
});
