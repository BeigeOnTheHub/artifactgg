import { describe, it, expect, vi, beforeEach } from 'vitest';
import { register, _resetForTests } from './outsideClick';

describe('outsideClick - registry', () => {
  beforeEach(() => {
    _resetForTests();
  });

  it('fires close() on a document pointerdown when predicate returns false', () => {
    const inner = document.createElement('div');
    document.body.appendChild(inner);
    const close = vi.fn();
    register((target) => target === inner, close);

    const outside = document.createElement('div');
    document.body.appendChild(outside);
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(close).toHaveBeenCalledTimes(1);
    document.body.removeChild(inner);
    document.body.removeChild(outside);
  });

  it('does NOT fire close() when predicate returns true (click inside)', () => {
    const inner = document.createElement('div');
    document.body.appendChild(inner);
    const close = vi.fn();
    register((target) => target === inner, close);

    inner.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(close).not.toHaveBeenCalled();
    document.body.removeChild(inner);
  });

  it('returns an unregister handle that stops further calls', () => {
    const close = vi.fn();
    const off = register(() => false, close);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(close).toHaveBeenCalledTimes(1);

    off();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('walks all registered entries on a single pointerdown', () => {
    const closeA = vi.fn();
    const closeB = vi.fn();
    register(() => false, closeA);
    register(() => false, closeB);

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).toHaveBeenCalledTimes(1);
  });

  it('detaches the document listener when the registry empties', () => {
    const spy = vi.spyOn(document, 'addEventListener');
    const off = register(() => true, () => {});
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();

    const removeSpy = vi.spyOn(document, 'removeEventListener');
    off();
    expect(removeSpy).toHaveBeenCalledTimes(1);
    removeSpy.mockRestore();
  });
});
