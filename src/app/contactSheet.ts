import type { Store } from './store';
import { TAINTED_CANVAS } from './pngExport';

// Geometry constants for the contact-sheet grid. All in output-PNG pixels.
const CELL_W = 960;   // half natural res (1920) - sharp but not huge
const CELL_H = 540;   // half natural res (1080)
const PAD = 48;       // outer margin
const GAP = 24;       // between cells (both axes)
const HEADER_H = 96;  // title band at the top
const CAPTION_H = 44; // caption line under each cell
const FOOTER_H = 56;  // footer band at the bottom

export interface ContactSheetCell { x: number; y: number; w: number; h: number; }

export interface ContactSheetLayout {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  canvasW: number;
  canvasH: number;
  pad: number;
  gap: number;
  headerH: number;
  captionH: number;
  footerH: number;
  cells: ContactSheetCell[];
}

/**
 * Pure grid geometry for the contact sheet. Column count adapts to the frame
 * count - a roughly square grid, capped at 4 wide so big strats stay compact.
 * A zero count is clamped to one cell so the maths never divides by zero.
 */
export function contactSheetLayout(frameCount: number): ContactSheetLayout {
  const n = Math.max(1, frameCount);
  const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(n))));
  const rows = Math.ceil(n / cols);
  const canvasW = PAD * 2 + cols * CELL_W + (cols - 1) * GAP;
  const canvasH = PAD + HEADER_H + rows * (CELL_H + CAPTION_H)
    + (rows - 1) * GAP + FOOTER_H + PAD;

  const cells: ContactSheetCell[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    cells.push({
      x: PAD + c * (CELL_W + GAP),
      y: PAD + HEADER_H + r * (CELL_H + CAPTION_H + GAP),
      w: CELL_W,
      h: CELL_H,
    });
  }

  return {
    cols, rows, cellW: CELL_W, cellH: CELL_H, canvasW, canvasH,
    pad: PAD, gap: GAP, headerH: HEADER_H, captionH: CAPTION_H, footerH: FOOTER_H,
    cells,
  };
}

const BG = '#16181c';
const TITLE_COL = '#e8e8e8';
const META_COL = '#9aa0aa';
const FOOTER_COL = '#6b7280';

export interface ContactSheetOpts {
  store: Store;
  /** Composite the store's CURRENTLY active frame to a canvas at the given size. */
  composeFrame: (w: number, h: number) => Promise<HTMLCanvasElement>;
  header: { mapName: string; stratName: string | null; dateText: string };
  footer: string;
  /** Caption for frame `i`, or '' when it has none. */
  captionOf: (frameIdx: number) => string;
}

/**
 * Composite every frame of the strat into one contact-sheet PNG. Drives the
 * store to each frame with a NEW frames array ref (so the transition controller
 * settles instantly, no tween), composites it via `composeFrame`, tiles it onto
 * one big canvas, then ALWAYS restores the original frames+activeFrameIdx
 * (finally) even if compositing throws - same approach as exportGif.
 */
export async function composeContactSheet(o: ContactSheetOpts): Promise<Blob> {
  const s0 = o.store.get();
  const origFrames = s0.frames;
  const origIdx = s0.activeFrameIdx;
  const n = origFrames.length;
  const layout = contactSheetLayout(n);

  const canvas = document.createElement('canvas');
  canvas.width = layout.canvasW;
  canvas.height = layout.canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to acquire 2D context');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);
  drawHeader(ctx, o.header, n, layout);

  try {
    for (let i = 0; i < n; i++) {
      o.store._apply({ frames: [...origFrames], activeFrameIdx: i });
      const cell = layout.cells[i]!;
      const frameCanvas = await o.composeFrame(cell.w, cell.h);
      ctx.drawImage(frameCanvas, cell.x, cell.y, cell.w, cell.h);
      drawBadge(ctx, cell, String(i + 1));
      drawCaption(ctx, cell, o.captionOf(i), layout);
    }
  } finally {
    o.store._apply({ frames: origFrames, activeFrameIdx: origIdx });
  }

  drawFooter(ctx, o.footer, layout);
  return canvasToBlob(canvas);
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  header: ContactSheetOpts['header'],
  n: number,
  layout: ContactSheetLayout,
): void {
  const y = layout.pad + layout.headerH / 2;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let x = layout.pad;
  ctx.font = '700 40px system-ui, sans-serif';
  ctx.fillStyle = TITLE_COL;
  ctx.fillText(header.mapName, x, y);
  x += ctx.measureText(header.mapName).width;

  const rest: string[] = [];
  if (header.stratName) rest.push(header.stratName);
  rest.push(`${n} ${n === 1 ? 'frame' : 'frames'}`);
  rest.push(header.dateText);
  ctx.font = '400 28px system-ui, sans-serif';
  ctx.fillStyle = META_COL;
  ctx.fillText(` · ${rest.join(' · ')}`, x, y);
}

function drawBadge(ctx: CanvasRenderingContext2D, cell: ContactSheetCell, label: string): void {
  ctx.font = '700 28px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  const padX = 10, padY = 6, fontPx = 28;
  const bw = ctx.measureText(label).width + padX * 2;
  const bh = fontPx + padY * 2;
  const bx = cell.x + 12, by = cell.y + 12;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, bx + padX, by + padY);
}

function drawCaption(
  ctx: CanvasRenderingContext2D,
  cell: ContactSheetCell,
  caption: string,
  layout: ContactSheetLayout,
): void {
  if (!caption) return;
  ctx.font = '400 26px system-ui, sans-serif';
  ctx.fillStyle = META_COL;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const text = truncateToWidth(ctx, caption, cell.w - 16);
  ctx.fillText(text, cell.x + cell.w / 2, cell.y + cell.h + layout.captionH / 2);
}

function drawFooter(ctx: CanvasRenderingContext2D, text: string, layout: ContactSheetLayout): void {
  ctx.font = '400 24px system-ui, sans-serif';
  ctx.fillStyle = FOOTER_COL;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, layout.canvasW / 2, layout.canvasH - layout.pad - layout.footerH / 2);
}

function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}...`).width > maxW) {
    t = t.slice(0, -1);
  }
  return `${t}...`;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error('toBlob returned null'));
        else resolve(blob);
      }, 'image/png');
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if ((e as { name?: string }).name === 'SecurityError') {
        reject(new Error('Tainted canvas - export blocked', { cause: TAINTED_CANVAS }));
      } else {
        reject(e);
      }
    }
  });
}
