import '../styles/frame-timeline.css';
import type { Store } from '../app/store';
import type { History } from '../app/history';
import type { PlaybackController } from '../app/playback';
import { isOnionOn, setOnion, subscribeOnion } from '../app/onionPref';
import { buildPlaybackDelay } from './playbackDelay';
import { announce } from '../app/announcer';
import { sanitiseText } from '../app/sanitiseText';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Bottom-strip frame timeline, always rendered. Left: a scrolling row of
 * frame cards (1-based index, hover reveals delete) plus a `+` button. Right:
 * a playback-delay stepper and Play/Pause.
 */
export class FrameTimeline {
  private root: HTMLElement | null = null;
  private unsub: () => void = () => {};
  private unsubPlay: () => void = () => {};
  private unsubLayout: () => void = () => {};
  private unsubOnion: () => void = () => {};
  /** Live drag-to-reorder state, or null when no drag is in progress. The
   *  grabbed card follows the cursor while the other cards ease aside to open
   *  the slot it would drop into (see onPointerMove / frame-timeline.css). */
  private dragState: {
    src: number;
    startX: number;
    step: number;        // px between adjacent card lefts (card width + gap)
    firstCenter: number; // original centre-x of the first card
    cards: HTMLElement[];
    dragged: HTMLElement;
    target: number;
  } | null = null;
  /** Tracked across renders so we can classify what changed (add vs delete vs
   * reorder vs plain switch) and replay the appropriate card animation without
   * needing per-command instrumentation. -1 = first render. */
  private prevFrameCount: number = -1;
  private prevActiveIdx: number = -1;
  /** Index of the card to play the appear animation on this render, or null
   * if no card is newly inserted. Reset after each render. */
  private appearIdx: number | null = null;
  /** Whether the active card on this render should pulse. */
  private pulseActive: boolean = false;
  // Grab a card. Snapshot the original card geometry so the drop-target maths
  // stays stable even as the siblings slide around under it.
  private beginDrag(e: PointerEvent, idx: number, card: HTMLElement): void {
    if (!this.root) return;
    const cards = Array.from(this.root.querySelectorAll<HTMLElement>('.frame-timeline-card'));
    const rect0 = cards[0]!.getBoundingClientRect();
    let step = rect0.width || 96;
    if (cards.length > 1) {
      const gap = cards[1]!.getBoundingClientRect().left - rect0.left;
      if (gap > 0) step = gap;
    }
    this.dragState = {
      src: idx,
      startX: e.clientX,
      step,
      firstCenter: rect0.left + rect0.width / 2,
      cards,
      dragged: card,
      target: idx,
    };
    card.classList.add('frame-timeline-card--dragging');
    try { card.setPointerCapture(e.pointerId); } catch { /* jsdom / unsupported */ }
    document.addEventListener('pointermove', this.onPointerMove);
    document.addEventListener('pointerup', this.onPointerUp);
    document.addEventListener('pointercancel', this.onPointerCancel);
  }

  // Which slot the card would drop into for a given cursor x. Uses the
  // snapshotted geometry rather than live rects (which shift mid-drag).
  private dragTargetFor(clientX: number): number {
    const ds = this.dragState!;
    const raw = Math.round((clientX - ds.firstCenter) / ds.step);
    if (!Number.isFinite(raw)) return ds.src;
    return Math.max(0, Math.min(ds.cards.length - 1, raw));
  }

