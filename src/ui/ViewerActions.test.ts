import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { createStore, type StratState } from '../app/store';
import { ViewerActions } from './ViewerActions';
import { emptyFrame } from '../types/primitives';
import { hex } from '../types/hex';

function initial(): StratState {
  return {
    mapId: 'miru', zoom: 1, panX: 0, panY: 0,
    frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '', tool: 'cursor',
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
}

describe('ViewerActions', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let clear: Mock<() => void>;
  let zoomIn: Mock<() => void>;
  let zoomOut: Mock<() => void>;
  let setZoom: Mock<(zoom: number) => void>;
  let hud: ViewerActions;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore(initial());
    clear = vi.fn();
    zoomIn = vi.fn();
    zoomOut = vi.fn();
    setZoom = vi.fn();
    hud = new ViewerActions(host, store, {
      clearActiveFrame: clear,
      zoomIn,
      zoomOut,
      setZoom,
    });
    hud.mount();
  });

  afterEach(() => {
    hud.destroy();
    if (host.parentElement) host.parentElement.removeChild(host);
  });

  function btn(cls: string): HTMLButtonElement {
    return host.querySelector(`.${cls}`) as HTMLButtonElement;
  }
  function zoomField(): HTMLInputElement {
    return host.querySelector('.viewer-actions-zoom-input') as HTMLInputElement;
  }

  it('mounts the four controls in column order (zoom in, %, zoom out, clear)', () => {
    expect(host.querySelectorAll('.viewer-actions-btn').length).toBe(3);
    expect(zoomField()).not.toBeNull();
    const order = Array.from(host.querySelectorAll('.viewer-actions > *'))
      .filter((el) => el.classList.length > 0)
      .map((el) => el.classList[0]);
    expect(order).toEqual([
      'viewer-actions-btn',
      'viewer-actions-zoom-input',
      'viewer-actions-btn',
      'viewer-actions-sep',
      'viewer-actions-btn',
    ]);
  });

  it('each button has an accessible label', () => {
    expect(btn('viewer-actions-zoom-in').getAttribute('aria-label')).toBe('Zoom in');
    expect(btn('viewer-actions-zoom-out').getAttribute('aria-label')).toBe('Zoom out');
    expect(btn('viewer-actions-clear').getAttribute('aria-label')).toBe('Clear frame');
    expect(zoomField().getAttribute('aria-label')).toBe('Zoom percent');
  });

  it('clicking a button calls the matching dep', () => {
    btn('viewer-actions-zoom-in').click();
    btn('viewer-actions-zoom-out').click();
    btn('viewer-actions-clear').click();
    expect(zoomIn).toHaveBeenCalledTimes(1);
    expect(zoomOut).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('does not let pointerdown / click bubble to the viewer', () => {
    const hostDown = vi.fn();
    const hostClick = vi.fn();
    host.addEventListener('pointerdown', hostDown);
    host.addEventListener('click', hostClick);
    btn('viewer-actions-zoom-in').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    btn('viewer-actions-zoom-in').click();
    expect(hostDown).not.toHaveBeenCalled();
    expect(hostClick).not.toHaveBeenCalled();
  });

  it('zoom input shows the current store zoom as a rounded percent', () => {
    expect(zoomField().value).toBe('100%');
    store._apply({ zoom: 1.27 });
    expect(zoomField().value).toBe('127%');
  });

  it('store zoom changes do NOT overwrite the input while it is focused (mid-typing)', () => {
    const input = zoomField();
    input.focus();
    input.value = '12';
    store._apply({ zoom: 1.5 });
    expect(input.value).toBe('12');
  });

  it('committing the input with Enter calls setZoom with the clamped value', () => {
    const input = zoomField();
    input.value = '250';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(setZoom).toHaveBeenCalledTimes(1);
    expect(setZoom.mock.calls[0]![0]).toBeCloseTo(2.5, 6);
  });

  it('out-of-range input clamps to MIN_ZOOM / MAX_ZOOM bounds', () => {
    const input = zoomField();
    input.value = '5000';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(setZoom.mock.calls[0]![0]).toBeCloseTo(10, 6);
    input.value = '1';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(setZoom.mock.calls[1]![0]).toBeCloseTo(0.1, 6);
  });

  it('Escape on the input snaps the value back to the store zoom and blurs', () => {
    const input = zoomField();
    input.focus();
    input.value = '350';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(setZoom).not.toHaveBeenCalled();
    expect(input.value).toBe('100%');
  });

  it('is a labelled group for screen readers', () => {
    const group = host.querySelector('.viewer-actions');
    expect(group!.getAttribute('role')).toBe('group');
    expect(group!.getAttribute('aria-label')).toBe('Map actions');
  });

  it('destroy() removes the HUD', () => {
    hud.destroy();
    expect(host.querySelector('.viewer-actions')).toBeNull();
  });
});
