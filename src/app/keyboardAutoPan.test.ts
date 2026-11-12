import { describe, it, expect, afterEach } from 'vitest';
import { keyboardLift, KeyboardAutoPan } from './keyboardAutoPan';
import { createStore, type StratState } from './store';
import { emptyFrame } from '../types/primitives';

function makeStore() {
  const s: StratState = {
    mapId: 'miru', zoom: 1, panX: 0, panY: 0, frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '', tool: 'place-text',
    colourSlots: [null, null, null, null, null], activeSlot: 0,
    selection: [], ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false,
    shareOpen: false, libraryOpen: false, mapDropdownOpen: false,
    colourPickerOpen: false, hintsOpen: false, calloutsVisible: false,
    changelogOpen: false, confirmOpen: null },
  };
  return createStore(s);
}

/** A minimal stand-in for window.visualViewport: an EventTarget carrying a
 *  mutable `height` / `offsetTop`, so a test can fire a synthetic `resize`. */
function makeVisualViewport(height: number): VisualViewport {
  const vv = new EventTarget() as unknown as VisualViewport & { height: number; offsetTop: number };
  vv.height = height;
  vv.offsetTop = 0;
  return vv as VisualViewport;
}

/** Force a static getBoundingClientRect on an element (jsdom returns zeros). */
function stubRect(el: Element, bottom: number): void {
  el.getBoundingClientRect = () => ({
    left: 0, top: bottom - 20, right: 100, bottom, width: 100, height: 20,
    x: 0, y: bottom - 20, toJSON: () => ({}),
  });
}

function setVisualViewport(vv: VisualViewport | undefined): void {
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true, writable: true });
}

describe('keyboardLift', () => {
  it('returns the overlap when the field bottom sits under the keyboard', () => {
    // field bottom 800, keyboard top 500, 16px margin -> 800 + 16 - 500
    expect(keyboardLift(800, 500, 16)).toBe(316);
  });

  it('is zero when the field is already clear of the keyboard', () => {
    expect(keyboardLift(300, 500, 16)).toBe(0);
  });

  it('never returns a negative lift', () => {
    expect(keyboardLift(100, 900, 16)).toBe(0);
  });
});