  private onPointerMove = (e: PointerEvent): void => {
    const ds = this.dragState;
    if (!ds) return;
    e.preventDefault();
    // The grabbed card tracks the cursor 1:1 (it has transitions off) and
    // lifts a touch so it reads as "picked up".
    const dx = e.clientX - ds.startX;
    ds.dragged.style.transform = `translateX(${dx}px) scale(1.06)`;
    ds.target = this.dragTargetFor(e.clientX);
    // Slide every other card aside to open the slot at the target. These DO
    // transition, so they glide rather than jump (the ease-in/out animation).
    for (let i = 0; i < ds.cards.length; i++) {
      if (i === ds.src) continue;
      let shift = 0;
      if (ds.src < ds.target && i > ds.src && i <= ds.target) shift = -ds.step;
      else if (ds.src > ds.target && i >= ds.target && i < ds.src) shift = ds.step;
      ds.cards[i]!.style.transform = shift === 0 ? '' : `translateX(${shift}px)`;
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const ds = this.dragState;
    if (!ds) return;
    const target = this.dragTargetFor(e.clientX);
    this.endDrag(ds);
    if (target !== ds.src) {
      this.history.dispatch({ t: 'frame.reorder', from: ds.src, to: target });
    }
  };

  // Interrupted gesture (e.g. a second touch): let the cards ease back home
  // and commit nothing.
  private onPointerCancel = (): void => {
    const ds = this.dragState;
    if (!ds) return;
    this.endDrag(ds);
  };

  private endDrag(ds: NonNullable<FrameTimeline['dragState']>): void {
    this.dragState = null;
    document.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerup', this.onPointerUp);
    document.removeEventListener('pointercancel', this.onPointerCancel);
    for (const el of ds.cards) {
      el.style.transform = '';
      el.classList.remove('frame-timeline-card--dragging');
    }
  }

  constructor(
    private host: HTMLElement,
    private store: Store,
    private history: History,
    private playback: PlaybackController,
  ) {}

  mount(): void {
    this.unsub = this.store.subscribe(['frames', 'activeFrameIdx'], () => this.sync());
    this.unsubPlay = this.playback.onChange(() => this.sync());
    this.unsubLayout = this.store.subscribe(['layoutMode'], () => this.syncCompact());
    this.unsubOnion = subscribeOnion(() => this.sync());
    this.sync();
  }

  destroy(): void {
    this.unsub();
    this.unsubPlay();
    this.unsubLayout();
    this.unsubOnion();
    document.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerup', this.onPointerUp);
    document.removeEventListener('pointercancel', this.onPointerCancel);
    this.removeRoot();
  }

  private syncCompact(): void {
    if (!this.root) return;
    this.root.dataset['compact'] = String((this.store.get().layoutMode ?? 'desktop') === 'compact');
  }

  private sync(): void {
    this.render();
  }

  /**
   * Diff the current store state against the last render to decide which
   * card (if any) should play the appear animation, and whether the active
   * card should pulse. Mutates the per-render flags and updates the
   * prev* trackers - call exactly once per render(), before paint.
   */
  private classifyTransition(count: number, activeIdx: number): void {
    this.appearIdx = null;
    this.pulseActive = false;

    // First render - no previous state to diff against.
    if (this.prevFrameCount < 0) {
      this.prevFrameCount = count;
      this.prevActiveIdx = activeIdx;
      return;
    }

    if (count > this.prevFrameCount) {
      // A frame was added. frame.add appends a copy of the last frame AND moves
      // activeFrameIdx onto it, so animate the new last card and pulse it.
      this.appearIdx = count - 1;
      this.pulseActive = true;
    } else if (count < this.prevFrameCount) {
      // A frame was deleted. We can't animate the removed node (it's gone),
      // but the active card almost always shifts - pulse it so the user
      // sees that the removal landed and where the cursor moved to.
      this.pulseActive = true;
    } else if (activeIdx !== this.prevActiveIdx) {
      // Same length, different active idx -> plain switch (or reorder of the
      // active card). Pulse the new active so arrow-key / click navigation
      // gets visual confirmation.
      this.pulseActive = true;
    }

    this.prevFrameCount = count;
    this.prevActiveIdx = activeIdx;
  }

  private render(): void {
    if (this.root) this.removeRoot();
    const root = document.createElement('div');
    root.className = 'frame-timeline';
    root.setAttribute('data-testid', 'frame-timeline');
    root.dataset['compact'] = String((this.store.get().layoutMode ?? 'desktop') === 'compact');

    const scroll = document.createElement('div');
    scroll.className = 'frame-timeline-scroll';
    const inner = document.createElement('div');
    inner.className = 'frame-timeline-inner';

    const state = this.store.get();
    this.classifyTransition(state.frames.length, state.activeFrameIdx);
    for (let i = 0; i < state.frames.length; i++) {
      inner.appendChild(this.renderCard(i, state.frames.length));
    }
    inner.appendChild(this.renderAddButton());
    scroll.appendChild(inner);

    root.appendChild(scroll);
    root.appendChild(this.renderActions());
    this.host.appendChild(root);
    this.root = root;
  }

  private renderCard(idx: number, total: number): HTMLElement {
    const state = this.store.get();
    const card = document.createElement('div');
    card.className = 'frame-timeline-card';
    if (idx === this.appearIdx) card.classList.add('frame-timeline-card--appearing');
    if (this.pulseActive && idx === state.activeFrameIdx) {
      card.classList.add('frame-timeline-card--pulse');
    }
    card.dataset['idx'] = String(idx);
    card.setAttribute('aria-current', String(idx === state.activeFrameIdx));
    // Focusable + named so keyboard / SR users can land on it and activate.
    // Not role=button because the card contains real <button> children (delete,
    // duration) and nesting button roles confuses screen readers.
    card.tabIndex = 0;
    card.setAttribute('aria-label', `Frame ${idx + 1} of ${total}`);
    card.addEventListener('click', () => this.history.dispatch({ t: 'frame.switch', idx }));
    card.addEventListener('keydown', (e) => this.onCardKeydown(e, idx, total));
    card.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const tgt = e.target as HTMLElement;
      if (tgt.closest('button, input')) return; // Skip drag when pressing a chip or an edit field.
      this.beginDrag(e, idx, card);
    });

