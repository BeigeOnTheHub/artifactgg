import type { Store, StratState } from './store';

export type ActionGroup = 'Tool' | 'Map' | 'Edit' | 'View' | 'Help' | 'File';

export interface Action {
  /** Stable identifier, dotted lowercase. Example: 'tool.draw', 'edit.copy'. */
  id: string;
  /** Human-readable label shown in palette + hints. */
  title: string;
  /** Group label used for palette section headers + hints rows. */
  group: ActionGroup;
  /**
   * Primary hotkey, in the canonical form produced by `app/keyboard.ts#canonical`.
   * Examples: 'V', 'Ctrl+C', 'Ctrl+Shift+Z', '?', '['.
   */
  hotkey?: string;
  /**
   * Hotkey aliases. Resolve through byHotkey but do NOT appear in palette/hints.
   * Example: edit.delete has hotkey='Delete' aliases=['Backspace'].
   */
  aliases?: string[];
  /** Returns true if the action is runnable in the supplied state. Default: always runnable. */
  canRun?: (state: Readonly<StratState>) => boolean;
  /** Invoke the action. Side-effect-free wrt the registry; mutates app state via deps captured in the closure. */
  run: () => void;
  /**
   * If true, the keyboard router fires this action even when an input/textarea/contenteditable
   * has focus. Set on edit.undo / edit.redo only.
   */
  allowInInput?: boolean;
}

export interface Actions {
  register(action: Action): void;
  byId(id: string): Action | null;
  byHotkey(combo: string): Action | null;
  list(group?: ActionGroup): Action[];
  run(id: string): boolean;
}

export function createActions(store: Store): Actions {
  const order: Action[] = [];
  const byIdMap = new Map<string, Action>();

  function normaliseHotkey(combo: string): string {
    return combo.toLowerCase();
  }

  return {
    register(a) {
      if (byIdMap.has(a.id)) {
        throw new Error(`duplicate action id: ${a.id}`);
      }
      byIdMap.set(a.id, a);
      order.push(a);
    },
    byId(id) {
      return byIdMap.get(id) ?? null;
    },
    byHotkey(combo) {
      const want = normaliseHotkey(combo);
      for (const a of order) {
        if (a.hotkey != null && normaliseHotkey(a.hotkey) === want) return a;
        if (a.aliases) {
          for (const al of a.aliases) {
            if (normaliseHotkey(al) === want) return a;
          }
        }
      }
      return null;
    },
    list(group) {
      if (group == null) return [...order];
      return order.filter((a) => a.group === group);
    },
    run(id) {
      const a = byIdMap.get(id);
      if (!a) return false;
      if (a.canRun && !a.canRun(store.get())) return false;
      a.run();
      return true;
    },
  };
}