describe('KeyboardAutoPan', () => {
  let pan: KeyboardAutoPan | null = null;

  afterEach(() => {
    pan?.detach();
    pan = null;
    document.body.replaceChildren();
    setVisualViewport(undefined);
  });

  it('pans the map up when a focused text box textarea falls under the keyboard', () => {
    const vv = makeVisualViewport(844);
    setVisualViewport(vv);
    const store = makeStore();
    pan = new KeyboardAutoPan(store);
    pan.attach();

    const tbox = document.createElement('div');
    tbox.className = 'tbox';
    const ta = document.createElement('textarea');
    tbox.appendChild(ta);
    document.body.appendChild(tbox);
    stubRect(ta, 800);

    ta.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    // Keyboard slides up: visible height shrinks to 400.
    (vv as unknown as { height: number }).height = 400;
    vv.dispatchEvent(new Event('resize'));

    // 800 + 16 - 400 = 416 -> the map pans up by 416 (panY decreases).
    expect(store.get().panY).toBe(-416);
  });

  it('the tbox map pan converges - a second resize does not pan again', () => {
    const vv = makeVisualViewport(844);
    setVisualViewport(vv);
    const store = makeStore();
    pan = new KeyboardAutoPan(store);
    pan.attach();

    const tbox = document.createElement('div');
    tbox.className = 'tbox';
    const ta = document.createElement('textarea');
    tbox.appendChild(ta);
    document.body.appendChild(tbox);
    // The textarea rides the map, so its on-screen bottom tracks panY: a pan
    // up (panY < 0) moves it up by that many pixels. This dynamic stub models
    // the real DOM, where getBoundingClientRect reflects the applied pan.
    ta.getBoundingClientRect = () => {
      const bottom = 800 + store.get().panY;
      return { left: 0, top: bottom - 20, right: 100, bottom, width: 100, height: 20,
        x: 0, y: bottom - 20, toJSON: () => ({}) } as DOMRect;
    };

    ta.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    (vv as unknown as { height: number }).height = 400;
    vv.dispatchEvent(new Event('resize'));
    // 800 + 16 - 400 = 416 -> the map pans up by 416.
    expect(store.get().panY).toBe(-416);

    // A second resize at the same keyboard height: the field now sits
    // margin-clear, so the residual lift is zero - no further pan.
    vv.dispatchEvent(new Event('resize'));
    expect(store.get().panY).toBe(-416);
  });

  it('lifts the bottom sheet when a focused field inside a .mob-sheet is occluded', () => {
    const vv = makeVisualViewport(844);
    setVisualViewport(vv);
    const store = makeStore();
    pan = new KeyboardAutoPan(store);
    pan.attach();

    const sheet = document.createElement('div');
    sheet.className = 'mob-sheet mob-toolsheet';
    const input = document.createElement('input');
    input.type = 'text';
    sheet.appendChild(input);
    document.body.appendChild(sheet);
    stubRect(input, 820);

    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    (vv as unknown as { height: number }).height = 400;
    vv.dispatchEvent(new Event('resize'));

    // 820 + 16 - 400 = 436 -> the sheet is translated up, the map is untouched.
    expect(sheet.style.transform).toBe('translateY(-436px)');
    expect(store.get().panY).toBe(0);
  });

  it('does nothing when the focused field is already above the keyboard', () => {
    const vv = makeVisualViewport(844);
    setVisualViewport(vv);
    const store = makeStore();
    pan = new KeyboardAutoPan(store);
    pan.attach();

    const tbox = document.createElement('div');
    tbox.className = 'tbox';
    const ta = document.createElement('textarea');
    tbox.appendChild(ta);
    document.body.appendChild(tbox);
    stubRect(ta, 300);

    ta.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    (vv as unknown as { height: number }).height = 400;
    vv.dispatchEvent(new Event('resize'));

    expect(store.get().panY).toBe(0);
  });

  it('also lifts on visualViewport scroll (iOS fires scroll rather than resize on some versions)', () => {
    const vv = makeVisualViewport(844);
    setVisualViewport(vv);
    const store = makeStore();
    pan = new KeyboardAutoPan(store);
    pan.attach();

    const sheet = document.createElement('div');
    sheet.className = 'mob-sheet';
    const input = document.createElement('input');
    sheet.appendChild(input);
    document.body.appendChild(sheet);
    stubRect(input, 820);

    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    // Simulate iOS keyboard slide-in via scroll (height stays, offsetTop changes).
    (vv as unknown as { height: number }).height = 400;
    vv.dispatchEvent(new Event('scroll'));
    expect(sheet.style.transform).toBe('translateY(-436px)');
  });

  it('clears a lifted sheet on focusout but leaves the map pan in place', () => {
    const vv = makeVisualViewport(844);
    setVisualViewport(vv);
    const store = makeStore();
    pan = new KeyboardAutoPan(store);
    pan.attach();

    const sheet = document.createElement('div');
    sheet.className = 'mob-sheet';
    const input = document.createElement('input');
    sheet.appendChild(input);
    document.body.appendChild(sheet);
    stubRect(input, 820);

    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    (vv as unknown as { height: number }).height = 400;
    vv.dispatchEvent(new Event('resize'));
    expect(sheet.style.transform).toBe('translateY(-436px)');

    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(sheet.style.transform).toBe('');
  });

  it('is inert when visualViewport is absent (graceful degradation)', () => {
    setVisualViewport(undefined);
    const store = makeStore();
    pan = new KeyboardAutoPan(store);
    expect(() => pan!.attach()).not.toThrow();

    const tbox = document.createElement('div');
    tbox.className = 'tbox';
    const ta = document.createElement('textarea');
    tbox.appendChild(ta);
    document.body.appendChild(tbox);
    stubRect(ta, 800);
    ta.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    expect(store.get().panY).toBe(0);
  });
});
