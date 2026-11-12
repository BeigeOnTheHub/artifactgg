import { describe, it, expect, beforeEach } from 'vitest';
import { TextLayer } from './TextLayer';
import { createStore, type StratState } from '../app/store';
import { createHistory } from '../app/history';
import { emptyFrame, type TextBox } from '../types/primitives';
import { hex } from '../types/hex';

function makeStore() {
  const initial: StratState = {
    mapId: 'miru',
    zoom: 1, panX: 0, panY: 0,
    frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '', tool: 'cursor',
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
  return createStore(initial);
}

const BOX_A: TextBox = {
  id: 'tA', x: 100, y: 100, w: 120, h: 40,
  text: 'hello', fontSize: 13, color: hex('#00ff88'),
};
const BOX_B: TextBox = {
  id: 'tB', x: 300, y: 200, w: 80, h: 32,
  text: '', fontSize: 16, color: hex('#ff4655'),
};

describe('TextLayer', () => {
  let mount: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let layer: TextLayer;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
    store = makeStore();
    const history = createHistory(store);
    const viewport = () => ({
      left: 0, top: 0, width: 1920, height: 1080,
      w: 1920, h: 1080, zoom: 1, panX: 0, panY: 0,
    });
    layer = new TextLayer(mount, store, history, viewport);
    layer.mount();
  });

  it('renders a tbox div with a textarea + 8 handles', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, textboxes: [BOX_A] }] });
    const div = mount.querySelector('[data-tbox-id="tA"]');
    expect(div).not.toBeNull();
    expect(div!.querySelector('textarea.tbox-text')).not.toBeNull();
    expect(div!.querySelectorAll('.tbox-handle')).toHaveLength(8);
  });

  it('positions and sizes the box from map coords', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, textboxes: [BOX_A] }] });
    const div = mount.querySelector('[data-tbox-id="tA"]') as HTMLDivElement;
    expect(div.style.left).toBe('100px');
    expect(div.style.top).toBe('100px');
    expect(div.style.width).toBe('120px');
    expect(div.style.height).toBe('40px');
  });

  it('writes textarea value and font-size from the box', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, textboxes: [BOX_A] }] });
    const ta = mount.querySelector('[data-tbox-id="tA"] textarea') as HTMLTextAreaElement;
    expect(ta.value).toBe('hello');
    expect(ta.style.fontSize).toBe('13px');
  });

  it('mutates an existing box in place rather than rebuilding (node identity stable)', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, textboxes: [BOX_A] }] });
    const before = mount.querySelector('[data-tbox-id="tA"]')!;
    const moved: TextBox = { ...BOX_A, x: 500, y: 500 };
    store._apply({ frames: [{ ...store.get().frames[0]!, textboxes: [moved] }] });
    const after = mount.querySelector('[data-tbox-id="tA"]')!;
    expect(after).toBe(before);
    expect((after as HTMLDivElement).style.left).toBe('500px');
  });

  it('does not clobber textarea.value while it is focused', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, textboxes: [BOX_A] }] });
    const ta = mount.querySelector('[data-tbox-id="tA"] textarea') as HTMLTextAreaElement;
    ta.focus();
    ta.value = 'mid-edit';
    // Now an external change writes a different .text - the layer must NOT overwrite the focused textarea.
    const updated: TextBox = { ...BOX_A, text: 'external' };
    store._apply({ frames: [{ ...store.get().frames[0]!, textboxes: [updated] }] });
    expect(ta.value).toBe('mid-edit');
  });

  it('removes nodes for deleted boxes', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, textboxes: [BOX_A, BOX_B] }] });
    expect(mount.querySelectorAll('[data-tbox-id]')).toHaveLength(2);
    store._apply({ frames: [{ ...store.get().frames[0]!, textboxes: [BOX_B] }] });
    const remaining = Array.from(mount.querySelectorAll('[data-tbox-id]')).map(
      (n) => n.getAttribute('data-tbox-id'),
    );
    expect(remaining).toEqual(['tB']);
  });

  it('destroy detaches subscriptions and removes the host children', () => {
    layer.destroy();
    expect(mount.querySelectorAll('[data-tbox-id]')).toHaveLength(0);
    expect(() => store._apply({
      frames: [{ ...store.get().frames[0]!, textboxes: [BOX_A] }],
    })).not.toThrow();
  });

  it('pointercancel mid-resize reverts the box dimensions and does not dispatch', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, textboxes: [BOX_A] }] });
    const div = mount.querySelector('[data-tbox-id="tA"]') as HTMLDivElement;
    const se = div.querySelector('.tbox-handle[data-dir="se"]') as HTMLElement;
    se.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 220, clientY: 140, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, button: 0, clientX: 320, clientY: 240, bubbles: true }));
    // Live preview has grown the box past its original 120x40.
    expect(store.get().frames[0]!.textboxes[0]!.w).toBeGreaterThan(120);
    document.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, button: 0, clientX: 320, clientY: 240, bubbles: true }));
    const b = store.get().frames[0]!.textboxes[0]!;
    expect(b.w).toBe(120);
    expect(b.h).toBe(40);
    expect(b.x).toBe(100);
    expect(b.y).toBe(100);
  });
});
