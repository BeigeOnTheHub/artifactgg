import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, type StratState } from '../app/store';
import { createHistory } from '../app/history';
import { buildNotesEditor } from './notesEditor';
import { emptyFrame } from '../types/primitives';
import { hex } from '../types/hex';

function initial(): StratState {
  return {
    mapId: 'miru', zoom: 1, panX: 0, panY: 0,
    frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '', tool: 'cursor',
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
}

describe('buildNotesEditor', () => {
  let store: ReturnType<typeof createStore>;
  let history: ReturnType<typeof createHistory>;
  let built: ReturnType<typeof buildNotesEditor>;

  beforeEach(() => {
    vi.useFakeTimers();
    store = createStore(initial());
    history = createHistory(store);
    built = buildNotesEditor(store, history);
    document.body.appendChild(built.el);
  });

  afterEach(() => {
    built.destroy();
    built.el.remove();
    vi.useRealTimers();
  });

  function ta(): HTMLTextAreaElement {
    return built.el.querySelector('textarea') as HTMLTextAreaElement;
  }

  it('seeds the textarea from the store', () => {
    expect(ta().value).toBe('');
  });

  it('commits typing to the store after the debounce', () => {
    ta().value = 'rush B';
    ta().dispatchEvent(new Event('input'));
    expect(store.get().notes).toBe('');
    vi.advanceTimersByTime(500);
    expect(store.get().notes).toBe('rush B');
  });

  it('coalesces a burst of typing into one undo step', () => {
    for (const v of ['r', 'ru', 'rush']) {
      ta().value = v;
      ta().dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(500);
    expect(store.get().notes).toBe('rush');
    history.undo();
    expect(store.get().notes).toBe('');
  });

  it('syncs an external store change back into the textarea', () => {
    history.dispatch({ t: 'notes.set', notes: 'from elsewhere' });
    expect(ta().value).toBe('from elsewhere');
  });

  it('destroy flushes a pending edit so closing mid-type does not lose it', () => {
    ta().value = 'half typed';
    ta().dispatchEvent(new Event('input'));
    built.destroy();
    expect(store.get().notes).toBe('half typed');
  });

  it('focus moves keyboard focus to the textarea', () => {
    built.focus();
    expect(document.activeElement).toBe(ta());
  });
});
