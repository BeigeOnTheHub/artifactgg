import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStore, type StratState } from '../app/store';
import { PlayerLegend } from './PlayerLegend';
import { emptyFrame, type Player } from '../types/primitives';
import { hex } from '../types/hex';

function makeStore(players: Player[] = [], layoutMode?: StratState['layoutMode']): ReturnType<typeof createStore> {
  const initial: StratState = {
    mapId: 'miru', zoom: 1, panX: 0, panY: 0,
    frames: [{ ...emptyFrame(), players }], activeFrameIdx: 0,
    notes: '', tool: 'cursor',
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ...(layoutMode !== undefined ? { layoutMode } : {}),
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
  return createStore(initial);
}

function p(id: string, team: Player['team'], name: string, dead = false): Player {
  return { id, team, x: 0, y: 0, name, dead };
}

describe('PlayerLegend', () => {
  let host: HTMLElement;
  let legend: PlayerLegend | null = null;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    legend?.destroy();
    legend = null;
    document.body.removeChild(host);
  });

  it('is hidden when no player has a name', () => {
    const store = makeStore([p('a', 'colonist', ''), p('b', 'reyab', '   ')]);
    legend = new PlayerLegend(host, store);
    legend.mount();
    const el = host.querySelector('#player-legend') as HTMLElement;
    expect(el.hidden).toBe(true);
    expect(el.children.length).toBe(0);
  });

  it('lists named players grouped colonist-then-reyab with per-team numbers', () => {
    const store = makeStore([
      p('a', 'colonist', 'Alice'),  // colonist #1
      p('b', 'colonist', ''),        // unnamed colonist #2 (skipped)
      p('c', 'colonist', 'Bob'),    // colonist #3
      p('d', 'reyab', 'Carol'),     // reyab #1
    ]);
    legend = new PlayerLegend(host, store);
    legend.mount();
    const el = host.querySelector('#player-legend') as HTMLElement;
    expect(el.hidden).toBe(false);
    const rows = Array.from(el.querySelectorAll('.legend-row'));
    expect(rows).toHaveLength(3);
    const nums = rows.map((r) => r.querySelector('.legend-num')!.textContent);
    const names = rows.map((r) => r.querySelector('.legend-name')!.textContent);
    expect(nums).toEqual(['1', '3', '1']);   // Alice, Bob (colonists), Carol (reyab)
    expect(names).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('shows a skull glyph for dead named players only', () => {
    const store = makeStore([p('a', 'colonist', 'Alice', true), p('b', 'reyab', 'Bob', false)]);
    legend = new PlayerLegend(host, store);
    legend.mount();
    const rows = Array.from(host.querySelectorAll('.legend-row'));
    expect(rows[0]!.querySelector('.legend-skull')).not.toBeNull();
    expect(rows[1]!.querySelector('.legend-skull')).toBeNull();
  });

  it('re-renders when the active frame changes', () => {
    const store = makeStore([]);
    legend = new PlayerLegend(host, store);
    legend.mount();
    const el = host.querySelector('#player-legend') as HTMLElement;
    expect(el.hidden).toBe(true);
    store._apply({ frames: [{ ...store.get().frames[0]!, players: [p('a', 'colonist', 'Zed')] }] });
    expect(el.hidden).toBe(false);
    expect(el.querySelectorAll('.legend-row')).toHaveLength(1);
    expect(el.querySelector('.legend-name')!.textContent).toBe('Zed');
  });

  it('destroy removes the element and stops responding to store changes', () => {
    const store = makeStore([p('a', 'colonist', 'Alice')]);
    legend = new PlayerLegend(host, store);
    legend.mount();
    legend.destroy();
    legend = null;
    expect(host.querySelector('#player-legend')).toBeNull();
    expect(() => store._apply({ frames: [{ ...store.get().frames[0]!, players: [p('b', 'reyab', 'Bob')] }] })).not.toThrow();
  });
});

describe('PlayerLegend - compact mode', () => {
  let host: HTMLElement;
  let legend: PlayerLegend | null = null;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    legend?.destroy();
    legend = null;
    document.body.removeChild(host);
  });

  it('renders nothing at all when nobody is named', () => {
    const store = makeStore([p('a', 'colonist', ''), p('b', 'reyab', '  ')], 'compact');
    legend = new PlayerLegend(host, store);
    legend.mount();
    const el = host.querySelector('#player-legend') as HTMLElement;
    // The toggle expands the legend. With nobody named there is nothing to
    // expand, and an unlabelled arrow floating over the map name in the top-left
    // corner reads as some other control entirely - it got taken for a map
    // switcher. Desktop has always hidden the empty legend; compact now matches.
    expect(host.querySelector('[data-testid="legend-toggle"]')).toBeNull();
    expect(el.hidden).toBe(true);
  });

  it('renders a toggle button with aria-label in compact mode', () => {
    const store = makeStore([p('a', 'colonist', 'Alice')], 'compact');
    legend = new PlayerLegend(host, store);
    legend.mount();
    const btn = host.querySelector('[data-testid="legend-toggle"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('aria-label')).toBeTruthy();
  });

  it('legend body is collapsed (hidden) by default in compact mode', () => {
    const store = makeStore([p('a', 'colonist', 'Alice')], 'compact');
    legend = new PlayerLegend(host, store);
    legend.mount();
    const el = host.querySelector('#player-legend') as HTMLElement;
    expect(el.querySelector('.legend-row')).toBeNull();
  });

  it('clicking the toggle button reveals legend body content', () => {
    const store = makeStore([p('a', 'colonist', 'Alice')], 'compact');
    legend = new PlayerLegend(host, store);
    legend.mount();
    const btn = host.querySelector('[data-testid="legend-toggle"]') as HTMLButtonElement;
    btn.click();
    const el = host.querySelector('#player-legend') as HTMLElement;
    expect(el.querySelector('.legend-row')).not.toBeNull();
  });

  it('clicking the toggle twice collapses the body again', () => {
    const store = makeStore([p('a', 'colonist', 'Alice')], 'compact');
    legend = new PlayerLegend(host, store);
    legend.mount();
    const btn = host.querySelector('[data-testid="legend-toggle"]') as HTMLButtonElement;
    btn.click();
    btn.click();
    const el = host.querySelector('#player-legend') as HTMLElement;
    expect(el.querySelector('.legend-row')).toBeNull();
  });

  it('desktop mode renders the legend body directly without a toggle button', () => {
    const store = makeStore([p('a', 'colonist', 'Alice')], 'desktop');
    legend = new PlayerLegend(host, store);
    legend.mount();
    expect(host.querySelector('[data-testid="legend-toggle"]')).toBeNull();
    const el = host.querySelector('#player-legend') as HTMLElement;
    expect(el.querySelector('.legend-row')).not.toBeNull();
  });

  it('absent layoutMode (undefined) renders desktop behaviour', () => {
    const store = makeStore([p('a', 'colonist', 'Alice')]);
    legend = new PlayerLegend(host, store);
    legend.mount();
    expect(host.querySelector('[data-testid="legend-toggle"]')).toBeNull();
    const el = host.querySelector('#player-legend') as HTMLElement;
    expect(el.querySelector('.legend-row')).not.toBeNull();
  });

  it('reactively switches between desktop and compact layout when layoutMode changes', () => {
    const store = makeStore([p('a', 'colonist', 'Alice')], 'desktop');
    legend = new PlayerLegend(host, store);
    legend.mount();
    const el = host.querySelector('#player-legend') as HTMLElement;

    // desktop: no toggle, rows visible
    expect(host.querySelector('[data-testid="legend-toggle"]')).toBeNull();
    expect(el.querySelector('.legend-row')).not.toBeNull();

    // switch to compact: toggle appears, body collapsed
    store._apply({ layoutMode: 'compact' });
    expect(host.querySelector('[data-testid="legend-toggle"]')).not.toBeNull();
    expect(el.querySelector('.legend-row')).toBeNull();

    // switch back to desktop: toggle gone, rows rendered again
    store._apply({ layoutMode: 'desktop' });
    expect(host.querySelector('[data-testid="legend-toggle"]')).toBeNull();
    expect(el.querySelector('.legend-row')).not.toBeNull();
  });
});
