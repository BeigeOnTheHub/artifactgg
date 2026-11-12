import { describe, it, expect } from 'vitest';
import { copy, paste, createClipboard, duplicate, deleteSelection } from './clipboard';
import { createHistory } from './history';
import { createStore } from './store';
import type { StratState } from './store';
import { emptyFrame, type Stroke, type Cone, type Player, type TextBox, type QuickAdd, type Shape } from '../types/primitives';
import { hex } from '../types/hex';

function state(overrides: Partial<ReturnType<typeof emptyFrame>> = {}): StratState {
  return {
    mapId: 'miru', zoom: 1, panX: 0, panY: 0,
    frames: [{ ...emptyFrame(), ...overrides }],
    activeFrameIdx: 0, notes: '', tool: 'select',
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
}

const PLAYER: Player = { id: 'p1', team: 'colonist', x: 100, y: 100, name: '', dead: false };
const CONE: Cone = {
  id: 'c1', x: 200, y: 200, angle: 0, length: 50,
  spreadIdx: 1, customHalfAngle: null, color: hex('#00ff88'), attachedPlayerId: null,
};
const SHAPE: Shape = {
  id: 'sh1', kind: 'square', x: 300, y: 300, w: 40, h: 40,
  rotation: 0, stroke: hex('#00ff88'), strokeWidth: 2, fill: false,
};
const TBOX: TextBox = {
  id: 't1', x: 400, y: 400, w: 80, h: 32, text: 'hello',
  fontSize: 13, color: hex('#00ff88'),
};
const QA: QuickAdd = { id: 'q1', type: 'grenade', x: 500, y: 500, rangeVisible: false };
const STROKE: Stroke = {
  id: 's1', type: 'draw', color: hex('#00ff88'), alpha: 1, size: 2,
  points: [{ x: 600, y: 600 }, { x: 610, y: 610 }],
};

describe('clipboard.copy', () => {
  it('extracts only the referenced primitives', () => {
    const s = state({
      players: [PLAYER, { ...PLAYER, id: 'p2' }],
      cones: [CONE],
      shapes: [SHAPE],
      textboxes: [TBOX],
      quickadds: [QA],
      strokes: [STROKE],
    });
    const snap = copy(s, [
      { kind: 'player', id: 'p1' },
      { kind: 'cone', id: 'c1' },
      { kind: 'stroke', id: 's1' },
    ]);
    expect(snap.players).toHaveLength(1);
    expect(snap.players[0]!.id).toBe('p1');
    expect(snap.cones).toHaveLength(1);
    expect(snap.strokes).toHaveLength(1);
    expect(snap.shapes).toHaveLength(0);
    expect(snap.textboxes).toHaveLength(0);
    expect(snap.quickadds).toHaveLength(0);
    expect(snap.scanner).toBeNull();
  });

  it('handles scanner singleton ref', () => {
    const s = state({ scanner: { x: 700, y: 700 } });
    const snap = copy(s, [{ kind: 'scanner', id: 'scanner' }]);
    expect(snap.scanner).toEqual({ x: 700, y: 700 });
  });

  it('returns empty snapshot when refs is empty', () => {
    const s = state({ players: [PLAYER] });
    const snap = copy(s, []);
    expect(snap.players).toHaveLength(0);
    expect(snap.scanner).toBeNull();
  });
});

describe('clipboard.paste', () => {
  it('returns fresh-id add commands offset by the requested vector', () => {
    const snap = copy(state({ players: [PLAYER] }), [{ kind: 'player', id: 'p1' }]);
    const cmds = paste(snap, { x: 50, y: 50 });
    expect(cmds).toHaveLength(1);
    const cmd = cmds[0]!;
    expect(cmd.t).toBe('player.add');
    if (cmd.t !== 'player.add') throw new Error('unreachable');
    expect(cmd.player.x).toBe(150);
    expect(cmd.player.y).toBe(150);
    expect(cmd.player.id).not.toBe('p1');
    expect(cmd.player.id.length).toBeGreaterThan(0);
  });

  it('paste-then-add is round-trip-shaped (every primitive emits one add)', () => {
    const s = state({
      players: [PLAYER], cones: [CONE], shapes: [SHAPE],
      textboxes: [TBOX], quickadds: [QA], strokes: [STROKE],
    });
    const snap = copy(s, [
      { kind: 'player', id: 'p1' },
      { kind: 'cone', id: 'c1' },
      { kind: 'shape', id: 'sh1' },
      { kind: 'textbox', id: 't1' },
      { kind: 'quickadd', id: 'q1' },
      { kind: 'stroke', id: 's1' },
    ]);
    const cmds = paste(snap, { x: 0, y: 0 });
    const ts = cmds.map((c) => c.t).sort();
    expect(ts).toContain('player.add');
    expect(ts).toContain('cone.add');
    expect(ts).toContain('shape.add');
    expect(ts).toContain('textbox.add');
    expect(ts).toContain('quickadd.add');
    expect(ts).toContain('stroke.add');
  });

  it('paste of scanner-only snapshot emits scanner.place', () => {
    const snap = copy(state({ scanner: { x: 700, y: 700 } }),
                      [{ kind: 'scanner', id: 'scanner' }]);
    const cmds = paste(snap, { x: 10, y: 10 });
    expect(cmds).toHaveLength(1);
    const cmd = cmds[0]!;
    expect(cmd.t).toBe('scanner.place');
    if (cmd.t !== 'scanner.place') throw new Error('unreachable');
    expect(cmd.scanner).toEqual({ x: 710, y: 710 });
  });

  it('empty snapshot pastes to empty array', () => {
    const snap = copy(state(), []);
    expect(paste(snap, { x: 0, y: 0 })).toEqual([]);
  });

  it('every pasted id is fresh (no collision with the source)', () => {
    const snap = copy(state({ players: [PLAYER] }), [{ kind: 'player', id: 'p1' }]);
    const a = paste(snap, { x: 0, y: 0 });
    const b = paste(snap, { x: 0, y: 0 });
    if (a[0]!.t !== 'player.add' || b[0]!.t !== 'player.add') throw new Error('unreachable');
    expect(a[0]!.player.id).not.toBe('p1');
    expect(a[0]!.player.id).not.toBe(b[0]!.player.id);
  });
});

describe('createClipboard', () => {
  it('starts empty and roundtrips a snapshot', () => {
    const cb = createClipboard();
    expect(cb.get()).toBeNull();
    const snap = { strokes: [], shapes: [], cones: [], players: [], textboxes: [], quickadds: [], scanner: null };
    cb.set(snap);
    expect(cb.get()).toBe(snap);
  });

  it('clear() resets to empty', () => {
    const cb = createClipboard();
    cb.set({ strokes: [], shapes: [], cones: [], players: [], textboxes: [], quickadds: [], scanner: null });
    cb.clear();
    expect(cb.get()).toBeNull();
  });
});

describe('duplicate (pure)', () => {
  it('snapshots + pastes the live selection in one batch and selects the new ids', () => {
    const s = state({
      players: [{ id: 'p1', team: 'colonist', x: 100, y: 100, name: '', dead: false }],
    });
    s.selection = [{ kind: 'player', id: 'p1' }];
    const store = createStore(s);
    const history = createHistory(store);

    expect(duplicate(store, history)).toBe(true);
    expect(store.get().frames[0]!.players).toHaveLength(2);
    expect(store.get().selection).toHaveLength(1);
    expect(store.get().selection[0]!.kind).toBe('player');
    expect(store.get().selection[0]!.id).not.toBe('p1');
    const pasted = store.get().frames[0]!.players.find((p) => p.id !== 'p1')!;
    expect(pasted.x).toBe(120);
    expect(pasted.y).toBe(120);
    expect(history.canUndo()).toBe(true);
  });

  it('returns false and is a no-op when selection is empty', () => {
    const store = createStore(state());
    const history = createHistory(store);
    expect(duplicate(store, history)).toBe(false);
    expect(history.canUndo()).toBe(false);
  });
});

describe('deleteSelection (pure)', () => {
  it('dispatches a single command for single-kind selection and clears selection', () => {
    const s = state({
      players: [
        { id: 'a', team: 'colonist', x: 100, y: 100, name: '', dead: false },
        { id: 'b', team: 'reyab', x: 200, y: 200, name: '', dead: false },
      ],
    });
    s.selection = [{ kind: 'player', id: 'a' }, { kind: 'player', id: 'b' }];
    const store = createStore(s);
    const history = createHistory(store);
    expect(deleteSelection(store, history)).toBe(true);
    expect(store.get().frames[0]!.players).toHaveLength(0);
    expect(store.get().selection).toEqual([]);
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(store.get().frames[0]!.players).toHaveLength(2);
  });

  it('dispatches one batch for mixed-kind selection (single undo restores all)', () => {
    const s = state({
      players: [{ id: 'p1', team: 'colonist', x: 100, y: 100, name: '', dead: false }],
      cones: [{
        id: 'c1', x: 200, y: 200, angle: 0, length: 50,
        spreadIdx: 1, customHalfAngle: null, color: hex('#00ff88'), attachedPlayerId: null,
      }],
    });
    s.selection = [{ kind: 'player', id: 'p1' }, { kind: 'cone', id: 'c1' }];
    const store = createStore(s);
    const history = createHistory(store);
    deleteSelection(store, history);
    expect(store.get().frames[0]!.players).toHaveLength(0);
    expect(store.get().frames[0]!.cones).toHaveLength(0);
    history.undo();
    expect(store.get().frames[0]!.players).toHaveLength(1);
    expect(store.get().frames[0]!.cones).toHaveLength(1);
  });

  it('returns false on empty selection (no command, no selection write)', () => {
    const store = createStore(state());
    const history = createHistory(store);
    expect(deleteSelection(store, history)).toBe(false);
    expect(history.canUndo()).toBe(false);
  });
});
