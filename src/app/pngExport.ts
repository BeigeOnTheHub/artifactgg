import type { TextBox } from '../types/primitives';

export const TAINTED_CANVAS = 'TAINTED_CANVAS' as const;

export interface ScannerOverlay {
  /** Map-space centre of the scanner sprite. */
  x: number;
  y: number;
  /** Edge length of the square sprite, in map pixels. */
  size: number;
  image: HTMLImageElement;
}

export interface ComposeDeps {
  mapImage: HTMLImageElement;
  /**
   * Optional callouts overlay image (per-map `map-callouts.png`). Rasterised
   * between the map background and the stroke layer to match the on-screen
   * z-order. Pass `null` when callouts are hidden, errored, or unloaded.
   */
  calloutsImage: HTMLImageElement | null;
  strokeCanvas: HTMLCanvasElement;
  /**
   * SVG roots in z-order: shapes -> cones -> quickadds -> players. Layers whose
   * positioning depends on live zoom/pan (PlayerLayer) must pass a fresh
   * natural-coord export SVG, or the viewport transform gets baked into the PNG.
   */
  svgLayers: SVGSVGElement[];
  /**
   * The active frame's textboxes, painted straight onto the canvas above the
   * SVG layers. Done with the canvas 2d text API rather than an SVG
   * `<foreignObject>` because the latter taints the canvas in Chromium and
   * breaks the export. Pass an empty array when there are no textboxes.
   */
  textBoxes: TextBox[];
  /** Singleton scanner placement, drawn after every other layer. Pass `null`
   * when no scanner is placed on the active frame. */
  scanner: ScannerOverlay | null;
  mapWidth: number;
  mapHeight: number;
}

const THUMB_W = 256;
const THUMB_H = 144;

/**
 * Compose the full strat as a PNG `Blob` at natural map resolution.
 * A tainted canvas rejects with an `Error` whose `.cause === TAINTED_CANVAS`;
 * callers toast and fall back (e.g. the map's static `thumbnail.png`).
 */
export async function composeFullPng(deps: ComposeDeps): Promise<Blob> {
  const canvas = await composeOnto(deps, deps.mapWidth, deps.mapHeight);
  return canvasToBlob(canvas);
}

/**
 * Compose the strat onto a canvas at an arbitrary size and return the canvas
 * itself (not a Blob) - the GIF exporter needs the raw pixels per frame.
 * Same compositing pipeline + tainted-canvas semantics as composeFullPng.
 */
export async function composeFrameCanvas(deps: ComposeDeps, w: number, h: number): Promise<HTMLCanvasElement> {
  return composeOnto(deps, w, h);
}

/**
 * Compose a `${THUMB_W}×${THUMB_H}` thumbnail PNG dataURL. Same compositing
 * pipeline as `composeFullPng`, downscaled at draw time. Same tainted-canvas
 * error semantics.
 */
export async function composeThumbnail(deps: ComposeDeps): Promise<string> {
  const canvas = await composeOnto(deps, THUMB_W, THUMB_H);
  try {
    return canvas.toDataURL('image/png');
  } catch (err) {
    throw wrapTainted(err);
  }
}

