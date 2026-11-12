import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStore, type StratState } from '../app/store';
import { createHistory } from '../app/history';
import { ToolsManager, type ToolController } from '../app/tools';
import { ContextPanel } from './ContextPanel';
import { emptyFrame, type ToolId } from '../types/primitives';
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

function stubTool(id: ToolId, panelText: string | null): ToolController {
  return {
    id,
    attach() {},
    detach() {},
    getContextPanel: panelText === null
      ? () => null
      : () => {
          const div = document.createElement('div');
          div.className = `panel-${id}`;
          div.textContent = panelText;
          return div;
        },
  };
}

describe('ContextPanel', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let history: ReturnType<typeof createHistory>;
  let tools: Map<ToolId, ToolController>;
  let manager: ToolsManager;
  let panel: ContextPanel;
  let target: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore(initialState());
    history = createHistory(store);
    tools = new Map<ToolId, ToolController>([
      ['cursor', stubTool('cursor', null)],
      ['draw', stubTool('draw', 'BRUSH SIZE')],
      ['erase', stubTool('erase', 'ERASER SIZE')],
    ]);
    target = document.createElement('div');
    document.body.appendChild(target);
    manager = new ToolsManager(target, store, tools);
    manager.start();
    panel = new ContextPanel(host, store, history, manager);
    panel.mount();
  });

  afterEach(() => {
    panel.destroy();
    manager.stop();
    document.body.removeChild(host);
    document.body.removeChild(target);
  });

  it('starts empty when active tool returns null', () => {
    expect(host.querySelector('.context-panel')?.children.length ?? 0).toBe(0);
  });

  it('mounts panel content when switching to a tool with a panel', () => {
    history.dispatch({ t: 'tool.set', tool: 'draw' });
    const inner = host.querySelector('.context-panel');
    expect(inner?.querySelector('.panel-draw')?.textContent).toBe('BRUSH SIZE');
  });

  it('replaces previous panel when tool changes', () => {
    history.dispatch({ t: 'tool.set', tool: 'draw' });
    history.dispatch({ t: 'tool.set', tool: 'erase' });
    const inner = host.querySelector('.context-panel');
    expect(inner?.querySelector('.panel-draw')).toBeNull();
    expect(inner?.querySelector('.panel-erase')?.textContent).toBe('ERASER SIZE');
  });

  it('empties the panel when switching to a tool that returns null', () => {
    history.dispatch({ t: 'tool.set', tool: 'draw' });
    history.dispatch({ t: 'tool.set', tool: 'cursor' });
    const inner = host.querySelector('.context-panel');
    expect(inner?.children.length).toBe(0);
  });

  it('destroy() removes the container - no leak on subsequent dispatches', () => {
    panel.destroy();
    history.dispatch({ t: 'tool.set', tool: 'draw' });
    expect(host.querySelector('.context-panel')).toBeNull();
  });

  it('shows the font-size editor when the cursor tool has one textbox selected', () => {
    store._apply({
      frames: [{ ...store.get().frames[0]!, textboxes: [{ id: 'tb1', x: 0, y: 0, w: 80, h: 32, text: 'hi', fontSize: 16, color: hex('#ffffff') }] }],
      selection: [{ kind: 'textbox', id: 'tb1' }],
    });
    const inner = host.querySelector('.context-panel')!;
    const slider = inner.querySelector('.cp-slider') as HTMLInputElement | null;
    expect(slider).not.toBeNull();
    expect(slider!.value).toBe('16');
  });

  it('shows the show-ranges toggle when the cursor tool has one non-scanner quickadd selected', () => {
    store._apply({
      frames: [{ ...store.get().frames[0]!, quickadds: [{ id: 'q1', type: 'grenade', x: 10, y: 10, rangeVisible: false }] }],
      selection: [{ kind: 'quickadd', id: 'q1' }],
    });
    const inner = host.querySelector('.context-panel')!;
    expect(inner.textContent).toContain('SHOW RANGES');
  });

  it('does not show the show-ranges toggle for a selected scanner quickadd', () => {
    store._apply({
      frames: [{ ...store.get().frames[0]!, quickadds: [{ id: 'sc', type: 'scanner', x: 10, y: 10, rangeVisible: false }] }],
      selection: [{ kind: 'quickadd', id: 'sc' }],
    });
    const inner = host.querySelector('.context-panel')!;
    expect(inner.textContent).not.toContain('SHOW RANGES');
    // cursor tool has no panel of its own -> empty
    expect(inner.children.length).toBe(0);
  });

  it('falls through to the tool panel when more than one item is selected', () => {
    store._apply({
      tool: 'draw',
      frames: [{ ...store.get().frames[0]!, textboxes: [
        { id: 'tb1', x: 0, y: 0, w: 80, h: 32, text: 'a', fontSize: 16, color: hex('#ffffff') },
        { id: 'tb2', x: 0, y: 0, w: 80, h: 32, text: 'b', fontSize: 16, color: hex('#ffffff') },
      ] }],
      selection: [{ kind: 'textbox', id: 'tb1' }, { kind: 'textbox', id: 'tb2' }],
    });
    const inner = host.querySelector('.context-panel')!;
    expect(inner.querySelector('.panel-draw')?.textContent).toBe('BRUSH SIZE');
  });

  it('does not show the selection editor for a non-selection tool', () => {
    store._apply({
      tool: 'draw',
      frames: [{ ...store.get().frames[0]!, textboxes: [{ id: 'tb1', x: 0, y: 0, w: 80, h: 32, text: 'a', fontSize: 16, color: hex('#ffffff') }] }],
      selection: [{ kind: 'textbox', id: 'tb1' }],
    });
    const inner = host.querySelector('.context-panel')!;
    expect(inner.querySelector('.cp-slider')).toBeNull();
    expect(inner.querySelector('.panel-draw')?.textContent).toBe('BRUSH SIZE');
  });
});
