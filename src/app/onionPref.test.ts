import { describe, it, expect, beforeEach } from 'vitest';
import { isOnionOn, setOnion, subscribeOnion } from './onionPref';

beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } setOnion(false); });

describe('onionPref', () => {
  it('reads back off after explicit set', () => {
    setOnion(false);
    expect(isOnionOn()).toBe(false);
  });
  it('set persists and reads back', () => {
    setOnion(true); expect(isOnionOn()).toBe(true);
    setOnion(false); expect(isOnionOn()).toBe(false);
  });
  it('notifies subscribers on change only', () => {
    let seen: boolean | null = null;
    let calls = 0;
    const off = subscribeOnion((v) => { seen = v; calls += 1; });
    setOnion(true);
    expect(seen).toBe(true);
    expect(calls).toBe(1);
    setOnion(true); // no change -> no extra notify
    expect(calls).toBe(1);
    off();
  });
});
