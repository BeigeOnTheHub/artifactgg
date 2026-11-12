import '../styles/transitions.css';
import type { Store } from './store';
import type { Frame } from '../types/primitives';
import type { FrameView, ItemEffect, ItemEffects, AnimCollection } from './frameView';
import { diffFrames, ANIM_COLLECTIONS, ANIM_GEOM, type FrameDiff } from './frameView';

export const FRAME_TRANSITION_MS = 320;

const NO_EFFECTS: ItemEffects = new Map();
const easePos = (t: number): number => 1 - Math.pow(1 - t, 3);          // cubic ease-out
const easeOpacity = (t: number): number => Math.min(1, t * 1.5);        // a touch front-loaded
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

function prefersReducedMotion(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

/** Deep-enough snapshot: new container arrays + new item objects + new scanner - 
 *  so a later mutation of the live store frame can't corrupt the captured one. */
function snapshotFrame(f: Frame): Frame {
  return {
    strokes: f.strokes.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p })) })),
    shapes: f.shapes.map((x) => ({ ...x })),
    cones: f.cones.map((x) => ({ ...x })),
    players: f.players.map((x) => ({ ...x })),
    textboxes: f.textboxes.map((x) => ({ ...x })),
    quickadds: f.quickadds.map((x) => ({ ...x })),
    scanner: f.scanner ? { ...f.scanner } : null,
  };
}

interface ActiveTransition {
  from: Frame;
  to: Frame;
  diff: FrameDiff;
  start: number;
  raf: number;
  gen: number;
}

/**
 * Owns the frame-transition animation. Layers read their frame through this
 * (FrameView): the live frame when idle, an interpolated one plus a per-item
 * fade/flash map mid-transition. Only `frame.switch` starts one (it is the only
 * thing that changes `activeFrameIdx` without replacing `frames`); structural
 * changes and edits settle without animation. A switch mid-animation snaps to
 * the in-flight target first.
 */
export class TransitionController implements FrameView {
  private displayed: Frame;          // snapshot of what's on screen (or being animated toward)
  private prevFramesRef: Frame[];
  private prevActiveIdx: number;
  private current: ActiveTransition | null = null;
  private gen = 0;
  private listeners = new Set<() => void>();
  private idleResolvers: Array<() => void> = [];
  private unsub: () => void;

  constructor(private store: Store) {
    const s = store.get();
    this.displayed = snapshotFrame(s.frames[s.activeFrameIdx]!);
    this.prevFramesRef = s.frames;
    this.prevActiveIdx = s.activeFrameIdx;
    this.unsub = store.subscribe(['frames', 'activeFrameIdx'], () => this.onStoreChange());
  }

  destroy(): void {
    this.unsub();
    if (this.current) cancelAnimationFrame(this.current.raf);
    this.current = null;
    this.listeners.clear();
    // anyone still awaiting whenIdle gets unstuck (e.g. an in-flight gif export)
    this.resolveIdle();
  }

  // ---- FrameView ----

