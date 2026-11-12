import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FrameTimeline } from './FrameTimeline';
import type { PlaybackController } from '../app/playback';
import { createStore, type StratState } from '../app/store';
import { createHistory } from '../app/history';
import { emptyFrame } from '../types/primitives';
import { hex } from '../types/hex';
import { isOnionOn, setOnion } from '../app/onionPref';

function initialState(): StratState {
  return {
    mapId: 'miru', zoom: 1, panX: 0, panY: 0,
    frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '', tool: 'cursor',
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'animation', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
}

/** Minimal stand-in for PlaybackController exposing just what FrameTimeline uses. */
function stubPlayback() {
  let playing = false;
  const cbs = new Set<() => void>();
  return {
    delayMs: 1000,
    isPlaying: (): boolean => playing,
    canPlay: (s: { frames: unknown[]; activeFrameIdx: number }): boolean =>
      s.frames.length > 1 && s.activeFrameIdx < s.frames.length - 1,
    onChange: (cb: () => void): (() => void) => { cbs.add(cb); return () => cbs.delete(cb); },
    setDelay: vi.fn(),
    toggle: vi.fn((): void => { playing = !playing; cbs.forEach((c) => c()); }),
  };
}
type StubPlayback = ReturnType<typeof stubPlayback>;
const asController = (p: StubPlayback): PlaybackController => p as unknown as PlaybackController;

describe('FrameTimeline', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let history: ReturnType<typeof createHistory>;
  let playback: StubPlayback;
  let timeline: FrameTimeline;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore(initialState());
    history = createHistory(store);
    playback = stubPlayback();
    timeline = new FrameTimeline(host, store, history, asController(playback));
    timeline.mount();
  });

  afterEach(() => {
    timeline.destroy();
    document.body.removeChild(host);
  });

  it('always mounts a strip element (Frame and Animation modes are merged)', () => {
    expect(host.querySelector('.frame-timeline')).not.toBeNull();
  });

  it('renders one card per frame plus a trailing + button', () => {
    history.dispatch({ t: 'frame.add' });
    history.dispatch({ t: 'frame.add' });
    expect(host.querySelectorAll('.frame-timeline-card').length).toBe(3);
    expect(host.querySelector('.frame-timeline-add')).not.toBeNull();
  });

  it('renders 1-based frame index per card', () => {
    history.dispatch({ t: 'frame.add' });
    const labels = Array.from(host.querySelectorAll<HTMLElement>('.frame-timeline-card-index')).map((e) => e.textContent);
    expect(labels).toEqual(['1', '2']);
  });

  it('active frame card has aria-current="true" (frame.add switches to the new frame)', () => {
    history.dispatch({ t: 'frame.add' });
    const cards = host.querySelectorAll<HTMLElement>('.frame-timeline-card');
    expect(cards[0]?.getAttribute('aria-current')).toBe('false');
    expect(cards[1]?.getAttribute('aria-current')).toBe('true');
  });

  it('clicking a card dispatches frame.switch', () => {
    history.dispatch({ t: 'frame.add' });
    history.dispatch({ t: 'frame.add' }); // 3 frames, now on the last
    host.querySelectorAll<HTMLElement>('.frame-timeline-card')[0]?.click();
    expect(store.get().activeFrameIdx).toBe(0);
  });

  it('clicking + dispatches frame.add', () => {
    host.querySelector<HTMLElement>('.frame-timeline-add')?.click();
    expect(store.get().frames).toHaveLength(2);
  });

  it('clicking × on a non-only frame dispatches frame.delete for that idx', () => {
    history.dispatch({ t: 'frame.add' });
    history.dispatch({ t: 'frame.add' });
    const cards = host.querySelectorAll<HTMLElement>('.frame-timeline-card');
    cards[1]?.querySelector<HTMLElement>('.frame-timeline-card-delete')?.click();
    expect(store.get().frames).toHaveLength(2);
  });

  it('× button is hidden when only one frame remains', () => {
    expect(host.querySelector<HTMLElement>('.frame-timeline-card-delete')).toBeNull();
  });

  it('each card shows a duration control reading "def" when unset', () => {
    const ctrl = host.querySelector('.frame-timeline-card .frame-timeline-card-dur');
    expect(ctrl).not.toBeNull();
    expect((ctrl as HTMLElement).textContent).toContain('def');
  });

  it('shows N.Ns when a frame has a duration', () => {
    history.dispatch({ t: 'frame.setDuration', frameIdx: 0, durationMs: 2500 });
    const ctrl = host.querySelector('.frame-timeline-card[data-idx="0"] .frame-timeline-card-dur');
    expect((ctrl as HTMLElement).textContent).toContain('2.5s');
  });

  it('editing a card duration dispatches frame.setDuration', () => {
    const dur = host.querySelector<HTMLElement>('.frame-timeline-card[data-idx="0"] .frame-timeline-card-dur')!;
    dur.click();
    const input = host.querySelector<HTMLInputElement>('.frame-timeline-card[data-idx="0"] .frame-timeline-card-dur-input')!;
    input.value = '3';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(store.get().frames[0]!.durationMs).toBe(3000);
  });

  it('editing a duration with Enter pushes exactly one undo entry (no double dispatch)', () => {
    const dur = host.querySelector<HTMLElement>('.frame-timeline-card[data-idx="0"] .frame-timeline-card-dur')!;
    dur.click();
    const input = host.querySelector<HTMLInputElement>('.frame-timeline-card[data-idx="0"] .frame-timeline-card-dur-input')!;
    input.value = '3';
    // Enter commits - the synchronous re-render removes `input` from the DOM.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    // In a real browser, removeChild of a focused element fires a synchronous
    // blur. jsdom doesn't, so reproduce it explicitly on the detached node.
    input.dispatchEvent(new FocusEvent('blur'));

    expect(store.get().frames[0]!.durationMs).toBe(3000);
    // A single undo must fully revert: if the blur double-dispatched there
    // would be two entries and one undo would leave it at 3000.
    expect(history.undo()).toBe(true);
    expect(store.get().frames[0]!.durationMs).toBeUndefined();
  });

  it('clearing the duration resets it to default (undefined)', () => {
    history.dispatch({ t: 'frame.setDuration', frameIdx: 0, durationMs: 3000 });
    const dur = host.querySelector<HTMLElement>('.frame-timeline-card[data-idx="0"] .frame-timeline-card-dur')!;
    dur.click();
    const input = host.querySelector<HTMLInputElement>('.frame-timeline-card[data-idx="0"] .frame-timeline-card-dur-input')!;
    input.value = '';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(store.get().frames[0]!.durationMs).toBeUndefined();
  });

  it('each card shows a caption chip reading "+note" when empty', () => {
    const chip = host.querySelector('.frame-timeline-card[data-idx="0"] .frame-timeline-card-cap');
    expect(chip).not.toBeNull();
    expect((chip as HTMLElement).textContent).toBe('+note');
  });

  it('caption chip flips to the set variant once a caption is dispatched', () => {
    history.dispatch({ t: 'frame.setCaption', frameIdx: 0, caption: 'rotate to A site' });
    const chip = host.querySelector<HTMLElement>('.frame-timeline-card[data-idx="0"] .frame-timeline-card-cap--set');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toBe('note');
    expect(chip!.title).toContain('rotate to A site');
  });

  it('editing a caption dispatches frame.setCaption on Enter', () => {
    const chip = host.querySelector<HTMLElement>('.frame-timeline-card[data-idx="0"] .frame-timeline-card-cap')!;
    chip.click();
    const input = host.querySelector<HTMLInputElement>('.frame-timeline-card[data-idx="0"] .frame-timeline-card-cap-input')!;
    expect(input).not.toBeNull();
    input.value = 'flank from heaven';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(store.get().frames[0]!.caption).toBe('flank from heaven');
  });

  it('clearing the caption resets it to undefined', () => {
    history.dispatch({ t: 'frame.setCaption', frameIdx: 0, caption: 'something' });
    const chip = host.querySelector<HTMLElement>('.frame-timeline-card[data-idx="0"] .frame-timeline-card-cap--set')!;
    chip.click();
    const input = host.querySelector<HTMLInputElement>('.frame-timeline-card[data-idx="0"] .frame-timeline-card-cap-input')!;
    input.value = '';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(store.get().frames[0]!.caption).toBeUndefined();
  });

  it('Escape on the caption editor cancels without dispatching', () => {
    history.dispatch({ t: 'frame.setCaption', frameIdx: 0, caption: 'keep me' });
    const chip = host.querySelector<HTMLElement>('.frame-timeline-card[data-idx="0"] .frame-timeline-card-cap--set')!;
    chip.click();
    const input = host.querySelector<HTMLInputElement>('.frame-timeline-card[data-idx="0"] .frame-timeline-card-cap-input')!;
    input.value = 'discard me';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(store.get().frames[0]!.caption).toBe('keep me');
  });

  it('caption input has a 200-char maxlength', () => {
    const chip = host.querySelector<HTMLElement>('.frame-timeline-card[data-idx="0"] .frame-timeline-card-cap')!;
    chip.click();
    const input = host.querySelector<HTMLInputElement>('.frame-timeline-card[data-idx="0"] .frame-timeline-card-cap-input')!;
    expect(input.maxLength).toBe(200);
  });

  it('caption chip is reachable via aria-label that names the frame', () => {
    history.dispatch({ t: 'frame.setCaption', frameIdx: 0, caption: 'hi' });
    const chip = host.querySelector<HTMLElement>('.frame-timeline-card[data-idx="0"] .frame-timeline-card-cap--set')!;
    expect(chip.getAttribute('aria-label')).toContain('Frame 1 caption');
    expect(chip.getAttribute('aria-label')).toContain('hi');
  });
});

