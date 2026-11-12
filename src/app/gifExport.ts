import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { Store } from './store';

export interface GifExportOpts {
  store: Store;
  /** Composite the CURRENTLY displayed frame to RGBA at gif size. */
  composeFrame: () => Promise<{ data: Uint8Array | Uint8ClampedArray; width: number; height: number }>;
  /** Global fallback delay (ms) for frames with no durationMs. */
  globalDelayMs: () => number;
  /** Download sink (injectable for tests). */
  download: (blob: Blob, filename: string) => void;
  /** Filename stem, e.g. the map id + timestamp. */
  filenameStem: () => string;
}

/**
 * Build a looping GIF of every frame. Drives the store to each frame with a
 * NEW frames array ref (so the transition controller settles instantly, no
 * tween), composites it, then ALWAYS restores the original
 * frames+activeFrameIdx (finally) even if compositing throws.
 */
export async function exportGif(o: GifExportOpts): Promise<void> {
  const s0 = o.store.get();
  const origFrames = s0.frames;
  const origIdx = s0.activeFrameIdx;
  const enc = GIFEncoder();
  try {
    for (let i = 0; i < origFrames.length; i++) {
      o.store._apply({ frames: [...origFrames], activeFrameIdx: i });
      const { data, width, height } = await o.composeFrame();
      const u8 = data instanceof Uint8Array
        ? data
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const palette = quantize(u8, 256);
      const index = applyPalette(u8, palette);
      const ms = origFrames[i]!.durationMs;
      const delay = typeof ms === 'number' ? ms : o.globalDelayMs();
      enc.writeFrame(index, width, height, { palette, delay });
    }
  } finally {
    o.store._apply({ frames: origFrames, activeFrameIdx: origIdx });
  }
  enc.finish();
  const blob = new Blob([enc.bytes()], { type: 'image/gif' });
  o.download(blob, `artifact-${o.filenameStem()}.gif`);
}
