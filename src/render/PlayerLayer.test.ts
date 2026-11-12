import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PlayerLayer } from './PlayerLayer';
import { createStore, type StratState } from '../app/store';
import { emptyFrame, type Player } from '../types/primitives';
import { hex } from '../types/hex';
import type { Viewport } from './coords';
import { setPlayerSizeMode, setPlayerSizeFactor } from '../app/playerSizePref';

function resetPlayerSize(): void {
  try { localStorage.clear(); } catch { /* ignore */ }
  setPlayerSizeMode('auto');
  setPlayerSizeFactor(1);
}

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

const PLAYER_A: Player = {
  id: 'pA', team: 'colonist', x: 100, y: 100, name: 'Alpha', dead: false,
};
const PLAYER_B: Player = {
  id: 'pB', team: 'reyab', x: 300, y: 200, name: '', dead: false,
};
const PLAYER_DEAD: Player = {
  id: 'pD', team: 'colonist', x: 500, y: 500, name: '', dead: true,
};

function fakeViewport(zoom: number, panX = 0, panY = 0): Viewport {
  return {
    left: 0, top: 0, width: 800, height: 600,
    w: 1920, h: 1080, zoom, panX, panY,
  };
}

describe('PlayerLayer', () => {
  let mount: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let layer: PlayerLayer;

  beforeEach(() => {
    mount = document.createElement('div');
    Object.defineProperty(mount, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(mount, 'clientHeight', { value: 600, configurable: true });
    document.body.appendChild(mount);
    resetPlayerSize();
    store = makeStore();
    layer = new PlayerLayer(mount, store, { w: 1920, h: 1080 }, () => fakeViewport(store.get().zoom, store.get().panX, store.get().panY));
    layer.mount();
  });

  afterEach(() => { resetPlayerSize(); });

  it('appends an svg sized to the viewport (not the map)', () => {
    const svg = mount.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('width')).toBe('800');
    expect(svg!.getAttribute('height')).toBe('600');
  });

  it('renders a player group with circle + number text', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, players: [PLAYER_A] }] });
    const g = mount.querySelector('svg [data-player-id="pA"]');
    expect(g).not.toBeNull();
    expect(g!.querySelector('circle[stroke="#ff4444"]')).not.toBeNull();
    expect(g!.querySelector('text')!.textContent).toBe('1');
  });

  it('auto mode (the default) is a fixed size, constant on zoom and ignoring the slider', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, players: [PLAYER_A] }] });
    const ring = () => mount.querySelector('svg [data-player-id="pA"] [data-role="ring"]')!;
    expect(Number(ring().getAttribute('r'))).toBeCloseTo(14, 5);
    store._apply({ zoom: 2 }); // constant - zoom does not change it
    expect(Number(ring().getAttribute('r'))).toBeCloseTo(14, 5);
    setPlayerSizeFactor(2); // greyed slider has no effect in auto
    expect(Number(ring().getAttribute('r'))).toBeCloseTo(14, 5);
  });

  it('manual mode scales the ring with zoom, and the factor multiplies it', () => {
    setPlayerSizeMode('manual');
    store._apply({ frames: [{ ...store.get().frames[0]!, players: [PLAYER_A] }] });
    const ring = () => Number(mount.querySelector('svg [data-player-id="pA"] [data-role="ring"]')!.getAttribute('r'));
    const r1 = ring(); // store zoom defaults to 1
    store._apply({ zoom: 2 }); // reposition path must resize, not just move
    const r2 = ring();
    expect(r2).toBeCloseTo(r1 * 2, 5); // doubles with zoom
    setPlayerSizeFactor(2);
    expect(ring()).toBeCloseTo(r2 * 2, 5); // slider multiplies on top
  });

  it('the number text scales with the ring', () => {
    setPlayerSizeMode('manual');
    setPlayerSizeFactor(2);
    store._apply({ frames: [{ ...store.get().frames[0]!, players: [PLAYER_A] }] });
    const r = Number(mount.querySelector('svg [data-player-id="pA"] [data-role="ring"]')!.getAttribute('r'));
    const f = Number(mount.querySelector('svg [data-player-id="pA"] text')!.getAttribute('font-size'));
    expect(f).toBeCloseTo(13 * (r / 14), 5); // font tracks the ring proportionally
  });

  it('export svg: auto stays the fixed base, manual carries the factor', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, players: [PLAYER_A] }] });
    setPlayerSizeFactor(2);
    // auto (default) ignores the factor in exports too
    const autoRing = layer.getExportSvg(1920, 1080).querySelector('[data-role="ring"]')!;
    expect(Number(autoRing.getAttribute('r'))).toBeCloseTo(14, 5);
    // manual scales the export by the factor
    setPlayerSizeMode('manual');
    const manualRing = layer.getExportSvg(1920, 1080).querySelector('[data-role="ring"]')!;
    expect(Number(manualRing.getAttribute('r'))).toBeCloseTo(28, 5);
  });

  it('renders skull instead of number when dead', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, players: [PLAYER_DEAD] }] });
    const g = mount.querySelector('svg [data-player-id="pD"]')!;
    expect(g.querySelector('text')).toBeNull();
    expect(g.querySelector('[data-role="skull"]')).not.toBeNull();
  });

  it('numbers each team independently from 1', () => {
    store._apply({
      frames: [{
        ...store.get().frames[0]!,
        players: [PLAYER_A, PLAYER_B], // colonist + reyab
      }],
    });
    const a = mount.querySelector('svg [data-player-id="pA"] text')!;
    const b = mount.querySelector('svg [data-player-id="pB"] text')!;
    expect(a.textContent).toBe('1');
    expect(b.textContent).toBe('1');
  });

  it('positions the group via translate at the screen-space coords for the player', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, players: [PLAYER_A] }] });
    const g = mount.querySelector('svg [data-player-id="pA"]')!;
    // viewport 800x600, map 1920x1080, zoom 1 -> tx = (800-1920)/2 = -560
    // mapToClient(100, 100) = 100*1 + -560 + 0 = -460 (x), 100*1 + -240 = -140 (y)
    // ty = (600-1080)/2 = -240
    expect(g.getAttribute('transform')).toBe('translate(-460,-140)');
  });

  it('re-positions when zoom changes (id-keyed node remains the same instance)', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, players: [PLAYER_A] }] });
    const before = mount.querySelector('svg [data-player-id="pA"]')!;
    const beforeTransform = before.getAttribute('transform');
    store._apply({ zoom: 2 });
    const after = mount.querySelector('svg [data-player-id="pA"]')!;
    expect(after).toBe(before); // same node
    expect(after.getAttribute('transform')).not.toBe(beforeTransform);
  });

  it('removes nodes for deleted players', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, players: [PLAYER_A, PLAYER_B] }] });
    expect(mount.querySelectorAll('svg [data-player-id]')).toHaveLength(2);
    store._apply({ frames: [{ ...store.get().frames[0]!, players: [PLAYER_B] }] });
    const remaining = Array.from(mount.querySelectorAll('svg [data-player-id]')).map(
      (n) => n.getAttribute('data-player-id'),
    );
    expect(remaining).toEqual(['pB']);
  });

  it('reposition (on zoom/pan) reads through the FrameView, not the live active frame', () => {
    // When wired to a non-live FrameView (e.g. the onion-skin ghost's
    // PreviousFrameView), reposition must use that view's players. If it ever
    // reads the live active frame again, ghost players will jump to their
    // current-frame positions on every zoom/pan.
    const previousFramePlayers: Player[] = [{ ...PLAYER_A, x: 100, y: 100 }];
    const activeFramePlayers: Player[] = [{ ...PLAYER_A, x: 800, y: 600 }];
    store._apply({
      frames: [
        { ...store.get().frames[0]!, players: previousFramePlayers },
        { ...store.get().frames[0]!, players: activeFramePlayers },
      ],
      activeFrameIdx: 1,
    });
    // A FrameView that always yields the previous frame.
    const prevView = {
      getView: () => ({ frame: store.get().frames[0]!, effects: new Map() }),
      subscribe: () => () => {},
    };
    const ghost = new PlayerLayer(mount, store, { w: 1920, h: 1080 },
      () => fakeViewport(store.get().zoom, store.get().panX, store.get().panY),
      prevView);
    ghost.mount();
    const g = mount.querySelectorAll('svg [data-player-id="pA"]')[1]!; // ghost is the 2nd svg's node
    const initial = g.getAttribute('transform');
    // Trigger reposition by changing zoom.
    store._apply({ zoom: 2 });
    const after = g.getAttribute('transform');
    // The translate should match the PREVIOUS frame's (100,100), not the active
    // frame's (800,600). At zoom 2 the previous-frame position recomputes; the
    // active-frame position would put the node somewhere else entirely.
    expect(after).not.toBe(initial); // re-positioned
    // mapToClient(100, 100) at zoom=2: tx = (800 - 1920*2)/2 = -1520, x = 100*2 - 1520 = -1320
    // ty = (600 - 1080*2)/2 = -780, y = 100*2 - 780 = -580
    expect(after).toBe('translate(-1320,-580)');
    ghost.destroy();
  });

  it('destroy detaches subscriptions and removes the svg', () => {
    layer.destroy();
    expect(mount.querySelector('svg')).toBeNull();
    expect(() => store._apply({
      frames: [{ ...store.get().frames[0]!, players: [PLAYER_A] }],
    })).not.toThrow();
  });
});
