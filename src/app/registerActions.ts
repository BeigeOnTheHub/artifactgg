import type { Actions, Action } from './actions';
import type { Store, StratState } from './store';
import type { History } from './history';
import type { Clipboard } from './clipboard';
import { copy, paste, duplicate, deleteSelection, PASTE_OFFSET_MAP } from './clipboard';
import { allRefs } from './selection';
import { TOOL_ORDER, TOOL_LABELS, TOOL_HOTKEY } from '../ui/icons';
import { MAPS, type MapId } from '../types/maps';
import type { ToolId } from '../types/primitives';

/** Tools under which SelectTool is attached and paints the `.sel-highlight`
 *  effect (mirrors ShapeHandlesLayer's set). Ctrl+A select-all hops to the
 *  cursor tool when the active tool isn't one of these so every just-selected
 *  node actually shows the selected effect. */
const SELECT_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['cursor', 'select', 'lasso']);

export interface BrushSizable {
  setSize(n: number): void;
  getSize(): number;
}

export interface RegisterDeps {
  store: Store;
  history: History;
  clipboard: Clipboard;
  drawTool: BrushSizable;
  eraseTool: BrushSizable;
  promptAndSave: () => void;
  openLibrary: () => void;
  exportPng: () => void;
  exportGif: () => void;
  exportContactSheet: () => void;
  exportJson: () => void;
  importJson: () => void;
  zoomFit: () => void;
  zoomTo100: () => void;
  resetView: () => void;
  setTheme: (t: 'dark' | 'light' | 'high-contrast') => void;
  openShare: () => void;
  dispatchClearFrame: () => void;
  focusNotesPane: () => void;
  // Focus the single selected textbox's <textarea> and select all its text so
  // it can be re-edited after placement. No-op unless exactly one textbox is
  // selected (the Ctrl+A action gates on that before calling this).
  editSelectedTextbox: () => void;
  // Open the privacy & legal notice (LegalModal owns its own state).
  openLegal: () => void;
  // Re-run the first-run onboarding tour on demand.
  startTour: () => void;
}

/** ToolId -> action id slug (e.g. 'place-cone' -> 'tool.cone'). */
function toolActionId(t: ToolId): string {
  if (t === 'place-cone') return 'tool.cone';
  if (t === 'place-player') return 'tool.player';
  if (t === 'place-text') return 'tool.text';
  if (t === 'place-quickadd') return 'tool.quickadd';
  if (t === 'place-scanner') return 'tool.scanner';
  return `tool.${t}`;
}

function toolTitle(t: ToolId): string {
  return `Tool · ${TOOL_LABELS[t]}`;
}

