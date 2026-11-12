/**
 * Persists per-tool settings across reloads (Draw size, Erase size, Shapes kind
 * + thickness; the other tools are not covered yet).
 *
 * One localStorage key holds `Record<ToolId, settings>` JSON, e.g.
 * `{"draw":{"size":12}}`. Hydrate runs once at boot and stays silent on a
 * missing or unparseable key. Watch flushes on a 200 ms trailing debounce so
 * `[`-key repeat doesn't spam writes. The payload stays tiny because each
 * tool's `getSettings()` returns only its tunable subset.
 */

import type { ToolId } from '../types/primitives';

export const STORAGE_KEY = 'artifact-gg.v2.toolSettings';
const DEBOUNCE_MS = 200;

export interface SettableTool {
  readonly id: ToolId;
  getSettings(): unknown;
  setSettings(s: unknown): void;
  onSettingsChanged(cb: () => void): () => void;
}

export function hydrate(tools: readonly SettableTool[]): void {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return; // localStorage may be disabled (Safari private mode).
  }
  if (raw == null) return;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.warn('[toolSettingsPersistence] failed to parse stored tool settings; ignoring', err);
    return; // Corrupt JSON - best-effort, leave tools at defaults.
  }
  if (typeof parsed !== 'object' || parsed === null) return;

  for (const tool of tools) {
    const value = parsed[tool.id];
    if (value === undefined) continue;
    try {
      tool.setSettings(value);
    } catch (err) {
      // Tool rejected the persisted shape (schema drift). Leave default.
      console.warn(`[toolSettingsPersistence] tool "${tool.id}" rejected persisted settings`, err);
    }
  }
}

export function watch(tools: readonly SettableTool[]): () => void {
  let pending: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    pending = null;
    const snap: Record<string, unknown> = {};
    for (const tool of tools) {
      try {
        snap[tool.id] = tool.getSettings();
      } catch (err) {
        // One tool's getSettings threw - log and skip it. Best-effort persistence
        // for the others still succeeds.
        console.warn(`[toolSettingsPersistence] getSettings threw for "${tool.id}"`, err);
      }
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
    } catch (err) {
      // Quota exceeded or localStorage disabled - best-effort; the user can
      // re-tune on the next reload.
      console.warn('[toolSettingsPersistence] failed to write tool settings to localStorage', err);
    }
  };

  const onChange = (): void => {
    if (pending != null) clearTimeout(pending);
    pending = setTimeout(flush, DEBOUNCE_MS);
  };

  const offs = tools.map((tool) => tool.onSettingsChanged(onChange));
  return () => {
    for (const off of offs) off();
    if (pending != null) {
      clearTimeout(pending);
      pending = null;
    }
  };
}