    const label = document.createElement('div');
    label.className = 'frame-timeline-card-index';
    label.textContent = String(idx + 1);
    card.appendChild(label);

    if (total > 1) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'frame-timeline-card-delete';
      del.textContent = '×';
      del.title = 'Delete frame';
      del.setAttribute('aria-label', `Delete frame ${idx + 1}`);
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        this.history.dispatch({ t: 'frame.delete', idx });
      });
      card.appendChild(del);
    }

    const dur = document.createElement('button');
    dur.type = 'button';
    dur.className = 'frame-timeline-card-dur';
    const ms = state.frames[idx]!.durationMs;
    const durText = typeof ms === 'number' ? `${(ms / 1000).toFixed(1)}s` : 'def';
    dur.textContent = durText;
    dur.title = 'Frame hold time (click to set; empty = default)';
    dur.setAttribute(
      'aria-label',
      `Frame ${idx + 1} hold time (${typeof ms === 'number' ? `${(ms / 1000).toFixed(1)} seconds` : 'default'}). Click to edit.`,
    );
    dur.addEventListener('click', (e) => {
      e.stopPropagation();
      this.beginEditDuration(card, idx);
    });
    card.appendChild(dur);

    const caption = state.frames[idx]!.caption;
    const cap = document.createElement('button');
    cap.type = 'button';
    cap.className = caption != null && caption !== ''
      ? 'frame-timeline-card-cap frame-timeline-card-cap--set'
      : 'frame-timeline-card-cap';
    cap.textContent = caption != null && caption !== '' ? 'note' : '+note';
    cap.title = caption != null && caption !== ''
      ? `Caption: ${caption}`
      : 'Add a caption shown during playback';
    cap.setAttribute(
      'aria-label',
      caption != null && caption !== ''
        ? `Frame ${idx + 1} caption: ${caption}. Click to edit.`
        : `Frame ${idx + 1} has no caption. Click to add one.`,
    );
    cap.addEventListener('click', (e) => {
      e.stopPropagation();
      this.beginEditCaption(card, idx);
    });
    card.appendChild(cap);

    return card;
  }

  private beginEditCaption(card: HTMLElement, idx: number): void {
    const existing = card.querySelector('.frame-timeline-card-cap, .frame-timeline-card-cap--set');
    const cur = this.store.get().frames[idx]!.caption ?? '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'frame-timeline-card-cap-input';
    input.maxLength = 200;
    input.value = cur;
    input.placeholder = 'Frame note';
    input.title = `Frame note shown during playback (max 200 chars)`;
    input.setAttribute('aria-label', `Frame ${idx + 1} note`);
    input.addEventListener('click', (e) => e.stopPropagation());
    let committed = false;
    const cancelToCard = (): void => {
      this.sync();
      queueMicrotask(() => {
        const target = this.root?.querySelector<HTMLElement>(
          `.frame-timeline-card[data-idx="${idx}"]`,
        );
        target?.focus();
      });
    };
    const onBlur = (): void => commit();
    const commit = (): void => {
      if (committed) return;
      committed = true;
      const trimmed = sanitiseText(input.value, { maxLen: 200 });
      const next = trimmed === '' ? undefined : trimmed;
      if (next !== cur && !(next === undefined && cur === '')) {
        input.removeEventListener('blur', onBlur);
        this.history.dispatch({ t: 'frame.setCaption', frameIdx: idx, caption: next });
      } else this.sync();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); input.removeEventListener('blur', onBlur); cancelToCard(); }
    });
    input.addEventListener('blur', onBlur);
    if (existing) existing.replaceWith(input);
    else card.appendChild(input);
    input.focus();
    input.select();
  }

  /** Keyboard handling for a frame card. Enter/Space activates; arrows /
   *  Home / End navigate; Ctrl/Alt+Left/Right reorders the focused frame (the
   *  keyboard equivalent of drag-to-reorder); Delete or Backspace removes the
   *  frame (when there is more than one). Ignores events that originated inside
   *  an inner interactive element (delete button, duration button, duration
   *  edit input) so Enter on the input doesn't bubble up and also re-switch the
   *  frame. */
  private onCardKeydown(e: KeyboardEvent, idx: number, total: number): void {
    const tgt = e.target as HTMLElement | null;
    if (tgt && tgt !== e.currentTarget && tgt.closest('button, input')) return;
    const focusCard = (target: number): void => {
      const clamped = Math.max(0, Math.min(total - 1, target));
      this.history.dispatch({ t: 'frame.switch', idx: clamped });
      // Re-find after render -- the DOM is replaced wholesale by sync().
      queueMicrotask(() => {
        const next = this.root?.querySelector<HTMLElement>(
          `.frame-timeline-card[data-idx="${clamped}"]`,
        );
        next?.focus();
      });
      // Polite SR announcement so keyboard users get the same "you moved"
      // feedback the visual pulse gives sighted users.
      announce(`Frame ${clamped + 1} of ${total}`);
    };
    // Move the focused frame to `to` (keyboard reorder). Same command the
    // pointer drag dispatches; keep focus on the card at its new position.
    const moveCard = (to: number): void => {
      if (to < 0 || to >= total || to === idx) return;
      this.history.dispatch({ t: 'frame.reorder', from: idx, to });
      queueMicrotask(() => {
        const moved = this.root?.querySelector<HTMLElement>(
          `.frame-timeline-card[data-idx="${to}"]`,
        );
        moved?.focus();
      });
      announce(`Frame moved to position ${to + 1} of ${total}`);
    };
    const reordering = e.ctrlKey || e.altKey || e.metaKey;
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        this.history.dispatch({ t: 'frame.switch', idx });
        announce(`Frame ${idx + 1} of ${total} selected`);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (reordering) moveCard(idx - 1);
        else focusCard(idx - 1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (reordering) moveCard(idx + 1);
        else focusCard(idx + 1);
        break;
      case 'Home':
        e.preventDefault();
        focusCard(0);
        break;
      case 'End':
        e.preventDefault();
        focusCard(total - 1);
        break;
      case 'Delete':
      case 'Backspace':
        if (total > 1) {
          e.preventDefault();
          this.history.dispatch({ t: 'frame.delete', idx });
        }
        break;
      default:
        break;
    }
  }

  private beginEditDuration(card: HTMLElement, idx: number): void {
    const existing = card.querySelector('.frame-timeline-card-dur');
    const cur = this.store.get().frames[idx]!.durationMs;
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'frame-timeline-card-dur-input';
    input.min = '0';
    input.step = '0.5';
    input.placeholder = 'def';
    input.value = typeof cur === 'number' ? String(cur / 1000) : '';
    input.title = 'Seconds to hold this frame. Empty = use the global delay.';
    input.setAttribute('aria-label', `Frame ${idx + 1} hold time in seconds (empty = use the global delay)`);
    input.addEventListener('click', (e) => e.stopPropagation());
    let committed = false;
    const cancelToCard = (): void => {
      this.sync();
      // Land focus back on the card so Esc doesn't dump the user at the body.
      queueMicrotask(() => {
        const target = this.root?.querySelector<HTMLElement>(
          `.frame-timeline-card[data-idx="${idx}"]`,
        );
        target?.focus();
      });
    };
    const onBlur = (): void => commit();
    const commit = (): void => {
      if (committed) return;
      committed = true;
      const raw = input.value.trim();
      let next: number | undefined;
      if (raw === '') next = undefined;
      else {
        const secs = Number(raw);
        next = Number.isFinite(secs) && secs > 0 ? Math.round(secs * 1000) : undefined;
      }
      if (next !== cur) {
        // dispatch re-renders synchronously, detaching this (focused) input,
        // which fires blur in a real browser - drop the blur path first so it
        // can't re-enter commit() with a stale `cur`.
        input.removeEventListener('blur', onBlur);
        this.history.dispatch({ t: 'frame.setDuration', frameIdx: idx, durationMs: next });
      } else this.sync();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); input.removeEventListener('blur', onBlur); cancelToCard(); }
    });
    input.addEventListener('blur', onBlur);
    if (existing) existing.replaceWith(input);
    input.focus();
    input.select();
  }

  private renderAddButton(): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'frame-timeline-add';
    btn.textContent = '+';
    btn.title = 'Add frame (duplicates the last frame)';
    btn.setAttribute('aria-label', 'Add frame (duplicates the last frame)');
    btn.addEventListener('click', () => this.history.dispatch({ t: 'frame.add' }));
    return btn;
  }

  private renderActions(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'frame-timeline-actions';

    // Shared with the compact View sheet, which is where this control lives on a
    // phone (the strip hides its copy there - see mobile-chrome.css).
    const delay = buildPlaybackDelay(this.playback);

    const onion = document.createElement('button');
    onion.type = 'button';
    onion.className = 'frame-timeline-onion';
    // The label is a span so the compact layout can hide it and show a glyph
    // instead; 'Prev frame' as text was 88px of a 224px actions cluster. The
    // aria-label and title carry the meaning either way.
    const onionLabel = document.createElement('span');
    onionLabel.className = 'frame-timeline-onion-label';
    onionLabel.textContent = 'Prev frame';
    // Both are always built; the CSS shows the text on desktop and the icon in
    // compact, so neither layout needs FrameTimeline to know which it is in.
    onion.append(makeOnionIcon(), onionLabel);
    onion.title = 'Show a ghost of the previous frame while editing';
    onion.setAttribute('aria-label', 'Show a ghost of the previous frame while editing');
    onion.setAttribute('aria-pressed', String(isOnionOn()));
    onion.addEventListener('click', () => setOnion(!isOnionOn()));
    wrap.append(onion);

    const playing = this.playback.isPlaying();
    const label = playing ? 'Pause' : 'Play frames';
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'frame-timeline-play';
    play.setAttribute('aria-label', label);
    play.title = label;
    play.appendChild(makePlayPauseIcon(playing ? 'pause' : 'play'));
    play.disabled = !playing && !this.playback.canPlay(this.store.get());
    play.addEventListener('click', () => this.playback.toggle());

    wrap.append(delay.el, play);
    return wrap;
  }

  private removeRoot(): void {
    if (this.root && this.root.parentElement) this.root.parentElement.removeChild(this.root);
    this.root = null;
  }
}