describe('FrameTimeline - playback controls', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let history: ReturnType<typeof createHistory>;
  let playback: StubPlayback;
  let timeline: FrameTimeline;

  function mountWith(frameCount: number, activeFrameIdx: number): void {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore(initialState());
    history = createHistory(store);
    for (let i = 1; i < frameCount; i++) history.dispatch({ t: 'frame.add' });
    store._apply({ activeFrameIdx });
    playback = stubPlayback();
    timeline = new FrameTimeline(host, store, history, asController(playback));
    timeline.mount();
  }

  afterEach(() => {
    timeline.destroy();
    document.body.removeChild(host);
  });

  it('renders a delay stepper and a play button in the actions area', () => {
    mountWith(2, 0);
    expect(host.querySelector('.frame-timeline-actions')).not.toBeNull();
    expect(host.querySelector('.frame-timeline-delay')).not.toBeNull();
    expect(host.querySelector('.frame-timeline-play')).not.toBeNull();
  });

  it('play button is disabled on the last frame and on a single-frame strat', () => {
    mountWith(2, 1);
    expect(host.querySelector<HTMLButtonElement>('.frame-timeline-play')!.disabled).toBe(true);
    timeline.destroy(); document.body.removeChild(host);
    mountWith(1, 0);
    expect(host.querySelector<HTMLButtonElement>('.frame-timeline-play')!.disabled).toBe(true);
  });

  it('play button is enabled when not on the last frame', () => {
    mountWith(3, 0);
    expect(host.querySelector<HTMLButtonElement>('.frame-timeline-play')!.disabled).toBe(false);
  });

  it('clicking the play button calls playback.toggle and flips to a pause label while playing', () => {
    mountWith(3, 0);
    const btn = host.querySelector<HTMLButtonElement>('.frame-timeline-play')!;
    expect(btn.getAttribute('aria-label')).toBe('Play frames');
    btn.click();
    expect(playback.toggle).toHaveBeenCalled();
    // the stub flipped `playing` and notified -> the timeline re-rendered
    expect(host.querySelector('.frame-timeline-play')!.getAttribute('aria-label')).toBe('Pause');
  });

  it('the delay input wires to playback.setDelay (seconds -> ms)', () => {
    mountWith(2, 0);
    const input = host.querySelector<HTMLInputElement>('.frame-timeline-delay')!;
    input.value = '2.5';
    input.dispatchEvent(new Event('change'));
    expect(playback.setDelay).toHaveBeenCalledWith(2500);
  });

  it('renders an onion toggle whose aria-pressed reflects isOnionOn() and flips on click', () => {
    setOnion(false);
    mountWith(2, 0);
    const onion = host.querySelector<HTMLButtonElement>('.frame-timeline-onion')!;
    expect(onion).not.toBeNull();
    expect(onion.getAttribute('aria-pressed')).toBe('false');
    onion.click();
    expect(isOnionOn()).toBe(true);
    expect(host.querySelector('.frame-timeline-onion')!.getAttribute('aria-pressed')).toBe('true');
    setOnion(false);
  });
});

