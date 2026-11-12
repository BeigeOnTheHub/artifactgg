import type { Command } from '../types/commands';
import type { Store, StratState } from './store';
import { emptyFrame } from '../types/primitives';
import type { Frame, Stroke, Shape, Cone, Player, QuickAdd, TextBox } from '../types/primitives';
import type { Hex } from '../types/hex';
import { getMapSwitchZoom } from './viewport';

/** Returns a partial patch replacing the active frame's strokes. */
function withStrokes(state: StratState, strokes: Stroke[]): Partial<StratState> {
  const idx = state.activeFrameIdx;
  const nextFrames = state.frames.map((f, i): Frame =>
    i === idx ? { ...f, strokes } : f,
  );
  return { frames: nextFrames };
}

/** Returns a partial patch replacing the active frame's shapes. */
function withShapes(state: StratState, shapes: Shape[]): Partial<StratState> {
  const idx = state.activeFrameIdx;
  const nextFrames = state.frames.map((f, i): Frame =>
    i === idx ? { ...f, shapes } : f,
  );
  return { frames: nextFrames };
}

/** Returns a partial patch replacing the active frame's cones. */
function withCones(state: StratState, cones: Cone[]): Partial<StratState> {
  const idx = state.activeFrameIdx;
  const nextFrames = state.frames.map((f, i): Frame =>
    i === idx ? { ...f, cones } : f,
  );
  return { frames: nextFrames };
}

/** Returns a partial patch replacing the active frame's players. */
function withPlayers(state: StratState, players: Player[]): Partial<StratState> {
  const idx = state.activeFrameIdx;
  const nextFrames = state.frames.map((f, i): Frame =>
    i === idx ? { ...f, players } : f,
  );
  return { frames: nextFrames };
}

/** Returns a partial patch replacing the active frame's quickadds. */
function withQuickadds(state: StratState, quickadds: QuickAdd[]): Partial<StratState> {
  const idx = state.activeFrameIdx;
  const nextFrames = state.frames.map((f, i): Frame =>
    i === idx ? { ...f, quickadds } : f,
  );
  return { frames: nextFrames };
}

/** Returns a partial patch replacing the active frame's textboxes. */
function withTextboxes(state: StratState, textboxes: TextBox[]): Partial<StratState> {
  const idx = state.activeFrameIdx;
  const nextFrames = state.frames.map((f, i): Frame =>
    i === idx ? { ...f, textboxes } : f,
  );
  return { frames: nextFrames };
}

/** Returns a partial patch replacing the active frame's scanner. */
function withScanner(
  state: StratState,
  scanner: import('../types/primitives').ScannerPlacement | null,
): Partial<StratState> {
  const idx = state.activeFrameIdx;
  const nextFrames = state.frames.map((f, i): Frame =>
    i === idx ? { ...f, scanner } : f,
  );
  return { frames: nextFrames };
}

/**
 * After moving frames[from] -> to, return the new index of an item that was
 * originally at `prevIdx`. Used to chase activeFrameIdx through reorders.
 */
function reorderedIndex(prevIdx: number, from: number, to: number): number {
  if (prevIdx === from) return to;
  if (from < prevIdx && to >= prevIdx) return prevIdx - 1;
  if (from > prevIdx && to <= prevIdx) return prevIdx + 1;
  return prevIdx;
}

/**
 * Copy a Frame with fresh container arrays (and a fresh `scanner` object) but the
 * same item IDs. Items are treated copy-on-write everywhere, so the shared item
 * references are safe - and stable IDs across frames are what the frame-transition
 * diff (app/transitions.ts) keys on, and they keep `Cone.attachedPlayerId`
 * resolving after a duplicate. Used by frame.add.
 */
function copyFrameKeepingIds(f: Frame): Frame {
  return {
    strokes: [...f.strokes],
    shapes: [...f.shapes],
    cones: [...f.cones],
    players: [...f.players],
    textboxes: [...f.textboxes],
    quickadds: [...f.quickadds],
    scanner: f.scanner ? { ...f.scanner } : null,
    ...(f.durationMs !== undefined ? { durationMs: f.durationMs } : {}),
  };
}

