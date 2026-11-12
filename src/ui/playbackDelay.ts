/**
 * The playback-delay stepper: a number input plus its "s" unit.
 *
 * Shared by `FrameTimeline.renderActions()` and the compact View sheet. On a
 * phone the strip has no room (the actions cluster is 224px on a 390px screen),
 * so CSS hides the strip's copy in compact and the sheet shows one instead.
 * Two live instances is fine: only one is visible per layout and the sheet
 * rebuilds on every open, so neither shows a stale number.
 */

/** Just the part of PlaybackController this control touches. */
export interface DelayTarget {
  delayMs: number;
  setDelay(ms: number): void;
}

export interface PlaybackDelayHandle {
  el: HTMLElement;
  destroy: () => void;
}

export function buildPlaybackDelay(playback: DelayTarget): PlaybackDelayHandle {
  const wrap = document.createElement('div');
  wrap.className = 'frame-timeline-delay-wrap';

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'frame-timeline-delay';
  input.min = '0';
  input.max = '10';
  input.step = '0.5';
  input.value = (playback.delayMs / 1000).toFixed(1);
  input.title = 'Pause between frames during playback (seconds)';
  input.setAttribute('aria-label', 'Playback delay in seconds');

  const onChange = (): void => {
    const secs = Number(input.value);
    // Blank or junk: leave the stored delay alone. Either way re-show delayMs,
    // so a clamped value corrects the field rather than lying about it.
    if (input.value.trim() !== '' && Number.isFinite(secs)) playback.setDelay(secs * 1000);
    input.value = (playback.delayMs / 1000).toFixed(1);
  };
  input.addEventListener('change', onChange);

  const unit = document.createElement('span');
  unit.className = 'frame-timeline-delay-unit';
  unit.textContent = 's';

  wrap.append(input, unit);
  return {
    el: wrap,
    destroy: () => {
      input.removeEventListener('change', onChange);
      wrap.remove();
    },
  };
}
