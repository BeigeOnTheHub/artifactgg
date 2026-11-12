import { describe, it, expect } from 'vitest';
import { createStore, type StratState } from './store';
import { Shell } from './Shell';
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
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
}

describe('Shell - layout slots', () => {
  it('exposes #sidebar-root and #topbar-root after mount()', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const shell = new Shell(root, createStore(initialState()));
    shell.mount();

    const sidebar = shell.getSidebarRoot();
    const topbar = shell.getTopBarRoot();

    expect(sidebar.id).toBe('sidebar-root');
    expect(topbar.id).toBe('topbar-root');
    expect(root.contains(sidebar)).toBe(true);
    expect(root.contains(topbar)).toBe(true);

    shell.destroy();
    document.body.removeChild(root);
  });

  it('viewer remains accessible alongside the new slots', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const shell = new Shell(root, createStore(initialState()));
    shell.mount();

    expect(root.contains(shell.getViewer())).toBe(true);

    shell.destroy();
    document.body.removeChild(root);
  });
});

describe('Shell data-layout wiring', () => {
  it('reflects desktop layoutMode on the root dataset and keeps structural elements', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const store = createStore({ ...initialState(), layoutMode: 'desktop' });
    const shell = new Shell(root, store);
    shell.mount();
    expect(root.dataset['layout']).toBe('desktop');
    expect(root.querySelector('#sidebar-root')).toBeTruthy();
    expect(root.querySelector('#topbar-root')).toBeTruthy();
    expect(root.querySelector('#map-viewer')).toBeTruthy();
    shell.destroy();
    document.body.removeChild(root);
  });

  it('updates data-layout when the store switches to compact', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const store = createStore({ ...initialState(), layoutMode: 'desktop' });
    const shell = new Shell(root, store);
    shell.mount();
    store._apply({ layoutMode: 'compact' });
    expect(root.dataset['layout']).toBe('compact');
    shell.destroy();
    document.body.removeChild(root);
  });
});