/**
 * Snapshot the full per-map view+frame slice as a `map._restore` command. Used
 * as the inverse for both `map.select` and `map._restore` itself - it round-trips
 * symmetrically, the same shape as the `frame._switchRestore` pattern.
 */
function mapRestoreSnapshot(state: StratState): Command {
  return {
    t: 'map._restore',
    mapId: state.mapId,
    frames: state.frames,
    activeFrameIdx: state.activeFrameIdx,
    zoom: state.zoom,
    panX: state.panX,
    panY: state.panY,
    mapFrames: state.mapFrames ?? {},
    selection: state.selection,
  };
}

/**
 * Compute the inverse of a command given current state, without mutating the store.
 * Exported so history can capture inverses at dispatch time.
 */
export function invert(state: StratState, cmd: Command): Command {
  switch (cmd.t) {
    case 'tool.set':
      return { t: 'tool.set', tool: state.tool };
    case 'map.select':
      // Re-selecting the active map is a no-op; otherwise the inverse is the full
      // prior slice (map + frames + view + the rest of the mapFrames stash).
      return cmd.mapId === state.mapId
        ? { t: 'map.select', mapId: state.mapId }
        : mapRestoreSnapshot(state);
    case 'map._restore':
      return mapRestoreSnapshot(state);
    case 'view.zoom':
      return { t: 'view.zoom', zoom: state.zoom };
    case 'view.pan':
      return { t: 'view.pan', panX: state.panX, panY: state.panY };
    case 'stroke.add':
      return { t: 'stroke.erase', ids: [cmd.stroke.id] };
    case 'stroke.erase': {
      const frame = state.frames[state.activeFrameIdx]!;
      const removed = frame.strokes.filter((s) => cmd.ids.includes(s.id));
      if (removed.length === 0) {
        throw new Error(`stroke.erase: no strokes matched ids=${cmd.ids.join(',')}`);
      }
      if (removed.length === 1) return { t: 'stroke.add', stroke: removed[0]! };
      return { t: 'stroke.addMany', strokes: removed };
    }
    case 'stroke.addMany':
      return { t: 'stroke.erase', ids: cmd.strokes.map((s) => s.id) };
    case 'stroke.modify': {
      const frame = state.frames[state.activeFrameIdx]!;
      if (!frame.strokes.some((s) => s.id === cmd.id)) {
        throw new Error(`stroke.modify: no stroke with id=${cmd.id}`);
      }
      return { t: 'stroke.modify', id: cmd.id, before: cmd.after, after: cmd.before };
    }
    case 'shape.add':
      return { t: 'shape.delete', ids: [cmd.shape.id] };
    case 'shape.addMany':
      return { t: 'shape.delete', ids: cmd.shapes.map((s) => s.id) };
    case 'shape.delete': {
      const frame = state.frames[state.activeFrameIdx]!;
      const removed = frame.shapes.filter((sh) => cmd.ids.includes(sh.id));
      if (removed.length === 0) {
        throw new Error(`shape.delete: no shapes matched ids=${cmd.ids.join(',')}`);
      }
      if (removed.length === 1) return { t: 'shape.add', shape: removed[0]! };
      return { t: 'shape.addMany', shapes: removed };
    }
    case 'shape.modify': {
      const frame = state.frames[state.activeFrameIdx]!;
      if (!frame.shapes.some((sh) => sh.id === cmd.id)) {
        throw new Error(`shape.modify: no shape with id=${cmd.id}`);
      }
      return { t: 'shape.modify', id: cmd.id, before: cmd.after, after: cmd.before };
    }
    case 'cone.add':
      return { t: 'cone.delete', ids: [cmd.cone.id] };
    case 'cone.addMany':
      return { t: 'cone.delete', ids: cmd.cones.map((c) => c.id) };
    case 'cone.delete': {
      const frame = state.frames[state.activeFrameIdx]!;
      const removed = frame.cones.filter((c) => cmd.ids.includes(c.id));
      if (removed.length === 0) {
        throw new Error(`cone.delete: no cones matched ids=${cmd.ids.join(',')}`);
      }
      if (removed.length === 1) return { t: 'cone.add', cone: removed[0]! };
      return { t: 'cone.addMany', cones: removed };
    }
    case 'cone.modify': {
      const frame = state.frames[state.activeFrameIdx]!;
      if (!frame.cones.some((c) => c.id === cmd.id)) {
        throw new Error(`cone.modify: no cone with id=${cmd.id}`);
      }
      return { t: 'cone.modify', id: cmd.id, before: cmd.after, after: cmd.before };
    }
    case 'player.add':
      return { t: 'player.delete', ids: [cmd.player.id] };
    case 'player.addMany':
      return { t: 'player.delete', ids: cmd.players.map((p) => p.id) };
    case 'player.delete': {
      const frame = state.frames[state.activeFrameIdx]!;
      const removed = frame.players.filter((p) => cmd.ids.includes(p.id));
      if (removed.length === 0) {
        throw new Error(`player.delete: no players matched ids=${cmd.ids.join(',')}`);
      }
      if (removed.length === 1) return { t: 'player.add', player: removed[0]! };
      return { t: 'player.addMany', players: removed };
    }
    case 'player.modify': {
      const frame = state.frames[state.activeFrameIdx]!;
      if (!frame.players.some((p) => p.id === cmd.id)) {
        throw new Error(`player.modify: no player with id=${cmd.id}`);
      }
      return { t: 'player.modify', id: cmd.id, before: cmd.after, after: cmd.before };
    }
    case 'quickadd.add':
      return { t: 'quickadd.delete', ids: [cmd.qa.id] };
    case 'quickadd.addMany':
      return { t: 'quickadd.delete', ids: cmd.quickadds.map((q) => q.id) };
    case 'quickadd.delete': {
      const frame = state.frames[state.activeFrameIdx]!;
      const removed = frame.quickadds.filter((q) => cmd.ids.includes(q.id));
      if (removed.length === 0) {
        throw new Error(`quickadd.delete: no quickadds matched ids=${cmd.ids.join(',')}`);
      }
      if (removed.length === 1) return { t: 'quickadd.add', qa: removed[0]! };
      return { t: 'quickadd.addMany', quickadds: removed };
    }
    case 'quickadd.modify': {
      const frame = state.frames[state.activeFrameIdx]!;
      if (!frame.quickadds.some((q) => q.id === cmd.id)) {
        throw new Error(`quickadd.modify: no quickadd with id=${cmd.id}`);
      }
      return { t: 'quickadd.modify', id: cmd.id, before: cmd.after, after: cmd.before };
    }
    case 'textbox.add':
      return { t: 'textbox.delete', ids: [cmd.box.id] };
    case 'textbox.addMany':
      return { t: 'textbox.delete', ids: cmd.boxes.map((b) => b.id) };
    case 'textbox.delete': {
      const frame = state.frames[state.activeFrameIdx]!;
      const removed = frame.textboxes.filter((b) => cmd.ids.includes(b.id));
      if (removed.length === 0) {
        throw new Error(`textbox.delete: no textboxes matched ids=${cmd.ids.join(',')}`);
      }
      if (removed.length === 1) return { t: 'textbox.add', box: removed[0]! };
      return { t: 'textbox.addMany', boxes: removed };
    }
    case 'textbox.modify': {
      const frame = state.frames[state.activeFrameIdx]!;
      if (!frame.textboxes.some((b) => b.id === cmd.id)) {
        throw new Error(`textbox.modify: no textbox with id=${cmd.id}`);
      }
      return { t: 'textbox.modify', id: cmd.id, before: cmd.after, after: cmd.before };
    }
    case 'scanner.place': {
      const prev = state.frames[state.activeFrameIdx]!.scanner;
      return { t: 'scanner.place', scanner: prev };
    }
    case 'colour.set':
      return { t: 'colour.set', slot: cmd.slot, before: cmd.after, after: cmd.before };
    case 'frame.setDuration': {
      const f = state.frames[cmd.frameIdx];
      if (!f) throw new Error(`frame.setDuration: no frame at idx=${cmd.frameIdx}`);
      return { t: 'frame.setDuration', frameIdx: cmd.frameIdx, durationMs: f.durationMs };
    }
    case 'frame.setCaption': {
      const f = state.frames[cmd.frameIdx];
      if (!f) throw new Error(`frame.setCaption: no frame at idx=${cmd.frameIdx}`);
      return { t: 'frame.setCaption', frameIdx: cmd.frameIdx, caption: f.caption };
    }
    case 'frame.add':
      return { t: 'frame._removeLast', activeFrameIdx: state.activeFrameIdx, selection: state.selection };
    case 'frame._removeLast':
      return { t: 'frame.add' };
    case 'frame.delete': {
      if (state.frames.length <= 1) {
        throw new Error('frame.delete: cannot delete the only frame');
      }
      const removed = state.frames[cmd.idx];
      if (!removed) throw new Error(`frame.delete: no frame at idx=${cmd.idx}`);
      return {
        t: 'frame._restore',
        idx: cmd.idx,
        frame: removed,
        activeFrameIdx: state.activeFrameIdx,
        selection: state.selection,
      };
    }
    case 'frame._restore':
      return { t: 'frame.delete', idx: cmd.idx };
    case 'frame.reorder':
      return { t: 'frame.reorder', from: cmd.to, to: cmd.from };
    case 'frame.switch':
      return { t: 'frame._switchRestore', idx: state.activeFrameIdx, selection: state.selection };
    case 'frame._switchRestore':
      return { t: 'frame.switch', idx: state.activeFrameIdx };
    case 'frame.clear':
      return {
        t: 'frame._clearRestore',
        idx: state.activeFrameIdx,
        frame: cmd.before,
        selection: state.selection,
      };
    case 'frame._clearRestore':
      return {
        t: 'frame.clear',
        before: state.frames[cmd.idx]!,
      };
    case 'notes.set':
      return { t: 'notes.set', notes: state.notes };
    case 'callouts.toggle':
      return { t: 'callouts.toggle', visible: !cmd.visible };
    case 'batch':
      throw new Error(
        'invert(batch): not supported - batch inverses are computed during apply()',
      );
    default:
      throw new Error(`invert: unhandled command ${(cmd as Command).t}`);
  }
}

