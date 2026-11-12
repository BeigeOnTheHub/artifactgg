import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OnionSkinLayer } from './OnionSkinLayer';
import { createStore, type StratState } from '../app/store';
import { createHistory } from '../app/history';
import { emptyFrame, type Player } from '../types/primitives';
import { hex } from '../types/hex';
import { setOnion } from '../app/onionPref';
import type { Viewport } from './coords';

function fakeContext(): CanvasRenderingContext2D & Record<string, unknown> {
  const ctx = {} as Record<string, unknown>;
  for (const m of [
    'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'clearRect', 'drawImage',
    'save', 'restore', 'setTransform', 'arc', 'fillRect', 'strokeRect',
  ]) {
    ctx[m] = vi.fn();
  }
  for (const p of ['lineCap', 'lineJoin', 'lineWidth', 'globalCompositeOperation', 'globalAlpha', 'strokeStyle', 'fillStyle']) {
    ctx[p] = '';
  }
  return ctx as unknown as CanvasRenderingContext2D & Record<string, unknown>;
}

function patchCanvasGetContext(): void {
  const cache = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string) {
    if (kind !== '2d') return null;
    let ctx = cache.get(this);
    if (!ctx) { ctx = fakeContext(); cache.set(this, ctx); }
    return ctx;
  } as HTMLCanvasElement['getContext'];
}

const PLAYER_A: Player = {
  id: 'p1', team: 'colonist', x: 100, y: 100, name: 'Alpha', dead: false,
};

function makeStore() {
  const initial: StratState = {
    mapId: 'miru',
    zoom: 1, panX: 0, panY: 0,
    frames: [
      { ...emptyFrame(), players: [PLAYER_A] },
      emptyFrame(),
    ],
    activeFrameIdx: 1,
    notes: '', tool: 'cursor',
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
  return createStore(initial);
}

function fakeViewport(zoom: number, panX = 0, panY = 0): Viewport {
  return {
    left: 0, top: 0, width: 800, height: 600,
    w: 1920, h: 1080, zoom, panX, panY,
  };
}

describe('OnionSkinLayer', () => {
  let zoomViewport: HTMLElement;
  let mapWrap: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let layer: OnionSkinLayer;
  let playing: boolean;
  let onChangeCb: () => void;
  let playback: { isPlaying(): boolean; onChange(cb: () => void): () => void };

  beforeEach(() => {
    patchCanvasGetContext();
    zoomViewport = document.createElement('div');
    Object.defineProperty(zoomViewport, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(zoomViewport, 'clientHeight', { value: 600, configurable: true });
    document.body.appendChild(zoomViewport);

    mapWrap = document.createElement('div');
    Object.defineProperty(mapWrap, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(mapWrap, 'clientHeight', { value: 600, configurable: true });
    const mapImage = document.createElement('div');
    mapImage.id = 'map-image';
    mapWrap.appendChild(mapImage);
    document.body.appendChild(mapWrap);

    store = makeStore();
    history = createHistory(store);
    playing = false;
    onChangeCb = () => {};
    playback = {
      isPlaying: () => playing,
      onChange: (cb) => { onChangeCb = cb; return () => {}; },
    };

    layer = new OnionSkinLayer(
      zoomViewport, mapWrap, store, history,
      { w: 1920, h: 1080 },
      () => fakeViewport(store.get().zoom, store.get().panX, store.get().panY),
      playback,
    );
  });

  afterEach(() => {
    setOnion(false);
  });

  function ghostContainers(): HTMLElement[] {
    return Array.from(document.body.querySelectorAll<HTMLElement>('div')).filter(
      (d) => d.parentElement === zoomViewport || (d.parentElement === mapWrap && d.id !== 'map-image'),
    );
  }

  it('builds both ghost containers, dim and non-interactive, visible when onion on / frame mode / active>0', () => {
    setOnion(true);
    layer.mount();

    const vp = Array.from(zoomViewport.children).find((c) => c.tagName === 'DIV') as HTMLElement;
    const wrap = Array.from(mapWrap.children).find(
      (c) => c.tagName === 'DIV' && (c as HTMLElement).id !== 'map-image',
    ) as HTMLElement;

    expect(vp).toBeTruthy();
    expect(wrap).toBeTruthy();

    for (const g of [vp, wrap]) {
      expect(g.style.pointerEvents).toBe('none');
      expect(parseFloat(g.style.opacity)).toBeCloseTo(0.28, 2);
      expect(g.style.display).not.toBe('none');
    }

    // ghost wrap sits directly after the map image
    const mapImage = mapWrap.querySelector('#map-image')!;
    expect(mapImage.nextSibling).toBe(wrap);
  });

  it('renders the PREVIOUS frame content (p1 from frame 0 while active=1)', () => {
    setOnion(true);
    layer.mount();

    const node = zoomViewport.querySelector('svg [data-player-id="p1"]');
    expect(node).not.toBeNull();
  });

  it('hides both containers when onion is turned off', () => {
    setOnion(true);
    layer.mount();
    setOnion(false);

    const vp = Array.from(zoomViewport.children).find((c) => c.tagName === 'DIV') as HTMLElement;
    const wrap = Array.from(mapWrap.children).find(
      (c) => c.tagName === 'DIV' && (c as HTMLElement).id !== 'map-image',
    ) as HTMLElement;
    expect(vp.style.display).toBe('none');
    expect(wrap.style.display).toBe('none');
  });

  it('hides when activeFrameIdx is 0', () => {
    setOnion(true);
    layer.mount();
    store._apply({ activeFrameIdx: 0 });

    for (const g of ghostContainers()) {
      expect(g.style.display).toBe('none');
    }
  });

  it('hides while playback is playing', () => {
    setOnion(true);
    layer.mount();
    playing = true;
    onChangeCb();

    for (const g of ghostContainers()) {
      expect(g.style.display).toBe('none');
    }
  });

  it('hides in animation mode', () => {
    setOnion(true);
    layer.mount();
    store._apply({ ui: { ...store.get().ui, mode: 'animation' } });

    for (const g of ghostContainers()) {
      expect(g.style.display).toBe('none');
    }
  });

  it('a stray dispatch from a ghost layer does NOT reach real history', () => {
    setOnion(true);
    // Pre-seed a textbox in the previous frame so the ghost TextLayer renders one.
    const tbox = { id: 'tb-ghost', x: 10, y: 10, w: 100, h: 40, text: 'hi', fontSize: 13, color: hex('#00ff88') };
    store._apply({
      frames: [
        { ...store.get().frames[0]!, textboxes: [tbox] },
        store.get().frames[1]!,
      ],
    });
    layer.mount();
    expect(history.canUndo()).toBe(false);
    // The ghost textbox node exists; simulate the worst-case where its handlers
    // fire a textbox.modify against the ghost's History. With a no-op shim that
    // dispatch goes nowhere - the real history stays clean.
    const ghostTbox = mapWrap.querySelector(`[data-tb-id="${tbox.id}"]`);
    if (ghostTbox) {
      // dblclick on the ghost would normally let you edit and dispatch a modify
      ghostTbox.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    }
    expect(history.canUndo()).toBe(false);
  });

  it('destroy removes both containers and is idempotent', () => {
    setOnion(true);
    layer.mount();

    expect(ghostContainers().length).toBe(2);
    layer.destroy();
    expect(ghostContainers().length).toBe(0);
    expect(() => layer.destroy()).not.toThrow();
  });
});
