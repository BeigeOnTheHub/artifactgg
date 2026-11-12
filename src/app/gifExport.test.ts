import { describe, it, expect, vi, beforeEach } from 'vitest';

const writeFrame = vi.fn();
const finish = vi.fn();
const bytes = vi.fn(() => new Uint8Array([1, 2, 3]));
vi.mock('gifenc', () => ({
  GIFEncoder: () => ({ writeFrame, finish, bytes }),
  quantize: () => [[0, 0, 0]],
  applyPalette: () => new Uint8Array(1),
}));

import { createStore } from './store';
import { emptyFrame } from '../types/primitives';
import { hex } from '../types/hex';
import { exportGif } from './gifExport';

function makeState() {
  const f0 = emptyFrame();
  const f1 = { ...emptyFrame(), durationMs: 2500 };
  const f2 = emptyFrame();
  return {
    mapId: 'miru', zoom: 1, panX: 0, panY: 0,
    frames: [f0, f1, f2], activeFrameIdx: 0,
    notes: '', tool: 'cursor',
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  } as unknown as Parameters<typeof createStore>[0];
}

beforeEach(() => { writeFrame.mockClear(); finish.mockClear(); bytes.mockClear(); });

describe('exportGif', () => {
  it('composites every frame, uses per-frame durationMs else the global delay, restores the store, downloads a gif', async () => {
    const store = createStore(makeState());
    const origFrames = store.get().frames;
    let composeCalls = 0;
    const downloads: Array<{ blob: Blob; filename: string }> = [];
    await exportGif({
      store,
      composeFrame: async () => { composeCalls += 1; return { data: new Uint8Array(4), width: 2, height: 2 }; },
      globalDelayMs: () => 1000,
      download: (blob, filename) => downloads.push({ blob, filename }),
      filenameStem: () => 'miru-x',
    });
    expect(composeCalls).toBe(3);
    expect(writeFrame.mock.calls.map((c) => c[3].delay)).toEqual([1000, 2500, 1000]);
    expect(store.get().frames).toBe(origFrames);     // restored by reference
    expect(store.get().activeFrameIdx).toBe(0);
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.blob.type).toBe('image/gif');
    expect(downloads[0]!.filename).toMatch(/^artifact-miru-x\.gif$/);
  });

  it('still restores the store if compositing throws', async () => {
    const store = createStore(makeState());
    const origFrames = store.get().frames;
    await expect(exportGif({
      store,
      composeFrame: async () => { throw new Error('boom'); },
      globalDelayMs: () => 1000,
      download: () => {},
      filenameStem: () => 'm',
    })).rejects.toThrow('boom');
    expect(store.get().frames).toBe(origFrames);
    expect(store.get().activeFrameIdx).toBe(0);
  });
});
