import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, type StratState } from '../app/store';
import { createHistory } from '../app/history';
import { MapDropdown } from './MapDropdown';
import { emptyFrame } from '../types/primitives';
import { hex } from '../types/hex';

function initialState(): StratState {
  return {
    mapId: 'miru',
    zoom: 1, panX: 0, panY: 0,
    frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '',
    tool: 'cursor',
    colourSlots: [hex('#00ff88'), null, null, null, null],
    activeSlot: 0,
    selection: [],
    ui: {
      sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false,
      libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false,
      hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null,
    },
  };
}

describe('MapDropdown', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let history: ReturnType<typeof createHistory>;
  let dropdown: MapDropdown;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore(initialState());
    history = createHistory(store);
    dropdown = new MapDropdown(host, store, history);
    dropdown.mount();
  });

  afterEach(() => {
    dropdown.destroy();
    document.body.removeChild(host);
  });

  it('button shows the active map name', () => {
    const button = host.querySelector('.map-dropdown-btn');
    expect(button?.textContent).toContain('MIRU');
  });

  it('list is hidden by default', () => {
    const list = host.querySelector('.map-dropdown-list');
    expect(list).not.toBeNull();
    expect((list as HTMLElement).hidden).toBe(true);
  });

  it('clicking the button opens the list', () => {
    const button = host.querySelector('.map-dropdown-btn') as HTMLElement;
    button.click();
    expect(store.get().ui.mapDropdownOpen).toBe(true);
    const list = host.querySelector('.map-dropdown-list') as HTMLElement;
    expect(list.hidden).toBe(false);
  });

  it('list contains 6 rows, one per map', () => {
    store._apply({ ui: { ...store.get().ui, mapDropdownOpen: true } });
    const rows = host.querySelectorAll('.map-dropdown-row');
    expect(rows.length).toBe(6);
  });

  it('clicking a row dispatches map.select and closes the list', () => {
    store._apply({ ui: { ...store.get().ui, mapDropdownOpen: true } });
    const dispatch = vi.spyOn(history, 'dispatch');
    const khidiRow = Array.from(host.querySelectorAll('.map-dropdown-row'))
      .find((el) => el.textContent?.includes('KHIDI')) as HTMLElement;
    khidiRow.click();
    expect(dispatch).toHaveBeenCalledWith({ t: 'map.select', mapId: 'khidi' });
    expect(store.get().ui.mapDropdownOpen).toBe(false);
  });

  it('the kiiro row is selectable and has no WIP badge', () => {
    store._apply({ ui: { ...store.get().ui, mapDropdownOpen: true } });
    const dispatch = vi.spyOn(history, 'dispatch');
    const kiiroRow = Array.from(host.querySelectorAll<HTMLButtonElement>('.map-dropdown-row'))
      .find((el) => el.textContent?.includes('KIIRO'))!;
    expect(kiiroRow.disabled).toBe(false);
    expect(kiiroRow.querySelector('.map-dropdown-wip-badge')).toBeNull();
    kiiroRow.click();
    expect(dispatch).toHaveBeenCalledWith({ t: 'map.select', mapId: 'kiiro' });
  });

  it('active row gets .active class matching state.mapId', () => {
    store._apply({ ui: { ...store.get().ui, mapDropdownOpen: true } });
    const active = host.querySelector('.map-dropdown-row.active');
    expect(active?.textContent).toContain('MIRU');
  });

  it('outside-click closes the list', () => {
    store._apply({ ui: { ...store.get().ui, mapDropdownOpen: true } });
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(store.get().ui.mapDropdownOpen).toBe(false);
  });
});

describe('MapDropdown - callouts toggle row', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let history: ReturnType<typeof createHistory>;
  let dropdown: MapDropdown;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore(initialState());
    history = createHistory(store);
    dropdown = new MapDropdown(host, store, history);
  });

  afterEach(() => {
    dropdown.destroy();
    document.body.removeChild(host);
  });

  it('renders a callouts toggle row at the bottom of the list', () => {
    dropdown.mount();
    const row = host.querySelector('.map-dropdown-callouts-row');
    expect(row).not.toBeNull();
    const pill = host.querySelector('.map-dropdown-callouts-pill');
    expect(pill?.textContent).toBe('ON');
  });

  it('clicking the row dispatches callouts.toggle', () => {
    dropdown.mount();
    const row = host.querySelector<HTMLButtonElement>('.map-dropdown-callouts-row');
    row?.click();
    expect(store.get().ui.calloutsVisible).toBe(false);
  });

  it('pill text + aria-pressed reflect calloutsVisible state', () => {
    dropdown.mount();
    store._apply({ ui: { ...store.get().ui, calloutsVisible: false } });

    const row = host.querySelector<HTMLButtonElement>('.map-dropdown-callouts-row')!;
    const pill = host.querySelector<HTMLElement>('.map-dropdown-callouts-pill')!;
    expect(pill.textContent).toBe('OFF');
    expect(row.getAttribute('aria-pressed')).toBe('false');

    store._apply({ ui: { ...store.get().ui, calloutsVisible: true } });
    expect(pill.textContent).toBe('ON');
    expect(row.getAttribute('aria-pressed')).toBe('true');
  });

  it('clicking the row does NOT close the dropdown', () => {
    dropdown.mount();
    store._apply({ ui: { ...store.get().ui, mapDropdownOpen: true } });
    const row = host.querySelector<HTMLButtonElement>('.map-dropdown-callouts-row');
    row?.click();
    expect(store.get().ui.mapDropdownOpen).toBe(true);
  });
});
