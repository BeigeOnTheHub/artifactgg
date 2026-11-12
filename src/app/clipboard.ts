import { nanoid } from 'nanoid';
import type { Store, StratState } from './store';
import type { History } from './history';
import type { Command } from '../types/commands';
import type {
  Stroke, Shape, Cone, Player, TextBox, QuickAdd, ScannerPlacement,
  SelectionRef, Point,
} from '../types/primitives';

export interface ClipboardSnapshot {
  strokes: Stroke[];
  shapes: Shape[];
  cones: Cone[];
  players: Player[];
  textboxes: TextBox[];
  quickadds: QuickAdd[];
  scanner: ScannerPlacement | null;
}

/** Extract the selected primitives from the active frame into an in-memory snapshot. */
export function copy(state: StratState, refs: SelectionRef[]): ClipboardSnapshot {
  const frame = state.frames[state.activeFrameIdx]!;
  const snap: ClipboardSnapshot = {
    strokes: [], shapes: [], cones: [], players: [],
    textboxes: [], quickadds: [], scanner: null,
  };
  for (const r of refs) {
    if (r.kind === 'stroke') {
      const s = frame.strokes.find((x) => x.id === r.id);
      if (s) snap.strokes.push({ ...s, points: s.points.map((p) => ({ x: p.x, y: p.y })) });
    } else if (r.kind === 'shape') {
      const sh = frame.shapes.find((x) => x.id === r.id);
      if (sh) snap.shapes.push({ ...sh });
    } else if (r.kind === 'cone') {
      const c = frame.cones.find((x) => x.id === r.id);
      if (c) snap.cones.push({ ...c });
    } else if (r.kind === 'player') {
      const p = frame.players.find((x) => x.id === r.id);
      if (p) snap.players.push({ ...p });
    } else if (r.kind === 'textbox') {
      const b = frame.textboxes.find((x) => x.id === r.id);
      if (b) snap.textboxes.push({ ...b });
    } else if (r.kind === 'quickadd') {
      const q = frame.quickadds.find((x) => x.id === r.id);
      if (q) snap.quickadds.push({ ...q });
    } else if (r.kind === 'scanner') {
      if (frame.scanner) snap.scanner = { ...frame.scanner };
    }
  }
  return snap;
}

/**
 * Convert a clipboard snapshot into a list of `*.add` / `scanner.place` commands,
 * each with a fresh id and shifted by `offsetMap`. Caller wraps these in a batch.
 */
export function paste(snap: ClipboardSnapshot, offsetMap: Point): Command[] {
  const cmds: Command[] = [];

  for (const s of snap.strokes) {
    cmds.push({
      t: 'stroke.add',
      stroke: {
        ...s,
        id: nanoid(),
        points: s.points.map((p) => ({ x: p.x + offsetMap.x, y: p.y + offsetMap.y })),
      },
    });
  }
  for (const sh of snap.shapes) {
    cmds.push({
      t: 'shape.add',
      shape: { ...sh, id: nanoid(), x: sh.x + offsetMap.x, y: sh.y + offsetMap.y },
    });
  }
  for (const c of snap.cones) {
    cmds.push({
      t: 'cone.add',
      cone: { ...c, id: nanoid(), x: c.x + offsetMap.x, y: c.y + offsetMap.y },
    });
  }
  for (const p of snap.players) {
    cmds.push({
      t: 'player.add',
      player: { ...p, id: nanoid(), x: p.x + offsetMap.x, y: p.y + offsetMap.y },
    });
  }
  for (const b of snap.textboxes) {
    cmds.push({
      t: 'textbox.add',
      box: { ...b, id: nanoid(), x: b.x + offsetMap.x, y: b.y + offsetMap.y },
    });
  }
  for (const q of snap.quickadds) {
    cmds.push({
      t: 'quickadd.add',
      qa: { ...q, id: nanoid(), x: q.x + offsetMap.x, y: q.y + offsetMap.y },
    });
  }
  if (snap.scanner) {
    cmds.push({
      t: 'scanner.place',
      scanner: { x: snap.scanner.x + offsetMap.x, y: snap.scanner.y + offsetMap.y },
    });
  }

  return cmds;
}

const PASTE_OFFSET_MAP: Point = { x: 20, y: 20 };

export interface Clipboard {
  get(): ClipboardSnapshot | null;
  set(snap: ClipboardSnapshot | null): void;
  clear(): void;
}