export function registerAll(actions: Actions, deps: RegisterDeps): void {
  const { store, history, clipboard, drawTool, eraseTool } = deps;

  // --- Tool group (11) ---
  for (const t of TOOL_ORDER) {
    const a: Action = {
      id: toolActionId(t),
      title: toolTitle(t),
      group: 'Tool',
      // Tool switches bypass history on purpose: apply
      // straight to the store so undo/redo never replays a tool change.
      run: () => store._apply({ tool: t }),
    };
    const hk = TOOL_HOTKEY[t];
    if (hk) a.hotkey = hk;
    actions.register(a);
  }

  // --- Brush group (2) - [ and ] resize active drawing tool ---
  const brushActive = (state: { tool: ToolId }): boolean =>
    state.tool === 'draw' || state.tool === 'erase';
  function applyBrushDelta(delta: number): void {
    const t = store.get().tool;
    if (t === 'draw') drawTool.setSize(drawTool.getSize() + delta);
    else if (t === 'erase') eraseTool.setSize(eraseTool.getSize() + delta);
  }
  actions.register({
    id: 'brush.shrink',
    title: 'Brush · Shrink',
    group: 'Tool',
    hotkey: '[',
    canRun: (s) => brushActive(s),
    run: () => applyBrushDelta(-1),
  });
  actions.register({
    id: 'brush.grow',
    title: 'Brush · Grow',
    group: 'Tool',
    hotkey: ']',
    canRun: (s) => brushActive(s),
    run: () => applyBrushDelta(+1),
  });

  // --- Colour slots (5) - number-row hotkeys to activate slot N -
  for (let i = 0; i < 5; i++) {
    const idx = i as 0 | 1 | 2 | 3 | 4;
    actions.register({
      id: `colour.slot.${idx}`,
      title: `Colour slot · ${idx + 1}`,
      group: 'Tool',
      hotkey: String(idx + 1),
      run: () => {
        if (store.get().activeSlot === idx) return;
        store._apply({ activeSlot: idx });
      },
    });
  }

  // --- Map group (5) ---
  // WIP maps are selectable now (same as the dropdown) - they're playable,
  // the WIP badge just flags that bits of them aren't final yet.
  for (const m of MAPS) {
    actions.register({
      id: `map.${m.id}`,
      title: `Switch map · ${m.name}`,
      group: 'Map',
      run: () => history.dispatch({ t: 'map.select', mapId: m.id as MapId }),
    });
  }

  // --- Edit group (6) ---
  actions.register({
    id: 'edit.undo',
    title: 'Undo',
    group: 'Edit',
    hotkey: 'Ctrl+Z',
    allowInInput: true,
    run: () => { history.undo(); },
  });
  actions.register({
    id: 'edit.redo',
    title: 'Redo',
    group: 'Edit',
    hotkey: 'Ctrl+Shift+Z',
    allowInInput: true,
    run: () => { history.redo(); },
  });
  actions.register({
    id: 'edit.copy',
    title: 'Copy',
    group: 'Edit',
    hotkey: 'Ctrl+C',
    canRun: (s) => s.selection.length > 0,
    run: () => {
      const sel = store.get().selection;
      if (sel.length === 0) return;
      clipboard.set(copy(store.get(), sel));
    },
  });
  actions.register({
    id: 'edit.paste',
    title: 'Paste',
    group: 'Edit',
    hotkey: 'Ctrl+V',
    run: () => {
      const snap = clipboard.get();
      if (!snap) return;
      const cmds = paste(snap, PASTE_OFFSET_MAP);
      if (cmds.length === 0) return;
      if (cmds.length === 1) history.dispatch(cmds[0]!);
      else history.dispatch({ t: 'batch', cmds });
    },
  });
  actions.register({
    id: 'edit.duplicate',
    title: 'Duplicate',
    group: 'Edit',
    hotkey: 'Ctrl+D',
    canRun: (s) => s.selection.length > 0,
    run: () => { duplicate(store, history); },
  });
  actions.register({
    id: 'edit.delete',
    title: 'Delete selection',
    group: 'Edit',
    hotkey: 'Delete',
    aliases: ['Backspace'],
    canRun: (s) => s.selection.length > 0,
    run: () => { deleteSelection(store, history); },
  });
  actions.register({
    id: 'edit.selectAll',
    title: 'Select all nodes',
    group: 'Edit',
    hotkey: 'Ctrl+A',
    // allowInInput is intentionally OFF. The keyboard router bails (without
    // preventDefault) whenever an INPUT/TEXTAREA/contenteditable is focused,
    // so native Ctrl+A keeps working there - in the notes pane / player-name
    // field it selects that field's text, and while a map textbox's <textarea>
    // is already focused it selects that textbox's text.
    run: () => {
      const s = store.get();
      // Textbox override: a single selected textbox means "edit its text"
      // (focus the textarea + select all of it) rather than select-all-nodes,
      // so a placed textbox can be re-edited via Ctrl+A.
      if (s.selection.length === 1 && s.selection[0]!.kind === 'textbox') {
        deps.editSelectedTextbox();
        return;
      }
      // Otherwise select every node in the active frame. The `.sel-highlight`
      // effect is painted by SelectTool, which is only attached under a
      // select-family tool - so if the user just placed nodes with a
      // placement tool and hit Ctrl+A, hop to the cursor tool too, otherwise
      // the selection would be set but invisible. Selection (and the tool
      // switch) are transient UI state, applied straight to the store so
      // neither enters undo history.
      const patch: Partial<StratState> = { selection: allRefs(s) };
      if (!SELECT_TOOLS.has(s.tool)) patch.tool = 'cursor';
      store._apply(patch);
    },
  });
  // --- Help group (3) ---
  actions.register({
    id: 'help.openPalette',
    title: 'Open command palette',
    group: 'Help',
    hotkey: 'Ctrl+K',
    run: () => {
      const ui = store.get().ui;
      store._apply({ ui: { ...ui, paletteOpen: !ui.paletteOpen } });
    },
  });
  actions.register({
    id: 'help.openHints',
    title: 'Open keyboard hints',
    group: 'Help',
    hotkey: '?',
    run: () => {
      const ui = store.get().ui;
      store._apply({ ui: { ...ui, hintsOpen: !ui.hintsOpen } });
    },
  });
  actions.register({
    id: 'help.tour',
    title: 'Replay tour',
    group: 'Help',
    run: () => deps.startTour(),
  });

  // --- File group (5) ---
  actions.register({
    id: 'library.save',
    title: 'Save strat',
    group: 'File',
    hotkey: 'Ctrl+S',
    allowInInput: true,
    run: () => deps.promptAndSave(),
  });
  actions.register({
    id: 'library.open',
    title: 'Open strat library',
    group: 'File',
    hotkey: 'Ctrl+Shift+L',
    allowInInput: true,
    run: () => deps.openLibrary(),
  });
  actions.register({
    id: 'file.exportPng',
    title: 'Export · PNG',
    group: 'File',
    run: () => deps.exportPng(),
  });
  actions.register({
    id: 'file.exportGif',
    title: 'Export · GIF',
    group: 'File',
    run: () => deps.exportGif(),
  });
  actions.register({
    id: 'file.exportContactSheet',
    title: 'Export · Contact sheet',
    group: 'File',
    run: () => deps.exportContactSheet(),
  });
  actions.register({
    id: 'file.exportJson',
    title: 'Export · JSON',
    group: 'File',
    run: () => deps.exportJson(),
  });
  actions.register({
    id: 'file.importJson',
    title: 'Import · JSON',
    group: 'File',
    run: () => deps.importJson(),
  });
  actions.register({
    id: 'share.open',
    title: 'Share strat',
    group: 'File',
    run: () => deps.openShare(),
  });

  // --- View group (2) ---
  actions.register({
    id: 'view.zoomFit',
    title: 'View · Zoom to fit',
    group: 'View',
    run: () => deps.zoomFit(),
  });
  actions.register({
    id: 'view.zoom100',
    title: 'View · Zoom 100%',
    group: 'View',
    run: () => deps.zoomTo100(),
  });
  // Reset to the view captured at boot (or after the most recent load).
  // Ctrl+0 mirrors the browser convention for "reset zoom". Implemented
  // as a separate action from zoomFit so a user who has resized the
  // window mid-session still lands at the exact view they opened on.
  actions.register({
    id: 'view.reset',
    title: 'View · Reset to original',
    group: 'View',
    hotkey: 'Ctrl+0',
    run: () => deps.resetView(),
  });
  actions.register({
    id: 'view.themeDark',
    title: 'Theme · Dark',
    group: 'View',
    run: () => deps.setTheme('dark'),
  });
  actions.register({
    id: 'view.themeLight',
    title: 'Theme · Light',
    group: 'View',
    run: () => deps.setTheme('light'),
  });
  actions.register({
    id: 'view.themeHighContrast',
    title: 'Theme · High-contrast',
    group: 'View',
    run: () => deps.setTheme('high-contrast'),
  });

  // --- Frame group (6) ---
  actions.register({
    id: 'frame.add',
    title: 'Frame · Add',
    group: 'Edit',
    run: () => history.dispatch({ t: 'frame.add' }),
  });
  actions.register({
    id: 'frame.delete',
    title: 'Frame · Delete active',
    group: 'Edit',
    canRun: (s) => s.frames.length > 1,
    run: () => history.dispatch({ t: 'frame.delete', idx: store.get().activeFrameIdx }),
  });
  actions.register({
    id: 'frame.clear',
    title: 'Frame · Clear active',
    group: 'Edit',
    run: () => deps.dispatchClearFrame(),
  });
  actions.register({
    id: 'frame.next',
    title: 'Frame · Next',
    group: 'Edit',
    hotkey: 'ArrowRight',
    canRun: (s) => s.frames.length > 1,
    run: () => {
      const s = store.get();
      const idx = (s.activeFrameIdx + 1) % s.frames.length;
      history.dispatch({ t: 'frame.switch', idx });
    },
  });
  actions.register({
    id: 'frame.prev',
    title: 'Frame · Previous',
    group: 'Edit',
    hotkey: 'ArrowLeft',
    canRun: (s) => s.frames.length > 1,
    run: () => {
      const s = store.get();
      const idx = (s.activeFrameIdx - 1 + s.frames.length) % s.frames.length;
      history.dispatch({ t: 'frame.switch', idx });
    },
  });

  // --- Notes (1) ---
  actions.register({
    id: 'notes.focus',
    title: 'Notes · Focus',
    group: 'View',
    run: () => {
      const ui = store.get().ui;
      if (ui.sidebarTab !== 'notes') store._apply({ ui: { ...ui, sidebarTab: 'notes' } });
      deps.focusNotesPane();
    },
  });

  // --- Callouts (1) ---
  actions.register({
    id: 'callouts.toggle',
    title: 'Callouts · Toggle',
    group: 'View',
    run: () => {
      const next = !store.get().ui.calloutsVisible;
      history.dispatch({ t: 'callouts.toggle', visible: next });
    },
  });

  // --- Changelog (1) ---
  actions.register({
    id: 'changelog.open',
    title: 'Help · Changelog',
    group: 'Help',
    run: () => {
      const ui = store.get().ui;
      if (ui.changelogOpen) return;
      store._apply({ ui: { ...ui, changelogOpen: true } });
    },
  });

  // --- Privacy & legal (1) ---
  actions.register({
    id: 'legal.open',
    title: 'Help · Privacy & legal',
    group: 'Help',
    run: () => deps.openLegal(),
  });
}
