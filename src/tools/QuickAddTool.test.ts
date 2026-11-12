import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QuickAddTool } from './QuickAddTool';
import { createStore, type StratState } from '../app/store';
import { createHistory } from '../app/history';
import { emptyFrame, type QuickAdd } from '../types/primitives';
import { hex } from '../types/hex';

function makeStore() {
  const initial: StratState = {
    mapId: 'suna',
    zoom: 1, panX: 0, panY: 0,
    frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '', tool: 'place-quickadd',
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
  return createStore(initial);
}

const fakeViewport = () => ({
  left: 0, top: 0, width: 1920, height: 1080,
  w: 1920, h: 1080, zoom: 1, panX: 0, panY: 0,
});

describe('QuickAddTool', () => {
  let target: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let tool: QuickAddTool;

  beforeEach(() => {
    target = document.createElement('div');
    document.body.appendChild(target);
    store = makeStore();
    history = createHistory(store);
    tool = new QuickAddTool({ store, history, getViewport: fakeViewport });
    tool.attach(target);
  });

  it('default type is grenade', () => {
    expect(tool.getType()).toBe('grenade');
  });

  it('left-click empty space dispatches quickadd.add with active type', () => {
    tool.setType('smoke');
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true }));
    const items = store.get().frames[0]!.quickadds;
    expect(items).toHaveLength(1);
    expect(items[0]!.type).toBe('smoke');
    expect(items[0]!.x).toBe(200);
    expect(items[0]!.y).toBe(200);
    expect(items[0]!.rangeVisible).toBe(false);
  });

  it('spawn-and-drag in one gesture: the just-placed item follows the pointer', () => {
    tool.setType('smoke');
    // Press on empty space - spawns the item.
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true }));
    // Without lifting, drag it.
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 350, clientY: 250, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup',   { pointerId: 1, button: 0, clientX: 350, clientY: 250, bubbles: true }));
    const items = store.get().frames[0]!.quickadds;
    expect(items).toHaveLength(1);
    expect(items[0]!.x).toBe(350);
    expect(items[0]!.y).toBe(250);
    // Undo the move first, then the spawn (two steps for spawn+drag).
    history.undo();
    expect(store.get().frames[0]!.quickadds[0]!.x).toBe(200);
    expect(store.get().frames[0]!.quickadds[0]!.y).toBe(200);
    history.undo();
    expect(store.get().frames[0]!.quickadds).toHaveLength(0);
  });

  it('drag on existing item dispatches quickadd.modify with new x,y', () => {
    const qa: QuickAdd = { id: 'qa1', type: 'grenade', x: 200, y: 200, rangeVisible: false };
    store._apply({ frames: [{ ...store.get().frames[0]!, quickadds: [qa] }] });
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 400, clientY: 350, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 400, clientY: 350, bubbles: true }));
    const moved = store.get().frames[0]!.quickadds[0]!;
    expect(moved.x).toBe(400);
    expect(moved.y).toBe(350);
  });

  it('drag commit is undoable', () => {
    const qa: QuickAdd = { id: 'qa1', type: 'grenade', x: 200, y: 200, rangeVisible: false };
    store._apply({ frames: [{ ...store.get().frames[0]!, quickadds: [qa] }] });
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 400, clientY: 350, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 400, clientY: 350, bubbles: true }));
    history.undo();
    expect(store.get().frames[0]!.quickadds[0]!.x).toBe(200);
    expect(store.get().frames[0]!.quickadds[0]!.y).toBe(200);
  });

  it('contextmenu on an item dispatches quickadd.delete', () => {
    const qa: QuickAdd = { id: 'qa1', type: 'grenade', x: 200, y: 200, rangeVisible: false };
    store._apply({ frames: [{ ...store.get().frames[0]!, quickadds: [qa] }] });
    target.dispatchEvent(new MouseEvent('contextmenu', { clientX: 200, clientY: 200, bubbles: true, cancelable: true }));
    expect(store.get().frames[0]!.quickadds).toHaveLength(0);
  });

  it('setRangeVisibleForId dispatches quickadd.modify toggling rangeVisible', () => {
    const qa: QuickAdd = { id: 'qa1', type: 'grenade', x: 200, y: 200, rangeVisible: false };
    store._apply({ frames: [{ ...store.get().frames[0]!, quickadds: [qa] }] });
    tool.setRangeVisibleForId('qa1', true);
    expect(store.get().frames[0]!.quickadds[0]!.rangeVisible).toBe(true);
    history.undo();
    expect(store.get().frames[0]!.quickadds[0]!.rangeVisible).toBe(false);
  });

  it('right-click does not place', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 2, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 2, clientX: 100, clientY: 100, bubbles: true }));
    expect(store.get().frames[0]!.quickadds).toHaveLength(0);
  });

  it('detach removes listeners', () => {
    tool.detach();
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    expect(store.get().frames[0]!.quickadds).toHaveLength(0);
  });

  describe('QuickAddTool - cancel() and touch input', () => {
    let target: HTMLElement;
    let store: ReturnType<typeof makeStore>;
    let history: ReturnType<typeof createHistory>;
    let tool: QuickAddTool;

    beforeEach(() => {
      target = document.createElement('div');
      document.body.appendChild(target);
      store = makeStore();
      history = createHistory(store);
      tool = new QuickAddTool({ store, history, getViewport: fakeViewport });
      tool.attach(target);
    });

    it('reverts an in-flight quickadd move drag and dispatches nothing', () => {
      const qa: QuickAdd = { id: 'qa1', type: 'grenade', x: 200, y: 200, rangeVisible: false };
      store._apply({ frames: [{ ...store.get().frames[0]!, quickadds: [qa] }] });
      target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true }));
      target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 400, clientY: 350, bubbles: true }));
      // The live preview has moved the item off its snapshot.
      expect(store.get().frames[0]!.quickadds[0]!.x).toBe(400);
      const dispatch = vi.spyOn(history, 'dispatch');
      tool.cancel();
      const after = store.get().frames[0]!.quickadds[0]!;
      expect(after.x).toBe(200);
      expect(after.y).toBe(200);
      expect(dispatch).not.toHaveBeenCalled();
      // A subsequent pointerup must not commit the aborted move.
      target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 400, clientY: 350, bubbles: true }));
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('is a no-op with no in-flight drag', () => {
      expect(() => tool.cancel()).not.toThrow();
    });

    it('pointercancel event routes through cancel() instead of committing the move', () => {
      const qa: QuickAdd = { id: 'qa1', type: 'grenade', x: 200, y: 200, rangeVisible: false };
      store._apply({ frames: [{ ...store.get().frames[0]!, quickadds: [qa] }] });
      target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true }));
      target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 400, clientY: 350, bubbles: true }));
      const dispatch = vi.spyOn(history, 'dispatch');
      target.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, button: 0, clientX: 400, clientY: 350, bubbles: true }));
      const after = store.get().frames[0]!.quickadds[0]!;
      expect(after.x).toBe(200);
      expect(after.y).toBe(200);
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('a one-finger touch tap places a quickadd', () => {
      target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', button: 0, clientX: 200, clientY: 200, bubbles: true }));
      target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', button: 0, clientX: 200, clientY: 200, bubbles: true }));
      const items = store.get().frames[0]!.quickadds;
      expect(items).toHaveLength(1);
      expect(items[0]!.x).toBe(200);
      expect(items[0]!.y).toBe(200);
    });
  });

  describe('QuickAddTool - context panel', () => {
    it('renders 7 buttons, one per QuickAddType', () => {
      const panel = tool.getContextPanel();
      expect(panel).not.toBeNull();
      // Scope to .cp-segmented so the unrelated show-ranges toggle (also a
      // .cp-segmented-btn but outside the type grid) isn't counted.
      const buttons = panel!.querySelectorAll('.cp-segmented .cp-segmented-btn');
      expect(buttons).toHaveLength(7);
      const types = Array.from(buttons).map((btn) => btn.getAttribute('data-type'));
      expect(types).toEqual(['grenade', 'impact_grenade', 'flash', 'smoke', 'thermite', 'vortex_mine', 'scanner']);
    });

    it('the type matching getType() has .active', () => {
      tool.setType('flash');
      const panel = tool.getContextPanel();
      const buttons = panel!.querySelectorAll('.cp-segmented .cp-segmented-btn');
      const activeBtn = Array.from(buttons).find((btn) => btn.classList.contains('active'));
      expect(activeBtn?.getAttribute('data-type')).toBe('flash');
    });

    it('clicking a button calls setType', () => {
      const panel = tool.getContextPanel();
      const thermiteBtn = panel!.querySelector('[data-type="thermite"]') as HTMLButtonElement;
      thermiteBtn.click();
      expect(tool.getType()).toBe('thermite');
    });
  });
});