  getView(): { frame: Frame; effects: ItemEffects } {
    const cur = this.current;
    if (!cur) {
      const s = this.store.get();
      return { frame: s.frames[s.activeFrameIdx]!, effects: NO_EFFECTS };
    }
    return this.interpolate(cur, this.progress(cur));
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ---- playback support ----

  isAnimating(): boolean { return this.current !== null; }

  whenIdle(): Promise<void> {
    if (!this.current) return Promise.resolve();
    return new Promise<void>((resolve) => this.idleResolvers.push(resolve));
  }

  // ---- internals ----

  private notify(): void { for (const cb of [...this.listeners]) cb(); }
  private resolveIdle(): void { const r = this.idleResolvers; this.idleResolvers = []; r.forEach((fn) => fn()); }

  private onStoreChange(): void {
    const s = this.store.get();
    const framesChanged = s.frames !== this.prevFramesRef;
    const idxChanged = s.activeFrameIdx !== this.prevActiveIdx;
    this.prevFramesRef = s.frames;
    this.prevActiveIdx = s.activeFrameIdx;

    if (idxChanged && !framesChanged) {
      // A genuine frame.switch (or its undo). Snap any in-flight transition to its
      // target, then start a fresh one from there.
      if (this.current) this.finalizeCurrent(false);
      this.startTransition(snapshotFrame(s.frames[s.activeFrameIdx]!));
      return;
    }
    // Structural / content change (edit, add/delete/reorder/clear, load): abort &
    // settle, no animation.
    if (this.current) this.finalizeCurrent(false);
    this.displayed = snapshotFrame(s.frames[s.activeFrameIdx]!);
    this.notify();
  }

  private startTransition(to: Frame): void {
    const from = this.displayed;
    const diff = diffFrames(from, to);
    this.displayed = to;            // we're now committed to showing `to`
    if (prefersReducedMotion() || (diff.created.size + diff.deleted.size + diff.moved.size) === 0) {
      this.notify();                // nothing to animate - just settle
      return;
    }
    const gen = ++this.gen;
    const t: ActiveTransition = { from, to, diff, start: performance.now(), raf: 0, gen };
    this.current = t;
    const loop = (): void => {
      if (this.current !== t || t.gen !== this.gen) return;
      if (this.progress(t) >= 1) { this.finalizeCurrent(true); return; }
      this.notify();
      t.raf = requestAnimationFrame(loop);
    };
    this.notify();
    t.raf = requestAnimationFrame(loop);
  }

  private progress(t: ActiveTransition): number {
    return Math.max(0, Math.min(1, (performance.now() - t.start) / FRAME_TRANSITION_MS));
  }

  /** Stop the rAF loop, drop the transition. If `notify`, push a settled view.
   *  Either way resolve any whenIdle promises - the running transition genuinely
   *  ended. (Callers that immediately start a new transition pass notify=false
   *  and let that one push the view.) */
  private finalizeCurrent(notify: boolean): void {
    const t = this.current;
    if (!t) return;
    cancelAnimationFrame(t.raf);
    this.current = null;
    if (notify) this.notify();
    this.resolveIdle();
  }

  private interpolate(t: ActiveTransition, p: number): { frame: Frame; effects: ItemEffects } {
    const kPos = easePos(p);
    const kIn = easeOpacity(p);
    const effects = new Map<string, ItemEffect>();
    const out: Frame = {
      strokes: [], shapes: [], cones: [], players: [], textboxes: [], quickadds: [],
      scanner: t.to.scanner ?? t.from.scanner ?? null,
    };
    for (const coll of ANIM_COLLECTIONS as AnimCollection[]) {
      const fromById = new Map((t.from[coll] as { id: string }[]).map((it) => [it.id, it]));
      const arr: { id: string }[] = [];
      for (const toIt of t.to[coll] as { id: string }[]) {
        if (t.diff.created.has(toIt.id)) {
          arr.push(toIt);
          effects.set(toIt.id, { opacity: kIn, flash: 'in' });
        } else if (t.diff.moved.has(toIt.id)) {
          // Honour the diff's alias map -- a player matched across frames
          // by (team, per-team number) keeps the destination id but pulls
          // its source geometry from the from-frame player it was paired
          // with. For collections without aliases this falls back to the
          // direct lookup by id.
          const fromId = t.diff.aliases.get(toIt.id) ?? toIt.id;
          const fromIt = fromById.get(fromId)!;
          const merged: Record<string, unknown> = { ...toIt };
          for (const f of ANIM_GEOM[coll]) merged[f] = lerp((fromIt as never)[f], (toIt as never)[f], kPos);
          arr.push(merged as { id: string });
        } else {
          arr.push(toIt);   // unchanged
        }
      }
      for (const fromIt of t.from[coll] as { id: string }[]) {
        if (t.diff.deleted.has(fromIt.id)) {
          arr.push(fromIt);
          effects.set(fromIt.id, { opacity: 1 - kIn, flash: 'out' });
        }
      }
      (out as unknown as Record<string, unknown>)[coll] = arr;
    }
    // scanner singleton
    if (t.diff.created.has('scanner')) {
      effects.set('scanner', { opacity: kIn, flash: 'in' });
    } else if (t.diff.deleted.has('scanner')) {
      out.scanner = t.from.scanner;
      effects.set('scanner', { opacity: 1 - kIn, flash: 'out' });
    } else if (t.diff.moved.has('scanner') && t.from.scanner && t.to.scanner) {
      out.scanner = { x: lerp(t.from.scanner.x, t.to.scanner.x, kPos), y: lerp(t.from.scanner.y, t.to.scanner.y, kPos) };
    }
    // strokes - presence-only fade; carry deleted ones over
    out.strokes = [...t.to.strokes];
    for (const s of t.to.strokes) { if (t.diff.created.has(s.id)) effects.set(s.id, { opacity: kIn, flash: null }); }
    for (const s of t.from.strokes) {
      if (t.diff.deleted.has(s.id)) { out.strokes.push(s); effects.set(s.id, { opacity: 1 - kIn, flash: null }); }
    }
    return { frame: out, effects };
  }
}