/** Tiny module-local clipboard holder. One instance lives in main.ts and is shared by edit.copy / edit.paste. */
export function createClipboard(): Clipboard {
  let snap: ClipboardSnapshot | null = null;
  return {
    get: () => snap,
    set: (s) => { snap = s; },
    clear: () => { snap = null; },
  };
}

/**
 * Snapshot the live selection and paste a copy at +20,+20. Replaces selection with the new ids.
 * Returns false (no-op) when selection is empty.
 */
export function duplicate(store: Store, history: History): boolean {
  const sel = store.get().selection;
  if (sel.length === 0) return false;
  const snap = copy(store.get(), sel);
  const cmds = paste(snap, PASTE_OFFSET_MAP);
  if (cmds.length === 0) return false;
  dispatchAndSelect(store, history, cmds);
  return true;
}

/**
 * Delete a set of refs as one undoable step and drop them from the current
 * selection (the rest of the selection stays). Returns false when `refs` is empty.
 */
export function deleteRefs(store: Store, history: History, refs: SelectionRef[]): boolean {
  if (refs.length === 0) return false;

  const playerIds: string[] = [];
  const coneIds: string[] = [];
  const shapeIds: string[] = [];
  const tboxIds: string[] = [];
  const qaIds: string[] = [];
  const strokeIds: string[] = [];
  let scannerSelected = false;

  for (const r of refs) {
    if (r.kind === 'player') playerIds.push(r.id);
    else if (r.kind === 'cone') coneIds.push(r.id);
    else if (r.kind === 'shape') shapeIds.push(r.id);
    else if (r.kind === 'textbox') tboxIds.push(r.id);
    else if (r.kind === 'quickadd') qaIds.push(r.id);
    else if (r.kind === 'stroke') strokeIds.push(r.id);
    else if (r.kind === 'scanner') scannerSelected = true;
  }

  const cmds: Command[] = [];
  if (playerIds.length) cmds.push({ t: 'player.delete', ids: playerIds });
  if (coneIds.length) cmds.push({ t: 'cone.delete', ids: coneIds });
  if (shapeIds.length) cmds.push({ t: 'shape.delete', ids: shapeIds });
  if (tboxIds.length) cmds.push({ t: 'textbox.delete', ids: tboxIds });
  if (qaIds.length) cmds.push({ t: 'quickadd.delete', ids: qaIds });
  if (strokeIds.length) cmds.push({ t: 'stroke.erase', ids: strokeIds });
  if (scannerSelected) {
    const f = store.get().frames[store.get().activeFrameIdx]!;
    if (f.scanner) cmds.push({ t: 'scanner.place', scanner: null });
  }

  if (cmds.length === 0) return false;
  if (cmds.length === 1) history.dispatch(cmds[0]!);
  else history.dispatch({ t: 'batch', cmds });

  // Drop the deleted refs from the selection (set difference by kind+id), so
  // RMB-deleting one node doesn't wipe the rest of a multi-selection.
  const gone = new Set(refs.map((r) => `${r.kind}:${r.id}`));
  const nextSel = store.get().selection.filter((r) => !gone.has(`${r.kind}:${r.id}`));
  store._apply({ selection: nextSel });
  return true;
}

export function deleteSelection(store: Store, history: History): boolean {
  return deleteRefs(store, history, store.get().selection);
}

/** Dispatch one batch (or single command) and replace selection with the new ids. Internal. */
function dispatchAndSelect(store: Store, history: History, cmds: Command[]): void {
  if (cmds.length === 1) history.dispatch(cmds[0]!);
  else history.dispatch({ t: 'batch', cmds });
  const newRefs: SelectionRef[] = [];
  for (const c of cmds) {
    if (c.t === 'stroke.add') newRefs.push({ kind: 'stroke', id: c.stroke.id });
    else if (c.t === 'shape.add') newRefs.push({ kind: 'shape', id: c.shape.id });
    else if (c.t === 'cone.add') newRefs.push({ kind: 'cone', id: c.cone.id });
    else if (c.t === 'player.add') newRefs.push({ kind: 'player', id: c.player.id });
    else if (c.t === 'textbox.add') newRefs.push({ kind: 'textbox', id: c.box.id });
    else if (c.t === 'quickadd.add') newRefs.push({ kind: 'quickadd', id: c.qa.id });
    // scanner.place: singleton - not added to selection (id is fixed 'scanner').
  }
  store._apply({ selection: newRefs });
}

/** Re-export the constant so SelectTool / actions can paste via the same offset. */
export { PASTE_OFFSET_MAP };
