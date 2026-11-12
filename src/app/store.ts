import type {
  ToolId,
  SelectionRef,
  Frame,
} from '../types/primitives';
import type { Hex } from '../types/hex';
import type { MapId } from '../types/maps';

export interface StratState {
  mapId: MapId;
  zoom: number;
  panX: number;
  panY: number;
  frames: Frame[];
  activeFrameIdx: number;
  /**
   * Frame stacks of the *inactive* maps. The active map's frames live in
   * `frames` / `activeFrameIdx`, never here. In-memory only, not serialised.
   * `map.select` stashes and restores through it. Optional so test factories
   * stay small; `commands.ts` reads it as `state.mapFrames ?? {}`.
   */
  mapFrames?: Partial<Record<MapId, { frames: Frame[]; activeFrameIdx: number }>>;
  notes: string;
  /**
   * Responsive layout mode. Optional + defaulted (like `mapFrames?`) so the
   * existing test factories don't all need updating. `compact` => the
   * reflowed touch layout; absent/`desktop` => the original pixel layout.
   */
  layoutMode?: 'desktop' | 'compact';
  /**
   * When true, mutation/tool entry points are suppressed. Absent => false.
   */
  readOnly?: boolean;
  tool: ToolId;
  colourSlots: (Hex | null)[];
  activeSlot: 0 | 1 | 2 | 3 | 4;
  selection: SelectionRef[];
  ui: {
    sidebarTab: 'tools' | 'notes';
    mode: 'frame' | 'animation';
    paletteOpen: boolean;
    shareOpen: boolean;
    libraryOpen: boolean;
    mapDropdownOpen: boolean;
    colourPickerOpen: boolean;
    hintsOpen: boolean;
    calloutsVisible: boolean;
    changelogOpen: boolean;
    /**
     * Compact touch-edit multi-select mode. When true a tap toggles
     * an item's selection membership and an empty-space drag draws a marquee.
     * Optional + read as `?? false` so the existing StratState test factories
     * need no update - the established mapFrames?/readOnly? pattern.
     */
    touchMultiSelect?: boolean;
    /**
     * Visibility toggles for the six per-frame layers (display:none, so hidden
     * means not interactable either). Read through `getLayerVisibility(state)`,
     * which defaults missing keys to true. Not persisted, resets on reload.
     */
    layerVisibility?: {
      strokes: boolean;
      shapes: boolean;
      cones: boolean;
      players: boolean;
      textboxes: boolean;
      quickadds: boolean;
    };
    confirmOpen: {
      kind: 'discard' | 'delete-strat' | 'clear-frame';
      title: string;
      body: string;
      confirmLabel: string;
      onConfirm: () => void;
    } | null;
  };
}

type Key = keyof StratState;
type Listener = (state: Readonly<StratState>) => void;

export interface Store {
  get(): Readonly<StratState>;
  subscribe(keys: Key[], listener: Listener): () => void;
  /** Apply a partial patch. Intended for command handlers; tests may call directly. */
  _apply(patch: Partial<StratState>): void;
}

export function createStore(initial: StratState): Store {
  let state: StratState = initial;
  const subs: { keys: Set<Key>; fn: Listener }[] = [];

  function apply(patch: Partial<StratState>): void {
    const changed = new Set<Key>();
    const next: StratState = { ...state };
    (Object.keys(patch) as Key[]).forEach((k) => {
      const v = patch[k];
      if (v === undefined) return;
      if (!Object.is(state[k], v)) {
        (next as unknown as Record<string, unknown>)[k] = v;
        changed.add(k);
      }
    });
    if (changed.size === 0) return;
    state = next;
    // Copy: a listener that unsubscribes mid-loop would shift the next one past us.
    for (const { keys, fn } of [...subs]) {
      for (const k of keys) {
        if (changed.has(k)) {
          fn(state);
          break;
        }
      }
    }
  }

  return {
    get: () => state,
    subscribe(keys, fn) {
      const rec = { keys: new Set(keys), fn };
      subs.push(rec);
      return () => {
        const i = subs.indexOf(rec);
        if (i >= 0) subs.splice(i, 1);
      };
    },
    _apply: apply,
  };
}
