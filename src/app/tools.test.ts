import { describe, it, expect } from 'vitest';
import { ToolsManager, type ToolController } from './tools';
import { createStore, type StratState } from './store';
import type { ToolId } from '../types/primitives';

function makeStore(tool: ToolId) {
  const s: StratState = {
    mapId: 'miru', zoom: 1, panX: 0, panY: 0, frames: [], activeFrameIdx: 0,
    notes: '', tool, colourSlots: [null, null, null, null, null], activeSlot: 0,
    selection: [], ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false,
    shareOpen: false, libraryOpen: false, mapDropdownOpen: false,
    colourPickerOpen: false, hintsOpen: false, calloutsVisible: false,
    changelogOpen: false, confirmOpen: null },
  };
  return createStore(s);
}

function fakeTool(id: ToolId): ToolController & { attached: number } {
  return { id, attached: 0, attach() { this.attached++; }, detach() { this.attached--; } };
}

const CREATION_IDS: ToolId[] = ['draw', 'erase', 'shapes', 'place-cone', 'place-player', 'place-quickadd', 'place-text'];

function creationMap(): Map<ToolId, ToolController> {
  return new Map<ToolId, ToolController>(CREATION_IDS.map((id) => [id, fakeTool(id)]));
}

describe('ToolsManager - compact creation-tool subset', () => {
  it('attaches the active creation tool and reports it via getActive', () => {
    const store = makeStore('draw');
    const tools = creationMap();
    const mgr = new ToolsManager(document.createElement('div'), store, tools);
    mgr.start();
    expect(mgr.getActiveId()).toBe('draw');
    expect(mgr.getActive()).toBe(tools.get('draw'));
    mgr.stop();
  });

  it('attaches nothing for a select-family id absent from the compact map', () => {
    const store = makeStore('cursor');
    const mgr = new ToolsManager(document.createElement('div'), store, creationMap());
    mgr.start();
    expect(mgr.getActiveId()).toBeNull();
    expect(mgr.getActive()).toBeNull();
    mgr.stop();
  });

  it('swapping to a select-family id detaches the active creation tool', () => {
    const store = makeStore('draw');
    const mgr = new ToolsManager(document.createElement('div'), store, creationMap());
    mgr.start();
    expect(mgr.getActiveId()).toBe('draw');
    store._apply({ tool: 'cursor' });
    expect(mgr.getActive()).toBeNull();
    mgr.stop();
  });
});
