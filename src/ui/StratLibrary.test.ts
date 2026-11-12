import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { createStore, type StratState } from '../app/store';
import { saveStrat, listStrats } from '../app/library';
import { StratLibrary } from './StratLibrary';
import { toast } from './Toast';
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

describe('StratLibrary', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let lib: StratLibrary;
  let onLoad: Mock<(id: string) => void>;
  let onNewSave: Mock<() => void>;

  beforeEach(() => {
    localStorage.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore(initialState());
    onLoad = vi.fn();
    onNewSave = vi.fn();
    lib = new StratLibrary(host, store, { onLoad, onNewSave });
    lib.mount();
  });

  afterEach(() => {
    lib.destroy();
    if (host.parentElement) host.parentElement.removeChild(host);
    localStorage.clear();
  });

  function makeFile() {
    return { v: 2 as const, map: 'miru' as const, notes: '', view: { zoom: 1, panX: 0, panY: 0 }, frames: [emptyFrame()], activeFrame: 0 };
  }

  function open(): void {
    const ui = store.get().ui;
    store._apply({ ui: { ...ui, libraryOpen: true } });
  }

  it('renders nothing when libraryOpen is false', () => {
    expect(host.querySelector('.strat-library')).toBeNull();
  });

  it('renders the empty-state when libraryOpen is true and library is empty', () => {
    open();
    expect(host.querySelector('.strat-library')).not.toBeNull();
    expect(host.querySelector('.strat-library-empty')).not.toBeNull();
  });

  it('keeps the same modal when an unrelated ui change lands while it is open', () => {
    open();
    const before = host.querySelector('.strat-library');
    const ui = store.get().ui;
    store._apply({ ui: { ...ui, hintsOpen: true } });
    expect(host.querySelector('.strat-library')).toBe(before);
  });

  it('says storage is blocked instead of "no saves yet" when it is', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    try {
      open();
      expect(host.querySelector('.strat-library-empty')?.textContent).toMatch(/blocked/i);
    } finally {
      spy.mockRestore();
    }
  });

  it('renders a row per saved strat, newest first', () => {
    saveStrat({ name: 'A', file: makeFile(), thumbDataUrl: 'data:image/png;base64,A' });
    vi.useFakeTimers();
    vi.advanceTimersByTime(10);
    saveStrat({ name: 'B', file: makeFile(), thumbDataUrl: 'data:image/png;base64,B' });
    vi.useRealTimers();
    open();
    const rows = host.querySelectorAll('.strat-library-row');
    expect(rows.length).toBe(2);
    expect(rows[0]!.querySelector('.strat-library-row-name')!.textContent).toBe('B');
    expect(rows[1]!.querySelector('.strat-library-row-name')!.textContent).toBe('A');
  });

  it('LOAD invokes onLoad with the entry id', () => {
    const id = saveStrat({ name: 'A', file: makeFile(), thumbDataUrl: 'data:image/png;base64,A' });
    open();
    const btn = host.querySelector('.strat-library-row-load') as HTMLButtonElement;
    btn.click();
    expect(onLoad).toHaveBeenCalledWith(id);
  });

  it('"+ New save" invokes onNewSave', () => {
    open();
    (host.querySelector('.strat-library-new-save') as HTMLButtonElement).click();
    expect(onNewSave).toHaveBeenCalledTimes(1);
  });

  it('RENAME opens a themed input modal and applies the new name on Save', () => {
    const id = saveStrat({ name: 'A', file: makeFile(), thumbDataUrl: 'data:image/png;base64,A' });
    open();
    (host.querySelector('.strat-library-row-rename') as HTMLButtonElement).click();
    const input = host.querySelector<HTMLInputElement>('[data-testid="strat-library-rename-input"]')!;
    expect(input).not.toBeNull();
    expect(input.value).toBe('A');
    input.value = 'A2';
    (host.querySelector<HTMLButtonElement>('[data-testid="strat-library-rename-save"]')!).click();
    expect(listStrats().find((e) => e.id === id)!.name).toBe('A2');
    expect(host.querySelector('.strat-library-rename')).toBeNull();
  });

  it('RENAME Cancel button leaves the name unchanged and closes the modal', () => {
    const id = saveStrat({ name: 'A', file: makeFile(), thumbDataUrl: 'data:image/png;base64,A' });
    open();
    (host.querySelector('.strat-library-row-rename') as HTMLButtonElement).click();
    const input = host.querySelector<HTMLInputElement>('[data-testid="strat-library-rename-input"]')!;
    input.value = 'should-not-apply';
    (host.querySelector<HTMLButtonElement>('[data-testid="strat-library-rename-cancel"]')!).click();
    expect(listStrats().find((e) => e.id === id)!.name).toBe('A');
    expect(host.querySelector('.strat-library-rename')).toBeNull();
  });

  it('RENAME Enter on the input commits and Escape cancels', () => {
    const id = saveStrat({ name: 'A', file: makeFile(), thumbDataUrl: 'data:image/png;base64,A' });
    open();
    (host.querySelector('.strat-library-row-rename') as HTMLButtonElement).click();
    let input = host.querySelector<HTMLInputElement>('[data-testid="strat-library-rename-input"]')!;
    input.value = 'A-via-enter';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(listStrats().find((e) => e.id === id)!.name).toBe('A-via-enter');

    (host.querySelector('.strat-library-row-rename') as HTMLButtonElement).click();
    input = host.querySelector<HTMLInputElement>('[data-testid="strat-library-rename-input"]')!;
    input.value = 'should-not-apply';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(listStrats().find((e) => e.id === id)!.name).toBe('A-via-enter');
  });

  it('RENAME does nothing on an empty/whitespace input', () => {
    const id = saveStrat({ name: 'A', file: makeFile(), thumbDataUrl: 'data:image/png;base64,A' });
    open();
    (host.querySelector('.strat-library-row-rename') as HTMLButtonElement).click();
    const input = host.querySelector<HTMLInputElement>('[data-testid="strat-library-rename-input"]')!;
    input.value = '   ';
    (host.querySelector<HTMLButtonElement>('[data-testid="strat-library-rename-save"]')!).click();
    expect(listStrats().find((e) => e.id === id)!.name).toBe('A');
    expect(host.querySelector('.strat-library-rename')).not.toBeNull();
  });

  it('DUPLICATE adds a new entry with " (copy)" suffix', () => {
    saveStrat({ name: 'A', file: makeFile(), thumbDataUrl: 'data:image/png;base64,A' });
    open();
    (host.querySelector('.strat-library-row-duplicate') as HTMLButtonElement).click();
    const list = listStrats();
    expect(list.length).toBe(2);
    expect(list.some((e) => e.name === 'A (copy)')).toBe(true);
  });

  it('DUPLICATE with full storage shows an error toast instead of failing silently', () => {
    saveStrat({ name: 'A', file: makeFile(), thumbDataUrl: 'data:image/png;base64,A' });
    open();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    try {
      (host.querySelector('.strat-library-row-duplicate') as HTMLButtonElement).click();
      expect(document.querySelector('.toast--error')?.textContent).toMatch(/full/i);
    } finally {
      spy.mockRestore();
      toast._test.reset();
    }
  });

  it('DELETE opens a confirm modal; confirming removes the entry', () => {
    const id = saveStrat({ name: 'A', file: makeFile(), thumbDataUrl: 'data:image/png;base64,A' });
    open();
    (host.querySelector('.strat-library-row-delete') as HTMLButtonElement).click();
    const payload = store.get().ui.confirmOpen;
    expect(payload).not.toBeNull();
    expect(payload!.kind).toBe('delete-strat');
    payload!.onConfirm();
    expect(listStrats().find((e) => e.id === id)).toBeUndefined();
  });

  it('renders a chip per tag', () => {
    saveStrat({ name: 'A', file: makeFile(), thumbDataUrl: 'data:image/png;base64,A', tags: ['suna', 'eco'] });
    open();
    const chips = [...host.querySelectorAll('.strat-library-row-tag')];
    expect(chips.map((c) => c.textContent)).toEqual(['suna', 'eco']);
  });

  it('search filters by tag', () => {
    saveStrat({ name: 'Alpha', file: makeFile(), thumbDataUrl: 'data:image/png;base64,A', tags: ['suna'] });
    saveStrat({ name: 'Bravo', file: makeFile(), thumbDataUrl: 'data:image/png;base64,B', tags: ['miru'] });
    open();
    const el = host.querySelector('[data-testid="strat-library-search-input"]') as HTMLInputElement;
    el.value = 'suna';
    el.dispatchEvent(new Event('input'));
    const names = [...host.querySelectorAll('.strat-library-row-name')].map((n) => n.textContent);
    expect(names).toEqual(['Alpha']);
  });

  it('clicking a tag chip filters to that tag', () => {
    saveStrat({ name: 'Alpha', file: makeFile(), thumbDataUrl: 'data:image/png;base64,A', tags: ['suna'] });
    saveStrat({ name: 'Bravo', file: makeFile(), thumbDataUrl: 'data:image/png;base64,B', tags: ['miru'] });
    open();
    const chip = host.querySelector('.strat-library-row-tag') as HTMLButtonElement;
    const tag = chip.textContent;
    chip.click();
    const el = host.querySelector('[data-testid="strat-library-search-input"]') as HTMLInputElement;
    expect(el.value).toBe(tag);
    expect(host.querySelectorAll('.strat-library-row-name').length).toBe(1);
  });

  it('edit modal shows a prefilled tags field and saves edited tags', () => {
    const id = saveStrat({ name: 'A', file: makeFile(), thumbDataUrl: 'data:image/png;base64,A', tags: ['old'] });
    open();
    (host.querySelector('.strat-library-row-rename') as HTMLButtonElement).click();
    const tagsInput = host.querySelector('[data-testid="strat-library-rename-tags"]') as HTMLInputElement;
    expect(tagsInput.value).toBe('old');
    tagsInput.value = 'new, fresh';
    (host.querySelector('[data-testid="strat-library-rename-save"]') as HTMLButtonElement).click();
    expect(listStrats().find((e) => e.id === id)!.tags).toEqual(['new', 'fresh']);
  });

  describe('search filter', () => {
    function input(value: string): void {
      const el = host.querySelector<HTMLInputElement>('[data-testid="strat-library-search-input"]')!;
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    it('renders the filter input above the list', () => {
      open();
      const filter = host.querySelector<HTMLInputElement>('[data-testid="strat-library-search-input"]');
      expect(filter).not.toBeNull();
      expect(filter!.type).toBe('search');
    });

    it('case-insensitive substring filter narrows the list', () => {
      saveStrat({ name: 'Alpha plan', file: makeFile(), thumbDataUrl: 'data:image/png;base64,A' });
      saveStrat({ name: 'Bravo plan', file: makeFile(), thumbDataUrl: 'data:image/png;base64,B' });
      saveStrat({ name: 'Charlie thing', file: makeFile(), thumbDataUrl: 'data:image/png;base64,C' });
      open();
      expect(host.querySelectorAll('.strat-library-row').length).toBe(3);
      input('PLAN');
      const names = Array.from(host.querySelectorAll('.strat-library-row-name')).map((n) => n.textContent);
      // Saves can share an updatedAt timestamp inside one tick, so don't pin
      // the order -- the filter's job is to narrow membership, not sort.
      expect(names.length).toBe(2);
      expect(names).toContain('Alpha plan');
      expect(names).toContain('Bravo plan');
      expect(names).not.toContain('Charlie thing');
    });

    it('clearing the filter restores every row', () => {
      saveStrat({ name: 'A', file: makeFile(), thumbDataUrl: 'data:image/png;base64,A' });
      saveStrat({ name: 'B', file: makeFile(), thumbDataUrl: 'data:image/png;base64,B' });
      open();
      input('a');
      expect(host.querySelectorAll('.strat-library-row').length).toBe(1);
      input('');
      expect(host.querySelectorAll('.strat-library-row').length).toBe(2);
    });

    it('shows a no-match message (not the empty-library message) when the filter excludes everything', () => {
      saveStrat({ name: 'Alpha', file: makeFile(), thumbDataUrl: 'data:image/png;base64,A' });
      open();
      input('zzz');
      expect(host.querySelectorAll('.strat-library-row').length).toBe(0);
      const empty = host.querySelector('.strat-library-empty');
      expect(empty).not.toBeNull();
      expect(empty!.textContent).toContain('zzz');
    });

    it('whitespace-only filter is treated as no filter', () => {
      saveStrat({ name: 'A', file: makeFile(), thumbDataUrl: 'data:image/png;base64,A' });
      saveStrat({ name: 'B', file: makeFile(), thumbDataUrl: 'data:image/png;base64,B' });
      open();
      input('   ');
      expect(host.querySelectorAll('.strat-library-row').length).toBe(2);
    });

    it('reopen after closing resets the filter (per-session, not persisted)', () => {
      saveStrat({ name: 'A', file: makeFile(), thumbDataUrl: 'data:image/png;base64,A' });
      saveStrat({ name: 'B', file: makeFile(), thumbDataUrl: 'data:image/png;base64,B' });
      open();
      input('a');
      expect(host.querySelectorAll('.strat-library-row').length).toBe(1);
      store._apply({ ui: { ...store.get().ui, libraryOpen: false } });
      open();
      expect(host.querySelectorAll('.strat-library-row').length).toBe(2);
      const filter = host.querySelector<HTMLInputElement>('[data-testid="strat-library-search-input"]');
      expect(filter!.value).toBe('');
    });
  });
});
