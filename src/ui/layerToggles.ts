import type { Store } from '../app/store';
import {
  LAYER_KEYS,
  getLayerVisibility,
  setLayerVisible,
  type LayerKey,
} from '../app/layerVisibility';

const LABELS: Record<LayerKey, string> = {
  strokes: 'Strokes',
  shapes: 'Shapes',
  cones: 'Cones',
  players: 'Players',
  textboxes: 'Text',
  quickadds: 'QuickAdds',
};

function ariaLabel(k: LayerKey, shown: boolean): string {
  return `${LABELS[k]} layer (${shown ? 'shown' : 'hidden'}). Click to toggle.`;
}

/**
 * The six per-layer toggle chips, shared by the desktop sidebar panel and the
 * mobile View sheet. Returns a bare labelled group - the caller supplies its
 * own heading, because the sidebar wants its LAYERS title div and the mobile
 * sheet wants the sheet's own h3.
 */
export function buildLayerToggles(store: Store): { el: HTMLElement; destroy: () => void } {
  const grid = document.createElement('div');
  grid.className = 'layer-visibility-grid';
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Layer visibility toggles');

  const buttons = new Map<LayerKey, HTMLButtonElement>();
  const v0 = getLayerVisibility(store.get());

  for (const k of LAYER_KEYS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'layer-visibility-btn';
    btn.dataset['layer'] = k;
    btn.textContent = LABELS[k];
    btn.title = `Show / hide ${LABELS[k].toLowerCase()} on the map`;
    btn.setAttribute('aria-pressed', String(v0[k]));
    btn.setAttribute('aria-label', ariaLabel(k, v0[k]));
    btn.addEventListener('click', () => {
      const cur = getLayerVisibility(store.get());
      setLayerVisible(store, k, !cur[k]);
    });
    grid.appendChild(btn);
    buttons.set(k, btn);
  }

  // Patch attributes in place instead of re-rendering, so the focused chip
  // keeps focus across a toggle.
  const unsub = store.subscribe(['ui'], () => {
    const v = getLayerVisibility(store.get());
    for (const k of LAYER_KEYS) {
      const btn = buttons.get(k);
      if (!btn) continue;
      btn.setAttribute('aria-pressed', String(v[k]));
      btn.setAttribute('aria-label', ariaLabel(k, v[k]));
    }
  });

  return {
    el: grid,
    destroy: (): void => {
      unsub();
      buttons.clear();
    },
  };
}
