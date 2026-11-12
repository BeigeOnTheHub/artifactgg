import { describe, it, expect, beforeEach } from 'vitest';
import { QuickAddLayer } from './QuickAddLayer';
import { createStore, type StratState } from '../app/store';
import { emptyFrame, type QuickAdd } from '../types/primitives';
import { hex } from '../types/hex';

function makeStore() {
  const initial: StratState = {
    mapId: 'suna',  // use suna so the scale factor is exactly V2_MAP_WIDTH/REFERENCE_MAP_WIDTH
    zoom: 1, panX: 0, panY: 0,
    frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '', tool: 'cursor',
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
  return createStore(initial);
}

const GRENADE: QuickAdd = { id: 'qaG', type: 'grenade', x: 100, y: 100, rangeVisible: false };
const SMOKE: QuickAdd = { id: 'qaS', type: 'smoke', x: 200, y: 200, rangeVisible: true };
const SCANNER_QA: QuickAdd = { id: 'qaSc', type: 'scanner', x: 300, y: 300, rangeVisible: false };

describe('QuickAddLayer', () => {
  let mount: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let layer: QuickAddLayer;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
    store = makeStore();
    layer = new QuickAddLayer(mount, store, { w: 1920, h: 1080 });
    layer.mount();
  });

  it('appends an svg with the right viewBox', () => {
    const svg = mount.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('viewBox')).toBe('0 0 1920 1080');
  });

  it('renders a grenade group with two circles + centre icon', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, quickadds: [GRENADE] }] });
    const g = mount.querySelector('svg [data-quickadd-id="qaG"]');
    expect(g).not.toBeNull();
    expect(g!.getAttribute('data-quickadd-type')).toBe('grenade');
    expect(g!.querySelectorAll('circle.qa-range').length).toBeGreaterThanOrEqual(2);
    expect(g!.querySelector('image.qa-center-icon')).not.toBeNull();
  });

  it('draws the thermite flame as an inline path, not an image', () => {
    const THERMITE: QuickAdd = { id: 'qaT', type: 'thermite', x: 400, y: 400, rangeVisible: true };
    store._apply({ frames: [{ ...store.get().frames[0]!, quickadds: [THERMITE] }] });
    const g = mount.querySelector('svg [data-quickadd-id="qaT"]')!;
    expect(g.querySelector('path.qa-range')).not.toBeNull();
    const hrefs = Array.from(g.querySelectorAll('image')).map((i) => i.getAttribute('href'));
    expect(hrefs.some((h) => h?.includes('thermite-fire'))).toBe(false);
  });

  it('renders a scanner group with image only (no .qa-range children)', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, quickadds: [SCANNER_QA] }] });
    const g = mount.querySelector('svg [data-quickadd-id="qaSc"]')!;
    expect(g.getAttribute('data-quickadd-type')).toBe('scanner');
    expect(g.querySelectorAll('.qa-range').length).toBe(0);
    expect(g.querySelector('image')).not.toBeNull();
  });

  it('positions the group at the item map-coords via transform', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, quickadds: [GRENADE] }] });
    const g = mount.querySelector('svg [data-quickadd-id="qaG"]')!;
    expect(g.getAttribute('transform')).toBe('translate(100,100)');
  });

  it('rangeVisible:false hides .qa-range children and shows .qa-center-icon', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, quickadds: [GRENADE] }] });
    const g = mount.querySelector('svg [data-quickadd-id="qaG"]')!;
    g.querySelectorAll('.qa-range').forEach((el) => {
      expect(el.getAttribute('display')).toBe('none');
    });
    expect(g.querySelector('.qa-center-icon')!.getAttribute('display')).not.toBe('none');
  });

  it('rangeVisible:true shows .qa-range and hides .qa-center-icon', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, quickadds: [SMOKE] }] });
    const g = mount.querySelector('svg [data-quickadd-id="qaS"]')!;
    g.querySelectorAll('.qa-range').forEach((el) => {
      expect(el.getAttribute('display')).not.toBe('none');
    });
    expect(g.querySelector('.qa-center-icon')!.getAttribute('display')).toBe('none');
  });

  it('moving an item updates only the transform (node identity stable)', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, quickadds: [GRENADE] }] });
    const before = mount.querySelector('svg [data-quickadd-id="qaG"]')!;
    const moved: QuickAdd = { ...GRENADE, x: 500, y: 400 };
    store._apply({ frames: [{ ...store.get().frames[0]!, quickadds: [moved] }] });
    const after = mount.querySelector('svg [data-quickadd-id="qaG"]')!;
    expect(after).toBe(before);
    expect(after.getAttribute('transform')).toBe('translate(500,400)');
  });

  it('switching mapId rebuilds all nodes (node identity changes)', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, quickadds: [GRENADE] }] });
    const before = mount.querySelector('svg [data-quickadd-id="qaG"]')!;
    store._apply({ mapId: 'khidi' });
    const after = mount.querySelector('svg [data-quickadd-id="qaG"]')!;
    expect(after).not.toBe(before);
  });

  it('removes nodes for deleted items', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, quickadds: [GRENADE, SMOKE] }] });
    expect(mount.querySelectorAll('svg [data-quickadd-id]')).toHaveLength(2);
    store._apply({ frames: [{ ...store.get().frames[0]!, quickadds: [SMOKE] }] });
    const remaining = Array.from(mount.querySelectorAll('svg [data-quickadd-id]')).map(
      (n) => n.getAttribute('data-quickadd-id'),
    );
    expect(remaining).toEqual(['qaS']);
  });

  it('destroy detaches subscriptions and removes the svg', () => {
    layer.destroy();
    expect(mount.querySelector('svg')).toBeNull();
    expect(() => store._apply({ frames: [{ ...store.get().frames[0]!, quickadds: [GRENADE] }] })).not.toThrow();
  });
});
