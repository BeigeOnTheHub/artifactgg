import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConeTool } from './ConeTool';
import { createStore, type StratState } from '../app/store';
import { createHistory } from '../app/history';
import { emptyFrame, type Cone } from '../types/primitives';
import { hex } from '../types/hex';

function makeStore() {
  const initial: StratState = {
    mapId: 'miru',
    zoom: 1, panX: 0, panY: 0,
    frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '', tool: 'place-cone',
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

describe('ConeTool', () => {
  let target: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let tool: ConeTool;

  beforeEach(() => {
    target = document.createElement('div');
    document.body.appendChild(target);
    store = makeStore();
    history = createHistory(store);
    tool = new ConeTool({ store, history, getViewport: fakeViewport });
    tool.attach(target);
  });

  it('left-click empty space dispatches one cone.add', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 200, clientY: 150, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 200, clientY: 150, bubbles: true,
    }));
    const cones = store.get().frames[0]!.cones;
    expect(cones).toHaveLength(1);
    expect(cones[0]!.x).toBe(200);
    expect(cones[0]!.y).toBe(150);
  });

  it('placed cone uses default length, spreadIdx, the fixed grey colour, and is unattached', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true,
    }));
    const c = store.get().frames[0]!.cones[0]!;
    expect(c.length).toBe(130);
    expect(c.spreadIdx).toBe(1);
    expect(c.customHalfAngle).toBeNull();
    expect(c.color).toBe('#aeb6bb'); // DEFAULT_CONE_COLOUR - not the active slot
    expect(c.attachedPlayerId).toBeNull();
    expect(c.angle).toBe(0);
  });

  it('placing a cone on a player attaches it and takes the team colour', () => {
    store._apply({
      frames: [{
        ...store.get().frames[0]!,
        players: [{ id: 'p1', team: 'colonist', x: 300, y: 300, name: '', dead: false }],
      }],
    });
    // Click within the attach threshold (28 px) of the player.
    target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 305, clientY: 308, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 305, clientY: 308, bubbles: true,
    }));
    const c = store.get().frames[0]!.cones[0]!;
    expect(c.attachedPlayerId).toBe('p1');
    expect(c.color).toBe('#ff4444'); // colonist team colour
    expect(c.x).toBe(300);
    expect(c.y).toBe(300);
  });

  it('dragging the arc-centre dot reshapes the cone (direction + length)', () => {
    const cone: Cone = {
      id: 'c1', x: 200, y: 200, angle: 0, length: 130,
      spreadIdx: 1, customHalfAngle: null, color: hex('#aeb6bb'), attachedPlayerId: null,
    };
    store._apply({ frames: [{ ...store.get().frames[0]!, cones: [cone] }] });
    // Arc-centre dot is at (200 + 130, 200) = (330, 200). Grab it and drag to
    // (200, 280): new direction ~ 90° down, new length = 80.
    target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 330, clientY: 200, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, button: 0, clientX: 200, clientY: 280, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 200, clientY: 280, bubbles: true,
    }));
    const c = store.get().frames[0]!.cones[0]!;
    expect(c.length).toBe(80);
    expect(c.angle).toBeCloseTo(Math.PI / 2, 4);
    expect(c.x).toBe(200); // origin unchanged
    expect(history.canUndo()).toBe(true);
  });

  it('dragging the origin dot near a player attaches the cone; dragging it away detaches', () => {
    const cone: Cone = {
      id: 'c1', x: 100, y: 100, angle: 0, length: 130,
      spreadIdx: 1, customHalfAngle: null, color: hex('#aeb6bb'), attachedPlayerId: null,
    };
    store._apply({
      frames: [{
        ...store.get().frames[0]!,
        cones: [cone],
        players: [{ id: 'p1', team: 'reyab', x: 400, y: 400, name: '', dead: false }],
      }],
    });
    // Grab the origin dot at (100,100), drop it on the player at (400,400).
    target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, button: 0, clientX: 400, clientY: 400, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 400, clientY: 400, bubbles: true,
    }));
    let c = store.get().frames[0]!.cones[0]!;
    expect(c.attachedPlayerId).toBe('p1');
    expect(c.color).toBe('#00ccee'); // reyab team colour

    // Now grab the origin (which now sits at the player, (400,400)) and drag
    // it far away - detaches and goes grey again.
    target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 2, button: 0, clientX: 400, clientY: 400, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 2, button: 0, clientX: 900, clientY: 900, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 2, button: 0, clientX: 900, clientY: 900, bubbles: true,
    }));
    c = store.get().frames[0]!.cones[0]!;
    expect(c.attachedPlayerId).toBeNull();
    expect(c.color).toBe('#aeb6bb');
    expect(c.x).toBe(900);
    expect(c.y).toBe(900);
  });

  it('right-click does not place', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 2, clientX: 100, clientY: 100, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 2, clientX: 100, clientY: 100, bubbles: true,
    }));
    expect(store.get().frames[0]!.cones).toHaveLength(0);
  });

  it('contextmenu on a cone hit-point dispatches cone.delete', () => {
    const cone: Cone = {
      id: 'c1', x: 200, y: 200, angle: 0, length: 130,
      spreadIdx: 1, customHalfAngle: null, color: hex('#00ff88'), attachedPlayerId: null,
    };
    store._apply({ frames: [{ ...store.get().frames[0]!, cones: [cone] }] });
    target.dispatchEvent(new MouseEvent('contextmenu', {
      clientX: 200, clientY: 200, bubbles: true, cancelable: true,
    }));
    expect(store.get().frames[0]!.cones).toHaveLength(0);
  });

  it('contextmenu on empty space does not delete', () => {
    const cone: Cone = {
      id: 'c1', x: 200, y: 200, angle: 0, length: 130,
      spreadIdx: 1, customHalfAngle: null, color: hex('#00ff88'), attachedPlayerId: null,
    };
    store._apply({ frames: [{ ...store.get().frames[0]!, cones: [cone] }] });
    target.dispatchEvent(new MouseEvent('contextmenu', {
      clientX: 800, clientY: 800, bubbles: true, cancelable: true,
    }));
    expect(store.get().frames[0]!.cones).toHaveLength(1);
  });

  it('detach removes listeners - pointerdown after detach has no effect', () => {
    tool.detach();
    target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true,
    }));
    expect(store.get().frames[0]!.cones).toHaveLength(0);
  });
});

