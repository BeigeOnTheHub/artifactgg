import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolId } from '../types/primitives';
import { hydrate, watch, STORAGE_KEY, type SettableTool } from './toolSettingsPersistence';

function makeTool(id: ToolId, initial: Record<string, unknown>): SettableTool & { _settings: Record<string, unknown>; _cb: (() => void) | null } {
  const tool = {
    id,
    _settings: { ...initial },
    _cb: null as (() => void) | null,
    getSettings: () => tool._settings,
    setSettings: (s: unknown) => { tool._settings = { ...(s as Record<string, unknown>) }; tool._cb?.(); },
    onSettingsChanged: (cb: () => void) => {
      tool._cb = cb;
      return () => { if (tool._cb === cb) tool._cb = null; };
    },
  };
  return tool;
}

describe('toolSettingsPersistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  it('hydrate is a no-op when localStorage is empty', () => {
    const draw = makeTool('draw', { size: 4 });
    hydrate([draw]);
    expect(draw._settings).toEqual({ size: 4 });
  });

  it('hydrate restores stored settings per tool', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ draw: { size: 22 }, shapes: { kind: 'circle' } }));
    const draw = makeTool('draw', { size: 4 });
    const shapes = makeTool('shapes', { kind: 'square' });
    hydrate([draw, shapes]);
    expect(draw._settings).toEqual({ size: 22 });
    expect(shapes._settings).toEqual({ kind: 'circle' });
  });

  it('hydrate ignores entries for unregistered tool ids', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ unknown: { foo: 1 }, draw: { size: 9 } }));
    const draw = makeTool('draw', { size: 4 });
    hydrate([draw]);
    expect(draw._settings).toEqual({ size: 9 });
  });

  it('hydrate is silent on JSON parse error', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const draw = makeTool('draw', { size: 4 });
    expect(() => hydrate([draw])).not.toThrow();
    expect(draw._settings).toEqual({ size: 4 });
  });

  it('watch writes a debounced snapshot of all tools after a change', () => {
    const draw = makeTool('draw', { size: 4 });
    const shapes = makeTool('shapes', { kind: 'square' });
    const off = watch([draw, shapes]);

    // Trigger a change.
    draw.setSettings({ size: 16 });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull(); // not flushed yet

    vi.advanceTimersByTime(199);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    vi.advanceTimersByTime(1);
    const snap = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    expect(snap).toEqual({ draw: { size: 16 }, shapes: { kind: 'square' } });

    off();
  });

  it('watch coalesces rapid changes into a single write', () => {
    const draw = makeTool('draw', { size: 4 });
    const off = watch([draw]);
    draw.setSettings({ size: 5 });
    vi.advanceTimersByTime(50);
    draw.setSettings({ size: 6 });
    vi.advanceTimersByTime(50);
    draw.setSettings({ size: 7 });
    vi.advanceTimersByTime(199);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    vi.advanceTimersByTime(1);
    const snap = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    expect(snap).toEqual({ draw: { size: 7 } });
    off();
  });

  it('watch unsubscribe stops further writes', () => {
    const draw = makeTool('draw', { size: 4 });
    const off = watch([draw]);
    off();
    draw.setSettings({ size: 99 });
    vi.advanceTimersByTime(500);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
