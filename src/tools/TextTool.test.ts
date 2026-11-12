import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TextTool } from './TextTool';
import { TextLayer } from '../render/TextLayer';
import { createStore, type StratState } from '../app/store';
import { createHistory } from '../app/history';
import { emptyFrame, type TextBox } from '../types/primitives';
import { hex } from '../types/hex';

function makeStore() {
  const initial: StratState = {
    mapId: 'miru',
    zoom: 1, panX: 0, panY: 0,
    frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '', tool: 'place-text',
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
  return createStore(initial);
}

const fakeViewport = () => ({
  left: 0, top: 0, width: 1920, height: 1080,
  w: 1920, h: 1080, zoom: 1, panX: 0, panY: 0,
});

describe('TextTool', () => {
  let target: HTMLElement;
  let layerHost: HTMLElement;
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;
  let layer: TextLayer;
  let tool: TextTool;

  beforeEach(() => {
    target = document.createElement('div');
    layerHost = document.createElement('div');
    document.body.appendChild(target);
    document.body.appendChild(layerHost);
    store = makeStore();
    history = createHistory(store);
    layer = new TextLayer(layerHost, store, history, fakeViewport);
    layer.mount();
    tool = new TextTool({ store, history, textLayer: layer, getViewport: fakeViewport });
    tool.attach(target);
  });

  it('left-click empty space dispatches textbox.add at the click point', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true }));
    const boxes = store.get().frames[0]!.textboxes;
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.x).toBe(200);
    expect(boxes[0]!.y).toBe(200);
    expect(boxes[0]!.text).toBe('');
  });

  it('placing a textbox auto-switches the active tool to cursor', () => {
    expect(store.get().tool).toBe('place-text');
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true }));
    expect(store.get().tool).toBe('cursor');
    // The auto-switch is a view-state change - it must not push an extra
    // history entry, so undo cleanly reverts the textbox in one step.
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(store.get().frames[0]!.textboxes).toHaveLength(0);
  });

  it('placing then blurring an empty textbox dispatches textbox.delete', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true }));
    const id = store.get().frames[0]!.textboxes[0]!.id;
    const ta = layerHost.querySelector(`[data-tbox-id="${id}"] textarea`) as HTMLTextAreaElement;
    ta.dispatchEvent(new FocusEvent('focus'));
    ta.value = '';
    ta.dispatchEvent(new FocusEvent('blur'));
    expect(store.get().frames[0]!.textboxes).toHaveLength(0);
  });

  it('editing then blurring with non-empty changed text dispatches textbox.modify', () => {
    const box: TextBox = { id: 't1', x: 100, y: 100, w: 120, h: 40, text: 'old', fontSize: 13, color: hex('#00ff88') };
    store._apply({ frames: [{ ...store.get().frames[0]!, textboxes: [box] }] });
    const ta = layerHost.querySelector(`[data-tbox-id="t1"] textarea`) as HTMLTextAreaElement;
    ta.dispatchEvent(new FocusEvent('focus'));
    ta.value = 'new';
    ta.dispatchEvent(new FocusEvent('blur'));
    expect(store.get().frames[0]!.textboxes[0]!.text).toBe('new');
    history.undo();
    expect(store.get().frames[0]!.textboxes[0]!.text).toBe('old');
  });

  it('blur with unchanged text does not dispatch a command', () => {
    const box: TextBox = { id: 't1', x: 100, y: 100, w: 120, h: 40, text: 'same', fontSize: 13, color: hex('#00ff88') };
    store._apply({ frames: [{ ...store.get().frames[0]!, textboxes: [box] }] });
    const ta = layerHost.querySelector(`[data-tbox-id="t1"] textarea`) as HTMLTextAreaElement;
    ta.dispatchEvent(new FocusEvent('focus'));
    ta.dispatchEvent(new FocusEvent('blur'));
    expect(history.canUndo()).toBe(false);
  });

  it('contextmenu on a textbox dispatches textbox.delete', () => {
    const box: TextBox = { id: 't1', x: 100, y: 100, w: 120, h: 40, text: 'x', fontSize: 13, color: hex('#00ff88') };
    store._apply({ frames: [{ ...store.get().frames[0]!, textboxes: [box] }] });
    const div = layerHost.querySelector(`[data-tbox-id="t1"]`) as HTMLDivElement;
    div.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(store.get().frames[0]!.textboxes).toHaveLength(0);
  });

  it('drag on border-strip dispatches textbox.modify with new x,y', () => {
    const box: TextBox = { id: 't1', x: 100, y: 100, w: 120, h: 40, text: 'x', fontSize: 13, color: hex('#00ff88') };
    store._apply({ frames: [{ ...store.get().frames[0]!, textboxes: [box] }] });
    const div = layerHost.querySelector(`[data-tbox-id="t1"]`) as HTMLDivElement;
    div.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 105, clientY: 105, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 250, clientY: 200, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 250, clientY: 200, bubbles: true }));
    const after = store.get().frames[0]!.textboxes[0]!;
    expect(after.x).toBe(245);
    expect(after.y).toBe(195);
  });

  it('drag on handle dispatches textbox.modify with new w,h', () => {
    const box: TextBox = { id: 't1', x: 100, y: 100, w: 120, h: 40, text: 'x', fontSize: 13, color: hex('#00ff88') };
    store._apply({ frames: [{ ...store.get().frames[0]!, textboxes: [box] }] });
    const handle = layerHost.querySelector(`[data-tbox-id="t1"] .tbox-handle--se`) as HTMLDivElement;
    handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 220, clientY: 140, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 320, clientY: 200, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 320, clientY: 200, bubbles: true }));
    const after = store.get().frames[0]!.textboxes[0]!;
    expect(after.w).toBe(220);
    expect(after.h).toBe(100);
  });

  it('right-click on empty space does not place', () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 2, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 2, clientX: 100, clientY: 100, bubbles: true }));
    expect(store.get().frames[0]!.textboxes).toHaveLength(0);
  });

  it('detach removes listeners - pointerdown after detach has no effect', () => {
    tool.detach();
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true }));
    expect(store.get().frames[0]!.textboxes).toHaveLength(0);
  });

  describe('TextTool - cancel() and touch input', () => {
    it('reverts an in-flight text box move drag and dispatches nothing', () => {
      const box: TextBox = { id: 't1', x: 100, y: 100, w: 120, h: 40, text: 'x', fontSize: 13, color: hex('#00ff88') };
      store._apply({ frames: [{ ...store.get().frames[0]!, textboxes: [box] }] });
      const div = layerHost.querySelector(`[data-tbox-id="t1"]`) as HTMLDivElement;
      div.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 105, clientY: 105, bubbles: true }));
      target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 250, clientY: 200, bubbles: true }));
      // The live preview has moved the box off its snapshot.
      expect(store.get().frames[0]!.textboxes[0]!.x).not.toBe(100);
      const dispatch = vi.spyOn(history, 'dispatch');
      tool.cancel();
      const after = store.get().frames[0]!.textboxes[0]!;
      expect(after.x).toBe(100);
      expect(after.y).toBe(100);
      expect(dispatch).not.toHaveBeenCalled();
      // A subsequent pointerup must not commit the aborted move.
      target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 250, clientY: 200, bubbles: true }));
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('is a no-op with no in-flight drag', () => {
      expect(() => tool.cancel()).not.toThrow();
    });

    it('pointercancel event routes through cancel() instead of committing the move', () => {
      const box: TextBox = { id: 't1', x: 100, y: 100, w: 120, h: 40, text: 'x', fontSize: 13, color: hex('#00ff88') };
      store._apply({ frames: [{ ...store.get().frames[0]!, textboxes: [box] }] });
      const div = layerHost.querySelector(`[data-tbox-id="t1"]`) as HTMLDivElement;
      div.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 105, clientY: 105, bubbles: true }));
      target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 250, clientY: 200, bubbles: true }));
      const dispatch = vi.spyOn(history, 'dispatch');
      target.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, button: 0, clientX: 250, clientY: 200, bubbles: true }));
      const after = store.get().frames[0]!.textboxes[0]!;
      expect(after.x).toBe(100);
      expect(after.y).toBe(100);
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('a one-finger touch tap places a text box and hands off to the select tool', () => {
      expect(store.get().tool).toBe('place-text');
      target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', button: 0, clientX: 200, clientY: 200, bubbles: true }));
      const boxes = store.get().frames[0]!.textboxes;
      expect(boxes).toHaveLength(1);
      expect(boxes[0]!.x).toBe(200);
      expect(boxes[0]!.y).toBe(200);
      // Desktop parity: after placing a box the tool hands off to Select.
      expect(store.get().tool).toBe('cursor');
    });
  });

  describe('TextTool - context panel', () => {
    it('renders a font-size slider', () => {
      const panel = tool.getContextPanel();
      const slider = panel.querySelector('input[type="range"].cp-slider') as HTMLInputElement;
      expect(slider).toBeTruthy();
      expect(slider.getAttribute('min')).toBe('8');
      expect(slider.getAttribute('max')).toBe('48');
    });

    it('moving the slider calls setFontSize', () => {
      const panel = tool.getContextPanel();
      const slider = panel.querySelector('input[type="range"].cp-slider') as HTMLInputElement;
      slider.value = '20';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      expect(tool.getFontSize()).toBe(20);
    });

    it('placed textbox uses tool-instance fontSize', () => {
      tool.setFontSize(20);
      target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true }));
      target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 200, clientY: 200, bubbles: true }));
      const box = store.get().frames[0]!.textboxes[0]!;
      expect(box.fontSize).toBe(20);
    });
  });
});
