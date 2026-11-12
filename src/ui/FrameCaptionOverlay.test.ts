import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStore, type StratState } from '../app/store';
import { FrameCaptionOverlay } from './FrameCaptionOverlay';
import { emptyFrame, type Frame } from '../types/primitives';
import { hex } from '../types/hex';
import type { PlaybackController } from '../app/playback';

function initial(frames: Frame[] = [emptyFrame()]): StratState {
  return {
    mapId: 'miru', zoom: 1, panX: 0, panY: 0,
    frames, activeFrameIdx: 0,
    notes: '', tool: 'cursor',
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
}

/** Tiny PlaybackController stub -- just the slice the overlay reads. */
class FakePlayback {
  private playing = false;
  private listeners = new Set<() => void>();
  isPlaying(): boolean { return this.playing; }
  onChange(cb: () => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  setPlaying(v: boolean): void { this.playing = v; for (const cb of [...this.listeners]) cb(); }
}

describe('FrameCaptionOverlay', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let playback: FakePlayback;
  let overlay: FrameCaptionOverlay;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    overlay.destroy();
    if (host.parentElement) host.parentElement.removeChild(host);
  });

  function mountWith(state: StratState): void {
    store = createStore(state);
    playback = new FakePlayback();
    overlay = new FrameCaptionOverlay(host, store, playback as unknown as PlaybackController);
    overlay.mount();
  }

  function el(): HTMLElement {
    return host.querySelector('.frame-caption-overlay') as HTMLElement;
  }

  it('mounts hidden by default (not playing, no caption)', () => {
    mountWith(initial());
    expect(el()).not.toBeNull();
    expect(el().hidden).toBe(true);
  });

  it('stays hidden when the frame has a caption but playback is paused', () => {
    const f = emptyFrame();
    f.caption = 'rotate to A site';
    mountWith(initial([f]));
    expect(el().hidden).toBe(true);
  });

  it('stays hidden when playback is running but the frame has no caption', () => {
    mountWith(initial());
    playback.setPlaying(true);
    expect(el().hidden).toBe(true);
  });

  it('shows the caption when playback starts and the frame has one', () => {
    const f = emptyFrame();
    f.caption = 'rotate to A site';
    mountWith(initial([f]));
    playback.setPlaying(true);
    expect(el().hidden).toBe(false);
    expect(el().textContent).toBe('rotate to A site');
  });

  it('updates the caption when the active frame changes mid-playback', () => {
    const f1 = emptyFrame();
    f1.caption = 'first';
    const f2 = emptyFrame();
    f2.caption = 'second';
    mountWith(initial([f1, f2]));
    playback.setPlaying(true);
    expect(el().textContent).toBe('first');
    store._apply({ activeFrameIdx: 1 });
    expect(el().textContent).toBe('second');
  });

  it('hides between frames when the next active frame has no caption', () => {
    const f1 = emptyFrame();
    f1.caption = 'first';
    const f2 = emptyFrame();
    mountWith(initial([f1, f2]));
    playback.setPlaying(true);
    expect(el().hidden).toBe(false);
    store._apply({ activeFrameIdx: 1 });
    expect(el().hidden).toBe(true);
    // The text is wiped so a screen reader doesn't re-announce the prior
    // caption when the live region toggles back on.
    expect(el().textContent).toBe('');
  });

  it('hides when playback stops', () => {
    const f = emptyFrame();
    f.caption = 'something';
    mountWith(initial([f]));
    playback.setPlaying(true);
    expect(el().hidden).toBe(false);
    playback.setPlaying(false);
    expect(el().hidden).toBe(true);
  });

  it('is a polite live region for screen readers', () => {
    mountWith(initial());
    const node = el();
    expect(node.getAttribute('role')).toBe('status');
    expect(node.getAttribute('aria-live')).toBe('polite');
    expect(node.getAttribute('aria-atomic')).toBe('true');
  });
});
