// src/tools/quickadd-presets.ts
import type { MapId } from '../types/maps';
import type { QuickAddType } from '../types/primitives';

/** Radii calibrated for the SUNA reference map (1200 px wide). */
export const GRENADE_RADII = { death: 19, damage: 29 } as const;
export const IMPACT_RADII = { death: 16, damage: 21 } as const;
export const FLASH_RADII = { inner: 63, outer: 79 } as const;
export const THERMITE_RADII = { burn: 42 } as const;  // side length in map-px (not a radius)
export const SMOKE_RADII = { cloud: 25 } as const;
export const VORTEX_RADII = { pull: 11 } as const;

export const SCANNER_SIZE = 28;     // px (image dim)
export const REFERENCE_MAP_WIDTH = 1200;
export const V2_MAP_WIDTH = 1920;   // hard-coded in Shell.ts

/** Per-map scale percentage. Suna = 100. */
export const MAP_QUICKADD_SCALE_PCT: Record<MapId, number> = {
  suna: 100, miru: 103, khidi: 74, cliffside: 91, frio: 100, kiiro: 100,
};

/**
 * Combined scale factor: per-map percentage × (actualW / referenceW).
 * Multiply any base radius by this to get the map-pixel radius for the current map.
 */
export function getQuickAddScale(mapId: MapId): number {
  const pct = MAP_QUICKADD_SCALE_PCT[mapId] ?? 100;
  return (pct / 100) * (V2_MAP_WIDTH / REFERENCE_MAP_WIDTH);
}

/** All seven types, in the order the rail will display them. */
export const QUICKADD_TYPES: readonly QuickAddType[] = [
  'grenade', 'impact_grenade', 'smoke', 'flash', 'thermite', 'vortex_mine', 'scanner',
] as const;
