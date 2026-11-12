import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getTheme, setTheme, subscribeTheme, cycleTheme, applyTheme, attachTheme } from './themePref';

const KEY = 'artifact-gg.v2.theme';

function stubMatchMedia(map: Record<string, boolean>) {
  (window as unknown as { matchMedia: unknown }).matchMedia = vi.fn(
    (q: string) => ({ matches: !!map[q], media: q, addEventListener() {}, removeEventListener() {} }),
  );
}

beforeEach(() => {
  localStorage.clear();
  stubMatchMedia({}); // default: no OS preference -> dark
});
afterEach(() => { vi.restoreAllMocks(); });

describe('themePref - stored value', () => {
  it('returns a valid stored theme verbatim', () => {
    localStorage.setItem(KEY, 'light');
    expect(getTheme()).toBe('light');
  });
  it('ignores an invalid stored value and falls back to OS resolution', () => {
    localStorage.setItem(KEY, 'banana');
    expect(getTheme()).toBe('dark'); // no OS hint stubbed
  });
});

describe('themePref - first-visit OS resolution', () => {
  it('prefers-contrast: more wins -> high-contrast', () => {
    stubMatchMedia({ '(prefers-contrast: more)': true, '(prefers-color-scheme: light)': true });
    expect(getTheme()).toBe('high-contrast');
  });
  it('prefers-color-scheme: light (no contrast hint) -> light', () => {
    stubMatchMedia({ '(prefers-color-scheme: light)': true });
    expect(getTheme()).toBe('light');
  });
  it('no hints -> dark', () => {
    expect(getTheme()).toBe('dark');
  });
});

describe('themePref - set / subscribe', () => {
  it('setTheme persists and notifies on change; teardown stops notifications', () => {
    const seen: string[] = [];
    const off = subscribeTheme((t) => seen.push(t));
    setTheme('light');
    expect(localStorage.getItem(KEY)).toBe('light');
    expect(getTheme()).toBe('light');
    expect(seen).toEqual(['light']);
    off();
    setTheme('dark');
    expect(seen).toEqual(['light']); // no further notifications after teardown
  });

  it('setTheme to the current value does not notify', () => {
    localStorage.setItem(KEY, 'dark');
    const seen: string[] = [];
    const off = subscribeTheme((t) => seen.push(t));
    setTheme('dark');
    expect(seen).toEqual([]);
    off();
  });

  it('cycleTheme advances dark -> light -> high-contrast -> dark', () => {
    localStorage.setItem(KEY, 'dark');
    expect(cycleTheme()).toBe('light');
    expect(cycleTheme()).toBe('high-contrast');
    expect(cycleTheme()).toBe('dark');
  });
});

describe('themePref - DOM application', () => {
  it('applyTheme sets data-theme on the given element', () => {
    const el = document.createElement('div');
    applyTheme('light', el);
    expect(el.dataset.theme).toBe('light');
  });

  it('attachTheme applies the current theme immediately and on later changes', () => {
    localStorage.setItem(KEY, 'dark');
    const el = document.createElement('div');
    const off = attachTheme(el);
    expect(el.dataset.theme).toBe('dark');
    setTheme('high-contrast');
    expect(el.dataset.theme).toBe('high-contrast');
    off();
    setTheme('light');
    expect(el.dataset.theme).toBe('high-contrast'); // unsubscribed: no longer updates
  });
});
