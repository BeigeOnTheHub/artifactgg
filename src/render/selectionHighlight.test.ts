import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SelectionHighlight, type HighlightLayers } from './selectionHighlight';
import { createStore, type StratState } from '../app/store';
import { emptyFrame, type Player } from '../types/primitives';
import { hex } from '../types/hex';

function makeStore(players: Player[] = [], tool: StratState['tool'] = 'cursor') {
  const initial: StratState = {
    mapId: 'miru', zoom: 1, panX: 0, panY: 0,
    frames: [{ ...emptyFrame(), players }], activeFrameIdx: 0,
    notes: '', tool,
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
  return createStore(initial);
}

const p = (id: string): Player => ({ id, team: 'colonist', x: 10, y: 10, name: '', dead: false });

/** Stand-in layers: a real element per player id, stubs for the rest. */
function makeLayers(ids: string[]): { layers: HighlightLayers; nodes: Map<string, HTMLElement>; strokeIds: () => Set<string> } {
  const nodes = new Map<string, HTMLElement>();
  for (const id of ids) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    nodes.set(id, el);
  }
  let strokeIds = new Set<string>();
  const none = { getNode: (): null => null };
  const layers = {
    playerLayer: { getNode: (id: string) => nodes.get(id) ?? null },
    coneLayer: none, shapeLayer: none, textLayer: none, quickAddLayer: none,
    strokeLayer: { setHighlightedIds: (s: Set<string>) => { strokeIds = s; } },
  } as unknown as HighlightLayers;
  return { layers, nodes, strokeIds: () => strokeIds };
}

describe('SelectionHighlight', () => {
  let hl: SelectionHighlight | null = null;
  afterEach(() => { hl?.destroy(); hl = null; document.body.replaceChildren(); });

  it('paints the glow on a selected node', () => {
    const store = makeStore([p('a'), p('b')]);
    const { layers, nodes } = makeLayers(['a', 'b']);
    hl = new SelectionHighlight(store, layers);
    hl.mount();
    store._apply({ selection: [{ kind: 'player', id: 'a' }] });
    expect(nodes.get('a')!.classList.contains('sel-highlight')).toBe(true);
    expect(nodes.get('b')!.classList.contains('sel-highlight')).toBe(false);
  });

  it('clears the glow when the selection goes away', () => {
    const store = makeStore([p('a')]);
    const { layers, nodes } = makeLayers(['a']);
    hl = new SelectionHighlight(store, layers);
    hl.mount();
    store._apply({ selection: [{ kind: 'player', id: 'a' }] });
    store._apply({ selection: [] });
    expect(nodes.get('a')!.classList.contains('sel-highlight')).toBe(false);
  });

  it('paints nothing while a creation tool is active', () => {
    // Matches what the desktop did: SelectTool cleared the highlights on detach,
    // so switching to Draw dropped them even with a selection still in the store.
    const store = makeStore([p('a')], 'draw');
    const { layers, nodes } = makeLayers(['a']);
    hl = new SelectionHighlight(store, layers);
    hl.mount();
    store._apply({ selection: [{ kind: 'player', id: 'a' }] });
    expect(nodes.get('a')!.classList.contains('sel-highlight')).toBe(false);
    store._apply({ tool: 'cursor' });
    expect(nodes.get('a')!.classList.contains('sel-highlight')).toBe(true);
  });

  it('repaints after a frame change rebuilds the nodes', () => {
    // SelectTool subscribed to 'selection' alone, so a frame switch that rebuilt
    // the layer nodes lost the glow on a selection that was still live.
    const store = makeStore([p('a')]);
    const { layers, nodes } = makeLayers(['a']);
    hl = new SelectionHighlight(store, layers);
    hl.mount();
    store._apply({ selection: [{ kind: 'player', id: 'a' }] });
    nodes.get('a')!.classList.remove('sel-highlight'); // as if the node were rebuilt
    store._apply({ frames: [{ ...store.get().frames[0]!, players: [p('a')] }] });
    expect(nodes.get('a')!.classList.contains('sel-highlight')).toBe(true);
  });

  it('hands selected stroke ids to the stroke layer', () => {
    const store = makeStore();
    const { layers, strokeIds } = makeLayers([]);
    hl = new SelectionHighlight(store, layers);
    hl.mount();
    store._apply({ selection: [{ kind: 'stroke', id: 's1' }] });
    expect([...strokeIds()]).toEqual(['s1']);
  });

  it('stops painting once destroyed', () => {
    const store = makeStore([p('a')]);
    const { layers, nodes } = makeLayers(['a']);
    hl = new SelectionHighlight(store, layers);
    hl.mount();
    hl.destroy();
    hl = null;
    store._apply({ selection: [{ kind: 'player', id: 'a' }] });
    expect(nodes.get('a')!.classList.contains('sel-highlight')).toBe(false);
  });

  it('survives an empty frame list without throwing', () => {
    const store = makeStore();
    const { layers } = makeLayers([]);
    hl = new SelectionHighlight(store, layers);
    hl.mount();
    expect(() => store._apply({ frames: [], activeFrameIdx: 0 })).not.toThrow();
  });
});