describe('ConeTool - cancel() and touch input', () => {
  let target: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let tool: ConeTool;

  beforeEach(() => {
    target = document.createElement('div');
    document.body.appendChild(target);
    store = makeStore();
    history = createHistory(store);
    tool = new ConeTool({ store, history, getViewport: fakeViewport });
    tool.attach(target);
  });

  it('drops an in-flight placement candidate and dispatches nothing', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 200, clientY: 150, bubbles: true }));
    const dispatch = vi.spyOn(history, 'dispatch');
    tool.cancel();
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 200, clientY: 150, bubbles: true }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(store.get().frames[0]!.cones).toHaveLength(0);
  });

  it('reverts an in-flight reshape edit and dispatches nothing', () => {
    const cone: Cone = {
      id: 'c1', x: 200, y: 200, angle: 0, length: 130,
      spreadIdx: 1, customHalfAngle: null, color: hex('#aeb6bb'), attachedPlayerId: null,
    };
    store._apply({ frames: [{ ...store.get().frames[0]!, cones: [cone] }] });
    // Grab the arc-centre dot at (330, 200) and drag it - liveConeEdit previews.
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 330, clientY: 200, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, button: 0, clientX: 200, clientY: 280, bubbles: true }));
    // The live preview has moved the cone off its snapshot.
    expect(store.get().frames[0]!.cones[0]!.length).not.toBe(130);
    const dispatch = vi.spyOn(history, 'dispatch');
    tool.cancel();
    const c = store.get().frames[0]!.cones[0]!;
    expect(c.length).toBe(130);
    expect(c.angle).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
    // A subsequent pointerup must not commit the aborted edit.
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 200, clientY: 280, bubbles: true }));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('is a no-op with no in-flight gesture', () => {
    expect(() => tool.cancel()).not.toThrow();
  });

  it('pointercancel mid-reshape reverts the edit and dispatches nothing', () => {
    const cone: Cone = {
      id: 'c1', x: 200, y: 200, angle: 0, length: 130,
      spreadIdx: 1, customHalfAngle: null, color: hex('#aeb6bb'), attachedPlayerId: null,
    };
    store._apply({ frames: [{ ...store.get().frames[0]!, cones: [cone] }] });
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 330, clientY: 200, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, button: 0, clientX: 200, clientY: 280, bubbles: true }));
    expect(store.get().frames[0]!.cones[0]!.length).not.toBe(130);
    const dispatch = vi.spyOn(history, 'dispatch');
    target.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, button: 0, clientX: 200, clientY: 280, bubbles: true }));
    const c = store.get().frames[0]!.cones[0]!;
    expect(c.length).toBe(130);
    expect(c.angle).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('detach mid-reshape reverts the edit so the store is not left half-dragged', () => {
    const cone: Cone = {
      id: 'c1', x: 200, y: 200, angle: 0, length: 130,
      spreadIdx: 1, customHalfAngle: null, color: hex('#aeb6bb'), attachedPlayerId: null,
    };
    store._apply({ frames: [{ ...store.get().frames[0]!, cones: [cone] }] });
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 330, clientY: 200, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, button: 0, clientX: 200, clientY: 280, bubbles: true }));
    const dispatch = vi.spyOn(history, 'dispatch');
    tool.detach();
    const c = store.get().frames[0]!.cones[0]!;
    expect(c.length).toBe(130);
    expect(c.angle).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('a one-finger touch tap places a cone', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', button: 0, clientX: 200, clientY: 150, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', button: 0, clientX: 200, clientY: 150, bubbles: true }));
    const cones = store.get().frames[0]!.cones;
    expect(cones).toHaveLength(1);
    expect(cones[0]!.x).toBe(200);
    expect(cones[0]!.y).toBe(150);
  });
});

describe('ConeTool - context panel', () => {
  let target: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let tool: ConeTool;

  beforeEach(() => {
    target = document.createElement('div');
    document.body.appendChild(target);
    store = makeStore();
    history = createHistory(store);
    tool = new ConeTool({ store, history, getViewport: fakeViewport });
    tool.attach(target);
  });

  it('renders 3 spread buttons and no length slider (slider was removed)', () => {
    const panel = tool.getContextPanel();
    const buttons = panel.querySelectorAll('.cp-segmented-btn');
    expect(buttons).toHaveLength(3);
    const slider = panel.querySelector('input[type="range"]');
    expect(slider).toBeNull();
  });

  it('clicking a spread button calls setSpread', () => {
    const panel = tool.getContextPanel();
    const btn = panel.querySelector('[data-spread="2"]') as HTMLElement;
    expect(btn).not.toBeNull();
    btn.click();
    expect(tool.getSpread()).toBe(2);
  });

  it('placed cone uses tool-instance spread + length', () => {
    tool.setSpread(2);
    tool.setLength(200);
    target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 300, clientY: 300, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 300, clientY: 300, bubbles: true,
    }));
    const cone = store.get().frames[0]!.cones[0]!;
    expect(cone.spreadIdx).toBe(2);
    expect(cone.length).toBe(200);
  });
});
