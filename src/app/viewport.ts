import type { Store } from './store';
import { getMap } from '../types/maps';

// Below 1.0 so a window smaller than 1920x1080 can still fit the whole map.
// zoomTo100 still snaps to true native size.
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 10.0;
const MAP_W = 1920;
const MAP_H = 1080;

/**
 * Shell chrome sizes. Keep in sync with `Shell.ts` (sidebar width, topbar
 * height, map-viewer `bottom`) and `styles/frame-timeline.css` (timeline `height`).
 */
export const SIDEBAR_PX = 280;
export const TOPBAR_PX = 36;
export const TIMELINE_PX = 80;

export function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

/**
 * Pointer-anchored zoom: given the current view, a target zoom, and the
 * cursor position relative to the viewer (cx, cy) plus the viewer size,
 * return the pan that keeps the map point under the cursor fixed.
 * Shared by the wheel controller and the touch controller so the maths
 * has exactly one implementation.
 */
export function anchoredZoomPan(
  cur: { zoom: number; panX: number; panY: number },
  nextZoom: number,
  cx: number,
  cy: number,
  viewerW: number,
  viewerH: number,
): { zoom: number; panX: number; panY: number } {
  const k = nextZoom / cur.zoom;
  return {
    zoom: nextZoom,
    panX: k * cur.panX + (1 - k) * (cx - viewerW / 2),
    panY: k * cur.panY + (1 - k) * (cy - viewerH / 2),
  };
}

/**
 * Two-finger transform: pin the map point that was under the gesture's starting
 * midpoint to wherever that midpoint is now, at the zoom implied by how far the
 * fingers have spread. Fingers moving together pan by the midpoint delta
 * (`anchoredZoomPan` alone can't, it only compensates for zoom changes).
 * Takes a snapshot of the gesture start so the anchor can't drift over a long drag.
 */
export function pinchTransform(
  start: { dist: number; midX: number; midY: number; zoom: number; panX: number; panY: number },
  curDist: number,
  curMidX: number,
  curMidY: number,
  viewerW: number,
  viewerH: number,
): { zoom: number; panX: number; panY: number } {
  const zoom = start.dist > 0 ? clampZoom(start.zoom * (curDist / start.dist)) : start.zoom;
  // The map point under the starting midpoint, in map coords (see render/coords:
  // tx = (viewerW - mapW*zoom)/2 + panX).
  const mapX = (start.midX - ((viewerW - MAP_W * start.zoom) / 2 + start.panX)) / start.zoom;
  const mapY = (start.midY - ((viewerH - MAP_H * start.zoom) / 2 + start.panY)) / start.zoom;
  return {
    zoom,
    panX: curMidX - mapX * zoom - (viewerW - MAP_W * zoom) / 2,
    panY: curMidY - mapY * zoom - (viewerH - MAP_H * zoom) / 2,
  };
}

/** Compute the zoom that exactly fits a 1920×1080 map inside the given viewer rect. */
export function fitZoomFor(viewerW: number, viewerH: number): number {
  if (viewerW <= 0 || viewerH <= 0) return 1;
  return Math.min(viewerW / MAP_W, viewerH / MAP_H);
}

/**
 * The compact layout's default view zoom: double fit, capped at the height fit.
 *
 * In portrait plain fit leaves the map a quarter of the screen height and too
 * small to read, so we accept some panning. The height cap means landscape needs
 * no branch: there fit is already height-limited and the doubling can't apply.
 *
 *   390x844  fit 0.203 -> 0.406 (capped at 0.781)
 *   844x390  fit 0.361 -> 0.361 (capped at 0.361)
 *
 * `toggleZoom` compares against plain `fitZoomFor`, so from here it zooms out.
 */
export function compactViewZoom(viewerW: number, viewerH: number): number {
  const fit = fitZoomFor(viewerW, viewerH);
  if (viewerH <= 0) return fit;
  return Math.min(fit * 2, viewerH / MAP_H);
}

