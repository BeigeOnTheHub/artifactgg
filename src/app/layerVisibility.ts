// The hide rules that act on the data-hide-* attributes we set below live in
// this stylesheet. Nothing else pulls it in, so without this side-effect import
// the toggles flip the attributes but nothing actually disappears.
import '../styles/layer-visibility.css';
import type { Store, StratState } from './store';

/**
 * Per-session visibility for the six per-frame render layers, kept in
 * `state.ui.layerVisibility`. Missing keys default to true; the controller
 * mirrors the slice onto data attributes on the zoom-viewport for CSS to hide
 * each layer. Not persisted to the strat, it is only an editing aid.
 */

export type LayerKey = 'strokes' | 'shapes' | 'cones' | 'players' | 'textboxes' | 'quickadds';

export const LAYER_KEYS: ReadonlyArray<LayerKey> = [
  'strokes', 'shapes', 'cones', 'players', 'textboxes', 'quickadds',
];

export interface LayerVisibility {
  strokes: boolean;
  shapes: boolean;
  cones: boolean;
  players: boolean;
  textboxes: boolean;
  quickadds: boolean;
}

const DEFAULTS: LayerVisibility = {
  strokes: true, shapes: true, cones: true,
  players: true, textboxes: true, quickadds: true,
};

/** Resolve the (possibly absent) per-state slice into a fully-populated
 *  LayerVisibility. Missing keys default to "shown" so a fresh state
 *  reveals every layer. */
export function getLayerVisibility(state: Readonly<StratState>): LayerVisibility {
  const v = state.ui.layerVisibility;
  if (!v) return DEFAULTS;
  return {
    strokes: v.strokes,
    shapes: v.shapes,
    cones: v.cones,
    players: v.players,
    textboxes: v.textboxes,
    quickadds: v.quickadds,
  };
}

/** Toggle the visibility of one layer in the store. Operates on the slice
 *  returned by getLayerVisibility so the first toggle out of the default
 *  state populates every key, not just the one being flipped. */
export function setLayerVisible(store: Store, key: LayerKey, visible: boolean): void {
  const ui = store.get().ui;
  const current = getLayerVisibility(store.get());
  if (current[key] === visible) return;
  store._apply({ ui: { ...ui, layerVisibility: { ...current, [key]: visible } } });
}

/**
 * Subscribe to ui.layerVisibility and reflect it as data attributes on the
 * supplied element (typically the zoom-viewport). CSS rules in layer-
 * visibility.css consume those attributes to hide each layer's DOM root.
 * Returns a teardown that unsubscribes and clears every attribute.
 */
export function attachLayerVisibility(target: HTMLElement, store: Store): () => void {
  const apply = (): void => {
    const v = getLayerVisibility(store.get());
    for (const k of LAYER_KEYS) {
      // A "true" attribute value is what CSS [data-hide-...="true"] matches
      // on. Setting it to "false" is functionally the same as removing it,
      // but writing the value makes the attribute presence consistent
      // between "shown" and "hidden" -- easier to assert in tests.
      target.dataset[attrKey(k)] = v[k] ? 'false' : 'true';
    }
  };
  apply();
  const off = store.subscribe(['ui'], apply);
  return () => {
    off();
    for (const k of LAYER_KEYS) delete target.dataset[attrKey(k)];
  };
}

/** dataset key for a layer's hide attribute. dataset camelCases, so
 *  data-hide-strokes -> dataset.hideStrokes. */
function attrKey(k: LayerKey): string {
  return `hide${k.charAt(0).toUpperCase()}${k.slice(1)}`;
}
