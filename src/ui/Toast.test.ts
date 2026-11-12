import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { toast } from './Toast';

describe('Toast singleton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toast._test.reset();
  });
  afterEach(() => {
    toast._test.reset();
    vi.useRealTimers();
  });

  it('success() shows a success toast in document.body', () => {
    toast.success('Saved');
    const el = document.body.querySelector('.toast');
    expect(el).not.toBeNull();
    expect(el!.classList.contains('toast--success')).toBe(true);
    expect(el!.textContent).toContain('Saved');
  });

  it('error() shows an error toast', () => {
    toast.error('Failed');
    const el = document.body.querySelector('.toast');
    expect(el!.classList.contains('toast--error')).toBe(true);
  });

  it('info() shows an info toast', () => {
    toast.info('Note');
    const el = document.body.querySelector('.toast');
    expect(el!.classList.contains('toast--info')).toBe(true);
  });

  it('success auto-dismisses after 3000 ms', () => {
    toast.success('Saved');
    expect(document.body.querySelector('.toast')).not.toBeNull();
    vi.advanceTimersByTime(2999);
    expect(document.body.querySelector('.toast')).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(document.body.querySelector('.toast')).toBeNull();
  });

  it('info auto-dismisses after 3000 ms', () => {
    toast.info('Note');
    vi.advanceTimersByTime(3000);
    expect(document.body.querySelector('.toast')).toBeNull();
  });

  it('error stays sticky past 3000 ms', () => {
    toast.error('Failed');
    vi.advanceTimersByTime(10_000);
    expect(document.body.querySelector('.toast')).not.toBeNull();
  });

  it('bursts queue instead of overwriting (second appears after first auto-dismisses)', () => {
    toast.success('First');
    toast.success('Second');
    // Only the first is on screen while it's still active.
    let els = document.body.querySelectorAll('.toast');
    expect(els.length).toBe(1);
    expect(els[0]!.textContent).toContain('First');
    // After the first auto-dismisses, the second takes its place.
    vi.advanceTimersByTime(AUTO_DISMISS_MS);
    els = document.body.querySelectorAll('.toast');
    expect(els.length).toBe(1);
    expect(els[0]!.textContent).toContain('Second');
  });

  it('dismiss() removes the active toast and drains anything queued behind it', () => {
    toast.error('First');
    toast.success('Second');
    toast.dismiss();
    expect(document.body.querySelector('.toast')).toBeNull();
    // The queue is empty now -- nothing else surfaces.
    vi.advanceTimersByTime(AUTO_DISMISS_MS);
    expect(document.body.querySelector('.toast')).toBeNull();
  });

  it('clicking the close button advances the queue to the next toast', () => {
    toast.error('First');
    toast.success('Second');
    const close = document.body.querySelector('.toast-close') as HTMLButtonElement;
    expect(close).not.toBeNull();
    close.click();
    const el = document.body.querySelector('.toast')!;
    expect(el.textContent).toContain('Second');
  });

  it('root container is a polite live region for screen readers', () => {
    toast.info('Hi');
    const root = document.body.querySelector('.toast-root')!;
    expect(root.getAttribute('role')).toBe('status');
    expect(root.getAttribute('aria-live')).toBe('polite');
    expect(root.getAttribute('aria-atomic')).toBe('true');
    expect(root.getAttribute('aria-label')).toBe('Notifications');
  });

  describe('prompt variant', () => {
    it('renders an action button and a close, and stays sticky past 3000 ms', () => {
      toast.prompt('Restore unsaved work?', { actionLabel: 'Restore', onAction: () => {} });
      const el = document.body.querySelector('.toast')!;
      expect(el.classList.contains('toast--prompt')).toBe(true);
      expect(el.querySelector('.toast-action')!.textContent).toBe('Restore');
      expect(el.querySelector('.toast-close')).not.toBeNull();
      vi.advanceTimersByTime(10_000);
      expect(document.body.querySelector('.toast')).not.toBeNull();
    });

    it('clicking the action runs onAction (not onDismiss) and tears the toast down', () => {
      const onAction = vi.fn();
      const onDismiss = vi.fn();
      toast.prompt('Restore unsaved work?', { actionLabel: 'Restore', onAction, onDismiss });
      const action = document.body.querySelector('.toast-action') as HTMLButtonElement;
      action.click();
      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onDismiss).not.toHaveBeenCalled();
      expect(document.body.querySelector('.toast')).toBeNull();
    });

    it('clicking close runs onDismiss (not onAction) and tears the toast down', () => {
      const onAction = vi.fn();
      const onDismiss = vi.fn();
      toast.prompt('Restore unsaved work?', { actionLabel: 'Restore', onAction, onDismiss });
      const close = document.body.querySelector('.toast-close') as HTMLButtonElement;
      close.click();
      expect(onDismiss).toHaveBeenCalledTimes(1);
      expect(onAction).not.toHaveBeenCalled();
      expect(document.body.querySelector('.toast')).toBeNull();
    });

    it('dismiss() leaves an active or queued prompt alone; only the user answers it', () => {
      const onDismiss = vi.fn();
      toast.prompt('Restore?', { actionLabel: 'Restore', onAction: () => {}, onDismiss });
      toast.info('Exporting PNG...');
      toast.dismiss();
      expect(onDismiss).not.toHaveBeenCalled();
      expect(document.body.querySelector('.toast--prompt')).not.toBeNull();

      toast._test.reset();
      toast.error('first');
      toast.prompt('Restore?', { actionLabel: 'Restore', onAction: () => {} });
      toast.dismiss();
      expect(document.body.querySelector('.toast--prompt')).not.toBeNull();
    });

    it('onDismiss is optional -- close still works without it', () => {
      const onAction = vi.fn();
      toast.prompt('Restore?', { actionLabel: 'Restore', onAction });
      const close = document.body.querySelector('.toast-close') as HTMLButtonElement;
      expect(() => close.click()).not.toThrow();
      expect(onAction).not.toHaveBeenCalled();
      expect(document.body.querySelector('.toast')).toBeNull();
    });
  });
});

const AUTO_DISMISS_MS = 3000;
