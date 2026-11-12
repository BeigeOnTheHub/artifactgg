import type { Command } from '../types/commands';
import type { Store } from './store';
import { apply } from './commands';
import { allRefs } from './selection';

export interface History {
  dispatch(cmd: Command): void;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
  /** Run `fn` just before anything that can change the active frame (frame
   *  switch/add/delete/reorder, map switch, undo, redo). Drags hook in here to
   *  cancel while their own frame is still the active one. */
  onBeforeFrameChange(fn: () => void): () => void;
}

const FRAME_CHANGERS = new Set<Command['t']>([
  'frame.switch', 'frame.add', 'frame.delete', 'frame.reorder', 'map.select',
]);

export function createHistory(store: Store): History {
  const undoStack: Command[] = [];
  const redoStack: Command[] = [];
  const beforeFrameChange: (() => void)[] = [];
  const runBeforeFrameChange = (): void => {
    for (const fn of [...beforeFrameChange]) fn();
  };

  // Undo/redo can remove items that are still selected. A stale ref makes the
  // next delete or modify throw, so drop anything no longer in the frame.
  const pruneSelection = (): void => {
    const s = store.get();
    if (s.selection.length === 0) return;
    const live = new Set(allRefs(s).map((r) => `${r.kind}:${r.id}`));
    const next = s.selection.filter((r) => live.has(`${r.kind}:${r.id}`));
    if (next.length !== s.selection.length) store._apply({ selection: next });
  };

  return {
    dispatch(cmd) {
      if (FRAME_CHANGERS.has(cmd.t)) runBeforeFrameChange();
      const inv = apply(store, cmd);
      undoStack.push(inv);
      redoStack.length = 0;
    },
    undo() {
      if (undoStack.length === 0) return false;
      runBeforeFrameChange();
      const inv = undoStack.pop()!;
      const reinv = apply(store, inv);
      redoStack.push(reinv);
      pruneSelection();
      return true;
    },
    redo() {
      if (redoStack.length === 0) return false;
      runBeforeFrameChange();
      const redo = redoStack.pop()!;
      const inv = apply(store, redo);
      undoStack.push(inv);
      pruneSelection();
      return true;
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
    },
    onBeforeFrameChange(fn) {
      beforeFrameChange.push(fn);
      return () => {
        const i = beforeFrameChange.indexOf(fn);
        if (i >= 0) beforeFrameChange.splice(i, 1);
      };
    },
  };
}