describe('FrameTimeline - drag-to-reorder', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let history: ReturnType<typeof createHistory>;
  let timeline: FrameTimeline;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore(initialState());
    history = createHistory(store);
    history.dispatch({ t: 'frame.add' });
    history.dispatch({ t: 'frame.add' });
    store._apply({ activeFrameIdx: 0 });   // frame.add leaves us on the last frame; reset for these tests
    // 3 frames now, active = 0.
    timeline = new FrameTimeline(host, store, history, asController(stubPlayback()));
    timeline.mount();
  });

  afterEach(() => {
    timeline.destroy();
    document.body.removeChild(host);
  });

  function makePointerEvent(type: string, init: Partial<PointerEventInit & { clientX: number; clientY: number }>): PointerEvent {
    return new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init });
  }

  it('pointerdown on a card body marks it as dragging', () => {
    const card0 = host.querySelectorAll<HTMLElement>('.frame-timeline-card')[0]!;
    card0.dispatchEvent(makePointerEvent('pointerdown', { clientX: 50, clientY: 0 }));
    expect(card0.classList.contains('frame-timeline-card--dragging')).toBe(true);
  });

  it('pointerup at a different x dispatches frame.reorder', () => {
    const cards = host.querySelectorAll<HTMLElement>('.frame-timeline-card');
    const card0 = cards[0]!;
    const card2 = cards[2]!;
    Object.defineProperty(card0, 'getBoundingClientRect', { value: () => ({ left: 0, right: 96, top: 0, bottom: 54, width: 96, height: 54, x: 0, y: 0, toJSON: () => ({}) }), configurable: true });
    Object.defineProperty(cards[1]!, 'getBoundingClientRect', { value: () => ({ left: 104, right: 200, top: 0, bottom: 54, width: 96, height: 54, x: 0, y: 0, toJSON: () => ({}) }), configurable: true });
    Object.defineProperty(card2, 'getBoundingClientRect', { value: () => ({ left: 208, right: 304, top: 0, bottom: 54, width: 96, height: 54, x: 0, y: 0, toJSON: () => ({}) }), configurable: true });

    card0.dispatchEvent(makePointerEvent('pointerdown', { clientX: 48, clientY: 27 }));
    document.dispatchEvent(makePointerEvent('pointermove', { clientX: 250, clientY: 27 }));
    document.dispatchEvent(makePointerEvent('pointerup', { clientX: 250, clientY: 27 }));

    expect(store.get().frames.length).toBe(3);
    // After reorder from 0 -> 2, the original frame[0] is now at index 2; active
    // followed it (initially activeFrameIdx === 0).
    expect(store.get().activeFrameIdx).toBe(2);
  });

  it('pointerup at the same position does NOT dispatch frame.reorder', () => {
    const card0 = host.querySelectorAll<HTMLElement>('.frame-timeline-card')[0]!;
    Object.defineProperty(card0, 'getBoundingClientRect', { value: () => ({ left: 0, right: 96, top: 0, bottom: 54, width: 96, height: 54, x: 0, y: 0, toJSON: () => ({}) }), configurable: true });

    const beforeFrames = store.get().frames;
    card0.dispatchEvent(makePointerEvent('pointerdown', { clientX: 48, clientY: 27 }));
    document.dispatchEvent(makePointerEvent('pointerup', { clientX: 48, clientY: 27 }));

    expect(store.get().frames).toBe(beforeFrames);
  });
});

