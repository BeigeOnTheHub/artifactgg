import type { Store } from '../app/store';
import type { Stroke } from '../types/primitives';
import { directFrameView, type FrameView } from '../app/frameView';

export interface MapSize { w: number; h: number }

export class StrokeLayer {
  private visible: HTMLCanvasElement;
  private vctx: CanvasRenderingContext2D;
  private offscreen: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;
  private dpr: number;
  // CSS-pixel size of the visible canvas, captured at last resizeVisible.
  // renderVisible() centres against this rather than re-reading host.clientWidth
  // mid-render, which would drift from the canvas if host has resized since.
  private cssW = 0;
  private cssH = 0;
  private preview: Stroke | null = null;
  private hidden: Set<string> = new Set();
  private highlighted: Set<string> = new Set();
  private offscreenDirty = true;
  private rafId = 0;
  private frameView: FrameView;
  private unsubStrokes: () => void = () => {};
  private unsubView: () => void = () => {};
  private unsubFrame: () => void = () => {};

  constructor(
    private host: HTMLElement,
    private store: Store,
    private mapSize: MapSize,
    frameView?: FrameView,
  ) {
    this.frameView = frameView ?? directFrameView(store);
    this.dpr = window.devicePixelRatio || 1;

    this.visible = document.createElement('canvas');
    this.visible.id = 'stroke-canvas';
    this.visible.dataset['testid'] = 'stroke-canvas';
    this.visible.style.cssText = [
      'position:absolute', 'inset:0',
      'pointer-events:none',
    ].join(';');

    this.offscreen = document.createElement('canvas');
    this.offscreen.width = Math.round(mapSize.w * this.dpr);
    this.offscreen.height = Math.round(mapSize.h * this.dpr);

    const vctx = this.visible.getContext('2d');
    const octx = this.offscreen.getContext('2d');
    if (!vctx || !octx) throw new Error('StrokeLayer: 2d context unavailable');
    this.vctx = vctx;
    this.octx = octx;
  }

  mount(): void {
    this.host.appendChild(this.visible);
    this.resizeVisible();
    // The offscreen (PNG-export raster) follows the *logical* active frame, so it
    // re-renders only when frames/activeFrameIdx actually change - not on every
    // transition tick.
    this.unsubStrokes = this.store.subscribe(['frames', 'activeFrameIdx'], () => {
      this.offscreenDirty = true;
      this.scheduleRender();
    });
    // The visible canvas follows the FrameView (interpolated during a transition).
    this.unsubFrame = this.frameView.subscribe(() => this.scheduleRender());
    this.unsubView = this.store.subscribe(['zoom', 'panX', 'panY'], () => this.scheduleRender());
    // First paint:
    this.scheduleRender();
  }

  /** Set or clear an in-flight stroke that overlays committed strokes. */
  setPreview(stroke: Stroke | null): void {
    this.preview = stroke;
    this.scheduleRender();
  }

  /** Hide strokes by id without removing them from the store (used by EraseTool during a drag). */
  setHiddenIds(ids: Set<string>): void {
    this.hidden = ids;
    this.offscreenDirty = true;
    this.scheduleRender();
  }
  getHiddenIds(): Set<string> { return this.hidden; }

  /** Set the ids of strokes that should render with an additional accent underlay. */
  setHighlightedIds(ids: Set<string>): void {
    this.highlighted = ids;
    // highlights are visible-canvas only - the offscreen feeds PNG export and
    // mustn't bake selection state in. just re-render the visible.
    this.scheduleRender();
  }
  getHighlightedIds(): Set<string> { return this.highlighted; }

  /**
   * Accessor used by pngExport - returns the offscreen canvas holding the
   * committed strokes at natural map resolution (no viewport transform). Not
   * tainted; the canvas is drawn to entirely from JS.
   */
  getCommittedCanvas(): HTMLCanvasElement { return this.offscreen; }

  /** Public so the Shell can call it on viewport resize. */
  resizeVisible(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    const cw = Math.round(w * this.dpr);
    const ch = Math.round(h * this.dpr);
    if (this.visible.width !== cw || this.visible.height !== ch) {
      this.visible.width = cw;
      this.visible.height = ch;
      this.visible.style.width = `${w}px`;
      this.visible.style.height = `${h}px`;
      this.cssW = w;
      this.cssH = h;
      this.scheduleRender();
    }
  }

