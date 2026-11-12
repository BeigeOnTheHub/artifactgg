import '../styles/canvas-hint.css';
import type { Store } from '../app/store';

const SEEN_KEY = 'artifact.canvas-hint-seen';

function readSeen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}
function writeSeen(): void {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
}

/**
 * A ghost nudge near the top of the map while the active frame is empty, for
 * first-timers who skipped the tour. Hides once anything is placed; the x
 * dismisses it for good (persisted). pointer-events:none on the body so it
 * never blocks drawing, only the x is clickable.
 */
export class CanvasHint {
  private el: HTMLDivElement;
  private unsub: () => void = () => {};
  private dismissed: boolean;

  constructor(private host: HTMLElement, private store: Store) {
    this.dismissed = readSeen();
    this.el = document.createElement('div');
    this.el.className = 'canvas-hint';
    this.el.hidden = true;

    const text = document.createElement('span');
    text.className = 'canvas-hint-text';
    text.textContent = 'Pick a tool and draw on the map to start.';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'canvas-hint-close';
    close.setAttribute('aria-label', 'Dismiss hint');
    close.textContent = '×';
    // The hint sits over the canvas, so the active tool's pointerdown handler
    // grabs the pointer (setPointerCapture) and reroutes the synthesized click
    // away from this button -- which is why tapping the × did nothing. Swallow
    // the pointer events here so they never reach the tool. Same fix
    // ViewerActions/DiscordLink already use.
    const swallow = (e: Event): void => e.stopPropagation();
    close.addEventListener('pointerdown', swallow);
    close.addEventListener('pointerup', swallow);
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismissed = true;
      writeSeen();
      this.render();
    });

    this.el.appendChild(text);
    this.el.appendChild(close);
  }

  mount(): void {
    this.host.appendChild(this.el);
    this.render();
    this.unsub = this.store.subscribe(['frames', 'activeFrameIdx'], () => this.render());
  }

  destroy(): void {
    this.unsub();
    this.el.remove();
  }

  private render(): void {
    // First node placed (or booted with content): retire the hint for good,
    // same as clicking the x. Otherwise deleting everything brings it back.
    if (!this.dismissed && !this.isActiveFrameEmpty()) {
      this.dismissed = true;
      writeSeen();
    }
    this.el.hidden = this.dismissed || !this.isActiveFrameEmpty();
  }

  private isActiveFrameEmpty(): boolean {
    const s = this.store.get();
    const f = s.frames[s.activeFrameIdx];
    if (!f) return false;
    return (
      f.strokes.length === 0 &&
      f.shapes.length === 0 &&
      f.cones.length === 0 &&
      f.players.length === 0 &&
      f.textboxes.length === 0 &&
      f.quickadds.length === 0 &&
      f.scanner == null
    );
  }
}