describe('FrameTimeline - visibility', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let history: ReturnType<typeof createHistory>;
  let timeline: FrameTimeline;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore(initialState());
    history = createHistory(store);
    timeline = new FrameTimeline(host, store, history, asController(stubPlayback()));
    timeline.mount();
  });

  afterEach(() => {
    timeline.destroy();
    document.body.removeChild(host);
  });

  it('does not render a per-card duplicate button', () => {
    history.dispatch({ t: 'frame.add' });
    expect(host.querySelector('.frame-timeline-card-duplicate')).toBeNull();
  });

  it('strip stays mounted regardless of ui.mode (modes merged)', () => {
    expect(host.querySelector('.frame-timeline')).not.toBeNull();
    store._apply({ ui: { ...store.get().ui, mode: 'frame' } });
    expect(host.querySelector('.frame-timeline')).not.toBeNull();
    store._apply({ ui: { ...store.get().ui, mode: 'animation' } });
    expect(host.querySelector('.frame-timeline')).not.toBeNull();
  });
});

describe('FrameTimeline - compact layout', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let history: ReturnType<typeof createHistory>;
  let timeline: FrameTimeline;

  afterEach(() => {
    timeline?.destroy();
    document.body.removeChild(host);
  });

  it('marks its root data-compact="true" when layoutMode is compact', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore({ ...initialState(), layoutMode: 'compact' });
    history = createHistory(store);
    timeline = new FrameTimeline(host, store, history, asController(stubPlayback()));
    timeline.mount();
    const root = host.querySelector('[data-testid="frame-timeline"]') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.getAttribute('data-compact')).toBe('true');
  });

  it('marks its root data-compact="false" when layoutMode is desktop', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore({ ...initialState(), layoutMode: 'desktop' });
    history = createHistory(store);
    timeline = new FrameTimeline(host, store, history, asController(stubPlayback()));
    timeline.mount();
    const root = host.querySelector('[data-testid="frame-timeline"]') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.getAttribute('data-compact')).toBe('false');
  });

  it('updates data-compact reactively when layoutMode changes', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore(initialState()); // no layoutMode => desktop
    history = createHistory(store);
    timeline = new FrameTimeline(host, store, history, asController(stubPlayback()));
    timeline.mount();
    expect(host.querySelector('[data-testid="frame-timeline"]')?.getAttribute('data-compact')).toBe('false');
    store._apply({ layoutMode: 'compact' });
    expect(host.querySelector('[data-testid="frame-timeline"]')?.getAttribute('data-compact')).toBe('true');
    store._apply({ layoutMode: 'desktop' });
    expect(host.querySelector('[data-testid="frame-timeline"]')?.getAttribute('data-compact')).toBe('false');
  });
});

