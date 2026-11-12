import { describe, it, expect, beforeEach } from 'vitest';
import { ConeLayer } from './ConeLayer';
import { createStore, type StratState } from '../app/store';
import { emptyFrame, type Cone } from '../types/primitives';
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

const CONE_A: Cone = {
  id: 'coneA', x: 100, y: 100, angle: 0, length: 130,
  spreadIdx: 1, customHalfAngle: null, color: hex('#00ff88'), attachedPlayerId: null,
};
const CONE_B: Cone = {
  id: 'coneB', x: 300, y: 200, angle: Math.PI / 2, length: 80,
  spreadIdx: 0, customHalfAngle: null, color: hex('#ff4655'), attachedPlayerId: null,
};

describe('ConeLayer', () => {
  let mount: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let layer: ConeLayer;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
    store = makeStore();
    layer = new ConeLayer(mount, store, { w: 1920, h: 1080 });
    layer.mount();
  });

  it('appends an svg with the right viewBox', () => {
    const svg = mount.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('viewBox')).toBe('0 0 1920 1080');
  });

  it('renders a cone group with body + arc dot + root dot', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, cones: [CONE_A] }] });
    const g = mount.querySelector('svg [data-cone-id="coneA"]');
    expect(g).not.toBeNull();
    expect(g!.querySelector('[data-role="body"]')).not.toBeNull();
    expect(g!.querySelector('[data-role="arc"]')).not.toBeNull();
    expect(g!.querySelector('[data-role="root"]')).not.toBeNull();
  });

  it('body path uses the cone colour', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, cones: [CONE_A] }] });
    const body = mount.querySelector('svg [data-cone-id="coneA"] [data-role="body"]')!;
    expect(body.getAttribute('stroke')).toBe('#00ff88');
  });

  it('mutates an existing cone in place rather than rebuilding', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, cones: [CONE_A] }] });
    const before = mount.querySelector('svg [data-cone-id="coneA"]')!;
    const moved: Cone = { ...CONE_A, x: 500, y: 500 };
    store._apply({ frames: [{ ...store.get().frames[0]!, cones: [moved] }] });
    const after = mount.querySelector('svg [data-cone-id="coneA"]')!;
    expect(after).toBe(before);
    const root = after.querySelector('[data-role="root"]')!;
    expect(root.getAttribute('cx')).toBe('500');
    expect(root.getAttribute('cy')).toBe('500');
  });

  it('removes nodes for deleted cones', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, cones: [CONE_A, CONE_B] }] });
    expect(mount.querySelectorAll('svg [data-cone-id]')).toHaveLength(2);
    store._apply({ frames: [{ ...store.get().frames[0]!, cones: [CONE_B] }] });
    const remaining = Array.from(mount.querySelectorAll('svg [data-cone-id]')).map(
      (n) => n.getAttribute('data-cone-id'),
    );
    expect(remaining).toEqual(['coneB']);
  });

  it('cone handles have pointer-events:none in 3a (no interaction)', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, cones: [CONE_A] }] });
    const arcDot = mount.querySelector('svg [data-cone-id="coneA"] [data-role="arc"]')!;
    expect(arcDot.getAttribute('pointer-events')).toBe('none');
  });

  it('an attached cone renders at the player position and takes the team colour', () => {
    const attached: Cone = { ...CONE_A, attachedPlayerId: 'p1' };
    store._apply({
      frames: [{
        ...store.get().frames[0]!,
        cones: [attached],
        players: [{ id: 'p1', team: 'colonist', x: 600, y: 700, name: '', dead: false }],
      }],
    });
    const g = mount.querySelector('svg [data-cone-id="coneA"]')!;
    const root = g.querySelector('[data-role="root"]')!;
    expect(root.getAttribute('cx')).toBe('600');
    expect(root.getAttribute('cy')).toBe('700');
    const body = g.querySelector('[data-role="body"]')!;
    expect(body.getAttribute('stroke')).toBe('#ff4444'); // colonist colour, not the stored #00ff88
  });

  it('an attached cone with a missing player falls back to its own coords + colour', () => {
    const attached: Cone = { ...CONE_A, attachedPlayerId: 'gone' };
    store._apply({ frames: [{ ...store.get().frames[0]!, cones: [attached] }] });
    const root = mount.querySelector('svg [data-cone-id="coneA"] [data-role="root"]')!;
    expect(root.getAttribute('cx')).toBe('100');
    expect(root.getAttribute('cy')).toBe('100');
  });

  it('a cone with customHalfAngle at or beyond pi still draws (clamped, not degenerate)', () => {
    // Bare SVG arcs need two distinct endpoints; if 2*ha == 2*pi the start and
    // end coincide and the path renders as nothing. Clamping inside ConeLayer
    // means the path always has a non-trivial body.
    for (const ha of [Math.PI, Math.PI + 0.5, Math.PI * 2]) {
      const wide: Cone = { ...CONE_A, customHalfAngle: ha };
      store._apply({ frames: [{ ...store.get().frames[0]!, cones: [wide] }] });
      const body = mount.querySelector('svg [data-cone-id="coneA"] [data-role="body"]')!;
      const d = body.getAttribute('d') ?? '';
      // Pull the two arc endpoints (M ox oy L x1 y1 A r r 0 flag 1 x2 y2 Z)
      // and verify they aren't sitting on top of each other.
      const m = d.match(/L([-\d.]+) ([-\d.]+) A[\d.]+ [\d.]+ 0 \d \d ([-\d.]+) ([-\d.]+)/);
      expect(m).not.toBeNull();
      const [x1, y1, x2, y2] = [Number(m![1]), Number(m![2]), Number(m![3]), Number(m![4])];
      expect(Math.hypot(x1 - x2, y1 - y2)).toBeGreaterThan(0.1);
    }
  });

  it('destroy detaches subscriptions and removes the svg', () => {
    layer.destroy();
    expect(mount.querySelector('svg')).toBeNull();
    expect(() => store._apply({
      frames: [{ ...store.get().frames[0]!, cones: [CONE_A] }],
    })).not.toThrow();
  });
});
