import type { Frame } from './primitives';
import type { MapId } from './maps';

/**
 * Versioned strat file format. Schema-stable; mutations to this interface
 * MUST come with a v-bump and a migration path in `app/persistence.ts`.
 */
export interface StratFile {
  v: 2;
  map: MapId;
  notes: string;
  view: { zoom: number; panX: number; panY: number };
  frames: Frame[];
  activeFrame: number;
}