/**
 * Build a 24x24 onion-skin glyph: a solid frame with a dashed ghost behind it.
 * Only shown in the compact layout, where the words "Prev frame" cost 88px of a
 * 224px actions cluster; desktop keeps the text and hides this (CSS). An SVG
 * rather than a CSS `content` glyph because the obvious half-moon characters are
 * not in every system font - U+25D1 renders as tofu on Chromium/Windows.
 */
function makeOnionIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('frame-timeline-onion-icon');
  const ghost = document.createElementNS(SVG_NS, 'rect');
  ghost.setAttribute('x', '3'); ghost.setAttribute('y', '3');
  ghost.setAttribute('width', '14'); ghost.setAttribute('height', '14');
  ghost.setAttribute('rx', '2');
  ghost.setAttribute('stroke-dasharray', '3 2');
  ghost.setAttribute('opacity', '0.6');
  const front = document.createElementNS(SVG_NS, 'rect');
  front.setAttribute('x', '7'); front.setAttribute('y', '7');
  front.setAttribute('width', '14'); front.setAttribute('height', '14');
  front.setAttribute('rx', '2');
  svg.append(ghost, front);
  return svg;
}

/** Build a 24x24 currentColor play or pause glyph (no innerHTML). */
function makePlayPauseIcon(kind: 'play' | 'pause'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  const ds = kind === 'play' ? ['M8 5v14l11-7z'] : ['M6 5h4v14H6z', 'M14 5h4v14h-4z'];
  for (const d of ds) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}
