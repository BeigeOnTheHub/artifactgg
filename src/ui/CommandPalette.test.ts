import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, type StratState } from '../app/store';
import { createHistory } from '../app/history';
import { createActions } from '../app/actions';
import { CommandPalette } from './CommandPalette';
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

describe('CommandPalette', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let history: ReturnType<typeof createHistory>;
  let actions: ReturnType<typeof createActions>;
  let palette: CommandPalette;
  const drawRun = vi.fn();
  const eraseRun = vi.fn();

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore(initialState());
    history = createHistory(store);
    actions = createActions(store);
    drawRun.mockReset();
    eraseRun.mockReset();
    actions.register({ id: 'tool.draw', title: 'Tool · Draw', group: 'Tool', hotkey: 'D', run: drawRun });
    actions.register({ id: 'tool.erase', title: 'Tool · Erase', group: 'Tool', hotkey: 'E', run: eraseRun });
    actions.register({
      id: 'edit.copy', title: 'Copy', group: 'Edit', hotkey: 'Ctrl+C',
      canRun: (s) => s.selection.length > 0, run: vi.fn(),
    });
    actions.register({ id: 'map.miru', title: 'Switch map · MIRU', group: 'Map', run: vi.fn() });
    palette = new CommandPalette(host, store, actions);
    palette.mount();
  });

  afterEach(() => {
    palette.destroy();
    document.body.removeChild(host);
  });

  function open(): void {
    store._apply({ ui: { ...store.get().ui, paletteOpen: true } });
  }

  it('starts hidden', () => {
    const root = host.querySelector('.command-palette') as HTMLElement;
    expect(root.hidden).toBe(true);
  });

  it('opens when ui.paletteOpen=true and focuses the input', () => {
    open();
    const root = host.querySelector('.command-palette') as HTMLElement;
    expect(root.hidden).toBe(false);
    const input = host.querySelector('.cp-input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
  });

  it('renders all actions when the query is empty', () => {
    open();
    const rows = host.querySelectorAll('.cp-row');
    expect(rows.length).toBe(4);
  });

  it('filters by case-insensitive subsequence on id+title', () => {
    open();
    const input = host.querySelector('.cp-input') as HTMLInputElement;
    input.value = 'draw';
    input.dispatchEvent(new Event('input'));
    const rows = host.querySelectorAll('.cp-row');
    expect(rows.length).toBe(1);
    expect(rows[0]?.textContent).toContain('Draw');
  });

  it('subsequence matches: "ot.dr" matches "tool.draw"', () => {
    open();
    const input = host.querySelector('.cp-input') as HTMLInputElement;
    input.value = 'ot.dr';
    input.dispatchEvent(new Event('input'));
    const rows = host.querySelectorAll('.cp-row');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.textContent).toContain('Draw');
  });

  it('disabled action rendered with .disabled class when canRun=false', () => {
    open();
    const copyRow = Array.from(host.querySelectorAll<HTMLElement>('.cp-row'))
      .find((r) => r.textContent?.includes('Copy'));
    expect(copyRow?.classList.contains('disabled')).toBe(true);
  });

  it('Enter on a disabled row is a no-op', () => {
    open();
    const input = host.querySelector('.cp-input') as HTMLInputElement;
    input.value = 'copy';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(store.get().ui.paletteOpen).toBe(true); // still open
  });

  it('Enter runs the selected (first) action and closes the palette', () => {
    open();
    const input = host.querySelector('.cp-input') as HTMLInputElement;
    input.value = 'draw';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(drawRun).toHaveBeenCalledTimes(1);
    expect(store.get().ui.paletteOpen).toBe(false);
  });

  it('ArrowDown moves selection to the next row', () => {
    open();
    const input = host.querySelector('.cp-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const selected = host.querySelector('.cp-row.selected');
    const rows = Array.from(host.querySelectorAll('.cp-row'));
    expect(rows.indexOf(selected as HTMLElement)).toBe(1);
  });

  it('ArrowUp wraps from row 0 to last row', () => {
    open();
    const input = host.querySelector('.cp-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    const selected = host.querySelector('.cp-row.selected');
    const rows = Array.from(host.querySelectorAll('.cp-row'));
    expect(rows.indexOf(selected as HTMLElement)).toBe(rows.length - 1);
  });

  it('clicking a row runs that action and closes', () => {
    open();
    const eraseRow = Array.from(host.querySelectorAll<HTMLElement>('.cp-row'))
      .find((r) => r.textContent?.includes('Erase'));
    eraseRow!.click();
    expect(eraseRun).toHaveBeenCalledTimes(1);
    expect(store.get().ui.paletteOpen).toBe(false);
  });

  it('hides when ui.paletteOpen flips back to false', () => {
    open();
    store._apply({ ui: { ...store.get().ui, paletteOpen: false } });
    const root = host.querySelector('.command-palette') as HTMLElement;
    expect(root.hidden).toBe(true);
  });

  it('clears the query input when re-opened', () => {
    open();
    const input = host.querySelector('.cp-input') as HTMLInputElement;
    input.value = 'draw';
    input.dispatchEvent(new Event('input'));
    store._apply({ ui: { ...store.get().ui, paletteOpen: false } });
    open();
    expect(input.value).toBe('');
  });
});
