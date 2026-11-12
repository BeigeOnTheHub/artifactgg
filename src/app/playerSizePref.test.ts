import { describe, it, expect, beforeEach } from 'vitest';
import {
  getPlayerSizeMode, setPlayerSizeMode,
  getPlayerSizeFactor, setPlayerSizeFactor,
  subscribePlayerSize,
  MIN_PLAYER_FACTOR, MAX_PLAYER_FACTOR,
} from './playerSizePref';

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  setPlayerSizeMode('auto');
  setPlayerSizeFactor(1);
});

describe('playerSizePref', () => {
  it('defaults to auto @ 1', () => {
    expect(getPlayerSizeMode()).toBe('auto');
    expect(getPlayerSizeFactor()).toBe(1);
  });

  it('mode set persists and reads back', () => {
    setPlayerSizeMode('manual');
    expect(getPlayerSizeMode()).toBe('manual');
    setPlayerSizeMode('auto');
    expect(getPlayerSizeMode()).toBe('auto');
  });

  it('clamps the factor to the allowed range', () => {
    setPlayerSizeFactor(99);
    expect(getPlayerSizeFactor()).toBe(MAX_PLAYER_FACTOR);
    setPlayerSizeFactor(0.01);
    expect(getPlayerSizeFactor()).toBe(MIN_PLAYER_FACTOR);
  });

  it('notifies subscribers on a real change only', () => {
    let calls = 0;
    const off = subscribePlayerSize(() => { calls += 1; });
    setPlayerSizeMode('manual');
    expect(calls).toBe(1);
    setPlayerSizeMode('manual'); // no change
    expect(calls).toBe(1);
    setPlayerSizeFactor(1.5);
    expect(calls).toBe(2);
    setPlayerSizeFactor(1.5); // no change
    expect(calls).toBe(2);
    off();
    setPlayerSizeFactor(2);
    expect(calls).toBe(2);
  });
});
