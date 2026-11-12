import type { Store } from '../app/store';
import type { History } from '../app/history';
import { buildSelectionEditor } from './selectionEditors';
import { insulateChromePointerEvents } from './touchChrome';
import { buildMobileSheet } from './mobileSheet';
import { buildMapPicker } from './mapPicker';
import { buildLayerToggles } from './layerToggles';
import { buildNotesEditor } from './notesEditor';
import { buildPlaybackDelay, type DelayTarget, type PlaybackDelayHandle } from './playbackDelay';
import { createSheetManager, type SheetManager } from './sheetManager';

const SVG_NS = 'http://www.w3.org/2000/svg';

type ChromeIcon = 'undo' | 'redo' | 'delete' | 'menu';

/** Build a 24x24 currentColor-stroke SVG icon for the topbar action buttons.
 *  Inline so we don't need to ship more PNG assets just for the mobile chrome,
 *  and so the buttons can stay 44x44 instead of widening to fit a text label
 *  (5 text-labelled buttons + the title overflow at 360px wide). */
function chromeIcon(kind: ChromeIcon): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of iconPaths(kind)) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.appendChild(el);
  }
  return svg;
}

function iconPaths(kind: ChromeIcon): Array<[string, Record<string, string>]> {
  switch (kind) {
    case 'undo': return [
      ['path', { d: 'M9 14L4 9l5-5' }],
      ['path', { d: 'M4 9h10a6 6 0 0 1 0 12h-3' }],
    ];
    case 'redo': return [
      ['path', { d: 'M15 14l5-5-5-5' }],
      ['path', { d: 'M20 9H10a6 6 0 0 0 0 12h3' }],
    ];
    case 'delete': return [
      ['path', { d: 'M3 6h18' }],
      ['path', { d: 'M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2' }],
      ['path', { d: 'M5 6l1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14' }],
    ];
    case 'menu': return [
      ['path', { d: 'M3 6h18' }],
      ['path', { d: 'M3 12h18' }],
      ['path', { d: 'M3 18h18' }],
    ];
  }
}

/**
 * The launcher action callbacks the compact menu sheet exposes.
 */
export interface MobileMenuActions {
  /** Quick-save onto the strat's current library entry. */
  save: () => void;
  /** Force a brand-new library entry. */
  newSave: () => void;
  /** Open the strat library modal. */
  openLibrary: () => void;
  /** Open the .strat.json file picker. */
  importFile: () => void;
  /** Export the strat as a PNG. */
  exportPng: () => void;
  /** Export the strat as an animated GIF. */
  exportGif: () => void;
  /** Export the strat as a .strat.json file. */
  exportJson: () => void;
  /** Open the share-link dialog. */
  openShare: () => void;
  /** Open the changelog modal. */
  openChangelog: () => void;
  /** Open the privacy & legal notice. */
  openLegal: () => void;
}

export interface MobileEditCtx {
  history: History;
  /** Delete the current selection (returns false when empty). */
  deleteSelection: () => boolean;
  /** Refit the whole map to the screen. Wired to TouchViewportController's
   *  resetToDefaultView. Used after a map switch. */
  fitView: () => void;
  /** Clear the active frame. Routes through the same confirm-then-clear flow
   *  the desktop viewer HUD uses, so a stray tap cannot wipe a frame. */
  clearFrame: () => void;
  /**
   * The active tool's settings panel (its getContextPanel()), or null when
   * the tool has no panel. Optional so the edit-mode tests can
   * construct an editCtx without a ToolsManager.
   */
  getToolPanel?: () => HTMLElement | null;
  /**
   * The menu-sheet launcher callbacks. Optional so the
   * edit-mode tests can construct an editCtx without them.
   */
  menuActions?: MobileMenuActions;
  /**
   * The playback controller, for the delay stepper the View sheet hosts - the
   * frame strip has no room for it on a phone. Optional so the earlier
   * edit-mode tests can construct an editCtx without a PlaybackController.
   */
  playback?: DelayTarget;
}

/**
 * Compact-mode chrome: a slim translucent top bar (title + menu button, plus
 * Undo/Redo/Delete when `editCtx` is supplied) over the full-bleed map, and a
 * menu sheet. With `editCtx.menuActions` the sheet is a grouped launcher of
 * large action rows; without it (read-only) it just shows the notes.
 * Selecting one item opens its editor sheet, and switching to a tool with
 * settings opens the tool-settings sheet.
 */
