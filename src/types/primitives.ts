import type { Hex } from './hex';

export type ToolId =
  | 'cursor'
  | 'select'
  | 'lasso'
  | 'draw'
  | 'erase'
  | 'place-player'
  | 'place-cone'
  | 'shapes'
  | 'place-text'
  | 'place-quickadd'
  | 'place-scanner';

export type Team = 'colonist' | 'reyab';

export interface Point {
  x: number;
  y: number;
}

export type DashStyle = 'solid' | 'dashed' | 'dotted';
export const DASH_STYLES: readonly DashStyle[] = ['solid', 'dashed', 'dotted'];

export interface Stroke {
  id: string;
  type: 'draw' | 'erase';
  color: Hex;
  alpha: number;
  size: number;
  points: Point[];
  // optional so old saves/links still load - absent means solid, which keeps
  // the .strat format at v2 (no version bump needed).
  dash?: DashStyle;
}

export type ShapeKind = 'square' | 'circle' | 'triangle' | 'line' | 'arrow';

export interface Shape {
  id: string;
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  stroke: Hex;
  strokeWidth: number;
  fill: boolean;
}

export interface Cone {
  id: string;
  x: number;
  y: number;
  angle: number;
  length: number;
  spreadIdx: 0 | 1 | 2;
  customHalfAngle: number | null;
  /** Free-standing colour. Used when `attachedPlayerId` is null; on attached
   *  cones the player's team colour is drawn instead (see
   *  `coneEffectiveColour`) and this stored value isn't read. Allowed to be
   *  null only when attached -- free cones must carry a colour. The invariant
   *  is asserted in `freeConeColor`. */
  color: Hex | null;
  /** When set, the cone's origin tracks this player and it takes the player's
   *  team colour. Null = a free-standing cone at (x, y) with its own colour. */
  attachedPlayerId: string | null;
}

/** Read the freestanding colour off a cone, asserting the invariant that any
 *  cone with `attachedPlayerId === null` has a non-null `color`. Use this
 *  anywhere the caller has narrowed to a free-standing cone and needs a Hex. */
export function freeConeColor(c: Cone): Hex {
  if (c.color == null) {
    throw new Error(`Cone ${c.id} is free-standing but has no colour`);
  }
  return c.color;
}

export interface Player {
  id: string;
  team: Team;
  x: number;
  y: number;
  name: string;
  dead: boolean;
}

export interface TextBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fontSize: number;
  color: Hex;
}

export type QuickAddType =
  | 'grenade'
  | 'impact_grenade'
  | 'smoke'
  | 'flash'
  | 'thermite'
  | 'vortex_mine'
  | 'scanner';

export interface QuickAdd {
  id: string;
  type: QuickAddType;
  x: number;
  y: number;
  rangeVisible: boolean;
}

export interface ScannerPlacement {
  x: number;
  y: number;
}

export type SelectionRef =
  | { kind: 'stroke'; id: string }
  | { kind: 'shape'; id: string }
  | { kind: 'cone'; id: string }
  | { kind: 'player'; id: string }
  | { kind: 'textbox'; id: string }
  | { kind: 'quickadd'; id: string }
  | { kind: 'scanner'; id: string };

export interface Frame {
  strokes: Stroke[];
  shapes: Shape[];
  cones: Cone[];
  players: Player[];
  textboxes: TextBox[];
  quickadds: QuickAdd[];
  scanner: ScannerPlacement | null;
  /** Optional per-frame hold time (ms) for Play + GIF export. Unset = use
   *  the global play-delay. Absent on every pre-2026-05 save (back-compat). */
  durationMs?: number;
  /** Optional short text caption (~200 chars) displayed as a HUD overlay
   *  during playback. Edited inline on the timeline card. Absent on every
   *  save before this field landed (back-compat). */
  caption?: string;
}

export function emptyFrame(): Frame {
  return {
    strokes: [],
    shapes: [],
    cones: [],
    players: [],
    textboxes: [],
    quickadds: [],
    scanner: null,
  };
}
