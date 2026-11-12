import { describe, it, expect } from 'vitest';
import { insulateChromePointerEvents } from './touchChrome';

describe('insulateChromePointerEvents', () => {
  it('marks the element with data-touch-chrome', () => {
    const el = document.createElement('div');
    insulateChromePointerEvents(el);
    expect(el.dataset['touchChrome']).toBe('');
  });

  it('stops pointer events bubbling past the element', () => {
    const parent = document.createElement('div');
    const chrome = document.createElement('div');
    parent.appendChild(chrome);
    let parentSaw = 0;
    parent.addEventListener('pointerdown', () => { parentSaw++; });
    insulateChromePointerEvents(chrome);
    chrome.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(parentSaw).toBe(0);
  });

  it('does not stop the element\'s own handlers from running', () => {
    const chrome = document.createElement('div');
    let ran = 0;
    chrome.addEventListener('pointerdown', () => { ran++; });
    insulateChromePointerEvents(chrome);
    chrome.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(ran).toBe(1);
  });

  it('stops events that originate on a descendant of the insulated root', () => {
    const parent = document.createElement('div');
    const chrome = document.createElement('div');
    const child = document.createElement('button');
    chrome.appendChild(child);
    parent.appendChild(chrome);
    let parentSaw = 0;
    parent.addEventListener('pointerdown', () => { parentSaw++; });
    insulateChromePointerEvents(chrome);
    child.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(parentSaw).toBe(0);
  });
});
