import '../styles/callouts-layer.css';
import type { Store } from '../app/store';
import { getMap, mapSupportsCallouts } from '../types/maps';

/**
 * Per-map callouts overlay, inside the transformed `mapWrap` between the base
 * map image (z-index 0) and the SVG / canvas layers (z-index 1+).
 *
 * The source follows the folder-per-map convention (as MapDropdown.thumbnail).
 * On 404 (Kiiro ships no `map-callouts.png`) `img.onerror` hides the element,
 * and that hide wins over `state.ui.calloutsVisible`.
 */
export class CalloutsLayer {
  private img: HTMLImageElement;
  private erroredFor: string | null = null;
  private unsubMap: () => void = () => {};
  private unsubUi: () => void = () => {};

  constructor(private host: HTMLElement, private store: Store) {
    this.img = document.createElement('img');
    this.img.className = 'callouts-layer-img';
    this.img.alt = '';
    this.img.draggable = false;
    this.img.addEventListener('dragstart', (e) => e.preventDefault());
  }

  mount(): void {
    this.host.appendChild(this.img);
    this.refreshSrc();
    this.refreshVisibility();

    this.img.addEventListener('error', this.onError);

    this.unsubMap = this.store.subscribe(['mapId'], () => {
      this.erroredFor = null; // map changed - reset error state.
      this.refreshSrc();
      this.refreshVisibility();
    });
    this.unsubUi = this.store.subscribe(['ui'], () => this.refreshVisibility());
  }

  destroy(): void {
    this.unsubMap();
    this.unsubUi();
    this.img.removeEventListener('error', this.onError);
    if (this.img.parentElement) this.img.parentElement.removeChild(this.img);
  }

  /**
   * Used by pngExport to include the callouts overlay in the rasterised
   * output when (and only when) it's currently visible AND loaded
   * successfully for the active map. Returns null if hidden, errored, or
   * still loading.
   */
  getExportImage(): HTMLImageElement | null {
    const visible = this.store.get().ui.calloutsVisible;
    if (!visible) return null;
    if (!mapSupportsCallouts(this.store.get().mapId)) return null;
    if (this.erroredFor === this.store.get().mapId) return null;
    if (!this.img.complete || this.img.naturalWidth === 0) return null;
    return this.img;
  }

  private onError = (): void => {
    this.erroredFor = this.store.get().mapId;
    this.img.style.display = 'none';
  };

  private refreshSrc(): void {
    const m = getMap(this.store.get().mapId);
    this.img.src = `${import.meta.env.BASE_URL}${m.folder}/map-callouts.png`;
  }

  private refreshVisibility(): void {
    const visible = this.store.get().ui.calloutsVisible;
    // Maps whose callouts are still being worked on (Kiiro) never show them,
    // regardless of the toggle state carried over from another map.
    if (!mapSupportsCallouts(this.store.get().mapId)) {
      this.img.style.display = 'none';
      return;
    }
    if (this.erroredFor === this.store.get().mapId) {
      this.img.style.display = 'none';
      return;
    }
    this.img.style.display = visible ? '' : 'none';
  }
}
