import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, type StratState } from '../app/store';
import { createHistory } from '../app/history';
import { ToolRail } from './ToolRail';
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

describe('ToolRail - buttons', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let history: ReturnType<typeof createHistory>;
  let rail: ToolRail;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore(initialState());
    history = createHistory(store);
    rail = new ToolRail(host, store, history);
    rail.mount();
  });

  afterEach(() => {
    rail.destroy();
    document.body.removeChild(host);
  });

  it('renders 10 buttons (place-scanner was folded into place-quickadd)', () => {
    expect(host.querySelectorAll('.tool-rail-btn').length).toBe(10);
  });

  it('each button has a data-tool attribute matching its ToolId', () => {
    const btns = Array.from(host.querySelectorAll<HTMLButtonElement>('.tool-rail-btn'));
    const toolIds = btns.map((b) => b.dataset['tool']);
    expect(toolIds).toEqual([
      'cursor', 'select', 'lasso',
      'draw', 'erase', 'shapes',
      'place-cone', 'place-player', 'place-text',
      'place-quickadd',
    ]);
  });

  it('cursor button has .active class when state.tool=cursor', () => {
    const cursor = host.querySelector('[data-tool="cursor"]');
    expect(cursor?.classList.contains('active')).toBe(true);
    const draw = host.querySelector('[data-tool="draw"]');
    expect(draw?.classList.contains('active')).toBe(false);
  });

  it('clicking a button sets the tool directly, not through history', () => {
    const dispatch = vi.spyOn(history, 'dispatch');
    (host.querySelector('[data-tool="draw"]') as HTMLElement).click();
    expect(store.get().tool).toBe('draw');
    // Tool switches bypass history on purpose - no dispatch, no undo entry.
    expect(dispatch).not.toHaveBeenCalled();
    expect(history.canUndo()).toBe(false);
  });

  it('active highlight syncs when state.tool changes', () => {
    history.dispatch({ t: 'tool.set', tool: 'erase' });
    const erase = host.querySelector('[data-tool="erase"]');
    expect(erase?.classList.contains('active')).toBe(true);
    const cursor = host.querySelector('[data-tool="cursor"]');
    expect(cursor?.classList.contains('active')).toBe(false);
  });

  it('place-quickadd renders an <svg> icon (place-scanner is no longer in the rail)', () => {
    const qa = host.querySelector('[data-tool="place-quickadd"] svg');
    expect(qa).not.toBeNull();
    // place-quickadd: 2 circles
    expect(qa?.querySelectorAll('circle').length).toBe(2);
    // place-scanner button is intentionally absent now.
    expect(host.querySelector('[data-tool="place-scanner"]')).toBeNull();
  });

  it('shapes and cone draw their icons as inline <svg>, not a PNG', () => {
    for (const id of ['shapes', 'place-cone']) {
      expect(host.querySelector(`[data-tool="${id}"] svg`)).not.toBeNull();
      expect(host.querySelector(`[data-tool="${id}"] img`)).toBeNull();
    }
  });

  it('a second rail on the page gets its own shapes mask id', () => {
    const host2 = document.createElement('div');
    document.body.appendChild(host2);
    const rail2 = new ToolRail(host2, store, history);
    rail2.mount();
    const ids = Array.from(document.querySelectorAll('[data-tool="shapes"] mask')).map((m) => m.id);
    expect(ids.length).toBe(2);
    expect(new Set(ids).size).toBe(2);
    rail2.destroy();
    host2.remove();
  });

  it('PNG-icon buttons render an <img> element', () => {
    const cursor = host.querySelector('[data-tool="cursor"] img');
    expect(cursor).not.toBeNull();
    expect((cursor as HTMLImageElement).src).toMatch(/cursor\.png$/);
  });
});