/** Apply a command, returning its inverse. */
export function apply(store: Store, cmd: Command): Command {
  // batch needs special handling: each child is applied through apply() so its
  // inverse can be computed against the intermediate state, then collected in
  // reverse for the batch inverse. We do NOT call invert(state, batch) - there
  // is no useful state to invert against until after the children have run.
  if (cmd.t === 'batch') {
    const childInvs: Command[] = [];
    try {
      for (const child of cmd.cmds) {
        childInvs.push(apply(store, child));
      }
    } catch (err) {
      // Roll back the children that did land, or they'd stick with no undo entry.
      for (let i = childInvs.length - 1; i >= 0; i--) apply(store, childInvs[i]!);
      throw err;
    }
    return { t: 'batch', cmds: childInvs.reverse() };
  }

  const state = store.get();

  const inv = invert(state, cmd);

  switch (cmd.t) {
    case 'tool.set':
      store._apply({ tool: cmd.tool });
      break;
    case 'map.select': {
      if (cmd.mapId === state.mapId) break; // re-selecting the active map: nothing changes
      const prevMapFrames: NonNullable<StratState['mapFrames']> = state.mapFrames ?? {};
      // Pull the incoming map's stashed frames back out (or one empty frame the
      // first time it's visited); stash the outgoing map's frames in its place.
      // The active map's frames always live top-level, so drop the incoming entry.
      const incoming = prevMapFrames[cmd.mapId];
      const restored = incoming ?? { frames: [emptyFrame()], activeFrameIdx: 0 };
      const nextMapFrames: NonNullable<StratState['mapFrames']> = { ...prevMapFrames };
      nextMapFrames[state.mapId] = { frames: state.frames, activeFrameIdx: state.activeFrameIdx };
      delete nextMapFrames[cmd.mapId];
      store._apply({
        mapId: cmd.mapId,
        frames: restored.frames,
        activeFrameIdx: restored.activeFrameIdx,
        mapFrames: nextMapFrames,
        zoom: getMapSwitchZoom(),
        panX: 0,
        panY: 0,
        selection: [],
      });
      break;
    }
    case 'map._restore': {
      store._apply({
        mapId: cmd.mapId,
        frames: cmd.frames,
        activeFrameIdx: cmd.activeFrameIdx,
        mapFrames: cmd.mapFrames,
        zoom: cmd.zoom,
        panX: cmd.panX,
        panY: cmd.panY,
        selection: cmd.selection,
      });
      break;
    }
    case 'view.zoom':
      store._apply({ zoom: cmd.zoom });
      break;
    case 'view.pan':
      store._apply({ panX: cmd.panX, panY: cmd.panY });
      break;
    case 'stroke.add': {
      const frame = state.frames[state.activeFrameIdx]!;
      store._apply(withStrokes(state, [...frame.strokes, cmd.stroke]));
      break;
    }
    case 'stroke.erase': {
      const frame = state.frames[state.activeFrameIdx]!;
      store._apply(
        withStrokes(state, frame.strokes.filter((s) => !cmd.ids.includes(s.id))),
      );
      break;
    }
    case 'stroke.addMany': {
      const frame = state.frames[state.activeFrameIdx]!;
      store._apply(withStrokes(state, [...frame.strokes, ...cmd.strokes]));
      break;
    }
    case 'stroke.modify': {
      const frame = state.frames[state.activeFrameIdx]!;
      const next = frame.strokes.map((s) => s.id === cmd.id ? { ...s, ...cmd.after } : s);
      store._apply(withStrokes(state, next));
      break;
    }
    case 'shape.add': {
      const frame = state.frames[state.activeFrameIdx]!;
      store._apply(withShapes(state, [...frame.shapes, cmd.shape]));
      break;
    }
    case 'shape.addMany': {
      const frame = state.frames[state.activeFrameIdx]!;
      store._apply(withShapes(state, [...frame.shapes, ...cmd.shapes]));
      break;
    }
    case 'shape.delete': {
      const frame = state.frames[state.activeFrameIdx]!;
      store._apply(withShapes(state, frame.shapes.filter((sh) => !cmd.ids.includes(sh.id))));
      break;
    }
    case 'shape.modify': {
      const frame = state.frames[state.activeFrameIdx]!;
      const next = frame.shapes.map((sh) => sh.id === cmd.id ? { ...sh, ...cmd.after } : sh);
      store._apply(withShapes(state, next));
      break;
    }
    case 'cone.add': {
      const frame = state.frames[state.activeFrameIdx]!;
      store._apply(withCones(state, [...frame.cones, cmd.cone]));
      break;
    }
    case 'cone.addMany': {
      const frame = state.frames[state.activeFrameIdx]!;
      store._apply(withCones(state, [...frame.cones, ...cmd.cones]));
      break;
    }
    case 'cone.delete': {
      const frame = state.frames[state.activeFrameIdx]!;
      store._apply(withCones(state, frame.cones.filter((c) => !cmd.ids.includes(c.id))));
      break;
    }
    case 'cone.modify': {
      const frame = state.frames[state.activeFrameIdx]!;
      const next = frame.cones.map((c) => c.id === cmd.id ? { ...c, ...cmd.after } : c);
      store._apply(withCones(state, next));
      break;
    }
    case 'player.add': {
      const frame = state.frames[state.activeFrameIdx]!;
      store._apply(withPlayers(state, [...frame.players, cmd.player]));
      break;
    }
    case 'player.addMany': {
      const frame = state.frames[state.activeFrameIdx]!;
      store._apply(withPlayers(state, [...frame.players, ...cmd.players]));
      break;
    }
    case 'player.delete': {
      const frame = state.frames[state.activeFrameIdx]!;
      store._apply(withPlayers(state, frame.players.filter((p) => !cmd.ids.includes(p.id))));
      break;
    }
    case 'player.modify': {
      const frame = state.frames[state.activeFrameIdx]!;
      const next = frame.players.map((p) => p.id === cmd.id ? { ...p, ...cmd.after } : p);
      store._apply(withPlayers(state, next));
      break;
    }
    case 'quickadd.add': {
      const frame = state.frames[state.activeFrameIdx]!;
      store._apply(withQuickadds(state, [...frame.quickadds, cmd.qa]));
      break;
    }
    case 'quickadd.addMany': {
      const frame = state.frames[state.activeFrameIdx]!;
      store._apply(withQuickadds(state, [...frame.quickadds, ...cmd.quickadds]));
      break;
    }
    case 'quickadd.delete': {
      const frame = state.frames[state.activeFrameIdx]!;
      store._apply(withQuickadds(state, frame.quickadds.filter((q) => !cmd.ids.includes(q.id))));
      break;
    }
    case 'quickadd.modify': {
      const frame = state.frames[state.activeFrameIdx]!;
      const next = frame.quickadds.map((q) => q.id === cmd.id ? { ...q, ...cmd.after } : q);
      store._apply(withQuickadds(state, next));
      break;
    }
    case 'textbox.add': {
      const frame = state.frames[state.activeFrameIdx]!;
      store._apply(withTextboxes(state, [...frame.textboxes, cmd.box]));
      break;
    }
    case 'textbox.addMany': {
      const frame = state.frames[state.activeFrameIdx]!;
      store._apply(withTextboxes(state, [...frame.textboxes, ...cmd.boxes]));
      break;
    }
    case 'textbox.delete': {
      const frame = state.frames[state.activeFrameIdx]!;
      store._apply(withTextboxes(state, frame.textboxes.filter((b) => !cmd.ids.includes(b.id))));
      break;
    }
    case 'textbox.modify': {
      const frame = state.frames[state.activeFrameIdx]!;
      const next = frame.textboxes.map((b) => b.id === cmd.id ? { ...b, ...cmd.after } : b);
      store._apply(withTextboxes(state, next));
      break;
    }
    case 'scanner.place': {
      store._apply(withScanner(state, cmd.scanner));
      break;
    }
    case 'colour.set': {
      const next: (Hex | null)[] = [...state.colourSlots];
      next[cmd.slot] = cmd.after;
      store._apply({ colourSlots: next });
      break;
    }
    case 'frame.setDuration': {
      if (cmd.frameIdx < 0 || cmd.frameIdx >= state.frames.length) {
        throw new Error(`frame.setDuration: idx ${cmd.frameIdx} out of bounds`);
      }
      const nextFrames: Frame[] = state.frames.map((f, i): Frame => {
        if (i !== cmd.frameIdx) return f;
        const { durationMs: _omit, ...rest } = f;
        return cmd.durationMs === undefined ? rest : { ...rest, durationMs: cmd.durationMs };
      });
      store._apply({ frames: nextFrames });
      break;
    }
    case 'frame.setCaption': {
      if (cmd.frameIdx < 0 || cmd.frameIdx >= state.frames.length) {
        throw new Error(`frame.setCaption: idx ${cmd.frameIdx} out of bounds`);
      }
      const nextFrames: Frame[] = state.frames.map((f, i): Frame => {
        if (i !== cmd.frameIdx) return f;
        const { caption: _omit, ...rest } = f;
        return cmd.caption === undefined || cmd.caption === ''
          ? rest
          : { ...rest, caption: cmd.caption };
      });
      store._apply({ frames: nextFrames });
      break;
    }
    case 'frame.add': {
      const last = state.frames[state.frames.length - 1]!;
      const next: Frame[] = [...state.frames, copyFrameKeepingIds(last)];
      store._apply({ frames: next, activeFrameIdx: next.length - 1, selection: [] });
      break;
    }
    case 'frame._removeLast': {
      store._apply({
        frames: state.frames.slice(0, -1),
        activeFrameIdx: cmd.activeFrameIdx,
        selection: cmd.selection,
      });
      break;
    }
    case 'frame.delete': {
      if (state.frames.length <= 1) {
        throw new Error('frame.delete: cannot delete the only frame');
      }
      const nextFrames: Frame[] = state.frames.filter((_, i) => i !== cmd.idx);
      const wasActive = state.activeFrameIdx === cmd.idx;
      let nextActive = state.activeFrameIdx;
      if (cmd.idx <= state.activeFrameIdx) {
        nextActive = Math.max(0, state.activeFrameIdx - 1);
      }
      const patch: Partial<StratState> = { frames: nextFrames, activeFrameIdx: nextActive };
      if (wasActive) patch.selection = [];
      store._apply(patch);
      break;
    }
    case 'frame._restore': {
      const nextFrames: Frame[] = [
        ...state.frames.slice(0, cmd.idx),
        cmd.frame,
        ...state.frames.slice(cmd.idx),
      ];
      store._apply({
        frames: nextFrames,
        activeFrameIdx: cmd.activeFrameIdx,
        selection: cmd.selection,
      });
      break;
    }
    case 'frame.reorder': {
      const n = state.frames.length;
      if (cmd.from < 0 || cmd.from >= n || cmd.to < 0 || cmd.to >= n) {
        throw new Error(`frame.reorder: ${cmd.from} -> ${cmd.to} out of bounds (frames=${n})`);
      }
      const moved = state.frames[cmd.from]!;
      const without: Frame[] = state.frames.filter((_, i) => i !== cmd.from);
      const next: Frame[] = [...without.slice(0, cmd.to), moved, ...without.slice(cmd.to)];
      const nextActive = reorderedIndex(state.activeFrameIdx, cmd.from, cmd.to);
      store._apply({ frames: next, activeFrameIdx: nextActive });
      break;
    }
    case 'frame.switch': {
      if (cmd.idx < 0 || cmd.idx >= state.frames.length) {
        throw new Error(`frame.switch: idx ${cmd.idx} out of bounds (frames=${state.frames.length})`);
      }
      store._apply({ activeFrameIdx: cmd.idx, selection: [] });
      break;
    }
    case 'frame._switchRestore': {
      store._apply({ activeFrameIdx: cmd.idx, selection: cmd.selection });
      break;
    }
    case 'frame.clear': {
      const idx = state.activeFrameIdx;
      const nextFrames: Frame[] = state.frames.map((f, i) => i === idx ? emptyFrame() : f);
      store._apply({ frames: nextFrames, selection: [] });
      break;
    }
    case 'frame._clearRestore': {
      const nextFrames: Frame[] = state.frames.map((f, i) => i === cmd.idx ? cmd.frame : f);
      store._apply({ frames: nextFrames, selection: cmd.selection });
      break;
    }
    case 'notes.set':
      store._apply({ notes: cmd.notes });
      break;
    case 'callouts.toggle': {
      const ui = state.ui;
      store._apply({ ui: { ...ui, calloutsVisible: cmd.visible } });
      break;
    }
    default:
      throw new Error(`apply: unhandled command ${(cmd as Command).t}`);
  }
  return inv;
}
