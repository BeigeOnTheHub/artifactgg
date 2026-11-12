import { describe, it, expect, vi } from 'vitest';
import { buildPlaybackDelay, type DelayTarget } from './playbackDelay';

/** Just the two members the builder touches, so the test needs no real
 *  PlaybackController (which owns a rAF loop and localStorage). */
function fakePlayback(delayMs = 1000): DelayTarget & { setDelay: ReturnType<typeof vi.fn> } {
  return {
    delayMs,
    setDelay: vi.fn(function (this: { delayMs: number }, ms: number) { this.delayMs = ms; }),
  };
}

describe('buildPlaybackDelay', () => {
  it('shows the current delay in seconds', () => {
    const { el } = buildPlaybackDelay(fakePlayback(1500));
    expect((el.querySelector('input') as HTMLInputElement).value).toBe('1.5');
  });

  it('writes a changed value through setDelay, in ms', () => {
    const p = fakePlayback(1000);
    const { el } = buildPlaybackDelay(p);
    const input = el.querySelector('input') as HTMLInputElement;
    input.value = '2.5';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(p.setDelay).toHaveBeenCalledWith(2500);
  });

  it('ignores a non-numeric entry and re-shows the live value', () => {
    const p = fakePlayback(1000);
    const { el } = buildPlaybackDelay(p);
    const input = el.querySelector('input') as HTMLInputElement;
    input.value = 'abc';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(p.setDelay).not.toHaveBeenCalled();
    expect(input.value).toBe('1.0');
  });

  it('re-shows the clamped value when the controller clamps it', () => {
    // setDelay clamps; the field must show what actually took effect, not what
    // was typed.
    const p = fakePlayback(1000);
    p.setDelay = vi.fn(function (this: { delayMs: number }) { this.delayMs = 10_000; });
    const { el } = buildPlaybackDelay(p);
    const input = el.querySelector('input') as HTMLInputElement;
    input.value = '99';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(input.value).toBe('10.0');
  });

  it('keeps the accessible name and the seconds unit', () => {
    const { el } = buildPlaybackDelay(fakePlayback());
    const input = el.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBe('Playback delay in seconds');
    expect(el.querySelector('.frame-timeline-delay-unit')?.textContent).toBe('s');
  });
});