/**
 * The reference "100%" zoom: the full map fitted inside a maximised 1920x1080
 * window minus sidebar, topbar and timeline. Fixed rather than read from the
 * viewer so `View > Zoom 100%` lands the same on any monitor.
 *
 * = min((1920-280)/1920, (1080-36-80)/1080) = min(0.854, 0.8925) ~ 0.854
 */
export const STANDARD_ZOOM_100 = fitZoomFor(MAP_W - SIDEBAR_PX, MAP_H - TOPBAR_PX - TIMELINE_PX);

// The zoom a map switch lands on. The map.select command can't see the viewer,
// so whichever viewport controller is attached supplies a fit for its own size.
let mapSwitchZoom: () => number = () => STANDARD_ZOOM_100;
export function getMapSwitchZoom(): number { return mapSwitchZoom(); }
export function setMapSwitchZoom(fn: (() => number) | null): void {
  mapSwitchZoom = fn ?? (() => STANDARD_ZOOM_100);
}

/** Fit for a viewer element, or the standard zoom when it has no size yet. */
export function fitElement(el: HTMLElement, fit: (w: number, h: number) => number): number {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? clampZoom(fit(r.width, r.height)) : STANDARD_ZOOM_100;
}

export function currentMapSrc(store: Store): string {
  const id = store.get().mapId;
  const m = getMap(id);
  // mapRev rides along as ?v=N so a swapped-in map image doesn't get masked by
  // a stale cached copy under the same filename.
  const v = m.mapRev ? `?v=${m.mapRev}` : '';
  return `${import.meta.env.BASE_URL}${m.folder}/map.png${v}`;
}

const ZOOM_STEP = 1.1; // multiplicative per wheel notch

export class ViewportController {
  private dragging: { panX0: number; panY0: number; cx0: number; cy0: number } | null = null;
  private offWheel: () => void = () => {};
  private offDown: () => void = () => {};
  private offMove: () => void = () => {};
  private offUp: () => void = () => {};
  // Snapshot of the view the user first saw -- captured by markInitialView()
  // once the boot-time fit has settled, used by resetView() / Ctrl+0. Captured
  // again after loadFile() so a freshly-opened share / library entry treats
  // its own opening view as the reset target.
  private initial: { zoom: number; panX: number; panY: number } | null = null;

  constructor(
    private target: HTMLElement,
    private store: Store,
  ) {}

