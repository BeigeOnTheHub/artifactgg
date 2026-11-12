import type { Store, StratState } from './store';
import type { Hex } from '../types/hex';

/**
 * When the active colour slot changes and exactly one textbox is selected,
 * retint that textbox to match.
 *
 * Bypasses history like the colour-wheel drag: a colour pick is exploratory
 * view-state, and the colour gets rolled into the next real edit's `before`
 * snapshot anyway.
 *
 * Selection changes are not a trigger, so selecting another box leaves its
 * colour alone until the active colour moves. That is why the last-seen hex is
 * tracked.
 */
export function attachSelectionColourSync(store: Store): () => void {
  let lastActiveHex: Hex | null = activeHex(store.get());

  const apply = (): void => {
    const s = store.get();
    const cur = activeHex(s);
    if (cur === lastActiveHex) return;
    lastActiveHex = cur;
    if (cur == null) return;

    if (s.selection.length !== 1) return;
    const ref = s.selection[0]!;
    if (ref.kind !== 'textbox') return;

    const frameIdx = s.activeFrameIdx;
    const tbs = s.frames[frameIdx]?.textboxes;
    if (!tbs) return;
    const target = tbs.find((b) => b.id === ref.id);
    if (!target || target.color === cur) return;

    const nextBoxes = tbs.map((b) => b.id === ref.id ? { ...b, color: cur } : b);
    const nextFrames = s.frames.map((f, i) => i === frameIdx ? { ...f, textboxes: nextBoxes } : f);
    store._apply({ frames: nextFrames });
  };

  // Subscribe to the slot + active-slot keys; selection changes are tracked
  // implicitly because lastActiveHex only short-circuits on hex-identity and
  // a same-hex selection change is the no-op we want anyway.
  return store.subscribe(['colourSlots', 'activeSlot'], apply);
}

function activeHex(state: StratState): Hex | null {
  return state.colourSlots[state.activeSlot] ?? null;
}
