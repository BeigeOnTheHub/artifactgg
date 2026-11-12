import { describe, it, expect } from 'vitest';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

describe('gifenc is usable', () => {
  it('encodes a 2x2 frame to non-empty bytes', () => {
    const rgba = new Uint8Array([
      255,0,0,255,  0,255,0,255,
      0,0,255,255,   255,255,0,255,
    ]);
    const palette = quantize(rgba, 16);
    const index = applyPalette(rgba, palette);
    const enc = GIFEncoder();
    enc.writeFrame(index, 2, 2, { palette, delay: 100 });
    enc.finish();
    const bytes = enc.bytes();
    expect(bytes.length).toBeGreaterThan(0);
  });
});
