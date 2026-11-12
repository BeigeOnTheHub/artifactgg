import { describe, it, expect, vi, beforeEach } from 'vitest';
import { contactSheetLayout, composeContactSheet, type ContactSheetOpts } from './contactSheet';
import { createStore } from './store';
import { emptyFrame } from '../types/primitives';
import { hex } from '../types/hex';

describe('contactSheetLayout', () => {
  it('adapts column count to frame count, capped at 4', () => {
    expect(contactSheetLayout(1).cols).toBe(1);
    expect(contactSheetLayout(2).cols).toBe(2);
    expect(contactSheetLayout(3).cols).toBe(2);
    expect(contactSheetLayout(4).cols).toBe(2);
    expect(contactSheetLayout(6).cols).toBe(3);
    expect(contactSheetLayout(9).cols).toBe(3);
    expect(contactSheetLayout(10).cols).toBe(4);
    expect(contactSheetLayout(20).cols).toBe(4);
  });

  it('computes rows and one cell per frame in row-major order', () => {
    const l = contactSheetLayout(5); // 3 cols -> 2 rows
    expect(l.rows).toBe(2);
    expect(l.cells).toHaveLength(5);
    // row-major: cell 0 and cell 1 share a row (same y), cell 0 left of cell 1
    expect(l.cells[0]!.y).toBe(l.cells[1]!.y);
    expect(l.cells[0]!.x).toBeLessThan(l.cells[1]!.x);
    // cell 3 is on the next row (greater y than cell 0)
    expect(l.cells[3]!.y).toBeGreaterThan(l.cells[0]!.y);
  });

  it('canvas dimensions match the padding/gap/header/footer formula', () => {
    const l = contactSheetLayout(4); // 2x2
    const expectedW = l.pad * 2 + l.cols * l.cellW + (l.cols - 1) * l.gap;
    const expectedH = l.pad + l.headerH + l.rows * (l.cellH + l.captionH)
      + (l.rows - 1) * l.gap + l.footerH + l.pad;
    expect(l.canvasW).toBe(expectedW);
    expect(l.canvasH).toBe(expectedH);
  });

  it('treats a zero/empty frame count as one cell', () => {
    expect(contactSheetLayout(0).cells).toHaveLength(1);
    expect(contactSheetLayout(0).cols).toBe(1);
  });
});

function makeState(captions: Array<string | undefined>) {
  const frames = captions.map((cap) => ({ ...emptyFrame(), caption: cap }));
  return {
    mapId: 'suna', zoom: 1, panX: 0, panY: 0,
    frames, activeFrameIdx: 0,
    notes: '', tool: 'cursor',
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  } as unknown as Parameters<typeof createStore>[0];
}

interface DrawCall { fn: string; args: unknown[]; }

function installCanvasMock(): { drawn: DrawCall[] } {
  const drawn: DrawCall[] = [];
  const rec = (fn: string) => (...args: unknown[]) => { drawn.push({ fn, args }); };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (kind: string) {
    if (kind !== '2d') return null;
    return {
      drawImage: rec('drawImage'),
      fillRect: rec('fillRect'),
      fillText: rec('fillText'),
      measureText: () => ({ width: 0 }),
      set fillStyle(_v: unknown) {}, get fillStyle() { return ''; },
      set font(_v: unknown) {}, get font() { return ''; },
      set textAlign(_v: unknown) {}, get textAlign() { return 'left'; },
      set textBaseline(_v: unknown) {}, get textBaseline() { return 'top'; },
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'high',
    } as unknown as CanvasRenderingContext2D;
  });
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback): void {
    cb(new Blob(['fake'], { type: 'image/png' }));
  };
  return { drawn };
}

function baseOpts(store: ReturnType<typeof createStore>, composeFrame: ContactSheetOpts['composeFrame']): ContactSheetOpts {
  return {
    store,
    composeFrame,
    header: { mapName: 'SUNA', stratName: 'A-site default', dateText: '30 May 2026' },
    footer: 'made with artifactgg.com',
    captionOf: (i) => store.get().frames[i]?.caption ?? '',
  };
}

describe('composeContactSheet', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('composites every frame once and returns a png blob', async () => {
    installCanvasMock();
    const store = createStore(makeState(['a', 'b', 'c']));
    let calls = 0;
    const blob = await composeContactSheet(baseOpts(store, async () => {
      calls += 1;
      return document.createElement('canvas');
    }));
    expect(calls).toBe(3);
    expect(blob.type).toBe('image/png');
  });

  it('restores frames + activeFrameIdx by reference afterwards', async () => {
    installCanvasMock();
    const store = createStore(makeState(['a', 'b']));
    const origFrames = store.get().frames;
    await composeContactSheet(baseOpts(store, async () => document.createElement('canvas')));
    expect(store.get().frames).toBe(origFrames);
    expect(store.get().activeFrameIdx).toBe(0);
  });

  it('restores the store even if compositing throws', async () => {
    installCanvasMock();
    const store = createStore(makeState(['a', 'b']));
    const origFrames = store.get().frames;
    await expect(composeContactSheet(baseOpts(store, async () => { throw new Error('boom'); })))
      .rejects.toThrow('boom');
    expect(store.get().frames).toBe(origFrames);
    expect(store.get().activeFrameIdx).toBe(0);
  });

  it('draws one image per frame (the tiled cells)', async () => {
    const { drawn } = installCanvasMock();
    const store = createStore(makeState(['a', 'b', 'c', 'd']));
    await composeContactSheet(baseOpts(store, async () => document.createElement('canvas')));
    expect(drawn.filter((d) => d.fn === 'drawImage')).toHaveLength(4);
  });
});
