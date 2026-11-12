import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PlayerTool } from './PlayerTool';
import { createStore, type StratState } from '../app/store';
import { createHistory } from '../app/history';
import { emptyFrame, type Player } from '../types/primitives';
import { hex } from '../types/hex';
import { setPlayerSizeMode, setPlayerSizeFactor, getPlayerSizeFactor } from '../app/playerSizePref';

function resetPlayerSize(): void {
  try { localStorage.clear(); } catch { /* ignore */ }
  setPlayerSizeMode('auto');
  setPlayerSizeFactor(1);
}

function makeStore() {
  const initial: StratState = {
    mapId: 'miru',
    zoom: 1, panX: 0, panY: 0,
    frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '', tool: 'place-player',
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

describe('PlayerTool', () => {
  let target: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let tool: PlayerTool;

  beforeEach(() => {
    resetPlayerSize();
    target = document.createElement('div');
    document.body.appendChild(target);
    store = makeStore();
    history = createHistory(store);
    tool = new PlayerTool({ store, history, getViewport: fakeViewport });
    tool.attach(target);
  });

  afterEach(() => { resetPlayerSize(); });

  it('default team is colonist', () => {
    expect(tool.getTeam()).toBe('colonist');
  });

  it('left-click empty space dispatches player.add with active team', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 400, clientY: 400, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 400, clientY: 400, bubbles: true,
    }));
    const players = store.get().frames[0]!.players;
    expect(players).toHaveLength(1);
    expect(players[0]!.team).toBe('colonist');
    expect(players[0]!.x).toBe(400);
    expect(players[0]!.y).toBe(400);
  });

  it('a bigger node has a wider click target (click 25u away toggles instead of placing)', () => {
    // place one player at 400,400
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 400, clientY: 400, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 400, clientY: 400, bubbles: true }));
    expect(store.get().frames[0]!.players).toHaveLength(1);

    // at factor 1 the hit radius is ~16u, so a click 25u away misses and places a 2nd player
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, button: 0, clientX: 425, clientY: 400, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, button: 0, clientX: 425, clientY: 400, bubbles: true }));
    expect(store.get().frames[0]!.players).toHaveLength(2);
  });

  it('in manual mode, factor 2 catches a click that factor 1 would miss', () => {
    setPlayerSizeMode('manual'); // the factor only affects size in manual mode
    setPlayerSizeFactor(2); // bigger nodes -> wider hit radius
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 400, clientY: 400, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 400, clientY: 400, bubbles: true }));
    expect(store.get().frames[0]!.players).toHaveLength(1);
    expect(store.get().frames[0]!.players[0]!.dead).toBe(false);

    // 25u away now lands on the node - a click toggles dead rather than placing
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, button: 0, clientX: 425, clientY: 400, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, button: 0, clientX: 425, clientY: 400, bubbles: true }));
    expect(store.get().frames[0]!.players).toHaveLength(1);
    expect(store.get().frames[0]!.players[0]!.dead).toBe(true);
  });

  it('setTeam switches the next placement', () => {
    tool.setTeam('reyab');
    target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true,
    }));
    expect(store.get().frames[0]!.players[0]!.team).toBe('reyab');
  });

  it('placement is rejected when team already has 5 players', () => {
    const five: Player[] = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`, team: 'colonist', x: 100 + i * 20, y: 100, name: '', dead: false,
    }));
    store._apply({ frames: [{ ...store.get().frames[0]!, players: five }] });
    target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 600, clientY: 600, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 600, clientY: 600, bubbles: true,
    }));
    expect(store.get().frames[0]!.players).toHaveLength(5);
  });

  it('click on existing player toggles dead state', () => {
    const p: Player = { id: 'p1', team: 'colonist', x: 200, y: 200, name: '', dead: false };
    store._apply({ frames: [{ ...store.get().frames[0]!, players: [p] }] });
    target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true,
    }));
    expect(store.get().frames[0]!.players[0]!.dead).toBe(true);
    expect(store.get().frames[0]!.players).toHaveLength(1);
  });

  it('drag on existing player dispatches player.modify with new x,y', () => {
    const p: Player = { id: 'p1', team: 'colonist', x: 200, y: 200, name: '', dead: false };
    store._apply({ frames: [{ ...store.get().frames[0]!, players: [p] }] });
    target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, clientX: 350, clientY: 280, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 350, clientY: 280, bubbles: true,
    }));
    const moved = store.get().frames[0]!.players[0]!;
    expect(moved.x).toBe(350);
    expect(moved.y).toBe(280);
  });

  it('drag commit is undoable', () => {
    const p: Player = { id: 'p1', team: 'colonist', x: 200, y: 200, name: '', dead: false };
    store._apply({ frames: [{ ...store.get().frames[0]!, players: [p] }] });
    target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, clientX: 350, clientY: 280, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 350, clientY: 280, bubbles: true,
    }));
    history.undo();
    expect(store.get().frames[0]!.players[0]!.x).toBe(200);
    expect(store.get().frames[0]!.players[0]!.y).toBe(200);
  });

  it('contextmenu on a player dispatches player.delete', () => {
    const p: Player = { id: 'p1', team: 'colonist', x: 200, y: 200, name: '', dead: false };
    store._apply({ frames: [{ ...store.get().frames[0]!, players: [p] }] });
    target.dispatchEvent(new MouseEvent('contextmenu', {
      clientX: 200, clientY: 200, bubbles: true, cancelable: true,
    }));
    expect(store.get().frames[0]!.players).toHaveLength(0);
  });

  it('contextmenu on empty space does not delete', () => {
    const p: Player = { id: 'p1', team: 'colonist', x: 200, y: 200, name: '', dead: false };
    store._apply({ frames: [{ ...store.get().frames[0]!, players: [p] }] });
    target.dispatchEvent(new MouseEvent('contextmenu', {
      clientX: 800, clientY: 800, bubbles: true, cancelable: true,
    }));
    expect(store.get().frames[0]!.players).toHaveLength(1);
  });

  it('right-click does not place', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 2, clientX: 100, clientY: 100, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 2, clientX: 100, clientY: 100, bubbles: true,
    }));
    expect(store.get().frames[0]!.players).toHaveLength(0);
  });

  it('detach removes listeners', () => {
    tool.detach();
    target.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true,
    }));
    target.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true,
    }));
    expect(store.get().frames[0]!.players).toHaveLength(0);
  });
});

function placePlayerAt(t: PlayerTool, tgt: HTMLElement, x: number, y: number): void {
  tgt.dispatchEvent(new PointerEvent('pointerdown', {
    pointerId: 1, button: 0, clientX: x, clientY: y, bubbles: true,
  }));
  tgt.dispatchEvent(new PointerEvent('pointerup', {
    pointerId: 1, button: 0, clientX: x, clientY: y, bubbles: true,
  }));
}

describe('PlayerTool - context panel', () => {
  let target: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let tool: PlayerTool;

  beforeEach(() => {
    target = document.createElement('div');
    document.body.appendChild(target);
    store = makeStore();
    history = createHistory(store);
    tool = new PlayerTool({ store, history, getViewport: fakeViewport });
    tool.attach(target);
  });

  it('renders team toggle, name input, dead toggle', () => {
    const panel = tool.getContextPanel();
    expect(panel.querySelector('[data-team-toggle]')).not.toBeNull();
    expect(panel.querySelector('input[type="text"]')).not.toBeNull();
    expect(panel.querySelector('[data-dead-toggle]')).not.toBeNull();
  });

  it('the name input is the compact size that lines up with the toggle rows', () => {
    const panel = tool.getContextPanel();
    const input = panel.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input.classList.contains('cp-input--compact')).toBe(true);
    // The NAME row uses the same container as the TEAM / SPAWN DEAD rows so
    // all three share one rhythm.
    expect(input.parentElement?.classList.contains('cp-toggle-row')).toBe(true);
    const rows = panel.querySelectorAll('.cp-toggle-row');
    expect(rows).toHaveLength(4); // TEAM, NAME, SPAWN DEAD, SIZE
  });

  it('shows the size mode toggle and a scale slider', () => {
    const panel = tool.getContextPanel();
    expect(panel.querySelector('[data-size-mode="auto"]')).not.toBeNull();
    expect(panel.querySelector('[data-size-mode="manual"]')).not.toBeNull();
    const slider = panel.querySelector('input[aria-label="Player node scale"]') as HTMLInputElement;
    expect(slider).not.toBeNull();
    expect(slider.disabled).toBe(true); // auto by default -> slider greyed
  });

  it('switching to manual enables the scale slider, auto greys it out', () => {
    const panel = tool.getContextPanel();
    const slider = panel.querySelector('input[aria-label="Player node scale"]') as HTMLInputElement;
    (panel.querySelector('[data-size-mode="manual"]') as HTMLButtonElement).click();
    expect(slider.disabled).toBe(false);
    (panel.querySelector('[data-size-mode="auto"]') as HTMLButtonElement).click();
    expect(slider.disabled).toBe(true);
  });

  it('moving the scale slider in manual mode updates the saved factor', () => {
    const panel = tool.getContextPanel();
    (panel.querySelector('[data-size-mode="manual"]') as HTMLButtonElement).click();
    const slider = panel.querySelector('input[aria-label="Player node scale"]') as HTMLInputElement;
    slider.value = '200';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(getPlayerSizeFactor()).toBeCloseTo(2, 5);
  });

  it('clicking team toggle flips Colonist <-> REYAB', () => {
    const panel = tool.getContextPanel();
    const btn = panel.querySelector('[data-team-toggle]') as HTMLButtonElement;
    expect(tool.getTeam()).toBe('colonist');
    btn.click();
    expect(tool.getTeam()).toBe('reyab');
    btn.click();
    expect(tool.getTeam()).toBe('colonist');
  });

  it('typing in the name input calls setNextName', () => {
    const panel = tool.getContextPanel();
    const input = panel.querySelector('input[type="text"]') as HTMLInputElement;
    input.value = 'Alpha';
    input.dispatchEvent(new Event('input'));
    expect(tool.getNextName()).toBe('Alpha');
  });

  it('clicking dead toggle flips spawnDead', () => {
    const panel = tool.getContextPanel();
    const btn = panel.querySelector('[data-dead-toggle]') as HTMLButtonElement;
    expect(tool.getSpawnDead()).toBe(false);
    btn.click();
    expect(tool.getSpawnDead()).toBe(true);
  });

  it('placed player uses tool-instance team / name / spawnDead', () => {
    tool.setTeam('reyab');
    tool.setNextName('Bravo');
    tool.setSpawnDead(true);
    placePlayerAt(tool, target, 300, 300);
    const player = store.get().frames[0]!.players[0]!;
    expect(player.team).toBe('reyab');
    expect(player.name).toBe('Bravo');
    expect(player.dead).toBe(true);
  });
});

describe('PlayerTool - cancel() and touch input', () => {
  let target: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let tool: PlayerTool;

  beforeEach(() => {
    target = document.createElement('div');
    document.body.appendChild(target);
    store = makeStore();
    history = createHistory(store);
    tool = new PlayerTool({ store, history, getViewport: fakeViewport });
    tool.attach(target);
  });

  it('reverts an in-flight player move drag and dispatches nothing', () => {
    const p: Player = { id: 'p1', team: 'colonist', x: 200, y: 200, name: '', dead: false };
    store._apply({ frames: [{ ...store.get().frames[0]!, players: [p] }] });
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 350, clientY: 280, bubbles: true }));
    // The live preview has moved the player off its snapshot.
    expect(store.get().frames[0]!.players[0]!.x).toBe(350);
    const dispatch = vi.spyOn(history, 'dispatch');
    tool.cancel();
    const after = store.get().frames[0]!.players[0]!;
    expect(after.x).toBe(200);
    expect(after.y).toBe(200);
    expect(dispatch).not.toHaveBeenCalled();
    // A subsequent pointerup must not commit the aborted move.
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 350, clientY: 280, bubbles: true }));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('detach mid-drag reverts the live move', () => {
    const p: Player = { id: 'p1', team: 'colonist', x: 200, y: 200, name: '', dead: false };
    store._apply({ frames: [{ ...store.get().frames[0]!, players: [p] }] });
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 350, clientY: 280, bubbles: true }));
    tool.detach();
    expect(store.get().frames[0]!.players[0]!.x).toBe(200);
  });

  it('drops an in-flight placement candidate and dispatches nothing', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 400, clientY: 400, bubbles: true }));
    const dispatch = vi.spyOn(history, 'dispatch');
    tool.cancel();
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 400, clientY: 400, bubbles: true }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(store.get().frames[0]!.players).toHaveLength(0);
  });

  it('is a no-op with no in-flight gesture', () => {
    expect(() => tool.cancel()).not.toThrow();
  });

  it('pointercancel event routes through cancel() instead of committing the move', () => {
    const p: Player = { id: 'p1', team: 'colonist', x: 200, y: 200, name: '', dead: false };
    store._apply({ frames: [{ ...store.get().frames[0]!, players: [p] }] });
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 350, clientY: 280, bubbles: true }));
    const dispatch = vi.spyOn(history, 'dispatch');
    target.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, button: 0, clientX: 350, clientY: 280, bubbles: true }));
    const after = store.get().frames[0]!.players[0]!;
    expect(after.x).toBe(200);
    expect(after.y).toBe(200);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('a one-finger touch tap places a player', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', button: 0, clientX: 300, clientY: 300, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', button: 0, clientX: 300, clientY: 300, bubbles: true }));
    const players = store.get().frames[0]!.players;
    expect(players).toHaveLength(1);
    expect(players[0]!.x).toBe(300);
    expect(players[0]!.y).toBe(300);
  });
});
