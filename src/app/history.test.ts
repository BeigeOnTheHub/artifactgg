import { describe, it, expect } from 'vitest';
import { createStore, type StratState } from './store';
import { createHistory } from './history';
import { emptyFrame, type Stroke } from '../types/primitives';
import { hex } from '../types/hex';
import { STANDARD_ZOOM_100 } from './viewport';

function makeStore() {
  const initial: StratState = {
    mapId: 'miru',
    zoom: 1,
    panX: 0,
    panY: 0,
    frames: [emptyFrame()],
    activeFrameIdx: 0,
    notes: '',
    tool: 'cursor',
    colourSlots: [hex('#00ff88'), null, null, null, null],
    activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
  return createStore(initial);
}

const STROKE: Stroke = {
  id: 's1',
  type: 'draw',
  color: hex('#00ff88'),
  alpha: 0.92,
  size: 4,
  points: [{ x: 10, y: 10 }],
};

describe('history', () => {
  it('dispatches a command and can undo it', () => {
    const s = makeStore();
    const h = createHistory(s);
    h.dispatch({ t: 'tool.set', tool: 'draw' });
    expect(s.get().tool).toBe('draw');
    h.undo();
    expect(s.get().tool).toBe('cursor');
  });

  it('undo drops selection refs to items it removed, keeping the rest', () => {
    const s = makeStore();
    const h = createHistory(s);
    h.dispatch({ t: 'stroke.add', stroke: STROKE });
    h.dispatch({ t: 'stroke.add', stroke: { ...STROKE, id: 's2' } });
    s._apply({ selection: [{ kind: 'stroke', id: 's1' }, { kind: 'stroke', id: 's2' }] });
    h.undo();
    expect(s.get().selection).toEqual([{ kind: 'stroke', id: 's1' }]);
  });

  it('runs the before-frame-change hook ahead of frame changes and undo, not other commands', () => {
    const s = makeStore();
    const h = createHistory(s);
    const seen: number[] = [];
    h.onBeforeFrameChange(() => seen.push(s.get().frames.length));
    h.dispatch({ t: 'stroke.add', stroke: STROKE });
    expect(seen).toEqual([]);
    h.dispatch({ t: 'frame.add' });
    expect(seen).toEqual([1]); // ran before the frame was added
    h.undo();
    expect(seen).toEqual([1, 2]);
  });

  it('a throwing before-frame-change hook leaves the undo entry on the stack', () => {
    const s = makeStore();
    const h = createHistory(s);
    h.dispatch({ t: 'stroke.add', stroke: STROKE });
    const off = h.onBeforeFrameChange(() => { throw new Error('boom'); });
    expect(() => h.undo()).toThrow('boom');
    off();
    expect(h.canUndo()).toBe(true);
  });

  it('redo reapplies an undone command', () => {
    const s = makeStore();
    const h = createHistory(s);
    h.dispatch({ t: 'tool.set', tool: 'draw' });
    h.undo();
    h.redo();
    expect(s.get().tool).toBe('draw');
  });

  it('a new dispatch after undo clears the redo stack', () => {
    const s = makeStore();
    const h = createHistory(s);
    h.dispatch({ t: 'tool.set', tool: 'draw' });
    h.undo();
    h.dispatch({ t: 'tool.set', tool: 'erase' });
    h.redo(); // no-op, redo stack is empty
    expect(s.get().tool).toBe('erase');
  });

  it('round-trips multiple interleaved commands', () => {
    const s = makeStore();
    const h = createHistory(s);
    h.dispatch({ t: 'stroke.add', stroke: STROKE });
    h.dispatch({ t: 'map.select', mapId: 'suna' });
    h.undo();
    expect(s.get().mapId).toBe('miru');
    h.undo();
    expect(s.get().frames[0]!.strokes).toHaveLength(0);
  });

  it('a map switch is one undoable step that round-trips frames + view', () => {
    const s = makeStore(); // mapId 'miru', zoom 1
    const h = createHistory(s);
    s._apply({ frames: [{ ...emptyFrame(), players: [{ id: 'p1', team: 'reyab', x: 5, y: 6, name: 'A', dead: false }] }], zoom: 3, panX: 10, panY: 20 });
    h.dispatch({ t: 'map.select', mapId: 'suna' });
    expect(s.get().mapId).toBe('suna');
    expect(s.get().frames[0]!.players).toHaveLength(0);
    expect(s.get().zoom).toBe(STANDARD_ZOOM_100);
    h.undo();
    expect(s.get().mapId).toBe('miru');
    expect(s.get().frames[0]!.players.map((p) => p.id)).toEqual(['p1']);
    expect(s.get().zoom).toBe(3);
    expect(s.get().panX).toBe(10);
    h.redo();
    expect(s.get().mapId).toBe('suna');
    expect(s.get().frames[0]!.players).toHaveLength(0);
    expect(s.get().zoom).toBe(STANDARD_ZOOM_100);
  });

  it('canUndo/canRedo reflect stack state', () => {
    const s = makeStore();
    const h = createHistory(s);
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    h.dispatch({ t: 'tool.set', tool: 'draw' });
    expect(h.canUndo()).toBe(true);
    expect(h.canRedo()).toBe(false);
    h.undo();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(true);
  });
});
