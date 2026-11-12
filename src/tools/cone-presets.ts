// src/tools/cone-presets.ts
import { hex, type Hex } from '../types/hex';

export const SPREAD_PRESETS_DEG = [22.5, 45, 70] as const;
export const SPREAD_PRESET_LABELS: readonly ['NARROW', 'MEDIUM', 'WIDE'] = ['NARROW', 'MEDIUM', 'WIDE'];
export const DEFAULT_CONE_LENGTH = 130;
export const DEFAULT_CONE_SPREAD_IDX = 1; // 45° half-angle

/** Length (sector radius) bounds shared by the cone tool and the reshape drag. */
export const CONE_LENGTH_MIN = 40;
export const CONE_LENGTH_MAX = 400;

/** Fixed colour for a free-standing (unattached) vision cone - a neutral grey
 *  so it reads on the dark map and isn't confused with either team colour. */
export const DEFAULT_CONE_COLOUR: Hex = hex('#aeb6bb');

/** Pointer-vs-handle hit radius (map px) for the origin / arc-tip drag handles. */
export const CONE_HANDLE_HIT_R = 14;

/**
 * Enlarged origin / arc-tip hit radius for the compact touch viewer, in SCREEN
 * px. Divide by the live zoom before comparing it against a map-space distance.
 * It used to be 28 map px, which the overlay scales with the map: on a 390x844
 * phone (fit zoom 0.203) that was a 5.7px radius, so grabbing a cone handle at
 * the default zoom was mostly luck.
 */
export const CONE_HANDLE_TOUCH_SCREEN_PX = 44;

/** How close (map px) a cone's origin must come to a player node to attach. */
export const CONE_ATTACH_THRESHOLD = 28;

/** Half-angle in radians for a cone given its spreadIdx and customHalfAngle override. */
export function halfAngleRad(
  spreadIdx: 0 | 1 | 2,
  customHalfAngle: number | null,
): number {
  if (customHalfAngle !== null) return customHalfAngle;
  return (SPREAD_PRESETS_DEG[spreadIdx] * Math.PI) / 180;
}

/** Clamp a sector length/radius to the allowed range and round to an integer. */
export function clampConeLength(n: number): number {
  return Math.max(CONE_LENGTH_MIN, Math.min(CONE_LENGTH_MAX, Math.round(n)));
}