describe('FrameTimeline - onion label', () => {
  it('keeps the label in a span so compact can swap it for a glyph', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const store = createStore(initialState());
    const history = createHistory(store);
    const playback = stubPlayback();
    const timeline = new FrameTimeline(host, store, history, asController(playback));
    timeline.mount();
    const onion = host.querySelector('.frame-timeline-onion') as HTMLButtonElement;
    // 'Prev frame' as bare text was 88px of a 224px actions cluster on a phone;
    // the span lets the compact CSS hide it and show a glyph instead. The
    // accessible name stays the whole sentence either way.
    expect(onion.querySelector('.frame-timeline-onion-label')?.textContent).toBe('Prev frame');
    expect(onion.getAttribute('aria-label')).toBe('Show a ghost of the previous frame while editing');
    timeline.destroy();
    host.remove();
  });

  it('mounts the shared delay stepper', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const store = createStore(initialState());
    const history = createHistory(store);
    const playback = stubPlayback();
    const timeline = new FrameTimeline(host, store, history, asController(playback));
    timeline.mount();
    const wrap = host.querySelector('.frame-timeline-delay-wrap');
    expect(wrap).not.toBeNull();
    expect((wrap!.querySelector('.frame-timeline-delay') as HTMLInputElement).value).toBe('1.0');
    timeline.destroy();
    host.remove();
  });
});
