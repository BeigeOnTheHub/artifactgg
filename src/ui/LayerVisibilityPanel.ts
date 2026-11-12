import '../styles/layer-visibility-panel.css';
import type { Store } from '../app/store';
import { buildLayerToggles } from './layerToggles';

/**
 * Sidebar (Tools tab) panel wrapping the shared layer toggles in the sidebar's
 * own LAYERS heading. The chips themselves live in ui/layerToggles.ts so the
 * mobile View sheet renders the identical control.
 */
export class LayerVisibilityPanel {
  private root: HTMLDivElement;
  private built: { el: HTMLElement; destroy: () => void } | null = null;

  constructor(private host: HTMLElement, private store: Store) {
    this.root = document.createElement('div');
    this.root.className = 'layer-visibility';
  }

  mount(): void {
    while (this.host.firstChild) this.host.removeChild(this.host.firstChild);
    this.host.appendChild(this.root);

    const title = document.createElement('div');
    title.className = 'layer-visibility-title';
    title.textContent = 'LAYERS';
    this.root.appendChild(title);

    this.built = buildLayerToggles(this.store);
    this.root.appendChild(this.built.el);
  }

  destroy(): void {
    this.built?.destroy();
    this.built = null;
    while (this.host.firstChild) this.host.removeChild(this.host.firstChild);
  }
}
