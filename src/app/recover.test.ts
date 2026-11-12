import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  RECOVER_KEY,
  DEFAULT_DEBOUNCE_MS,
  stratHasContent,
  writeRecover,
  readRecover,
  clearRecover,
  createAutosaver,
} from './recover';
import { createStore, type StratState } from './store';
import type { StratFile } from '../types/stratFile';
import { emptyFrame } from '../types/primitives';
import { hex } from '../types/hex';

function makeStratFile(overrides: Partial<StratFile> = {}): StratFile {
  return {
    v: 2,
    map: 'miru',
    notes: '',
    view: { zoom: 1, panX: 0, panY: 0 },
    frames: [emptyFrame()],
    activeFrame: 0,
    ...overrides,
  };
}

function makeStratState(overrides: Partial<StratState> = {}): StratState {
  return {
    mapId: 'miru',
    zoom: 1,
    panX: 0,
    panY: 0,
    frames: [emptyFrame()],
    activeFrameIdx: 0,
    mapFrames: {},
    notes: '',
    tool: 'cursor',
    colourSlots: [hex('#ff4655'), hex('#00ff88'), hex('#3da9fc'), hex('#ffffff'), hex('#000000')],
    activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: false, changelogOpen: false, touchMultiSelect: false, confirmOpen: null },
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('stratHasContent', () => {
  it('returns false for an empty default strat', () => {
    expect(stratHasContent(makeStratFile())).toBe(false);
  });

  it('returns true when notes are set', () => {
    expect(stratHasContent(makeStratFile({ notes: 'a' }))).toBe(true);
  });

  it('returns true when a frame has a player', () => {
    const file = makeStratFile();
    file.frames[0]!.players.push({ id: 'p1', team: 'colonist', x: 0, y: 0, name: '', dead: false });
    expect(stratHasContent(file)).toBe(true);
  });

  it('returns true when any frame has a placed scanner', () => {
    const file = makeStratFile({ frames: [emptyFrame(), emptyFrame()] });
    file.frames[1]!.scanner = { x: 1, y: 2 };
    expect(stratHasContent(file)).toBe(true);
  });
});

describe('writeRecover / readRecover / clearRecover', () => {
  it('round-trips through localStorage', () => {
    const file = makeStratFile({ notes: 'hi' });
    writeRecover('lib-id-1', file);
    const got = readRecover();
    expect(got).not.toBeNull();
    expect(got!.libraryId).toBe('lib-id-1');
    expect(got!.file.notes).toBe('hi');
    expect(got!.file.map).toBe('miru');
  });

  it('round-trips with a null libraryId (unsaved work)', () => {
    writeRecover(null, makeStratFile({ notes: 'x' }));
    expect(readRecover()!.libraryId).toBeNull();
  });

  it('returns null when no slot has been written', () => {
    expect(readRecover()).toBeNull();
  });

  it('returns null when the slot holds malformed JSON', () => {
    localStorage.setItem(RECOVER_KEY, 'not json');
    expect(readRecover()).toBeNull();
  });

  it('returns null when the strat fails schema validation', () => {
    localStorage.setItem(RECOVER_KEY, JSON.stringify({ libraryId: null, fileJson: '{"v":99}' }));
    expect(readRecover()).toBeNull();
  });

  it('returns null when the recovered strat has no content (no point restoring)', () => {
    writeRecover(null, makeStratFile()); // default = empty
    expect(readRecover()).toBeNull();
  });

  it('clearRecover wipes the slot', () => {
    writeRecover(null, makeStratFile({ notes: 'x' }));
    clearRecover();
    expect(readRecover()).toBeNull();
  });
});

describe('createAutosaver', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('debounces -- one storage write per quiet window even after many edits', () => {
    const store = createStore(makeStratState());
    const off = createAutosaver({
      store,
      currentStratFile: () => ({
        v: 2,
        map: store.get().mapId,
        notes: store.get().notes,
        view: { zoom: store.get().zoom, panX: store.get().panX, panY: store.get().panY },
        frames: store.get().frames,
        activeFrame: store.get().activeFrameIdx,
      }),
      getCurrentLibraryId: () => null,
    });

    // Burst of notes edits within the debounce window.
    for (let i = 0; i < 5; i++) {
      store._apply({ notes: `draft ${i}` });
      vi.advanceTimersByTime(100);
    }
    // The window hasn't elapsed yet; nothing in the slot.
    expect(localStorage.getItem(RECOVER_KEY)).toBeNull();
    vi.advanceTimersByTime(DEFAULT_DEBOUNCE_MS);
    const stored = readRecover();
    expect(stored).not.toBeNull();
    expect(stored!.file.notes).toBe('draft 4');

    off();
  });

  it('clears the slot if the user undoes back to an empty strat', () => {
    const store = createStore(makeStratState({ notes: 'something' }));
    const off = createAutosaver({
      store,
      currentStratFile: () => ({
        v: 2,
        map: store.get().mapId,
        notes: store.get().notes,
        view: { zoom: store.get().zoom, panX: store.get().panX, panY: store.get().panY },
        frames: store.get().frames,
        activeFrame: store.get().activeFrameIdx,
      }),
      getCurrentLibraryId: () => null,
    });

    // First write: real content.
    store._apply({ notes: 'something else' });
    vi.advanceTimersByTime(DEFAULT_DEBOUNCE_MS);
    expect(readRecover()).not.toBeNull();

    // User undoes everything.
    store._apply({ notes: '' });
    vi.advanceTimersByTime(DEFAULT_DEBOUNCE_MS);
    expect(readRecover()).toBeNull();

    off();
  });

  it('captures the current libraryId at write time, not subscribe time', () => {
    const store = createStore(makeStratState());
    let libraryId: string | null = null;
    const off = createAutosaver({
      store,
      currentStratFile: () => ({
        v: 2, map: store.get().mapId, notes: store.get().notes,
        view: { zoom: 1, panX: 0, panY: 0 },
        frames: store.get().frames, activeFrame: store.get().activeFrameIdx,
      }),
      getCurrentLibraryId: () => libraryId,
    });

    libraryId = 'after-save';
    store._apply({ notes: 'edited' });
    vi.advanceTimersByTime(DEFAULT_DEBOUNCE_MS);
    expect(readRecover()!.libraryId).toBe('after-save');

    off();
  });

  it('teardown cancels a pending write', () => {
    const store = createStore(makeStratState());
    const off = createAutosaver({
      store,
      currentStratFile: () => ({
        v: 2, map: store.get().mapId, notes: store.get().notes,
        view: { zoom: 1, panX: 0, panY: 0 },
        frames: store.get().frames, activeFrame: store.get().activeFrameIdx,
      }),
      getCurrentLibraryId: () => null,
    });

    store._apply({ notes: 'in progress' });
    off();
    vi.advanceTimersByTime(DEFAULT_DEBOUNCE_MS * 2);
    expect(readRecover()).toBeNull();
  });
});
