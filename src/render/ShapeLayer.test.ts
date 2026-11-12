import { describe, it, expect, beforeEach } from 'vitest';
import { ShapeLayer } from './ShapeLayer';
import { createStore, type StratState } from '../app/store';
import { emptyFrame, type Shape } from '../types/primitives';
import { hex } from '../types/hex';

function makeStore() {
  const initial: StratState = {
    mapId: 'miru',
    zoom: 1, panX: 0, panY: 0,
    frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '', tool: 'cursor',
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
  return createStore(initial);
}

const RECT: Shape = {
  id: 'r1', kind: 'square', x: 100, y: 100, w: 50, h: 30,
  rotation: 0, stroke: hex('#00ff88'), strokeWidth: 2, fill: false,
};
const CIRCLE: Shape = {
  id: 'c1', kind: 'circle', x: 200, y: 200, w: 40, h: 40,
  rotation: 0, stroke: hex('#ff4655'), strokeWidth: 3, fill: true,
};
const TRIANGLE: Shape = {
  id: 't1', kind: 'triangle', x: 300, y: 300, w: 60, h: 50,
  rotation: 0, stroke: hex('#5bffb0'), strokeWidth: 2, fill: false,
};
const LINE: Shape = {
  id: 'l1', kind: 'line', x: 400, y: 400, w: 80, h: 0,
  rotation: 0, stroke: hex('#00ff88'), strokeWidth: 2, fill: false,
};
const ARROW: Shape = {
  id: 'a1', kind: 'arrow', x: 500, y: 500, w: 80, h: 0,
  rotation: 0, stroke: hex('#00ff88'), strokeWidth: 2, fill: false,
};

describe('ShapeLayer', () => {
  let mount: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let layer: ShapeLayer;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
    store = makeStore();
    layer = new ShapeLayer(mount, store, { w: 1920, h: 1080 });
    layer.mount();
  });

  it('appends an svg element with the right viewBox', () => {
    const svg = mount.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('viewBox')).toBe('0 0 1920 1080');
  });

  it('renders a rect for kind=square', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, shapes: [RECT] }] });
    const rect = mount.querySelector('svg [data-shape-id="r1"]');
    expect(rect).not.toBeNull();
    expect(rect!.tagName.toLowerCase()).toBe('rect');
    expect(rect!.getAttribute('x')).toBe('100');
    expect(rect!.getAttribute('width')).toBe('50');
  });

  it('renders an ellipse for kind=circle', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, shapes: [CIRCLE] }] });
    const el = mount.querySelector('svg [data-shape-id="c1"]')!;
    expect(el.tagName.toLowerCase()).toBe('ellipse');
    expect(el.getAttribute('rx')).toBe('20');
    expect(el.getAttribute('ry')).toBe('20');
  });

  it('renders a path for kind=triangle, line, and arrow', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, shapes: [TRIANGLE, LINE, ARROW] }] });
    expect(mount.querySelector('svg [data-shape-id="t1"]')!.tagName.toLowerCase()).toBe('path');
    expect(mount.querySelector('svg [data-shape-id="l1"]')!.tagName.toLowerCase()).toBe('path');
    expect(mount.querySelector('svg [data-shape-id="a1"]')!.tagName.toLowerCase()).toBe('path');
    expect(mount.querySelector('svg [data-shape-id="a1"]')!.getAttribute('marker-end')).not.toBeNull();
  });

  it('mutates an existing node in place rather than rebuilding (node identity stable)', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, shapes: [RECT] }] });
    const before = mount.querySelector('svg [data-shape-id="r1"]')!;
    const moved: Shape = { ...RECT, x: 200, y: 200 };
    store._apply({ frames: [{ ...store.get().frames[0]!, shapes: [moved] }] });
    const after = mount.querySelector('svg [data-shape-id="r1"]')!;
    expect(after).toBe(before); // same node
    expect(after.getAttribute('x')).toBe('200');
  });

  it('removes nodes for deleted shapes', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, shapes: [RECT, CIRCLE] }] });
    expect(mount.querySelectorAll('svg [data-shape-id]')).toHaveLength(2);
    store._apply({ frames: [{ ...store.get().frames[0]!, shapes: [CIRCLE] }] });
    const remaining = Array.from(mount.querySelectorAll('svg [data-shape-id]')).map((n) => n.getAttribute('data-shape-id'));
    expect(remaining).toEqual(['c1']);
  });

  it('setPreview adds a transient preview node and clearing it removes it', () => {
    layer.setPreview(RECT);
    expect(mount.querySelector('svg [data-shape-preview="true"]')).not.toBeNull();
    layer.setPreview(null);
    expect(mount.querySelector('svg [data-shape-preview="true"]')).toBeNull();
  });

  it('destroy detaches subscriptions and removes the svg', () => {
    layer.destroy();
    expect(mount.querySelector('svg')).toBeNull();
    expect(() => store._apply({ frames: [{ ...store.get().frames[0]!, shapes: [RECT] }] })).not.toThrow();
  });

  it('getNode returns the SVG node for a known id, null for unknown', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, shapes: [RECT] }] });
    const node = layer.getNode('r1');
    expect(node).not.toBeNull();
    expect(node!.tagName.toLowerCase()).toBe('rect');
    expect(layer.getNode('does-not-exist')).toBeNull();
  });
});