  attach(): void {
    setMapSwitchZoom(() => fitElement(this.target, fitZoomFor));
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      // Horizontal-only scroll (trackpad swipe, shift+wheel) isn't a zoom.
      if (e.deltaY === 0) return;
      const s = this.store.get();
      const cur = s.zoom;
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      const next = clampZoom(cur * factor);
      if (next === cur) return;
      // Anchor the zoom on the pointer: keep whatever map point sits under the
      // cursor fixed by adjusting pan alongside the zoom. See anchoredZoomPan.
      const rect = this.target.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      // View transforms bypass history - undo/redo never replays a zoom/pan.
      this.store._apply(anchoredZoomPan(s, next, cx, cy, rect.width, rect.height));
    };
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 1) return; // middle mouse only
      e.preventDefault();
      const s = this.store.get();
      this.dragging = { panX0: s.panX, panY0: s.panY, cx0: e.clientX, cy0: e.clientY };
      this.target.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent): void => {
      if (!this.dragging) return;
      const dx = e.clientX - this.dragging.cx0;
      const dy = e.clientY - this.dragging.cy0;
      this.store._apply({
        panX: this.dragging.panX0 + dx,
        panY: this.dragging.panY0 + dy,
      });
    };
    const onUp = (e: PointerEvent): void => {
      if (e.button !== 1 || !this.dragging) return;
      // Pan is purely cosmetic - leave the live state in place and skip history.
      this.dragging = null;
      this.target.releasePointerCapture(e.pointerId);
    };
    // pointercancel = interrupted gesture: snap pan back to the pre-drag
    // (panX0, panY0) so the view doesn't get stranded at an interrupted
    // intermediate position. Mirrors the SelectTool pan-cancel fix.
    const onCancel = (e: PointerEvent): void => {
      if (!this.dragging) return;
      this.store._apply({ panX: this.dragging.panX0, panY: this.dragging.panY0 });
      this.dragging = null;
      try { this.target.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    };

    this.target.addEventListener('wheel', onWheel, { passive: false });
    this.target.addEventListener('pointerdown', onDown);
    this.target.addEventListener('pointermove', onMove);
    this.target.addEventListener('pointerup', onUp);
    this.target.addEventListener('pointercancel', onCancel);

    this.offWheel = () => this.target.removeEventListener('wheel', onWheel);
    this.offDown = () => this.target.removeEventListener('pointerdown', onDown);
    this.offMove = () => this.target.removeEventListener('pointermove', onMove);
    this.offUp = () => {
      this.target.removeEventListener('pointerup', onUp);
      this.target.removeEventListener('pointercancel', onCancel);
    };
  }

  detach(): void {
    setMapSwitchZoom(null);
    this.offWheel(); this.offDown(); this.offMove(); this.offUp();
    this.dragging = null;
  }

  /**
   * Snap to the standard 100% reference (largest zoom that fits the full map
   * inside a 1920×1080 browser minus the sidebar + topbar) and recentre pan.
   */
  zoomTo100(): void {
    const s = this.store.get();
    if (s.zoom === STANDARD_ZOOM_100 && s.panX === 0 && s.panY === 0) return;
    this.store._apply({ zoom: STANDARD_ZOOM_100, panX: 0, panY: 0 });
  }

  /**
   * Compute the largest zoom that fits the natural map size inside the viewer
   * along both axes, clamp to [MIN_ZOOM, MAX_ZOOM], and apply directly (no
   * history). Viewers smaller than 1920x1080 fit the map by zooming out below
   * 1.0 so the whole board is visible; larger viewers fit by zooming in.
   */
  zoomFit(): void {
    const rect = this.target.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const next = clampZoom(fitZoomFor(rect.width, rect.height));
    if (next === this.store.get().zoom && this.store.get().panX === 0 && this.store.get().panY === 0) return;
    this.store._apply({ zoom: next, panX: 0, panY: 0 });
  }

  /** Step the zoom in / out around the viewer centre. Same factor as one
   *  wheel notch (ZOOM_STEP) so it feels consistent with the scroll-wheel
   *  zoom. Pan adjusts so the centre of the viewer stays the fixed point. */
  zoomIn(): void { this.stepZoom(ZOOM_STEP); }
  zoomOut(): void { this.stepZoom(1 / ZOOM_STEP); }

  private stepZoom(factor: number): void {
    const s = this.store.get();
    const next = clampZoom(s.zoom * factor);
    if (next === s.zoom) return;
    const rect = this.target.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      this.store._apply({ zoom: next });
      return;
    }
    // Anchor on the viewer centre rather than the cursor -- the buttons are a
    // discrete action, not a pointer gesture, so centring is the right
    // expectation.
    this.store._apply(anchoredZoomPan(s, next, rect.width / 2, rect.height / 2, rect.width, rect.height));
  }

  /** Capture the current zoom/pan as the "initial" view used by resetView().
   *  Called once after boot settles and again after every loadFile() so the
   *  reset target tracks the entry the user opened. */
  markInitialView(): void {
    const s = this.store.get();
    this.initial = { zoom: s.zoom, panX: s.panX, panY: s.panY };
  }

  /** Restore the zoom/pan captured by the most recent markInitialView(). If
   *  nothing has been captured yet, falls back to zoomFit() so the user
   *  still gets a sensible reset on the very first frame. */
  resetView(): void {
    if (this.initial == null) { this.zoomFit(); return; }
    const s = this.store.get();
    if (s.zoom === this.initial.zoom && s.panX === this.initial.panX && s.panY === this.initial.panY) return;
    this.store._apply({ zoom: this.initial.zoom, panX: this.initial.panX, panY: this.initial.panY });
  }
}