export class MobileChrome {
  private bar: HTMLDivElement | null = null;
  private sheet: HTMLDivElement | null = null;
  private offSel: (() => void) | null = null;
  private undoBtn: HTMLButtonElement | null = null;
  private redoBtn: HTMLButtonElement | null = null;
  private delBtn: HTMLButtonElement | null = null;
  private selSheet: HTMLDivElement | null = null;
  private toolSheet: HTMLDivElement | null = null;
  private mapSheet: HTMLDivElement | null = null;
  private mapPicker: { el: HTMLElement; destroy: () => void } | null = null;
  private viewSheet: HTMLDivElement | null = null;
  private layerToggles: { el: HTMLElement; destroy: () => void } | null = null;
  private delayStepper: PlaybackDelayHandle | null = null;
  private notesSheet: HTMLDivElement | null = null;
  private notesEditor: { el: HTMLElement; destroy: () => void; focus: () => void } | null = null;
  private titleEl: HTMLElement | null = null;
  private offMapTitle: (() => void) | null = null;
  private selSheetDismissed = false;
  private lastSelKey = '';

  /**
   * `sheets` is shared with MobileColourSheet (main.ts builds one) so the colour
   * sheet and these five are mutually exclusive too. Optional so the unit tests
   * can construct chrome on its own; it makes its own manager when none is given.
   */
  constructor(
    private host: HTMLElement,
    private store: Store,
    private title: string,
    private editCtx?: MobileEditCtx,
    private sheets: SheetManager = createSheetManager(),
  ) {}

  mount(): void {
    const bar = document.createElement('div');
    bar.className = 'mob-topbar';
    bar.dataset['testid'] = 'mobile-topbar';
    insulateChromePointerEvents(bar);

    const t = this.editCtx ? this.buildTitleButton() : this.buildTitleSpan();
    this.titleEl = t;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mob-menu-btn';
    btn.dataset['testid'] = 'mobile-menu-btn';
    btn.setAttribute('aria-label', 'Open menu');
    btn.appendChild(chromeIcon('menu'));
    btn.addEventListener('click', () => this.toggleSheet());

    if (this.editCtx) {
      const ec = this.editCtx;
      const mkBtn = (cls: string, testid: string, label: string, icon: ChromeIcon, onClick: () => void): HTMLButtonElement => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `mob-menu-btn ${cls}`;
        b.dataset['testid'] = testid;
        b.setAttribute('aria-label', label);
        b.appendChild(chromeIcon(icon));
        b.addEventListener('click', onClick);
        return b;
      };
      const undo = mkBtn('mob-undo', 'mobile-undo', 'Undo', 'undo', () => { ec.history.undo(); this.refreshEdit(); });
      const redo = mkBtn('mob-redo', 'mobile-redo', 'Redo', 'redo', () => { ec.history.redo(); this.refreshEdit(); });
      const del  = mkBtn('mob-delete', 'mobile-delete', 'Delete', 'delete', () => { ec.deleteSelection(); this.refreshEdit(); });
      // No multi-select toggle here any more. Holding an item opens the per-item
      // action menu, whose "Add to selection" row switches the mode on, so the
      // button was a fifth 44px target in a 360px row for something with a
      // better home. A tap on empty space leaves the mode again.
      this.undoBtn = undo; this.redoBtn = redo; this.delBtn = del;
      const offMap = this.store.subscribe(['mapId'], () => {
        if (this.titleEl) this.titleEl.textContent = this.store.get().mapId;
      });
      this.offMapTitle = offMap;
      bar.append(t, undo, redo, del, btn);
      this.host.appendChild(bar);
      this.bar = bar;
      const offSel = this.store.subscribe(['selection'], () => { this.refreshEdit(); this.refreshSelSheet(); });
      // frames changes (committed edits) defer via microtask so refreshEdit runs
      // after history.dispatch pushes the inverse onto the undo stack.
      const offFrames = this.store.subscribe(['frames'], () => queueMicrotask(() => this.refreshEdit()));
      // tool changes auto-open the active tool's settings sheet.
      const offTool = this.store.subscribe(['tool'], () => this.showToolSettings());
      this.offSel = () => { offSel(); offFrames(); offTool(); };
      this.refreshEdit();
      this.refreshSelSheet();
      this.showToolSettings();
      return;
    }

