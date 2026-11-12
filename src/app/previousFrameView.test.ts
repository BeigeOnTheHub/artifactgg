import { describe, it, expect } from 'vitest';
import { createStore } from './store';
import { emptyFrame, type Player } from '../types/primitives';
import { hex } from '../types/hex';
import { PreviousFrameView } from './previousFrameView';

const PLAYER_A: Player = {
  id: 'p1', team: 'colonist', x: 1, y: 2, name: '', dead: false,
};

// frame 0 carries a player; frame 1 is empty. This lets the "no previous
// frame" test below distinguish an empty yielded frame from frame 0.
function makeStore(activeIdx: number) {
  return createStore({
    mapId: 'miru', zoom: 1, panX: 0, panY: 0,
    frames: [{ ...emptyFrame(), players: [PLAYER_A] }, emptyFrame()],
    activeFrameIdx: activeIdx,
    notes: '', tool: 'cursor',
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  } as unknown as Parameters<typeof createStore>[0]);
}

describe('PreviousFrameView', () => {
  it('returns the frame before the active one with empty effects', () => {
    const store = makeStore(1);
    const v = new PreviousFrameView(store);
    expect(v.getView().frame).toBe(store.get().frames[0]);
    expect(v.getView().effects.size).toBe(0);
  });

  it('yields an empty frame when active is 0 (no previous frame)', () => {
    const v = new PreviousFrameView(makeStore(0));
    const { frame } = v.getView();
    expect(frame.players).toEqual([]);
    expect(frame.shapes).toEqual([]);
    expect(frame.cones).toEqual([]);
    expect(frame.quickadds).toEqual([]);
    expect(frame.textboxes).toEqual([]);
    expect(frame.strokes).toEqual([]);
    expect(frame.scanner).toBeNull();
  });

  it('notifies subscribers on frames/activeFrameIdx change', () => {
    const store = makeStore(1);
    const v = new PreviousFrameView(store);
    let n = 0;
    const off = v.subscribe(() => { n += 1; });
    store._apply({ activeFrameIdx: 0 });
    expect(n).toBeGreaterThan(0);
    off();
  });
});
