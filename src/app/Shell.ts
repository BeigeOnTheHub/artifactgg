import type { Store } from './store';
import { currentMapSrc } from './viewport';
import { getMap } from '../types/maps';

const MAP_NATURAL_W = 1920;
const MAP_NATURAL_H = 1080;

export class Shell {
  private viewer: HTMLDivElement;
  private zoomViewport: HTMLDivElement;
  private mapWrap: HTMLDivElement;
  private img: HTMLImageElement;
  private sidebarRoot: HTMLDivElement;
  private topbarRoot: HTMLDivElement;
  private unsubMap: () => void = () => {};
  private unsubView: () => void = () => {};
  private unsubLayout: () => void = () => {};
  private unsubLabel: () => void = () => {};
  private willChangeTimer = 0;

  constructor(private root: HTMLElement, private store: Store) {
    while (root.firstChild) root.removeChild(root.firstChild);

    // Chrome geometry now lives in styles/layout.css, keyed by
    // #app[data-layout]; the data attribute below selects the desktop or
    // compact rule set.

    this.viewer = document.createElement('div');
    this.viewer.id = 'map-viewer';
    this.viewer.setAttribute('tabindex', '-1'); // focus target for the skip link
    this.viewer.dataset['testid'] = 'map-viewer';
    // role=main + label so screen readers can jump straight to the drawing
    // surface via landmark nav. The canvas itself is mouse/touch only, so
    // the label calls that out -- saves an SR user wandering trying to find
    // an interactive control inside it. The label is refreshed in mount() with
    // a summary of what's actually on the active frame (see updateViewerLabel).
    this.viewer.setAttribute('role', 'main');
    this.viewer.setAttribute('aria-label', 'Tactical map (mouse or touch only)');
    // Defensively suppress any native drag that might originate inside the
    // viewer regardless of which element the browser decides is the source - 
    // protects against future child elements forgetting their own draggable
    // attribute, and prevents the "no-drop" stop cursor from ever appearing
    // mid-pan.
    this.viewer.addEventListener('dragstart', (e) => e.preventDefault());

    this.zoomViewport = document.createElement('div');
    this.zoomViewport.id = 'zoom-viewport';
    this.zoomViewport.dataset['testid'] = 'zoom-viewport';

    this.mapWrap = document.createElement('div');
    this.mapWrap.id = 'map-canvas-wrap';
    this.mapWrap.dataset['testid'] = 'map-canvas-wrap';

    this.img = document.createElement('img');
    this.img.id = 'map-image';
    this.img.dataset['testid'] = 'map-image';
    this.img.alt = '';
    this.img.draggable = false;
    this.img.addEventListener('dragstart', (e) => e.preventDefault());

    this.mapWrap.appendChild(this.img);
    this.zoomViewport.appendChild(this.mapWrap);
    this.viewer.appendChild(this.zoomViewport);

    this.sidebarRoot = document.createElement('div');
    this.sidebarRoot.id = 'sidebar-root';
    this.sidebarRoot.dataset['testid'] = 'sidebar-root';
    this.sidebarRoot.setAttribute('role', 'complementary');
    this.sidebarRoot.setAttribute('aria-label', 'Tools and settings');

    this.topbarRoot = document.createElement('div');
    this.topbarRoot.id = 'topbar-root';
    this.topbarRoot.dataset['testid'] = 'topbar-root';
    this.topbarRoot.setAttribute('role', 'banner');
    this.topbarRoot.setAttribute('aria-label', 'App actions');

    // skip link: first in tab order, visible only on focus, jumps to the map
    const skipLink = document.createElement('a');
    skipLink.href = '#map-viewer';
    skipLink.className = 'skip-link';
    skipLink.textContent = 'Skip to map';
    root.appendChild(skipLink);
    root.appendChild(this.sidebarRoot);
    root.appendChild(this.topbarRoot);
    root.appendChild(this.viewer);

    root.dataset['layout'] = (this.store.get().layoutMode ?? 'desktop');
  }

