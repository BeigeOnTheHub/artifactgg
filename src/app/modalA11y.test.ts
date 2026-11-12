import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { activateModalA11y } from './modalA11y';

describe('activateModalA11y', () => {
  let panel: HTMLDivElement;
  let title: HTMLDivElement;
  let triggerButton: HTMLButtonElement;

  beforeEach(() => {
    // The button outside the modal that "opened" it - focus restore should
    // come back here on deactivate.
    triggerButton = document.createElement('button');
    triggerButton.textContent = 'Open modal';
    document.body.appendChild(triggerButton);
    triggerButton.focus();

    panel = document.createElement('div');
    title = document.createElement('div');
    title.textContent = 'Modal title';
    panel.appendChild(title);
    document.body.appendChild(panel);
  });

  afterEach(() => {
    triggerButton.remove();
    panel.remove();
  });

  it('sets role=dialog and aria-modal=true on the panel', () => {
    activateModalA11y({ panel, title });
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
  });

  it('assigns an id to the title and wires aria-labelledby', () => {
    activateModalA11y({ panel, title });
    expect(title.id).not.toBe('');
    expect(panel.getAttribute('aria-labelledby')).toBe(title.id);
  });

  it('focuses the first focusable inside the panel by default', () => {
    const first = document.createElement('button');
    first.textContent = 'first';
    const second = document.createElement('button');
    second.textContent = 'second';
    panel.appendChild(first);
    panel.appendChild(second);
    activateModalA11y({ panel, title });
    expect(document.activeElement).toBe(first);
  });

  it('honours an explicit initialFocus', () => {
    const a = document.createElement('button');
    const b = document.createElement('button');
    panel.appendChild(a);
    panel.appendChild(b);
    activateModalA11y({ panel, title, initialFocus: b });
    expect(document.activeElement).toBe(b);
  });

  it('restores focus to the previously-focused element on deactivate', () => {
    const button = document.createElement('button');
    panel.appendChild(button);
    const deactivate = activateModalA11y({ panel, title });
    expect(document.activeElement).toBe(button);
    deactivate();
    expect(document.activeElement).toBe(triggerButton);
  });

  it('Tab on the last focusable wraps to the first (focus trap)', () => {
    const a = document.createElement('button');
    const b = document.createElement('button');
    panel.appendChild(a);
    panel.appendChild(b);
    activateModalA11y({ panel, title });
    b.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    panel.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(a);
  });

  it('Shift+Tab on the first focusable wraps to the last (focus trap)', () => {
    const a = document.createElement('button');
    const b = document.createElement('button');
    panel.appendChild(a);
    panel.appendChild(b);
    activateModalA11y({ panel, title });
    a.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    panel.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(b);
  });

  it('deactivate is idempotent (second call is a no-op)', () => {
    panel.appendChild(document.createElement('button'));
    const deactivate = activateModalA11y({ panel, title });
    deactivate();
    expect(() => deactivate()).not.toThrow();
  });
});
