import type { Store } from './store';
import type { FrameView, ItemEffects } from './frameView';
import { emptyFrame, type Frame } from '../types/primitives';

const NO_EFFECTS: ItemEffects = new Map();

/** A reusable empty frame, yielded when no frame precedes the active one.
 *  Consumers only read it; it is never mutated. */
const EMPTY_FRAME: Frame = emptyFrame();

/**
 * A FrameView that yields the frame BEFORE the active one, for the onion-skin
 * ghost. Static, so effects are always empty. At index 0 it yields an empty
 * frame so the ghost renders nothing (OnionSkinLayer also hides it there).
 */
export class PreviousFrameView implements FrameView {
  constructor(private store: Store) {}

  getView(): { frame: Frame; effects: ItemEffects } {
    const s = this.store.get();
    if (s.activeFrameIdx <= 0) {
      return { frame: EMPTY_FRAME, effects: NO_EFFECTS };
    }
    return { frame: s.frames[s.activeFrameIdx - 1]!, effects: NO_EFFECTS };
  }

  subscribe(cb: () => void): () => void {
    return this.store.subscribe(['frames', 'activeFrameIdx'], () => cb());
  }
}
