import type { Store, StratState } from './store';
import type { History } from './history';

const DELAY_KEY = 'artifact.frame-play-delay';
const DEFAULT_DELAY_MS = 1000;
const MIN_DELAY_MS = 0;
const MAX_DELAY_MS = 10_000;

/** The slice of TransitionController playback needs (so it's stubbable in tests). */
export interface PlaybackTransitions {
  whenIdle(): Promise<void>;
  isAnimating(): boolean;
}

function clampDelay(n: number): number { return Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, Math.round(n))); }
function readDelay(): number {
  let raw: string | null = null;
  try { raw = localStorage.getItem(DELAY_KEY); } catch { /* ignore */ }
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? clampDelay(n) : DEFAULT_DELAY_MS;
}

/**
 * Auto-advances the active frame: switch -> wait for the transition -> wait
 * delayMs -> repeat, until the last frame or until toggled off. Frame switches go
 * through history (undoable), same as arrow-key frame nav. A run token guards
 * against stale whenIdle/setTimeout callbacks after a stop or manual nav.
 */
export class PlaybackController {
  delayMs: number = readDelay();
  private playing = false;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private runToken = 0;
  private listeners = new Set<() => void>();

  constructor(private store: Store, private history: History, private transitions: PlaybackTransitions) {}

  destroy(): void { this.clearTimer(); this.listeners.clear(); }

  isPlaying(): boolean { return this.playing; }
  canPlay(s: StratState): boolean { return s.frames.length > 1 && s.activeFrameIdx < s.frames.length - 1; }

  onChange(cb: () => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  private notify(): void { for (const cb of [...this.listeners]) cb(); }

  setDelay(ms: number): void {
    this.delayMs = clampDelay(ms);
    try { localStorage.setItem(DELAY_KEY, String(this.delayMs)); } catch { /* ignore */ }
  }

  toggle(): void {
    if (this.playing) { this.stop(); return; }
    if (!this.canPlay(this.store.get())) return;
    this.playing = true;
    this.notify();
    this.step();
  }

  private stop(): void {
    this.clearTimer();
    this.runToken++;
    if (this.playing) { this.playing = false; this.notify(); }
  }

  private clearTimer(): void { if (this.timeoutId != null) { clearTimeout(this.timeoutId); this.timeoutId = null; } }

  private step(): void {
    if (!this.playing) return;
    const s = this.store.get();
    const next = s.activeFrameIdx + 1;
    if (next >= s.frames.length) { this.stop(); return; }
    const token = ++this.runToken;
    const expectedIdx = next;
    this.history.dispatch({ t: 'frame.switch', idx: next });
    void this.transitions.whenIdle().then(() => {
      if (token !== this.runToken || !this.playing) return;
      const cur = this.store.get();
      // If something else moved the active frame (undo, manual nav), stop.
      if (cur.activeFrameIdx !== expectedIdx) { this.stop(); return; }
      const f = cur.frames[cur.activeFrameIdx];
      const delay = f && typeof f.durationMs === 'number' ? f.durationMs : this.delayMs;
      this.timeoutId = setTimeout(() => {
        this.timeoutId = null;
        if (token !== this.runToken || !this.playing) return;
        if (this.store.get().activeFrameIdx !== expectedIdx) { this.stop(); return; }
        this.step();
      }, delay);
    });
  }
}
