import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NotesPane } from './NotesPane';
import { createStore, type StratState } from '../app/store';
import { createHistory } from '../app/history';
import { emptyFrame } from '../types/primitives';
import { hex } from '../types/hex';

function initialState(): StratState {
  return {
    mapId: 'miru', zoom: 1, panX: 0, panY: 0,
    frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '', tool: 'cursor',
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
}

describe('NotesPane', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let history: ReturnType<typeof createHistory>;
  let pane: NotesPane;

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore(initialState());
    history = createHistory(store);
    pane = new NotesPane(host, store, history);
    pane.mount();
  });

  afterEach(() => {
    pane.destroy();
    document.body.removeChild(host);
    vi.useRealTimers();
  });

  it('mounts a textarea inside the host', () => {
    const ta = host.querySelector('textarea');
    expect(ta).not.toBeNull();
    expect(ta?.getAttribute('data-testid')).toBe('notes-textarea');
  });

  it('initial value reflects state.notes', () => {
    pane.destroy();
    store._apply({ notes: 'preset' });
    pane = new NotesPane(host, store, history);
    pane.mount();
    const ta = host.querySelector<HTMLTextAreaElement>('textarea');
    expect(ta?.value).toBe('preset');
  });

  it('input event debounces 500 ms before dispatching notes.set', () => {
    const ta = host.querySelector<HTMLTextAreaElement>('textarea')!;
    ta.value = 'hello';
    ta.dispatchEvent(new Event('input'));

    expect(store.get().notes).toBe(''); // not flushed yet
    vi.advanceTimersByTime(499);
    expect(store.get().notes).toBe('');
    vi.advanceTimersByTime(1);
    expect(store.get().notes).toBe('hello');
  });

  it('rapid edits coalesce into a single dispatch after the debounce window', () => {
    const ta = host.querySelector<HTMLTextAreaElement>('textarea')!;
    ta.value = 'a'; ta.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(200);
    ta.value = 'ab'; ta.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(200);
    ta.value = 'abc'; ta.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(499);
    expect(store.get().notes).toBe('');
    vi.advanceTimersByTime(1);
    expect(store.get().notes).toBe('abc');
  });

  it('external state.notes change syncs the textarea value', () => {
    const ta = host.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(ta.value).toBe('');
    store._apply({ notes: 'externally-set' });
    expect(ta.value).toBe('externally-set');
  });

  it('destroy() flushes pending typing', () => {
    const ta = host.querySelector<HTMLTextAreaElement>('textarea')!;
    ta.value = 'unflushed';
    ta.dispatchEvent(new Event('input'));
    expect(store.get().notes).toBe('');
    pane.destroy();
    expect(store.get().notes).toBe('unflushed');
  });

  it('destroy() actually unbinds the input listener (no leftover writes)', () => {
    const ta = host.querySelector<HTMLTextAreaElement>('textarea')!;
    pane.destroy();
    // After destroy, input events on the orphaned textarea must not schedule
    // a flush against the store anymore.
    ta.value = 'typed-after-destroy';
    ta.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(1000);
    expect(store.get().notes).toBe('');
  });

  it('input.value === current state.notes does not dispatch', () => {
    const ta = host.querySelector<HTMLTextAreaElement>('textarea')!;
    store._apply({ notes: 'same' });
    ta.value = 'same';
    ta.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(600);
    // No spurious history entry. Best we can verify: notes hasn't changed.
    expect(store.get().notes).toBe('same');
  });
});