async function composeOnto(deps: ComposeDeps, w: number, h: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to acquire 2D context');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // 1. Map background (z=0). Use object-fit:contain semantics so square or
  //    other non-16:9 source maps aren't squashed into the canvas frame.
  if (deps.mapImage.complete && deps.mapImage.naturalWidth > 0) {
    drawContain(ctx, deps.mapImage, 0, 0, w, h);
  }

  // 1b. Callouts overlay (between map and strokes - matches CSS z-order). The
  //     on-screen image carries a stacked drop-shadow outline (callouts-layer
  //     .css); reproduce it here with a canvas filter, scaled to the export
  //     size, so the glyphs read against busy maps in the PNG too.
  if (deps.calloutsImage && deps.calloutsImage.complete && deps.calloutsImage.naturalWidth > 0) {
    const s = w / deps.mapWidth;
    ctx.save();
    ctx.filter =
      `drop-shadow(0 0 ${1.5 * s}px rgba(0,0,0,0.95)) ` +
      `drop-shadow(0 0 ${1.5 * s}px rgba(0,0,0,0.95)) ` +
      `drop-shadow(0 0 ${1 * s}px rgba(0,0,0,0.85))`;
    drawContain(ctx, deps.calloutsImage, 0, 0, w, h);
    ctx.restore();
  }

  // 2. Stroke canvas (z=1) - committed strokes only; the in-flight stroke is
  //    on a separate visible canvas not passed here.
  ctx.drawImage(deps.strokeCanvas, 0, 0, w, h);

  // 3. SVG layers in z-order.
  for (let i = 0; i < deps.svgLayers.length; i++) {
    const img = await renderSvgToImage(deps.svgLayers[i]!, deps.mapWidth, deps.mapHeight);
    ctx.drawImage(img, 0, 0, w, h);
  }

  // 3b. Textboxes, painted on top of the annotation layers (matches the
  //     on-screen z-order where the text divs sit above every SVG layer).
  if (deps.textBoxes.length > 0) {
    // Best-effort: wait for the textbox font so canvas measureText/fillText
    // use it rather than a fallback. document.fonts is absent under jsdom.
    try { await document.fonts?.ready; } catch { /* no font manager */ }
    drawTextBoxes(ctx, deps.textBoxes, w / deps.mapWidth, h / deps.mapHeight);
  }

  // 4. Scanner singleton, drawn last so it sits above every annotation
  //    (matches the on-screen behaviour where the scanner DIV is appended
  //    after every layer in mapWrap). Scaled by the export ratio.
  if (deps.scanner && deps.scanner.image.complete && deps.scanner.image.naturalWidth > 0) {
    const sc = deps.scanner;
    const sx = (sc.x - sc.size / 2) * (w / deps.mapWidth);
    const sy = (sc.y - sc.size / 2) * (h / deps.mapHeight);
    const sw = sc.size * (w / deps.mapWidth);
    const sh = sc.size * (h / deps.mapHeight);
    ctx.drawImage(sc.image, sx, sy, sw, sh);
  }

  return canvas;
}

/**
 * Draw `img` into the destination rect (`x`, `y`, `w`, `h`) preserving the
 * source's aspect ratio (centred, letterboxed when the aspects differ) - the
 * canvas equivalent of `object-fit: contain`. Matches the CSS rule the live
 * `<img id="map-image">` carries in Shell.ts.
 */
function drawContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number, y: number, w: number, h: number,
): void {
  const srcAspect = img.naturalWidth / img.naturalHeight;
  const dstAspect = w / h;
  let dw: number, dh: number;
  if (srcAspect > dstAspect) {
    dw = w;
    dh = w / srcAspect;
  } else {
    dh = h;
    dw = h * srcAspect;
  }
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

async function renderSvgToImage(
  svg: SVGSVGElement,
  width: number,
  height: number,
): Promise<HTMLImageElement> {
  const serialised = await serialiseSvg(svg, width, height);
  return new Promise((resolve, reject) => {
    const blob = new Blob([serialised], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = (): void => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (): void => { URL.revokeObjectURL(url); reject(new Error('SVG image load failed')); };
    img.src = url;
  });
}

async function serialiseSvg(
  svg: SVGSVGElement,
  width: number,
  height: number,
): Promise<string> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  // Export is at natural resolution. The zoom transform lives on the wrapper,
  // not the <svg>, but strip these anyway in case one ever lands here.
  clone.removeAttribute('style');
  clone.removeAttribute('transform');
  // An SVG loaded as an <img> can't fetch external resources, so any sprite
  // referenced by URL (quickadd icons, the scanner) comes
  // out blank. Inline them as data: URIs first so they actually rasterise.
  await inlineSpriteImages(clone);
  return new XMLSerializer().serializeToString(clone);
}

const XLINK_NS = 'http://www.w3.org/1999/xlink';
const spriteDataUrlCache = new Map<string, Promise<string | null>>();

async function inlineSpriteImages(root: SVGSVGElement): Promise<void> {
  const images = Array.from(root.querySelectorAll('image'));
  await Promise.all(images.map(async (img) => {
    const href = img.getAttribute('href') ?? img.getAttributeNS(XLINK_NS, 'href');
    if (!href || href.startsWith('data:')) return;
    const dataUrl = await spriteToDataUrl(href);
    if (!dataUrl) return;
    img.setAttribute('href', dataUrl);
    // Drop any xlink:href so it can't override the inlined plain href.
    img.removeAttributeNS(XLINK_NS, 'href');
  }));
}

/** Load a (same-origin) sprite and turn it into a PNG data: URI. Cached, since
 *  a strat usually repeats the same handful of sprites. Returns null on
 *  failure so a missing sprite just doesn't render rather than blowing up the
 *  whole export. */
function spriteToDataUrl(url: string): Promise<string | null> {
  const cached = spriteDataUrlCache.get(url);
  if (cached) return cached;
  const p = (async (): Promise<string | null> => {
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  })();
  spriteDataUrlCache.set(url, p);
  return p;
}

const TEXT_BG = 'rgba(0, 0, 0, 0.55)';
const TEXT_FONT = "'JetBrains Mono', ui-monospace, monospace";
const TEXT_PAD_X = 6;
const TEXT_PAD_Y = 4;
const TEXT_LINE_HEIGHT = 1.2;

/**
 * Paint each textbox onto the canvas, mirroring the on-screen `.tbox` look:
 * a translucent black panel, JetBrains Mono text in the box's colour, 4/6px
 * padding, 1.2 line-height, wrapped to the box width and clipped to its
 * bounds. `sx`/`sy` scale map coords to the target canvas (1:1 for a full
 * export, smaller for the thumbnail).
 */
function drawTextBoxes(
  ctx: CanvasRenderingContext2D,
  boxes: TextBox[],
  sx: number,
  sy: number,
): void {
  for (const b of boxes) {
    const x = b.x * sx;
    const y = b.y * sy;
    const bw = b.w * sx;
    const bh = b.h * sy;
    const fontPx = b.fontSize * sy;
    const padX = TEXT_PAD_X * sx;
    const padY = TEXT_PAD_Y * sy;

    ctx.save();
    // overflow:hidden - clip text to the box.
    ctx.beginPath();
    ctx.rect(x, y, bw, bh);
    ctx.clip();

    ctx.fillStyle = TEXT_BG;
    ctx.fillRect(x, y, bw, bh);

    ctx.fillStyle = b.color;
    ctx.font = `${fontPx}px ${TEXT_FONT}`;
    ctx.textBaseline = 'top';

    const lineH = fontPx * TEXT_LINE_HEIGHT;
    const lines = wrapTextToWidth(ctx, b.text, bw - padX * 2);
    let ty = y + padY;
    for (const line of lines) {
      ctx.fillText(line, x + padX, ty);
      ty += lineH;
      if (ty > y + bh) break; // past the clip rect - no point drawing more
    }
    ctx.restore();
  }
}

/**
 * Greedy word-wrap that also breaks a single word too long to fit (the
 * `word-break: break-word` half of the on-screen style). Explicit newlines in
 * the text are kept as hard breaks (matching `white-space: pre-wrap`).
 */
function wrapTextToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') { lines.push(''); continue; }
    let line = '';
    const flush = (): void => { lines.push(line); line = ''; };
    for (const word of paragraph.split(' ')) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (ctx.measureText(candidate).width <= maxWidth) { line = candidate; continue; }
      if (line !== '') flush();
      // `word` now starts a fresh line. If it still doesn't fit, break it up.
      if (ctx.measureText(word).width <= maxWidth) { line = word; continue; }
      let chunk = '';
      for (const ch of word) {
        if (chunk !== '' && ctx.measureText(chunk + ch).width > maxWidth) {
          lines.push(chunk);
          chunk = '';
        }
        chunk += ch;
      }
      line = chunk;
    }
    lines.push(line);
  }
  return lines;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error('toBlob returned null'));
        else resolve(blob);
      }, 'image/png');
    } catch (err) {
      reject(wrapTainted(err));
    }
  });
}

function wrapTainted(err: unknown): Error {
  const e = err instanceof Error ? err : new Error(String(err));
  if ((e as { name?: string }).name === 'SecurityError') {
    return new Error('Tainted canvas - export blocked', { cause: TAINTED_CANVAS });
  }
  return e;
}
