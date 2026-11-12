import type { Store } from './store';
import type { Frame, Player } from '../types/primitives';

/** Per-item visual effect applied during a frame transition. Absent id = opacity 1, no flash. */
export interface ItemEffect { opacity: number; flash: 'in' | 'out' | null }
export type ItemEffects = ReadonlyMap<string, ItemEffect>;
const NO_EFFECTS: ItemEffects = new Map();

/**
 * What a render layer should draw "right now". When idle this is just the live
 * active frame; during a frame transition (see TransitionController) it's an
 * interpolated frame - moved items at lerped positions, deleted items carried
 * over at their old positions - plus an `effects` map for fade/flash.
 */
export interface FrameView {
  getView(): { frame: Frame; effects: ItemEffects };
  /** Fires once per transition tick, plus once on every non-transition frame
   *  change (settle). Returns an unsubscribe fn. */
  subscribe(cb: () => void): () => void;
}

/** Trivial pass-through FrameView - instant updates, never any effects. Used by
 *  layers in unit tests, and as the fallback when no controller is wired. */
export function directFrameView(store: Store): FrameView {
  return {
    getView: () => ({ frame: store.get().frames[store.get().activeFrameIdx]!, effects: NO_EFFECTS }),
    subscribe: (cb) => store.subscribe(['frames', 'activeFrameIdx'], () => cb()),
  };
}

/** Apply an ItemEffect to an element: inline opacity + a flash class. */
export function applyItemEffect(el: HTMLElement | SVGElement, fx: ItemEffect | undefined): void {
  (el as HTMLElement).style.opacity = fx ? String(fx.opacity) : '';
  el.classList.toggle('frame-flash-in', fx?.flash === 'in');
  el.classList.toggle('frame-flash-out', fx?.flash === 'out');
}

export interface FrameDiff {
  created: Set<string>;
  deleted: Set<string>;
  moved: Set<string>;
  /**
   * `Map<toFrameItemId, fromFrameItemId>`. Players only: the same (team, number)
   * with different ids in the two frames (a freshly placed node) is treated as
   * a moved player, lerped rather than faded. `moved` and rendering use the
   * destination id; this just tells `interpolate()` where the source geometry is.
   */
  aliases: Map<string, string>;
}

/** Geometry fields (per item collection) that, if any differ between from/to, mark
 *  an item "moved" and get lerped during the tween. */
const GEOM = {
  players: ['x', 'y'],
  cones: ['x', 'y', 'angle', 'length'],
  shapes: ['x', 'y', 'w', 'h', 'rotation'],
  quickadds: ['x', 'y'],
  textboxes: ['x', 'y', 'w', 'h'],
} as const;
export type AnimCollection = keyof typeof GEOM;
export const ANIM_COLLECTIONS: AnimCollection[] = ['players', 'cones', 'shapes', 'quickadds', 'textboxes'];
export const ANIM_GEOM = GEOM;

function geomEqual(a: Record<string, unknown>, b: Record<string, unknown>, fields: readonly string[]): boolean {
  for (const f of fields) if (a[f] !== b[f]) return false;
  return true;
}

export function diffFrames(from: Frame, to: Frame): FrameDiff {
  const created = new Set<string>();
  const deleted = new Set<string>();
  const moved = new Set<string>();
  const aliases = new Map<string, string>();
  for (const coll of ANIM_COLLECTIONS) {
    const fromById = new Map((from[coll] as { id: string }[]).map((it) => [it.id, it]));
    const toById = new Map((to[coll] as { id: string }[]).map((it) => [it.id, it]));
    for (const [id, toIt] of toById) {
      const fromIt = fromById.get(id);
      if (!fromIt) created.add(id);
      else if (!geomEqual(fromIt as never, toIt as never, GEOM[coll])) moved.add(id);
    }
    for (const id of fromById.keys()) if (!toById.has(id)) deleted.add(id);
  }
  // Player identity alias pass. After the per-id matching above, any leftover
  // created/deleted players that share a (team, per-team number) get paired
  // up so the transition treats them as a single moved instance. Lets the
  // user place colonist #1 separately in two adjacent frames and still see
  // the smooth ease-out move instead of a fade-out + fade-in pair.
  pairPlayersByTeamNumber(from.players, to.players, created, deleted, moved, aliases);
  // scanner singleton, keyed by the literal 'scanner'
  const fs = from.scanner, ts = to.scanner;
  if (fs && !ts) deleted.add('scanner');
  else if (!fs && ts) created.add('scanner');
  else if (fs && ts && (fs.x !== ts.x || fs.y !== ts.y)) moved.add('scanner');
  // strokes: presence only (no move tween)
  const fromStrokeIds = new Set(from.strokes.map((s) => s.id));
  const toStrokeIds = new Set(to.strokes.map((s) => s.id));
  for (const id of toStrokeIds) if (!fromStrokeIds.has(id)) created.add(id);
  for (const id of fromStrokeIds) if (!toStrokeIds.has(id)) deleted.add(id);
  return { created, deleted, moved, aliases };
}

/** Index `players` by their per-team running number. Mirrors the per-team
 *  numbering PlayerLayer uses for the on-screen badge -- the first colonist
 *  in array order is C1, the second is C2, and so on, independently for the
 *  two teams. Returned key is `"colonist-3"` / `"reyab-1"` etc. */
function indexByTeamNumber(players: Player[]): Map<string, string> {
  const out = new Map<string, string>();
  let nC = 0, nR = 0;
  for (const p of players) {
    if (p.team === 'colonist') { nC++; out.set(`colonist-${nC}`, p.id); }
    else                       { nR++; out.set(`reyab-${nR}`, p.id); }
  }
  return out;
}

function teamNumberKey(player: Player, runningC: { n: number }, runningR: { n: number }): string {
  if (player.team === 'colonist') { runningC.n++; return `colonist-${runningC.n}`; }
  runningR.n++; return `reyab-${runningR.n}`;
}

function pairPlayersByTeamNumber(
  from: Player[], to: Player[],
  created: Set<string>, deleted: Set<string>,
  moved: Set<string>, aliases: Map<string, string>,
): void {
  // Index unmatched-from players by team-number key. We can't use a single
  // `indexByTeamNumber` over the full array because the per-team number
  // depends on every player's array position, not just the unmatched ones --
  // a from player at C3 should match a to player at C3 regardless of how
  // many earlier from players were id-matched and aren't in `deleted`.
  const fromKey = indexByTeamNumber(from);
  const fromUnmatched = new Map<string, string>(); // teamKey -> fromId
  for (const [key, id] of fromKey) if (deleted.has(id)) fromUnmatched.set(key, id);

  // Walk the to-frame in array order to compute each player's team number;
  // a new player at C3 only matches a leftover from-frame player whose
  // team number is also C3.
  const cc = { n: 0 }, cr = { n: 0 };
  for (const p of to) {
    const key = teamNumberKey(p, cc, cr);
    if (!created.has(p.id)) continue; // already matched by id
    const fromId = fromUnmatched.get(key);
    if (!fromId || fromId === p.id) continue;
    // Pair them.
    created.delete(p.id);
    deleted.delete(fromId);
    moved.add(p.id);
    aliases.set(p.id, fromId);
    fromUnmatched.delete(key);
  }
}