  mount(): void {
    this.renderMap();
    this.applyTransform();
    this.updateViewerLabel();
    this.unsubMap = this.store.subscribe(['mapId'], () => { this.renderMap(); this.updateViewerLabel(); });
    this.unsubView = this.store.subscribe(['zoom', 'panX', 'panY'], () => this.applyTransform());
    this.unsubLayout = this.store.subscribe(['layoutMode'], () => {
      this.root.dataset['layout'] = (this.store.get().layoutMode ?? 'desktop');
      this.applyTransform();
    });
    // Keep the SR label in step with what's drawn so a screen-reader user knows
    // which frame they're on and roughly what it contains, without being able
    // to see the canvas.
    this.unsubLabel = this.store.subscribe(['frames', 'activeFrameIdx'], () => this.updateViewerLabel());
  }

  destroy(): void {
    this.unsubMap();
    this.unsubView();
    this.unsubLayout();
    this.unsubLabel();
    if (this.willChangeTimer) clearTimeout(this.willChangeTimer);
    while (this.root.firstChild) this.root.removeChild(this.root.firstChild);
  }

  /** The full viewport element - attach pointer-listening controllers and tools here. */
  getViewer(): HTMLElement { return this.viewer; }
  /** The transformed wrapper - append SVG layers here. */
  getMapWrap(): HTMLElement { return this.mapWrap; }
  /** The non-transformed sibling layer - append the canvas here. */
  getZoomViewport(): HTMLElement { return this.zoomViewport; }
  /** Sidebar host. Sidebar component mounts inside this element. */
  getSidebarRoot(): HTMLElement { return this.sidebarRoot; }
  /** Top bar host. TopBar component mounts inside this element. */
  getTopBarRoot(): HTMLElement { return this.topbarRoot; }

  /** Natural map size, fixed. Used by render layers to compute transforms. */
  getMapSize(): { w: number; h: number } { return { w: MAP_NATURAL_W, h: MAP_NATURAL_H }; }

  private renderMap(): void {
    this.img.src = currentMapSrc(this.store);
  }

  /** Refresh the viewer's aria-label with the active map, frame position, and a
   *  rough count of what's on the frame - the only "what's on the canvas" cue a
   *  screen-reader user gets, since the drawing itself has no text equivalent. */
  private updateViewerLabel(): void {
    const s = this.store.get();
    const total = s.frames.length;
    const f = s.frames[s.activeFrameIdx];
    const mapName = getMap(s.mapId).name;
    const parts: string[] = [];
    if (f) {
      const counts: Array<[number, string]> = [
        [f.players.length, 'player'],
        [f.cones.length, 'cone'],
        [f.shapes.length, 'shape'],
        [f.strokes.length, 'drawing'],
        [f.textboxes.length, 'text box'],
        [f.quickadds.length, 'marker'],
      ];
      for (const [c, label] of counts) {
        if (c > 0) parts.push(`${c} ${label}${c === 1 ? '' : 's'}`);
      }
    }
    const summary = parts.length ? parts.join(', ') : 'empty';
    this.viewer.setAttribute(
      'aria-label',
      `Tactical map (mouse or touch only). ${mapName}, frame ${s.activeFrameIdx + 1} of ${total}: ${summary}`,
    );
  }

  applyTransform(): void {
    const s = this.store.get();
    const vpW = this.viewer.clientWidth;
    const vpH = this.viewer.clientHeight;
    const tx = (vpW - MAP_NATURAL_W * s.zoom) / 2 + s.panX;
    const ty = (vpH - MAP_NATURAL_H * s.zoom) / 2 + s.panY;
    this.mapWrap.style.transform = `translate(${tx}px, ${ty}px) scale(${s.zoom})`;

    // Keep the wrap GPU-composited only while a zoom/pan gesture is in flight,
    // then drop the hint so the browser re-rasterises at the settled zoom --
    // otherwise will-change pins a base-resolution texture that scale() upscales,
    // pixellating the map and every node past ~1x.
    this.mapWrap.style.willChange = 'transform';
    if (this.willChangeTimer) clearTimeout(this.willChangeTimer);
    this.willChangeTimer = window.setTimeout(() => {
      this.mapWrap.style.willChange = 'auto';
      this.willChangeTimer = 0;
    }, 200);
  }
}
