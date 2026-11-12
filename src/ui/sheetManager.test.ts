import { describe, it, expect, vi } from 'vitest';
import { createSheetManager } from './sheetManager';

function sheetEl(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function down(target: EventTarget): void {
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
}

describe('createSheetManager', () => {
  it('opening a second sheet closes the first, exactly once', () => {
    const m = createSheetManager();
    const a = vi.fn(), b = vi.fn();
    m.open({ el: sheetEl(), onClose: a, dismiss: 'swallow' });
    m.open({ el: sheetEl(), onClose: b, dismiss: 'swallow' });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    m.destroy();
  });

  it('a pointerdown outside closes the open sheet', () => {
    const m = createSheetManager();
    const close = vi.fn();
    m.open({ el: sheetEl(), onClose: close, dismiss: 'swallow' });
    down(document.body);
    expect(close).toHaveBeenCalledTimes(1);
    expect(m.current()).toBeNull();
    m.destroy();
  });

  it('a pointerdown inside the sheet leaves it open', () => {
    const m = createSheetManager();
    const close = vi.fn();
    const el = sheetEl();
    const child = document.createElement('button');
    el.appendChild(child);
    m.open({ el, onClose: close, dismiss: 'swallow' });
    down(child);
    expect(close).not.toHaveBeenCalled();
    expect(m.current()).toBe(el);
    m.destroy();
  });

  it('swallow stops the dismissing tap reaching anything else', () => {
    const m = createSheetManager();
    const seen: string[] = [];
    const listener = (): void => { seen.push('map'); };
    document.body.addEventListener('pointerdown', listener);
    m.open({ el: sheetEl(), onClose: () => {}, dismiss: 'swallow' });
    down(document.body);
    expect(seen).toEqual([]);
    document.body.removeEventListener('pointerdown', listener);
    m.destroy();
  });

  it('passthrough lets the dismissing tap carry on', () => {
    // The tool-settings sheet auto-opens when a tool is picked, so the first stroke
    // after picking Draw has to draw rather than be eaten closing the sheet.
    const m = createSheetManager();
    const seen: string[] = [];
    const listener = (): void => { seen.push('map'); };
    document.body.addEventListener('pointerdown', listener);
    m.open({ el: sheetEl(), onClose: () => {}, dismiss: 'passthrough' });
    down(document.body);
    expect(seen).toEqual(['map']);
    document.body.removeEventListener('pointerdown', listener);
    m.destroy();
  });

  it('Escape closes the open sheet', () => {
    const m = createSheetManager();
    const close = vi.fn();
    m.open({ el: sheetEl(), onClose: close, dismiss: 'swallow' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(close).toHaveBeenCalledTimes(1);
    m.destroy();
  });

  it('leaves an exempt target alone', () => {
    // The menu button toggles its own sheet; if the dismissal ate its tap the
    // sheet would close and immediately reopen (or never close at all).
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const m = createSheetManager({ isExempt: (t) => t === btn });
    const close = vi.fn();
    m.open({ el: sheetEl(), onClose: close, dismiss: 'swallow' });
    down(btn);
    expect(close).not.toHaveBeenCalled();
    btn.remove();
    m.destroy();
  });

  it('closeAll with nothing open is a no-op and close is idempotent', () => {
    const m = createSheetManager();
    expect(() => m.closeAll()).not.toThrow();
    const close = vi.fn();
    m.open({ el: sheetEl(), onClose: close, dismiss: 'swallow' });
    m.close();
    m.close();
    expect(close).toHaveBeenCalledTimes(1);
    m.destroy();
  });

  it('survives an onClose that closes again', () => {
    // MobileColourSheet's onClose writes a store flag whose subscriber calls back
    // in; the record has to be cleared before onClose runs or that recurses.
    const m = createSheetManager();
    let calls = 0;
    m.open({
      el: sheetEl(),
      onClose: () => { calls += 1; m.close(); },
      dismiss: 'swallow',
    });
    expect(() => m.close()).not.toThrow();
    expect(calls).toBe(1);
    m.destroy();
  });

  it('stops listening once nothing is open', () => {
    const m = createSheetManager();
    const close = vi.fn();
    m.open({ el: sheetEl(), onClose: close, dismiss: 'swallow' });
    m.close();
    const seen: string[] = [];
    const listener = (): void => { seen.push('map'); };
    document.body.addEventListener('pointerdown', listener);
    down(document.body);
    expect(seen).toEqual(['map']); // no lingering swallow
    expect(close).toHaveBeenCalledTimes(1);
    document.body.removeEventListener('pointerdown', listener);
    m.destroy();
  });

  it('destroy closes what is open and unhooks', () => {
    const m = createSheetManager();
    const close = vi.fn();
    m.open({ el: sheetEl(), onClose: close, dismiss: 'swallow' });
    m.destroy();
    expect(close).toHaveBeenCalledTimes(1);
    down(document.body);
    expect(close).toHaveBeenCalledTimes(1); // the stray tap did nothing
  });
});
