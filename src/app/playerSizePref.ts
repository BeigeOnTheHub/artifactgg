// How player nodes are sized on the map. 'auto' keeps them a fixed, constant
// on-screen size and ignores the slider (greyed out). 'manual' lets them
// grow/shrink with the map zoom like the shapes do, with the factor (slider)
// multiplying that size. Default is auto @ 1 so the board looks the same as it
// always has until someone changes it. Same persist + subscribe shape as
// onionPref / themePref.
export type PlayerSizeMode = 'auto' | 'manual';

const MODE_KEY = 'artifact-gg.v2.playerSizeMode';
const FACTOR_KEY = 'artifact-gg.v2.playerSizeFactor';

export const MIN_PLAYER_FACTOR = 0.5;
export const MAX_PLAYER_FACTOR = 2.5;

const listeners = new Set<() => void>();

function clampFactor(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_PLAYER_FACTOR, Math.max(MIN_PLAYER_FACTOR, n));
}

function readMode(): PlayerSizeMode {
  try { return localStorage.getItem(MODE_KEY) === 'manual' ? 'manual' : 'auto'; } catch { return 'auto'; }
}

function readFactor(): number {
  try {
    const raw = localStorage.getItem(FACTOR_KEY);
    return raw == null ? 1 : clampFactor(parseFloat(raw));
  } catch { return 1; }
}

let mode = readMode();
let factor = readFactor();

export function getPlayerSizeMode(): PlayerSizeMode { return mode; }

export function setPlayerSizeMode(m: PlayerSizeMode): void {
  if (m === mode) return;
  mode = m;
  try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
  for (const cb of [...listeners]) cb();
}

export function getPlayerSizeFactor(): number { return factor; }

export function setPlayerSizeFactor(n: number): void {
  const next = clampFactor(n);
  if (next === factor) return;
  factor = next;
  try { localStorage.setItem(FACTOR_KEY, String(next)); } catch { /* ignore */ }
  for (const cb of [...listeners]) cb();
}

export function subscribePlayerSize(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
