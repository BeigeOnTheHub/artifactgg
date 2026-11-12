import type { Team } from '../types/primitives';
import { hex, type Hex } from '../types/hex';

/**
 * The two faction colours, used by the player layer, the cone layer (for
 * cones attached to a player) and the player legend. Single source so they
 * never drift apart.
 */
export const TEAM_COLOURS: Record<Team, Hex> = {
  colonist: hex('#ff4444'),
  reyab: hex('#00ccee'),
};
