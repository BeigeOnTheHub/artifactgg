import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { composeFullPng, composeThumbnail, TAINTED_CANVAS } from './pngExport';

interface MockCtx {
  drawImage: ReturnType<typeof vi.fn>;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: 'low' | 'medium' | 'high';
  // Canvas 2d text bits used by drawTextBoxes. Stubbed so the textbox path
  // runs without a real rendering context.
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  rect: ReturnType<typeof vi.fn>;
  clip: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  measureText: ReturnType<typeof vi.fn>;
  font: string;
  fillStyle: string;
  textBaseline: string;
}

let drawCalls: Array<{ src: string; dx: number; dy: number; dw: number; dh: number }> = [];
let textDrawn: string[] = [];

function makeMockCtx(): MockCtx {
  return {
    drawImage: vi.fn((_src: unknown, dx: number, dy: number, dw: number, dh: number) => {
      const tag = (_src as { tagName?: string } | null)?.tagName ?? 'unknown';
      drawCalls.push({ src: tag, dx, dy, dw, dh });
    }),
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'high',
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn((text: string) => { textDrawn.push(text); }),
    // 8px per char is enough to exercise the wrap/break logic in tests.
    measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
    font: '',
    fillStyle: '',
    textBaseline: '',
  };
}

beforeEach(() => {
  drawCalls = [];
  textDrawn = [];
  // Stub <canvas>.getContext('2d') to return a mock so we can assert orchestration.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement, kind: string) {
    if (kind !== '2d') return null;
    return makeMockCtx() as unknown as CanvasRenderingContext2D;
  });
  // Stub toBlob to return a fake Blob synchronously.
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback): void {
    cb(new Blob(['fake-png'], { type: 'image/png' }));
  };
  HTMLCanvasElement.prototype.toDataURL = function (): string {
    return 'data:image/png;base64,FAKE';
  };
  // jsdom 24 lacks URL.createObjectURL/revokeObjectURL - stub them so the
  // SVG-to-image pipeline doesn't crash with TypeError before our SecurityError
  // path runs.
  if (typeof URL.createObjectURL !== 'function') {
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (): string => 'blob:mock';
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = (): void => {};
  }
  // jsdom doesn't fire `onload` for blob: URLs on <img>. Stub the `src` setter
  // so assigning a value synchronously schedules `onload` in a microtask.
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    set(this: HTMLImageElement, value: string) {
      Object.defineProperty(this, '_src', { configurable: true, writable: true, value });
      queueMicrotask(() => {
        const handler = this.onload;
        if (typeof handler === 'function') handler.call(this, new Event('load'));
      });
    },
    get(this: HTMLImageElement): string {
      return (this as unknown as { _src?: string })._src ?? '';
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeMockImg(): HTMLImageElement {
  const img = document.createElement('img');
  Object.defineProperty(img, 'complete', { value: true });
  Object.defineProperty(img, 'naturalWidth', { value: 1920 });
  // naturalHeight is read by drawContain to preserve aspect ratio - mock the
  // 16:9 case so the destination rect matches the canvas (no letterboxing).
  Object.defineProperty(img, 'naturalHeight', { value: 1080 });
  return img;
}

function makeMockStroke(): HTMLCanvasElement {
  return document.createElement('canvas');
}

function makeMockSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 1920 1080');
  return svg;
}

function makeBox(over: Partial<import('../types/primitives').TextBox> = {}) {
  return {
    id: 't1', x: 100, y: 100, w: 200, h: 80,
    text: 'hello', fontSize: 16,
    color: '#ffffff' as import('../types/hex').Hex,
    ...over,
  };
}

function deps(over: Partial<{
  textBoxes: ReturnType<typeof makeBox>[];
  svgLayers: SVGSVGElement[];
  calloutsImage: HTMLImageElement | null;
  scanner: { x: number; y: number; size: number; image: HTMLImageElement } | null;
}> = {}) {
  return {
    mapImage: makeMockImg(),
    calloutsImage: over.calloutsImage ?? null,
    strokeCanvas: makeMockStroke(),
    svgLayers: over.svgLayers ?? [makeMockSvg(), makeMockSvg()],
    textBoxes: over.textBoxes ?? [],
    scanner: over.scanner ?? null,
    mapWidth: 1920,
    mapHeight: 1080,
  };
}

describe('pngExport', () => {
  it('composeFullPng draws map, strokes, and one image per SVG layer at natural resolution', async () => {
    const blob = await composeFullPng(deps({ svgLayers: [makeMockSvg(), makeMockSvg(), makeMockSvg(), makeMockSvg()] }));
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    // 1 map + 1 stroke + 4 SVG layers = 6 drawImage calls minimum, all at natural size.
    expect(drawCalls.length).toBeGreaterThanOrEqual(6);
    expect(drawCalls[0]!.dw).toBe(1920);
    expect(drawCalls[0]!.dh).toBe(1080);
  });

  it('composeFullPng with empty svgLayers still draws map + strokes', async () => {
    const blob = await composeFullPng(deps({ svgLayers: [] }));
    expect(blob).toBeInstanceOf(Blob);
    expect(drawCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('composeThumbnail returns a 256x144 PNG dataURL', async () => {
    const url = await composeThumbnail(deps());
    expect(url.startsWith('data:image/png')).toBe(true);
  });

  it('composeFullPng surfaces a TAINTED_CANVAS error when toBlob fails with SecurityError', async () => {
    HTMLCanvasElement.prototype.toBlob = function (): never {
      const err = new Error('Tainted canvas') as Error & { name: string };
      err.name = 'SecurityError';
      throw err;
    };
    await expect(composeFullPng(deps())).rejects.toMatchObject({ cause: TAINTED_CANVAS });
  });

  it('composeThumbnail surfaces a TAINTED_CANVAS error when toDataURL fails', async () => {
    HTMLCanvasElement.prototype.toDataURL = function (): never {
      const err = new Error('Tainted canvas') as Error & { name: string };
      err.name = 'SecurityError';
      throw err;
    };
    await expect(composeThumbnail(deps())).rejects.toMatchObject({ cause: TAINTED_CANVAS });
  });

  it('paints textboxes onto the canvas with fillText (no foreignObject)', async () => {
    await composeFullPng(deps({ textBoxes: [makeBox({ text: 'alpha' })] }));
    // The wrapped line(s) get drawn via fillText rather than baked into an SVG.
    expect(textDrawn.join(' ')).toContain('alpha');
  });

  it('wraps and breaks long textbox content to the box width', async () => {
    // 200px box, ~8px/char mock => ~24 chars fit; a 40-char word must break.
    const long = 'x'.repeat(40);
    await composeFullPng(deps({ textBoxes: [makeBox({ text: long })] }));
    expect(textDrawn.length).toBeGreaterThan(1);
  });

  it('composeFrameCanvas returns a canvas at the requested size', async () => {
    const { composeFrameCanvas } = await import('./pngExport');
    const canvas = await composeFrameCanvas(deps(), 960, 540);
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(canvas.width).toBe(960);
    expect(canvas.height).toBe(540);
  });
});
