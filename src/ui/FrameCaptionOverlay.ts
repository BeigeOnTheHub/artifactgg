import '../styles/frame-caption-overlay.css';
import type { Store } from '../app/store';
import type { PlaybackController } from '../app/playback';

/**
 * Bottom-of-viewer HUD showing the active frame's caption during playback.
 * Hidden when not playing or the frame has no caption. pointer-events: none so
 * it never steals map clicks. aria-live="polite" so screen readers hear captions
 * as playback advances.
 */
export class FrameCaptionOverlay {
  private el: HTMLDivElement;
  private unsub: () => void = () => {};
  private unsubPlay: () => void = () => {};

  constructor(
    private host: HTMLElement,
    private store: Store,
    private playback: PlaybackController,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'frame-caption-overlay';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.setAttribute('aria-atomic', 'true');
    this.el.hidden = true;
  }

  mount(): void {
    this.host.appendChild(this.el);
    this.render();
    this.unsub = this.store.subscribe(['frames', 'activeFrameIdx'], () => this.render());
    this.unsubPlay = this.playback.onChange(() => this.render());
  }

  destroy(): void {
    this.unsub();
    this.unsubPlay();
    this.el.remove();
  }

  private render(): void {
    const state = this.store.get();
    const frame = state.frames[state.activeFrameIdx];
    const caption = frame?.caption;
    const visible = this.playback.isPlaying() && caption != null && caption !== '';
    if (!visible) {
      this.el.hidden = true;
      // Clearing the text prevents a screen reader from re-announcing the
      // last caption when the live region toggles back on for a different
      // frame that happens to share the same text.
      this.el.textContent = '';
      return;
    }
    if (this.el.textContent !== caption) this.el.textContent = caption;
    this.el.hidden = false;
  }
}
