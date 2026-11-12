import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStore, type StratState } from '../app/store';
import { createHistory } from '../app/history';
import { buildMapPicker } from './mapPicker';
import { getMap, mapSupportsCallouts } from '../types/maps';
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

describe('buildMapPicker', () => {
  let store: ReturnType<typeof createStore>;
  let history: ReturnType<typeof createHistory>;
  let built: ReturnType<typeof buildMapPicker>;

  beforeEach(() => {
    store = createStore(initial());
    history = createHistory(store);
    built = buildMapPicker(store, history);
    document.body.appendChild(built.el);
  });

  afterEach(() => {
    built.destroy();
    built.el.remove();
  });

  function row(id: string): HTMLButtonElement {
    return built.el.querySelector(`.map-dropdown-row[data-mapid="${id}"]`) as HTMLButtonElement;
  }
  function callouts(): HTMLButtonElement {
    return built.el.querySelector('.map-dropdown-callouts-row') as HTMLButtonElement;
  }

  it('is the listbox itself, with one option per map', () => {
    expect(built.el.className).toBe('map-dropdown-list');
    expect(built.el.getAttribute('role')).toBe('listbox');
    expect(built.el.querySelectorAll('.map-dropdown-row').length).toBe(6);
    expect(row('suna').getAttribute('role')).toBe('option');
    expect(row('suna').parentElement).toBe(built.el);
  });

  it('marks the active map and moves the marker on a switch', () => {
    expect(row('miru').classList.contains('active')).toBe(true);
    expect(row('suna').classList.contains('active')).toBe(false);
    row('suna').click();
    expect(store.get().mapId).toBe('suna');
    expect(row('suna').classList.contains('active')).toBe(true);
    expect(row('miru').classList.contains('active')).toBe(false);
  });

  it('kiiro is a finished map now: no WIP badge, selectable, callouts on', () => {
    expect(row('kiiro').querySelector('.map-dropdown-wip-badge')).toBeNull();
    expect(row('kiiro').hasAttribute('disabled')).toBe(false);
    expect(mapSupportsCallouts('kiiro')).toBe(true);
  });

  it('calls onSelect with the chosen map after dispatching', () => {
    const seen: string[] = [];
    const b = buildMapPicker(store, history, { onSelect: (id) => seen.push(id) });
    document.body.appendChild(b.el);
    (b.el.querySelector('.map-dropdown-row[data-mapid="frio"]') as HTMLButtonElement).click();
    expect(seen).toEqual(['frio']);
    expect(store.get().mapId).toBe('frio');
    b.destroy();
    b.el.remove();
  });

  it('toggles callouts and reflects the pill', () => {
    expect(callouts().getAttribute('aria-pressed')).toBe('true');
    callouts().click();
    expect(store.get().ui.calloutsVisible).toBe(false);
    expect(callouts().getAttribute('aria-pressed')).toBe('false');
  });

  it('disables callouts on a map whose callouts are not ready', () => {
    // No shipped map is flagged right now, so flag one for this test only.
    const khidi = getMap('khidi');
    khidi.calloutsWip = true;
    try {
      row('khidi').click();
      expect(callouts().disabled).toBe(true);
      expect(callouts().getAttribute('aria-disabled')).toBe('true');
      callouts().click();
      // still whatever it was - the click must not dispatch on an unsupported map
      expect(store.get().ui.calloutsVisible).toBe(true);
    } finally {
      delete khidi.calloutsWip;
    }
  });

  it('destroy unsubscribes so later map changes are ignored', () => {
    built.destroy();
    history.dispatch({ t: 'map.select', mapId: 'khidi' });
    expect(row('khidi').classList.contains('active')).toBe(false);
  });
});
