import { describe, it, expect, beforeEach } from 'vitest';
import { APP_VERSION, LAST_SEEN_KEY, shouldAutoOpenChangelog, markChangelogSeen } from './version';

describe('version', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('exports a non-empty APP_VERSION', () => {
    expect(typeof APP_VERSION).toBe('string');
    expect(APP_VERSION.length).toBeGreaterThan(0);
  });

  it('shouldAutoOpenChangelog returns true on first boot (no key)', () => {
    expect(shouldAutoOpenChangelog()).toBe(true);
  });

  it('shouldAutoOpenChangelog returns true when stored version mismatches APP_VERSION', () => {
    localStorage.setItem(LAST_SEEN_KEY, 'older-version');
    expect(shouldAutoOpenChangelog()).toBe(true);
  });

  it('shouldAutoOpenChangelog returns false when stored version matches', () => {
    localStorage.setItem(LAST_SEEN_KEY, APP_VERSION);
    expect(shouldAutoOpenChangelog()).toBe(false);
  });

  it('markChangelogSeen writes APP_VERSION to localStorage', () => {
    markChangelogSeen();
    expect(localStorage.getItem(LAST_SEEN_KEY)).toBe(APP_VERSION);
  });

  it('markChangelogSeen makes shouldAutoOpenChangelog return false', () => {
    markChangelogSeen();
    expect(shouldAutoOpenChangelog()).toBe(false);
  });
});