    const offMap = this.store.subscribe(['mapId'], () => {
      if (this.titleEl) this.titleEl.textContent = this.store.get().mapId;
    });
    this.offMapTitle = offMap;
    bar.append(t, btn);
    this.host.appendChild(bar);
    this.bar = bar;
  }

  // Buttons refresh whenever a committed edit changes frames or selection.
  // history.ts has no listener API of its own; a dedicated history.subscribe
  // remains a possible future cleanup if a history mutation ever needs to be
  // reflected without an accompanying store change.
  /** Reflect history/selection state onto the edit buttons. */
  private refreshEdit(): void {
    if (!this.editCtx) return;
    if (this.undoBtn) this.undoBtn.disabled = !this.editCtx.history.canUndo();
    if (this.redoBtn) this.redoBtn.disabled = !this.editCtx.history.canRedo();
    if (this.delBtn) this.delBtn.disabled = this.store.get().selection.length === 0;
  }

  /**
   * Show a dismissible bottom sheet with the inline editor for a single
   * selected item (font size for a text box, show-ranges for a quickadd) - 
   * the same buildSelectionEditor desktop's ContextPanel uses. Rebuilt on
   * selection change only; a fresh selection re-arms a previously dismissed
   * sheet. No sheet for an empty/multi selection or an item with no editor.
   */
  private refreshSelSheet(): void {
    if (!this.editCtx) return;
    const sel = this.store.get().selection;
    const key = sel.length === 1 ? `${sel[0]!.kind}:${sel[0]!.id}` : '';
    if (key !== this.lastSelKey) {
      this.lastSelKey = key;
      this.selSheetDismissed = false;
    }
    this.selSheet?.remove();
    this.selSheet = null;
    if (key === '' || this.selSheetDismissed) return;
    const editor = buildSelectionEditor(this.store, this.editCtx.history, sel[0]!);
    if (!editor) return;
    const sel_el = this.buildSelSheet(editor);
    this.selSheet = sel_el;
    this.host.appendChild(sel_el);
    // Captures sel_el for the same reason showToolSettings does.
    // passthrough, like the tool sheet: this one auto-opens alongside a selection
    // and the selected item is right there on the map, so a tap or drag on it has
    // to reach the canvas. Swallowing meant the sheet ate the first move of a drag
    // on the very item it was editing.
    this.sheets.open({
      el: sel_el,
      onClose: () => { sel_el.remove(); if (this.selSheet === sel_el) this.selSheet = null; },
      dismiss: 'passthrough',
    });
  }

  private buildSelSheet(editor: HTMLElement): HTMLDivElement {
    return buildMobileSheet(editor, {
      variant: 'mob-selsheet',
      testid: 'mobile-selsheet',
      closeLabel: 'Close properties',
      closeTestid: 'mobile-selsheet-close',
      onClose: () => {
        this.selSheetDismissed = true;
        this.sheets.close();
      },
    });
  }

  /**
   * Auto-open a dismissible bottom sheet hosting the active tool's settings
   * panel (its getContextPanel()) - the same DOM desktop's ContextPanel
   * renders. Removed when the tool has no panel (Erase / the Select tool).
   * Called on every store.tool change.
   */
  private showToolSettings(): void {
    if (!this.editCtx?.getToolPanel) return;
    const panel = this.editCtx.getToolPanel();
    // No panel for this tool (Erase / Select): close through the manager so its
    // record goes with the sheet.
    if (!panel) { if (this.toolSheet) this.sheets.close(); return; }
    const el = this.buildToolSheet(panel);
    this.toolSheet = el;
    this.host.appendChild(el);
    // onClose captures `el` rather than reading this.toolSheet: opening the next
    // tool sheet closes this registration, and a closure over the field would
    // then delete the sheet that just replaced it.
    // passthrough because this one auto-opens when a tool is picked - the first
    // stroke after choosing Draw has to draw, not be eaten closing the panel.
    this.sheets.open({
      el,
      onClose: () => { el.remove(); if (this.toolSheet === el) this.toolSheet = null; },
      dismiss: 'passthrough',
    });
  }

  /** Re-open the active tool's settings sheet (re-tap of the active rail
   *  button - the store tool did not change so no subscription fired). */
  reopenToolSettings(): void {
    this.showToolSettings();
  }

  private buildToolSheet(panel: HTMLElement): HTMLDivElement {
    return buildMobileSheet(panel, {
      variant: 'mob-toolsheet',
      testid: 'mobile-toolsheet',
      closeLabel: 'Close tool settings',
      closeTestid: 'mobile-toolsheet-close',
      onClose: () => this.sheets.close(),
    });
  }

  private closeSheet(): void {
    this.sheet?.remove();
    this.sheet = null;
  }

  /**
   * One sheet at a time. All sheets share the same bottom:0 z-index:30 anchor,
   * so an unclosed one would sit under the new sheet with its controls unreachable.
   *
   * Doesn't set selSheetDismissed: that flag means the user dismissed it, and a
   * launcher opening over it shouldn't suppress it for the rest of the selection.
   * The tool sheet stays closed until the tool changes (reopenToolSettings()
   * handles re-tapping the active rail button).
   */
  private closeAllSheets(): void {
    this.sheets.closeAll();
  }

  /**
   * Open (or, if already open, close) the menu sheet - the touch
   * command-palette-equivalent. When `editCtx.menuActions` is supplied the
   * sheet leads with a grouped launcher of large tap-target action rows;
   * a read-only Notes block follows.
   */
  private toggleSheet(): void {
    if (this.sheet) { this.sheets.close(); return; }
    const sheet = document.createElement('div');
    sheet.className = 'mob-sheet';
    sheet.dataset['testid'] = 'mobile-sheet';
    insulateChromePointerEvents(sheet);

    const actions = this.editCtx?.menuActions;
    if (actions) {
      // Map / View / Notes lead. With File and Export first, the Map row landed
      // at offsetTop 526 in a 530px-tall sheet - exactly on the fold, which is
      // why map switching felt hidden away.
      sheet.appendChild(this.buildMenuGroup('Map', [
        ['map', 'Change map & callouts', () => this.openMapSheet()],
      ]));
      sheet.appendChild(this.buildMenuGroup('View', [
        ['view', 'Layers, reset view & clear frame', () => this.openViewSheet()],
      ]));
      sheet.appendChild(this.buildMenuGroup('Notes', [
        ['notes', 'Write strat notes', () => this.openNotesSheet()],
      ]));
      sheet.appendChild(this.buildMenuGroup('File', [
        ['save', 'Save', actions.save],
        ['new-save', 'New save', actions.newSave],
        ['library', 'Library', actions.openLibrary],
        ['import', 'Import a .strat.json file', actions.importFile],
      ]));
      sheet.appendChild(this.buildMenuGroup('Export', [
        ['export-png', 'Export PNG', actions.exportPng],
        ['export-gif', 'Export GIF', actions.exportGif],
        ['export-json', 'Export .strat.json', actions.exportJson],
      ]));
      sheet.appendChild(this.buildMenuGroup('Share', [
        ['share', 'Copy a share link', actions.openShare],
      ]));
      sheet.appendChild(this.buildMenuGroup('Help', [
        ['changelog', 'Changelog', actions.openChangelog],
        ['legal', 'Privacy & legal', actions.openLegal],
      ]));
    }

    // No launcher actions (read-only chrome): keep the plain notes paragraph
    // so the sheet still has something in it.
    if (!actions) {
      const notesGroup = document.createElement('div');
      notesGroup.className = 'mob-menu-group';
      const notesH = document.createElement('h3');
      notesH.textContent = 'Notes';
      const notes = document.createElement('p');
      notes.className = 'mob-notes';
      const text = this.store.get().notes;
      notes.textContent = text.trim().length > 0 ? text : 'No notes for this strat.';
      notesGroup.append(notesH, notes);
      sheet.appendChild(notesGroup);
    }

    this.sheet = sheet;
    this.host.appendChild(sheet);
    // The manager owns Escape and tap-outside for every sheet now; the menu used
    // to be the only one with them, wired up here by hand. onClose captures
    // `sheet` so a stale record can never tear down its replacement.
    this.sheets.open({
      el: sheet,
      onClose: () => { sheet.remove(); if (this.sheet === sheet) this.sheet = null; },
      dismiss: 'swallow',
    });
  }

  /**
   * Bottom sheet holding the shared map picker. Choosing a map dispatches
   * map.select (one undo step, mapFrames stash intact), then refits.
   */
  private openMapSheet(): void {
    const ec = this.editCtx;
    if (!ec) return;
    this.closeAllSheets();
    const picker = buildMapPicker(this.store, ec.history, {
      onSelect: () => {
        ec.fitView();
        this.sheets.close();
      },
    });
    this.mapPicker = picker;
    this.mapSheet = buildMobileSheet(picker.el, {
      variant: 'mob-mapsheet',
      testid: 'mobile-mapsheet',
      closeLabel: 'Close map picker',
      closeTestid: 'mobile-mapsheet-close',
      title: 'Map',
      onClose: () => this.sheets.close(),
    });
    this.host.appendChild(this.mapSheet);
    this.setTitleExpanded(true);
    this.sheets.open({ el: this.mapSheet, onClose: () => this.closeMapSheet(), dismiss: 'swallow' });
  }

  private closeMapSheet(): void {
    this.mapPicker?.destroy();
    this.mapPicker = null;
    this.mapSheet?.remove();
    this.mapSheet = null;
    // closeAllSheets() routes through here too, so a launcher opening something
    // else also clears the title's open state.
    this.setTitleExpanded(false);
  }

  /**
   * Bottom sheet with the shared layer toggles plus the two view actions worth
   * having on touch. No zoom in/out buttons: pinch already does continuous
   * zoom better than a button can, and there is no width for a slider.
   */
  private openViewSheet(): void {
    const ec = this.editCtx;
    if (!ec) return;
    this.closeAllSheets();

    const body = document.createElement('div');
    body.className = 'mob-viewsheet-body';

    this.layerToggles = buildLayerToggles(this.store);
    body.appendChild(this.layerToggles.el);

    // The playback delay lives here on a phone: the strip's actions cluster was
    // 224px of a 390px screen, and this is the part of it nobody needs mid-draw.
    if (ec.playback) {
      const row = document.createElement('div');
      row.className = 'mob-viewsheet-delay-row';
      const label = document.createElement('span');
      label.className = 'cp-label';
      label.textContent = 'Frame delay';
      this.delayStepper = buildPlaybackDelay(ec.playback);
      row.append(label, this.delayStepper.el);
      body.appendChild(row);
    }

    const actions = document.createElement('div');
    actions.className = 'mob-viewsheet-actions';

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'mob-menu-action';
    reset.dataset['testid'] = 'mobile-reset-view';
    reset.textContent = 'Reset view';
    reset.addEventListener('click', () => ec.fitView());

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'mob-menu-action';
    clear.dataset['testid'] = 'mobile-clear-frame';
    clear.textContent = 'Clear frame';
    // dispatchClearFrame (main.ts) early-returns on an empty frame - no confirm,
    // no toast, nothing. Disable up front instead of letting the tap silently
    // do nothing. Computed once here: the sheet is rebuilt on every open, so
    // that stays accurate without a subscription.
    if (this.activeFrameIsEmpty()) {
      clear.disabled = true;
      clear.title = 'This frame has nothing to clear';
    }
    clear.addEventListener('click', () => {
      // The confirm modal opens over the sheet, so get the sheet out of the way.
      this.sheets.close();
      ec.clearFrame();
    });

    actions.append(reset, clear);
    body.appendChild(actions);

    this.viewSheet = buildMobileSheet(body, {
      variant: 'mob-viewsheet',
      testid: 'mobile-viewsheet',
      closeLabel: 'Close view options',
      closeTestid: 'mobile-viewsheet-close',
      title: 'View',
      onClose: () => this.sheets.close(),
    });
    this.host.appendChild(this.viewSheet);
    this.sheets.open({ el: this.viewSheet, onClose: () => this.closeViewSheet(), dismiss: 'swallow' });
  }

  private closeViewSheet(): void {
    this.layerToggles?.destroy();
    this.layerToggles = null;
    this.delayStepper?.destroy();
    this.delayStepper = null;
    this.viewSheet?.remove();
    this.viewSheet = null;
  }

  /** Mirrors dispatchClearFrame's frameIsEmpty gate in main.ts (every item
   *  collection on the Frame, plus the scanner placement), so the Clear frame
   *  button's disabled state never disagrees with what clearFrame() would do. */
  private activeFrameIsEmpty(): boolean {
    const f = this.store.get().frames[this.store.get().activeFrameIdx];
    if (!f) return true;
    return (
      f.strokes.length === 0 && f.shapes.length === 0 && f.cones.length === 0 &&
      f.players.length === 0 && f.textboxes.length === 0 && f.quickadds.length === 0 &&
      f.scanner === null
    );
  }

  /**
   * Bottom sheet with the shared notes editor. Mobile used to show notes as a
   * read-only paragraph; this is the same textarea, debounce and undo
   * behaviour the sidebar has. KeyboardAutoPan (attached in the compact boot)
   * keeps the field above the on-screen keyboard.
   */
  private openNotesSheet(): void {
    const ec = this.editCtx;
    if (!ec) return;
    this.closeAllSheets();

    this.notesEditor = buildNotesEditor(this.store, ec.history);
    this.notesSheet = buildMobileSheet(this.notesEditor.el, {
      variant: 'mob-notessheet',
      testid: 'mobile-notessheet',
      closeLabel: 'Close notes',
      closeTestid: 'mobile-notessheet-close',
      title: 'Notes',
      onClose: () => this.sheets.close(),
    });
    this.host.appendChild(this.notesSheet);
    this.sheets.open({ el: this.notesSheet, onClose: () => this.closeNotesSheet(), dismiss: 'swallow' });
    this.notesEditor.focus();
  }

  /** destroy() on the editor flushes any pending debounce, so closing the
   *  sheet mid-sentence commits rather than bins the last few words. */
  private closeNotesSheet(): void {
    this.notesEditor?.destroy();
    this.notesEditor = null;
    this.notesSheet?.remove();
    this.notesSheet = null;
  }

  /** Reflect map-sheet open state onto the title button. No-op for the read-only
   *  chrome, whose title is a plain span with nothing to open. */
  private setTitleExpanded(open: boolean): void {
    if (this.titleEl instanceof HTMLButtonElement) {
      this.titleEl.setAttribute('aria-expanded', String(open));
    }
  }

  /** Read-only chrome: no map sheet to open, so the title is inert text. */
  private buildTitleSpan(): HTMLElement {
    const t = document.createElement('span');
    t.className = 'mob-title';
    t.textContent = this.title;
    return t;
  }

  /**
   * Editing chrome: the title IS the map switcher. The map name already sits in
   * the top-left corner, so tapping it to change map is the affordance people
   * reach for - the menu's Map row stays as a second route. The chevron is a CSS
   * ::after rather than a child node, so textContent stays exactly the map name
   * for the mapId subscription that keeps it current.
   */
  private buildTitleButton(): HTMLElement {
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'mob-title mob-title-btn';
    t.dataset['testid'] = 'mobile-title-btn';
    t.setAttribute('aria-label', 'Change map');
    // Reflects whether the map sheet is open: without it the button looked
    // identical whether you had just opened the sheet or not.
    t.setAttribute('aria-expanded', 'false');
    t.textContent = this.title;
    t.addEventListener('click', () => this.openMapSheet());
    return t;
  }

  /**
   * Build a labelled launcher group: a heading plus one full-width tappable
   * action row per `[id, label, run]` tuple. Tapping a row closes the menu
   * sheet, then runs the action (the action's own modal opens over the map).
   */
  private buildMenuGroup(
    heading: string,
    rows: ReadonlyArray<readonly [string, string, () => void]>,
  ): HTMLDivElement {
    const group = document.createElement('div');
    group.className = 'mob-menu-group';
    const h = document.createElement('h3');
    h.textContent = heading;
    group.appendChild(h);
    for (const [id, label, run] of rows) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mob-menu-action';
      b.dataset['testid'] = `mobile-action-${id}`;
      b.textContent = label;
      b.addEventListener('click', () => {
        // Through the manager, not closeSheet(): a direct teardown leaves the
        // manager holding a record for a sheet that no longer exists, and the next
        // open then runs that stale record's teardown against the new sheet.
        this.sheets.close();
        run();
      });
      group.appendChild(b);
    }
    return group;
  }

  destroy(): void {
    // Deregister first: a stale record would leave the manager's document listener
    // live, swallowing taps for a sheet that no longer exists.
    this.sheets.closeAll();
    this.offSel?.(); this.offSel = null;
    this.offMapTitle?.(); this.offMapTitle = null;
    this.closeSheet();
    this.closeMapSheet();
    this.closeViewSheet();
    this.closeNotesSheet();
    this.selSheet?.remove(); this.selSheet = null;
    this.toolSheet?.remove(); this.toolSheet = null;
    this.bar?.remove(); this.bar = null;
    this.undoBtn = null;
    this.redoBtn = null;
    this.delBtn = null;
    this.titleEl = null;
  }
}
