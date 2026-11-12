import type { Store } from '../app/store';
import type { History } from '../app/history';
import type { Command } from '../types/commands';
import type { Viewport } from './coords';
import { PreviousFrameView } from '../app/previousFrameView';
import { isOnionOn, subscribeOnion } from '../app/onionPref';
import { StrokeLayer } from './StrokeLayer';
import { ShapeLayer } from './ShapeLayer';
import { ConeLayer } from './ConeLayer';
import { QuickAddLayer } from './QuickAddLayer';
import { PlayerLayer } from './PlayerLayer';
import { TextLayer } from './TextLayer';

export interface MapSize { w: number; h: number }

interface GhostLayer { mount(): void; destroy(): void }

interface Playback {
  isPlaying(): boolean;
  onChange(cb: () => void): () => void;
}

/**
 * A non-interactive, dim ghost of the PREVIOUS frame behind the live layers,
 * shown only while editing (frame mode, not playing, previous frame exists,
 * onion toggle on). Built from the six real per-frame layers on a
 * PreviousFrameView; never mutates the store or dispatches history.
 */
const NOOP_HISTORY: History = {
  dispatch: (_cmd: Command): void => { /* ghost subtree: drop on the floor */ },
  undo: (): boolean => false,
  redo: (): boolean => false,
  canUndo: (): boolean => false,
  canRedo: (): boolean => false,
  clear: (): void => { /* */ },
  onBeforeFrameChange: (): (() => void) => () => { /* */ },
};

export class OnionSkinLayer {
  private wrapGhost: HTMLDivElement | null = null;
  private vpGhost: HTMLDivElement | null = null;
  private ghostLayers: GhostLayer[] = [];
  private unsubs: Array<() => void> = [];
  private destroyed = false;

  constructor(
    private zoomViewport: HTMLElement,
    private mapWrap: HTMLElement,
    private store: Store,
    private history: History,
    private mapSize: MapSize,
    private getViewport: () => Viewport,
    private playback: Playback,
  ) {}

  mount(): void {
    const { w, h } = this.mapSize;

    this.wrapGhost = document.createElement('div');
    this.wrapGhost.className = 'onion-ghost';
    this.wrapGhost.style.cssText =
      `position:absolute;left:0;top:0;width:${w}px;height:${h}px;pointer-events:none;opacity:0.28`;
    const mapImage = this.mapWrap.querySelector('#map-image');
    this.mapWrap.insertBefore(
      this.wrapGhost,
      mapImage ? mapImage.nextSibling : this.mapWrap.firstChild,
    );

    this.vpGhost = document.createElement('div');
    this.vpGhost.style.cssText =
      'position:absolute;inset:0;pointer-events:none;opacity:0.28';
    this.zoomViewport.appendChild(this.vpGhost);

    const fv = new PreviousFrameView(this.store);

    // The ghost subtree is opacity-dimmed and pointer-events:none on its
    // wrapper, but pointer-events doesn't always propagate to children with
    // their own default (textareas, the resize handles inside .tbox). If a
    // stray click ever reached a ghost handle, it would dispatch a real
    // textbox.modify against the live store. Hand the ghost TextLayer a
    // no-op History so nothing it does can leak into actual undo state.
    this.ghostLayers = [
      new ShapeLayer(this.wrapGhost, this.store, this.mapSize, fv),
      new ConeLayer(this.wrapGhost, this.store, this.mapSize, fv),
      new QuickAddLayer(this.wrapGhost, this.store, this.mapSize, fv),
      new TextLayer(this.wrapGhost, this.store, NOOP_HISTORY, this.getViewport, fv),
      new StrokeLayer(this.vpGhost, this.store, this.mapSize, fv),
      new PlayerLayer(this.vpGhost, this.store, this.mapSize, this.getViewport, fv),
    ];
    for (const l of this.ghostLayers) l.mount();

    this.unsubs.push(
      this.store.subscribe(['ui', 'activeFrameIdx', 'frames'], () => this.applyVisibility()),
      subscribeOnion(() => this.applyVisibility()),
      this.playback.onChange(() => this.applyVisibility()),
    );

    this.applyVisibility();
  }

  private applyVisibility(): void {
    const s = this.store.get();
    const shown =
      isOnionOn() &&
      s.ui.mode === 'frame' &&
      s.activeFrameIdx > 0 &&
      !this.playback.isPlaying();
    if (this.wrapGhost) this.wrapGhost.style.display = shown ? '' : 'none';
    if (this.vpGhost) this.vpGhost.style.display = shown ? '' : 'none';
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    for (const u of this.unsubs) u();
    this.unsubs = [];

    for (const l of this.ghostLayers) l.destroy();
    this.ghostLayers = [];

    if (this.wrapGhost && this.wrapGhost.parentNode) {
      this.wrapGhost.parentNode.removeChild(this.wrapGhost);
    }
    this.wrapGhost = null;
    if (this.vpGhost && this.vpGhost.parentNode) {
      this.vpGhost.parentNode.removeChild(this.vpGhost);
    }
    this.vpGhost = null;
  }
}
