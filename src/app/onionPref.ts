const KEY = 'artifact-gg.v2.onion';
const listeners = new Set<(on: boolean) => void>();

function read(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
let state = read();

export function isOnionOn(): boolean { return state; }

export function setOnion(on: boolean): void {
  if (on === state) return;
  state = on;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignore */ }
  for (const cb of [...listeners]) cb(on);
}

export function subscribeOnion(cb: (on: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
