import { describe, it, expect, vi } from 'vitest';
import { resolveLayoutMode, watchLayoutMode, currentLayoutMode, isReadOnly, COMPACT_QUERY } from './layoutMode';
import { createStore, type StratState } from './store';

function state(): StratState {
  return { mapId: 'suna', zoom: 1, panX: 0, panY: 0, frames: [], activeFrameIdx: 0, notes: '', tool: 'cursor', colourSlots: [null,null,null,null,null], activeSlot: 0, selection: [], ui: { sidebarTab:'tools', mode:'frame', paletteOpen:false, shareOpen:false, libraryOpen:false, mapDropdownOpen:false, colourPickerOpen:false, hintsOpen:false, calloutsVisible:false, changelogOpen:false, confirmOpen:null } };
}

describe('resolveLayoutMode', () => {
  it('matches => compact', () => { expect(resolveLayoutMode(true)).toBe('compact'); });
  it('no match => desktop', () => { expect(resolveLayoutMode(false)).toBe('desktop'); });
});

describe('currentLayoutMode / isReadOnly defaults', () => {
  it('defaults to desktop and not read-only', () => {
    const s = createStore(state());
    expect(currentLayoutMode(s)).toBe('desktop');
    expect(isReadOnly(s)).toBe(false);
  });
});

describe('watchLayoutMode', () => {
  it('writes compact when matchMedia matches and updates on change', () => {
    let cb: ((e: { matches: boolean }) => void) | null = null;
    let addedFn: ((e: { matches: boolean }) => void) | null = null;
    const mql = { matches: true, addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => { cb = fn; addedFn = fn; }, removeEventListener: vi.fn() };
    const fakeWin = { matchMedia: vi.fn(() => mql) } as unknown as Window;
    const s = createStore(state());
    const off = watchLayoutMode(s, fakeWin);
    expect((fakeWin.matchMedia as any)).toHaveBeenCalledWith(COMPACT_QUERY);
    expect(s.get().layoutMode).toBe('compact');
    expect(s.get().readOnly).toBe(false);
    cb!({ matches: false });
    expect(s.get().layoutMode).toBe('desktop');
    expect(s.get().readOnly).toBe(false);
    off();
    expect(mql.removeEventListener).toHaveBeenCalledWith('change', addedFn);
  });

  it('falls back to desktop when matchMedia is unavailable', () => {
    const s = createStore(state());
    const off = watchLayoutMode(s, {} as unknown as Window);
    expect(s.get().layoutMode).toBe('desktop');
    expect(s.get().readOnly).toBe(false);
    off();
  });
});