  destroy(): void {
    this.unsubStrokes();
    this.unsubView();
    this.unsubFrame();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.visible.remove();
  }

  // ---- private ----

  private scheduleRender(): void {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.render();
    });
  }

  private render(): void {
    if (this.offscreenDirty) {
      this.renderOffscreen();
      this.offscreenDirty = false;
    }
    this.renderVisible();
  }

  private renderOffscreen(): void {
    const ctx = this.octx;
    const dpr = this.dpr;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // map-coords -> offscreen pixels
    ctx.clearRect(0, 0, this.mapSize.w, this.mapSize.h);
    const frame = this.store.get().frames[this.store.get().activeFrameIdx]!;
    // No highlight underlay here - this canvas is what pngExport reads, and the
    // exported image shouldn't contain the user's current selection accent.
    for (const s of frame.strokes) {
      if (this.hidden.has(s.id)) continue;
      drawStroke(ctx, s);
    }
    ctx.restore();
  }

  private renderVisible(): void {
    const ctx = this.vctx;
    const s = this.store.get();
    const dpr = this.dpr;
    const vpW = this.visible.width;   // already × dpr
    const vpH = this.visible.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, vpW, vpH);

    // Render strokes directly to the visible canvas in viewport pixels - so they
    // stay crisp at any zoom level instead of being upscaled from the natural-res
    // offscreen blit. The offscreen is still maintained on `offscreenDirty` for
    // PNG export, which expects a 1920×1080 raster.
    const tx = (this.cssW - this.mapSize.w * s.zoom) / 2 + s.panX;
    const ty = (this.cssH - this.mapSize.h * s.zoom) / 2 + s.panY;
    const scale = s.zoom * dpr;
    ctx.setTransform(scale, 0, 0, scale, tx * dpr, ty * dpr);

    // The visible canvas follows the FrameView: during a frame transition that's
    // an interpolated frame (carries fade-out strokes) plus per-stroke opacity.
    const { frame, effects } = this.frameView.getView();
    for (const stroke of frame.strokes) {
      if (this.hidden.has(stroke.id)) continue;
      const fading = effects.has(stroke.id);
      if (this.highlighted.has(stroke.id) && stroke.type === 'draw' && !fading) drawHighlight(ctx, stroke);
      drawStroke(ctx, stroke, effects.get(stroke.id)?.opacity ?? 1);
    }
    if (this.preview) drawStroke(ctx, this.preview);

    ctx.restore();
  }
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, alphaMul = 1): void {
  if (!s.points || s.points.length < 1) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = s.size;
  // dash lengths track the pen size so they read the same at any width. dotted
  // leans on the round cap already set - a near-zero dash renders as a dot.
  if (s.dash === 'dashed') ctx.setLineDash([s.size * 2.5, s.size * 1.75]);
  else if (s.dash === 'dotted') ctx.setLineDash([s.size * 0.1, s.size * 1.6]);
  else ctx.setLineDash([]);
  if (s.type === 'erase') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = alphaMul;
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = s.alpha * alphaMul;
    ctx.strokeStyle = s.color;
  }
  ctx.beginPath();
  const p0 = s.points[0]!;
  ctx.moveTo(p0.x, p0.y);
  if (s.points.length === 1) {
    // single dot - draw as a small filled disc
    ctx.fillStyle = s.color;
    ctx.arc(p0.x, p0.y, s.size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    for (let i = 1; i < s.points.length; i++) {
      const p = s.points[i]!;
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawHighlight(ctx: CanvasRenderingContext2D, s: Stroke): void {
  if (!s.points || s.points.length < 1) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = s.size + 4;
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = '#00ff88';
  ctx.beginPath();
  const p0 = s.points[0]!;
  ctx.moveTo(p0.x, p0.y);
  if (s.points.length === 1) {
    ctx.fillStyle = '#00ff88';
    ctx.arc(p0.x, p0.y, (s.size + 4) / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    for (let i = 1; i < s.points.length; i++) {
      const p = s.points[i]!;
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}
