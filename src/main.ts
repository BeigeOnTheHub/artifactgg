import './styles/layout.css';
import './styles/tbox.css';
import './styles/selection.css';
import './styles/mobile-chrome.css';
import './styles/consent.css';
import { createStore, type StratState } from './app/store';
import { createHistory } from './app/history';
import { createActions } from './app/actions';
import { createClipboard, deleteSelection } from './app/clipboard';
import { installContextDelete } from './app/contextDelete';
import { registerAll } from './app/registerActions';
import { createKeyboard } from './app/keyboard';
import { Shell } from './app/Shell';
import { ConsentBanner } from './ui/ConsentBanner';
import { decodeHash, writeStratToFile, deserialize, serialize, type StratFile } from './app/persistence';
import { createAutosaver, readRecover, clearRecover, stratHasContent, writeRecover } from './app/recover';
import { ViewportController, clampZoom, fitZoomFor, SIDEBAR_PX, TOPBAR_PX, TIMELINE_PX } from './app/viewport';
import { Sidebar } from './ui/Sidebar';
import { MapDropdown } from './ui/MapDropdown';
import { ToolRail } from './ui/ToolRail';
import { ContextPanel } from './ui/ContextPanel';
import { ColourSlots } from './ui/ColourSlots';
import { ColourPicker } from './ui/ColourPicker';
import { CommandPalette } from './ui/CommandPalette';
import { KeyboardHints } from './ui/KeyboardHints';
import { TopBar } from './ui/TopBar';
import { toast } from './ui/Toast';
import { ConfirmModal } from './ui/ConfirmModal';
import { StratLibrary } from './ui/StratLibrary';
import { ShareDialog } from './ui/ShareDialog';
import { ChangelogModal } from './ui/ChangelogModal';
import { LegalModal } from './ui/LegalModal';
import { NotesPane } from './ui/NotesPane';
import { SelectionHighlight } from './render/selectionHighlight';
import { FrameTimeline } from './ui/FrameTimeline';
import { FrameCaptionOverlay } from './ui/FrameCaptionOverlay';
import { LayerVisibilityPanel } from './ui/LayerVisibilityPanel';
import { PlayerLegend } from './ui/PlayerLegend';
import { CanvasHint } from './ui/CanvasHint';
import { DiscordLink } from './ui/DiscordLink';
import { ViewerActions } from './ui/ViewerActions';
import { attachLayerVisibility } from './app/layerVisibility';
import { attachSelectionColourSync } from './app/selectionColourSync';
import { composeFullPng, composeFrameCanvas, composeThumbnail, TAINTED_CANVAS, type ComposeDeps } from './app/pngExport';
import { saveStrat, loadStrat, listStrats, LibraryError } from './app/library';
import { decodeV1Hash, tryDecodeV1Text } from './app/v1HashDecoder';
import { hydrate as hydrateToolSettings, watch as watchToolSettings } from './app/toolSettingsPersistence';
import { shouldAutoOpenChangelog, markChangelogSeen } from './app/version';
import { shouldShowOnboarding, markOnboardingSeen } from './app/onboarding';
import { Onboarding } from './ui/Onboarding';
import { getMap } from './types/maps';
import { ToolsManager, type ToolController } from './app/tools';
import { TransitionController } from './app/transitions';
import { PlaybackController } from './app/playback';
import { StrokeLayer } from './render/StrokeLayer';
import { CalloutsLayer } from './render/CalloutsLayer';
import { ShapeLayer } from './render/ShapeLayer';
import { ShapeHandlesLayer } from './render/ShapeHandlesLayer';
import { ConeLayer } from './render/ConeLayer';
import { PlayerLayer } from './render/PlayerLayer';
import { QuickAddLayer } from './render/QuickAddLayer';
import { TextLayer } from './render/TextLayer';
import { OnionSkinLayer } from './render/OnionSkinLayer';
import { DrawTool } from './tools/DrawTool';
import { EraseTool } from './tools/EraseTool';
import { ShapesTool } from './tools/ShapesTool';
import { ConeTool } from './tools/ConeTool';
import { PlayerTool } from './tools/PlayerTool';
import { QuickAddTool } from './tools/QuickAddTool';
import { TextTool } from './tools/TextTool';
import { ScannerTool } from './tools/ScannerTool';
import { SelectTool } from './tools/SelectTool';
import { emptyFrame, type ToolId, type SelectionRef } from './types/primitives';
import { hex } from './types/hex';
import type { Viewport } from './render/coords';
import { watchLayoutMode, currentLayoutMode } from './app/layoutMode';
import { bootProfile } from './app/bootProfile';
import { TouchViewportController } from './app/touchViewport';
import { MobileChrome } from './ui/MobileChrome';
import { MobileToolRail } from './ui/MobileToolRail';
import { MobileColourSheet } from './ui/MobileColourSheet';
import { createSheetManager } from './ui/sheetManager';
import { openItemActionMenu } from './ui/ItemActionMenu';
import { KeyboardAutoPan } from './app/keyboardAutoPan';
import { attachTheme, setTheme } from './app/themePref';

// Fade out + remove the static boot skeleton from index.html.
function hideBootSkeleton(): Promise<void> {
  const sk = document.getElementById('boot-skeleton');
  if (!sk) return Promise.resolve();
  sk.classList.add('is-hiding');
  return new Promise((r) => setTimeout(() => { sk.remove(); r(); }, 240));
}

// Sharing is hash-only: the strat lives in the URL fragment (#s=<lz>), or a
// legacy v1 #L... link. There is no server-side share code to resolve.
// `bad` is a #s= link that didn't decode; anything else unrecognised is left
// alone, since #L/#A could just be an anchor.
function readShareHash(rawHash: string): { file: StratFile | null; v1Dropped: string[] | null; bad: boolean } {
  if (rawHash.startsWith('s=')) {
    const file = decodeHash(rawHash.slice(2));
    return { file, v1Dropped: null, bad: file == null };
  }
  if (rawHash.startsWith('L') || rawHash.startsWith('A')) {
    // 'L' = a single v1 board, 'A' = a v1 animation (multiple frames).
    const v1 = decodeV1Hash(rawHash);
    if (v1) return { file: v1.file, v1Dropped: v1.droppedKinds, bad: false };
  }
  return { file: null, v1Dropped: null, bad: false };
}

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('Missing #app');

  // Reflect the persisted (or OS-derived) theme onto <html> before the UI
  // mounts so there's no dark-to-light flash.
  attachTheme();

  // the boot skeleton is baked into index.html so it paints before this bundle
  // runs; we fade it out at the end of boot once the real ui is mounted.

  const bootHash = readShareHash(window.location.hash.slice(1));
  const hash = bootHash.file;
  const v1Detected = bootHash.v1Dropped != null;
  const v1DroppedKinds = bootHash.v1Dropped ?? [];
  const badShareLink = bootHash.bad;

  // Fit-zoom estimate based on window dims minus the sidebar, topbar, and
  // frame timeline. Using this as the initial zoom (rather than 1.0) avoids
  // the brief zoom=1 flash before the post-mount zoomFit() refines it.
  // SIDEBAR_PX/TOPBAR_PX/TIMELINE_PX are imported from viewport.ts (where
  // they also feed STANDARD_ZOOM_100).
  const initialFitZoom = clampZoom(fitZoomFor(
    Math.max(0, window.innerWidth - SIDEBAR_PX),
    Math.max(0, window.innerHeight - TOPBAR_PX - TIMELINE_PX),
  ));

  const initial: StratState = {
    mapId: hash?.map ?? 'suna',
    zoom: hash?.view.zoom ?? initialFitZoom,
    panX: hash?.view.panX ?? 0,
    panY: hash?.view.panY ?? 0,
    frames: hash?.frames ?? [emptyFrame()],
    activeFrameIdx: hash?.activeFrame ?? 0,
    mapFrames: {},
    notes: hash?.notes ?? '',
    tool: 'cursor',
    // Five slots prefilled: red / green / blue / white / black.
    colourSlots: [hex('#ff4655'), hex('#00ff88'), hex('#3da9fc'), hex('#ffffff'), hex('#000000')],
    activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: false, changelogOpen: false, touchMultiSelect: false, confirmOpen: null },
  };

  const store = createStore(initial);
  watchLayoutMode(store);
  const profile = bootProfile(currentLayoutMode(store));
  const history = createHistory(store);
  // Owns the frame-switch animation; the per-frame render layers read their frame
  // through it (FrameView), so it must exist before any layer is constructed.
  const transitions = new TransitionController(store);
  const playback = new PlaybackController(store, history, transitions);

  const shell = new Shell(root, store);
  shell.mount();
  const mapSize = shell.getMapSize();

  const strokeLayer = new StrokeLayer(shell.getZoomViewport(), store, mapSize, transitions);
  strokeLayer.mount();
  const calloutsLayer = new CalloutsLayer(shell.getMapWrap(), store);
  calloutsLayer.mount();
  const shapeLayer = new ShapeLayer(shell.getMapWrap(), store, mapSize, transitions);
  shapeLayer.mount();
  const coneLayer = new ConeLayer(shell.getMapWrap(), store, mapSize, transitions);
  coneLayer.mount();

  function getViewport(): Viewport {
    const rect = shell.getViewer().getBoundingClientRect();
    const s = store.get();
    return {
      left: rect.left, top: rect.top, width: rect.width, height: rect.height,
      w: mapSize.w, h: mapSize.h, zoom: s.zoom, panX: s.panX, panY: s.panY,
    };
  }

  // Right-click any node to delete it, under any tool (lives on the viewer, so
  // it's tool-agnostic; SelectTool/ViewportController already ignore button 2).
  installContextDelete(shell.getViewer(), { store, history, getViewport });

  const onionSkinLayer = new OnionSkinLayer(
    shell.getZoomViewport(), shell.getMapWrap(), store, history,
    shell.getMapSize(), getViewport, playback,
  );
  onionSkinLayer.mount();

  const playerLayer = new PlayerLayer(shell.getZoomViewport(), store, mapSize, getViewport, transitions);
  playerLayer.mount();

  const quickAddLayer = new QuickAddLayer(shell.getMapWrap(), store, mapSize, transitions);
  quickAddLayer.mount();

  const textLayer = new TextLayer(shell.getMapWrap(), store, history, getViewport, transitions);
  textLayer.mount();

  // Resize handles for the selected shape. Mounted last among the map-wrap
  // layers so the handle squares sit on top of everything below them.
  const shapeHandlesLayer = new ShapeHandlesLayer(shell.getMapWrap(), store, history, mapSize, getViewport, profile.touchEdit);
  shapeHandlesLayer.mount();

  // Per-session layer visibility -> data attributes on the zoom viewport.
  // CSS in layer-visibility.css hides each layer's root when the matching
  // data-hide-... attribute reads "true". Done at boot so the toggles work
  // regardless of which sidebar tab the user lands on.
  const detachLayerVisibility = attachLayerVisibility(shell.getZoomViewport(), store);

  // Selected textbox follows the active colour slot, same flow as the font-
  // size slider retunes the selected textbox -- pick a colour, the selected
  // text follows. Bypasses history like the colour wheel does.
  const detachSelectionColourSync = attachSelectionColourSync(store);

  // Named-player legend overlay - mounted on the (untransformed) viewer so it
  // stays a fixed HUD element regardless of zoom/pan.
  // Drives the .sel-highlight glow off store.selection. Mounted for both profiles:
  // it used to live inside SelectTool, which compact never attaches, so a touch
  // selection was real but invisible.
  const selectionHighlight = new SelectionHighlight(store, {
    strokeLayer, shapeLayer, coneLayer, playerLayer, quickAddLayer, textLayer,
  });
  selectionHighlight.mount();

  const playerLegend = new PlayerLegend(shell.getViewer(), store);
  playerLegend.mount();

  // Discord link HUD -- top-right of the viewer, mirror of PlayerLegend's
  // top-left. Single-source URL lives in app/contact.ts.
  const discordLink = new DiscordLink(shell.getViewer());
  discordLink.mount();

  // Empty-frame nudge -- a one-line "pick a tool and draw" hint for a first
  // visitor who skipped the tour and is staring at a blank grid. Auto-hides
  // once anything is placed; dismissable for good.
  const canvasHint = new CanvasHint(shell.getViewer(), store);
  canvasHint.mount();

  // Bottom-right viewer HUD: clear-frame + zoom in/out icon buttons. Only
  // mounted on the desktop / mountTools profile; the compact chrome has
  // its own touch toolbar with equivalent affordances.
  let viewerActions: ViewerActions | null = null;

  // Playback caption HUD -- also mounted on the viewer so zoom/pan doesn't
  // move it around. Hidden whenever playback isn't running or the active
  // frame has no caption.
  const frameCaptionOverlay = new FrameCaptionOverlay(shell.getViewer(), store, playback);
  frameCaptionOverlay.mount();

  // --- Tool-only construction (desktop / mountTools profile) ---
  // Everything in here is editing chrome the compact read-only viewer does
  // not mount. Bindings referenced later are declared nullable and guarded.
  let drawTool: DrawTool | null = null;
  let eraseTool: EraseTool | null = null;
  let shapesTool: ShapesTool | null = null;
  let coneTool: ConeTool | null = null;
  let playerTool: PlayerTool | null = null;
  let quickAddTool: QuickAddTool | null = null;
  let textTool: TextTool | null = null;
  let scannerTool: ScannerTool | null = null;
  let cursorTool: SelectTool | null = null;
  let selectTool: SelectTool | null = null;
  let lassoTool: SelectTool | null = null;
  let toolsManager: ToolsManager | null = null;
  let offToolSettings: (() => void) | null = null;

  if (profile.mountTools) {
    drawTool = new DrawTool({ store, history, strokeLayer, getViewport });
    eraseTool = new EraseTool({ store, history, strokeLayer, getViewport });
    shapesTool = new ShapesTool({ store, history, shapeLayer, getViewport });
    coneTool = new ConeTool({ store, history, getViewport });
    playerTool = new PlayerTool({ store, history, getViewport });
    quickAddTool = new QuickAddTool({ store, history, getViewport });
    textTool = new TextTool({ store, history, textLayer, getViewport });

    scannerTool = new ScannerTool({
      store, history,
      host: shell.getMapWrap(),
      getViewport,
    });

    const selectDeps = {
      store, history,
      zoomViewport: shell.getZoomViewport(),
      strokeLayer, shapeLayer, coneLayer, playerLayer, quickAddLayer, textLayer,
      getViewport,
    };
    cursorTool = new SelectTool({ ...selectDeps, mode: 'cursor' });
    selectTool = new SelectTool({ ...selectDeps, mode: 'select' });
    lassoTool  = new SelectTool({ ...selectDeps, mode: 'lasso' });

    const tools = new Map<ToolId, ToolController>([
      ['cursor', cursorTool],
      ['select', selectTool],
      ['lasso', lassoTool],
      ['draw', drawTool],
      ['erase', eraseTool],
      ['shapes', shapesTool],
      ['place-cone', coneTool],
      ['place-player', playerTool],
      ['place-quickadd', quickAddTool],
      ['place-text', textTool],
      ['place-scanner', scannerTool],
    ]);
    toolsManager = new ToolsManager(shell.getViewer(), store, tools);
    toolsManager.start();
  }

  // Compact (touch-edit) mounts the seven creation tools in a ToolsManager
  // whose map deliberately omits the select-family ids - for cursor / select
  // / lasso the TouchViewportController's touch edit path is the "select
  // tool". This is mutually exclusive with the desktop mountTools block above.
  if (profile.mountCreationTools) {
    drawTool = new DrawTool({ store, history, strokeLayer, getViewport });
    eraseTool = new EraseTool({ store, history, strokeLayer, getViewport });
    shapesTool = new ShapesTool({ store, history, shapeLayer, getViewport });
    coneTool = new ConeTool({ store, history, getViewport });
    playerTool = new PlayerTool({ store, history, getViewport });
    quickAddTool = new QuickAddTool({ store, history, getViewport });
    textTool = new TextTool({ store, history, textLayer, getViewport });

    const tools = new Map<ToolId, ToolController>([
      ['draw', drawTool],
      ['erase', eraseTool],
      ['shapes', shapesTool],
      ['place-cone', coneTool],
      ['place-player', playerTool],
      ['place-quickadd', quickAddTool],
      ['place-text', textTool],
    ]);
    toolsManager = new ToolsManager(shell.getViewer(), store, tools);
    toolsManager.start();

    // Persist tool settings (draw size, erase size, shapes kind) across reloads.
    hydrateToolSettings([drawTool, eraseTool, shapesTool]);
    offToolSettings = watchToolSettings([drawTool, eraseTool, shapesTool]);
  }

  let touchCtl: TouchViewportController | null = null;
  let viewportCtl: ViewportController | null = null;
  // Assigned further down, once the shared sheet manager exists - the touch
  // controller is built before the compact chrome, so the hook has to be
  // forward-declared rather than passed straight in.
  let openItemMenu: ((ref: SelectionRef, x: number, y: number) => void) | null = null;
  if (profile.viewport === 'touch') {
    touchCtl = new TouchViewportController(
      shell.getViewer(), store,
      profile.touchEdit
        ? {
            getViewport, history,
            getActiveTool: () => toolsManager?.getActive() ?? null,
            onLongPress: (ref, x, y) => openItemMenu?.(ref, x, y),
          }
        : undefined,
    );
    touchCtl.attach();
  } else {
    viewportCtl = new ViewportController(shell.getViewer(), store);
    viewportCtl.attach();
  }

  // Drags revert onto the active frame, so cancel them before a frame change
  // rather than after, or the revert lands on the wrong frame.
  history.onBeforeFrameChange(() => {
    const tool = toolsManager?.getActive();
    if (tool?.cancelEdits) tool.cancelEdits(); else tool?.cancel?.();
    shapeHandlesLayer.cancel();
    touchCtl?.cancelEdits();
  });

  // Default first paint: fit the whole map regardless of viewport aspect ratio.
  // Compact always fits the whole map on open (hash or not); desktop only
  // fits fresh boots (hash-loaded strats keep their saved view).
  // After the fit lands, snapshot the view so Ctrl+0 (view.reset) restores
  // exactly what the user saw on first paint -- a later window resize won't
  // shift the reset target.
  if (profile.viewport === 'touch') {
    requestAnimationFrame(() => touchCtl?.resetToDefaultView());
  } else if (hash == null) {
    requestAnimationFrame(() => {
      viewportCtl?.zoomFit();
      viewportCtl?.markInitialView();
    });
  } else {
    requestAnimationFrame(() => viewportCtl?.markInitialView());
  }

  const clipboard = createClipboard();
  const actions = createActions(store);

  if (profile.mountTools) {
    // hydrate persisted tool settings BEFORE registerAll so the first
    // [/] press uses the persisted size (deferred decision 10).
    const settableTools = [drawTool!, eraseTool!, shapesTool!];
    hydrateToolSettings(settableTools);
    offToolSettings = watchToolSettings(settableTools);
  }

  // The library entry the on-screen strat came from (or was last saved to),
  // or null when it isn't a saved entry yet (fresh boot, hash/share link,
  // imported file). A plain SAVE re-saves onto this id instead of stacking up
  // a fresh "Strat <timestamp>" row every press; "+ New save" forces a new id.
  let currentLibraryId: string | null = null;
  // Bumped on every load, so an in-flight save can tell the strat changed under it.
  let loadGen = 0;
  // Set once the crash-recovery autosaver is running (it waits on the restore prompt).
  let autosaving = false;

  function currentStratFile(): StratFile {
    const s = store.get();
    return {
      v: 2,
      map: s.mapId,
      notes: s.notes,
      view: { zoom: s.zoom, panX: s.panX, panY: s.panY },
      frames: s.frames,
      activeFrame: s.activeFrameIdx,
    };
  }

  function loadFile(file: StratFile, libraryId: string | null): void {
    currentLibraryId = libraryId;
    loadGen++;
    store._apply({
      mapId: file.map,
      zoom: file.view.zoom,
      panX: file.view.panX,
      panY: file.view.panY,
      frames: file.frames,
      activeFrameIdx: file.activeFrame,
      // A freshly-loaded strat starts with no per-map memory - the previous
      // strat's stashed frames must not bleed through on the next map switch.
      mapFrames: {},
      notes: file.notes,
      selection: [],
    });
    // The old strat's undo steps would run against this one.
    history.clear();
    // The loaded view IS the new "original" for Ctrl+0 (view.reset).
    viewportCtl?.markInitialView();
  }

  function isContentPresent(): boolean {
    const file = currentStratFile();
    if (stratHasContent(file)) return true;
    // Other maps' frames live in mapFrames and a load wipes them too.
    return Object.values(store.get().mapFrames ?? {})
      .some((m) => m != null && stratHasContent({ ...file, frames: m.frames }));
  }

  function frameIsEmpty(idx: number): boolean {
    const f = store.get().frames[idx];
    if (!f) return true;
    return (
      f.strokes.length === 0 && f.shapes.length === 0 && f.cones.length === 0 &&
      f.players.length === 0 && f.textboxes.length === 0 && f.quickadds.length === 0 &&
      f.scanner === null
    );
  }

  function dispatchClearFrame(): void {
    const idx = store.get().activeFrameIdx;
    if (frameIsEmpty(idx)) return;
    const before = store.get().frames[idx]!;
    const ui = store.get().ui;
    store._apply({ ui: { ...ui, confirmOpen: {
      kind: 'clear-frame',
      title: 'Clear frame?',
      body: `This will remove all content from frame ${idx + 1}.`,
      confirmLabel: 'Clear frame',
      onConfirm: () => { history.dispatch({ t: 'frame.clear', before }); toast.success('Frame cleared'); },
    }}});
  }

  function timestamp(): string {
    const d = new Date();
    const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  // Preload the scanner sprite once so PNG export can include the singleton
  // scanner regardless of which tool is active when the user hits Export.
  // The on-screen scanner DIV is owned by ScannerTool and torn down on
  // detach, but the placement state lives in the active frame, so we draw
  // it from the store rather than the DOM at export time.
  const SCANNER_EXPORT_SIZE = 64;
  const scannerExportImage = new Image();
  scannerExportImage.src = `${import.meta.env.BASE_URL}assets/quick-adds/map-assets/scanner.png`;

  function getComposeDeps(): ComposeDeps {
    const mapImg = root!.querySelector('#map-image') as HTMLImageElement;
    const frame = store.get().frames[store.get().activeFrameIdx]!;
    return {
      mapImage: mapImg,
      calloutsImage: calloutsLayer.getExportImage(),
      strokeCanvas: strokeLayer.getCommittedCanvas(),
      // PlayerLayer needs a freshly-built natural-coord SVG - its live SVG
      // bakes the user's current zoom/pan into per-player transforms.
      svgLayers: [
        shapeLayer.getSvg(),
        coneLayer.getSvg(),
        quickAddLayer.getSvg(),
        playerLayer.getExportSvg(1920, 1080),
      ],
      textBoxes: textLayer.getExportTextBoxes(),
      scanner: frame.scanner
        ? { x: frame.scanner.x, y: frame.scanner.y, size: SCANNER_EXPORT_SIZE, image: scannerExportImage }
        : null,
      mapWidth: 1920,
      mapHeight: 1080,
    };
  }

  // Wait until an <img> has actually decoded. Saving the moment a map is
  // switched (before its png lands) used to bake a black thumbnail with the
  // map missing - that's the "library preview is just black" bug.
  function whenImageReady(img: HTMLImageElement): Promise<void> {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = (): void => {
        img.removeEventListener('load', done);
        img.removeEventListener('error', done);
        resolve();
      };
      img.addEventListener('load', done);
      img.addEventListener('error', done);
    });
  }

  // Last-ditch thumbnail: rasterise the map's own static preview onto a clean,
  // same-origin canvas so we hand the library a data: URL it'll actually show.
  // The library ignores non-data: srcs, so returning a bare asset path would
  // just leave a blank (black-looking) box.
  async function staticThumbDataUrl(): Promise<string | null> {
    const m = getMap(store.get().mapId);
    try {
      const img = new Image();
      img.src = `${import.meta.env.BASE_URL}${m.folder}/thumbnail.png`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 144;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.imageSmoothingQuality = 'high';
      const srcAspect = img.naturalWidth / img.naturalHeight;
      const dstAspect = canvas.width / canvas.height;
      let dw: number, dh: number;
      if (srcAspect > dstAspect) { dw = canvas.width; dh = dw / srcAspect; }
      else { dh = canvas.height; dw = dh * srcAspect; }
      ctx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  async function captureThumb(): Promise<string> {
    const mapImg = root!.querySelector('#map-image') as HTMLImageElement | null;
    if (mapImg) await whenImageReady(mapImg);
    try {
      return await composeThumbnail(getComposeDeps());
    } catch (err) {
      if (err instanceof Error && (err as Error & { cause?: unknown }).cause === TAINTED_CANVAS) {
        const fallback = await staticThumbDataUrl();
        if (fallback) return fallback;
        const m = getMap(store.get().mapId);
        return `${import.meta.env.BASE_URL}${m.folder}/thumbnail.png`;
      }
      throw err;
    }
  }

  let saving = false;

  async function promptAndSave(forceNew = false): Promise<void> {
    // Two saves racing the thumbnail capture would both see "no entry yet".
    if (saving) return;
    // Timestamp name, no window.prompt: some embedded views silently no-op it,
    // which made SAVE look broken. Name it from the library if you care.
    // Re-saving overwrites the current entry so two presses don't make two
    // identical rows; forceNew (the "+ New save" button) skips that.
    const existing = !forceNew && currentLibraryId != null
      ? listStrats().find((e) => e.id === currentLibraryId)
      : undefined;
    const name = existing?.name ?? `Strat ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
    const gen = loadGen;
    saving = true;
    try {
      const thumbDataUrl = await captureThumb();
      // A load during the capture would put the new strat (and its thumbnail)
      // into the old entry, and repoint the open strat at it.
      if (gen !== loadGen) {
        toast.info('Save skipped - a different strat was loaded.');
        return;
      }
      const file = currentStratFile();
      currentLibraryId = existing
        ? saveStrat({ id: existing.id, name, file, thumbDataUrl })
        : saveStrat({ name, file, thumbDataUrl });
      // Saving changes no store key, so the autosaver won't notice. Point the
      // recover slot at the entry or next boot offers to restore saved work.
      if (autosaving) writeRecover(currentLibraryId, file);
      toast.success(existing ? `Updated "${name}"` : `Saved "${name}"`);
    } catch (err) {
      if (err instanceof LibraryError && err.code === 'QUOTA_EXCEEDED') {
        toast.error('Browser storage is full. Delete a strat to make room.');
        return;
      }
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      saving = false;
    }
  }

  // Exports composite every layer on the main thread, which can take a second
  // or two (a multi-frame GIF especially). Guard against a second run while one
  // is in flight (double-clicking the button) and put up an "Exporting..." toast
  // so it doesn't look like nothing happened. The success/error toast at the end
  // dismisses the progress one.
  let exporting = false;

  async function exportPng(): Promise<void> {
    if (exporting) { toast.info('Hang on - an export is already running.'); return; }
    exporting = true;
    toast.info('Exporting PNG...');
    try {
      const blob = await composeFullPng(getComposeDeps());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `artifact-${store.get().mapId}-${timestamp()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.dismiss();
      toast.success('Exported PNG');
    } catch (err) {
      toast.dismiss();
      if (err instanceof Error && (err as Error & { cause?: unknown }).cause === TAINTED_CANVAS) {
        toast.error("Couldn't export PNG - map image isn't loaded yet, try reloading.");
        return;
      }
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      exporting = false;
    }
  }

  async function exportGif(): Promise<void> {
    if (exporting) { toast.info('Hang on - an export is already running.'); return; }
    exporting = true;
    toast.info('Exporting GIF...');
    const GIF_W = Math.round(1920 * 0.5);
    const GIF_H = Math.round(1080 * 0.5);
    try {
      const { exportGif: runGifExport } = await import('./app/gifExport');
      await runGifExport({
        store,
        composeFrame: async () => {
          const c = await composeFrameCanvas(getComposeDeps(), GIF_W, GIF_H);
          const ctx = c.getContext('2d');
          if (!ctx) throw new Error('no 2d context');
          const img = ctx.getImageData(0, 0, GIF_W, GIF_H);
          return { data: img.data, width: GIF_W, height: GIF_H };
        },
        globalDelayMs: () => playback.delayMs,
        download: (blob, filename) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = filename;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 0);
        },
        filenameStem: () => `${store.get().mapId}-${timestamp()}`,
      });
      toast.dismiss();
      toast.success('Exported GIF');
    } catch (err) {
      toast.dismiss();
      if (err instanceof Error && (err as Error & { cause?: unknown }).cause === TAINTED_CANVAS) {
        toast.error("Couldn't export GIF - map image isn't loaded yet, try reloading.");
        return;
      }
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      exporting = false;
    }
  }

  async function exportContactSheet(): Promise<void> {
    if (exporting) { toast.info('Hang on - an export is already running.'); return; }
    exporting = true;
    toast.info('Exporting contact sheet...');
    try {
      const { composeContactSheet } = await import('./app/contactSheet');
      const mapName = getMap(store.get().mapId).name;
      const entry = currentLibraryId != null
        ? listStrats().find((e) => e.id === currentLibraryId)
        : undefined;
      const dateText = new Date().toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
      });
      const blob = await composeContactSheet({
        store,
        composeFrame: (w, h) => composeFrameCanvas(getComposeDeps(), w, h),
        header: { mapName, stratName: entry?.name ?? null, dateText },
        footer: 'made with artifactgg.com',
        captionOf: (i) => store.get().frames[i]?.caption ?? '',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `artifact-${store.get().mapId}-contact-${timestamp()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.dismiss();
      toast.success('Exported contact sheet');
    } catch (err) {
      toast.dismiss();
      if (err instanceof Error && (err as Error & { cause?: unknown }).cause === TAINTED_CANVAS) {
        toast.error("Couldn't export contact sheet - map image isn't loaded yet, try reloading.");
        return;
      }
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      exporting = false;
    }
  }

  function exportJson(): void {
    writeStratToFile(currentStratFile(), `artifact-${store.get().mapId}-${timestamp()}.strat.json`);
    toast.success('Exported .strat.json');
  }

  function importJson(): void {
    const i = document.createElement('input');
    // Accept .txt too -- a v1 strat is just a pasted code, people often park
    // those in a text file.
    i.type = 'file';
    i.accept = '.strat.json,.json,.txt,application/json,text/plain';
    i.addEventListener('change', () => {
      const f = i.files?.[0];
      if (!f) return;
      f.text()
        .then((text) => {
          // Try a v2 file first, then fall back to a v1 code / packed array so
          // an old strat still comes in.
          let file: StratFile | null = null;
          let fromV1 = false;
          let dropped: string[] = [];
          try {
            file = deserialize(text);
          } catch {
            const v1 = tryDecodeV1Text(text);
            if (v1) { file = v1.file; fromV1 = true; dropped = v1.droppedKinds; }
          }
          if (!file) {
            toast.error("Import failed: that doesn't look like a strat file.");
            return;
          }
          const loaded = file;
          const done = (): void => {
            loadFile(loaded, null);
            if (fromV1) {
              toast.success(dropped.length > 0
                ? `Imported a v1 strat -- ${dropped.join(', ')} couldn't be migrated.`
                : 'Imported a v1 strat.');
            } else {
              toast.success('Imported strat');
            }
          };
          if (isContentPresent()) {
            const ui = store.get().ui;
            store._apply({ ui: { ...ui, confirmOpen: {
              kind: 'discard',
              title: 'Discard current strat?',
              body: 'Importing this file will replace the current strat.',
              confirmLabel: 'Discard & Import',
              onConfirm: done,
            }}});
          } else {
            done();
          }
        })
        .catch((err: Error) => toast.error(`Import failed: ${err.message}`));
    });
    i.click();
  }

  function openLibrary(): void {
    const ui = store.get().ui;
    store._apply({ ui: { ...ui, libraryOpen: true } });
  }

  function openShare(): void {
    const ui = store.get().ui;
    store._apply({ ui: { ...ui, shareOpen: true } });
  }

  function openChangelog(): void {
    const ui = store.get().ui;
    store._apply({ ui: { ...ui, changelogOpen: true } });
  }

  function loadFromLibrary(id: string): void {
    let file: StratFile;
    try {
      file = loadStrat(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    const proceed = (): void => {
      loadFile(file, id);
      const ui = store.get().ui;
      store._apply({ ui: { ...ui, libraryOpen: false } });
      const entry = listStrats().find((e) => e.id === id);
      toast.success(`Loaded "${entry?.name ?? id}"`);
    };
    if (isContentPresent()) {
      const ui = store.get().ui;
      store._apply({ ui: { ...ui, confirmOpen: {
        kind: 'discard',
        title: 'Discard current strat?',
        body: 'Loading will replace the current strat.',
        confirmLabel: 'Discard & Load',
        onConfirm: proceed,
      }}});
    } else {
      proceed();
    }
  }

  const legalModal = new LegalModal(document.body);
  legalModal.mount();

  // --- Tool-only actions + editing chrome (desktop / mountTools profile) ---
  // registerAll requires a fixed BrushSizable shape (drawTool/eraseTool) and
  // every registered action drives editing UI (sidebar / topbar / command
  // palette / keyboard) - none of which the compact read-only viewer mounts.
  // So the whole block is gated; the actions object simply stays unused in
  // compact (no keyboard attached, no palette/topbar to invoke it).
  let keyboard: ReturnType<typeof createKeyboard> | null = null;
  let sidebar: Sidebar | null = null;
  let mapDropdown: MapDropdown | null = null;
  let toolRail: ToolRail | null = null;
  let contextPanel: ContextPanel | null = null;
  let colourSlots: ColourSlots | null = null;
  let notesPane: NotesPane | null = null;
  let colourPicker: ColourPicker | null = null;
  let commandPalette: CommandPalette | null = null;
  let keyboardHints: KeyboardHints | null = null;
  let topBar: TopBar | null = null;

  // Spin up a fresh tour each time - Onboarding dismisses itself, so there's
  // nothing to keep around. Used both for the first-run auto-start and the
  // "replay tour" Help action.
  const startTour = (): void => { new Onboarding(document.body).start(); };

  if (profile.mountTools) {
    registerAll(actions, {
      store, history, clipboard, drawTool: drawTool!, eraseTool: eraseTool!,
      promptAndSave: () => { void promptAndSave(); },
      openLibrary,
      exportPng: () => { void exportPng(); },
      exportGif: () => { void exportGif(); },
      exportContactSheet: () => { void exportContactSheet(); },
      setTheme: (t) => { setTheme(t); },
      exportJson,
      importJson,
      zoomFit: () => viewportCtl?.zoomFit(),
      zoomTo100: () => viewportCtl?.zoomTo100(),
      resetView: () => viewportCtl?.resetView(),
      openShare,
      dispatchClearFrame,
      focusNotesPane: () => notesPane?.focus(),
      editSelectedTextbox: () => {
        // Ctrl+A with exactly one textbox selected: focus its textarea and
        // select all of ITS text so it can be re-edited after placement. The
        // action's textbox-override branch guarantees the precondition.
        const sel = store.get().selection;
        if (sel.length !== 1 || sel[0]!.kind !== 'textbox') return;
        const ta = textLayer.getNode(sel[0]!.id)?.querySelector('textarea') as HTMLTextAreaElement | null;
        if (!ta) return;
        ta.focus();
        ta.select();
      },
      openLegal: () => legalModal.open(),
      startTour,
    });

    keyboard = createKeyboard({ store, actions, legalModal });
    keyboard.attach();

    sidebar = new Sidebar(shell.getSidebarRoot(), store, actions);
    sidebar.mount();

    mapDropdown = new MapDropdown(sidebar.getMapDropdownSlot(), store, history);
    mapDropdown.mount();

    toolRail = new ToolRail(sidebar.getToolRailSlot(), store, history);
    toolRail.mount();

    contextPanel = new ContextPanel(sidebar.getContextPanelSlot(), store, history, toolsManager!);
    contextPanel.mount();

    colourSlots = new ColourSlots(sidebar.getColourSlotsSlot(), store);
    colourSlots.mount();

    notesPane = new NotesPane(sidebar.getNotesPaneSlot(), store, history);
    notesPane.mount();

    const layerVisibilityPanel = new LayerVisibilityPanel(sidebar.getLayerVisibilitySlot(), store);
    layerVisibilityPanel.mount();
    // Reference so the unused-var lint doesn't fire; the panel owns its own
    // lifetime via its subscription, no further wiring needed.
    void layerVisibilityPanel;

    colourPicker = new ColourPicker(document.body, store, history);
    colourPicker.mount();

    commandPalette = new CommandPalette(document.body, store, actions);
    commandPalette.mount();

    keyboardHints = new KeyboardHints(document.body, store, actions);
    keyboardHints.mount();

    topBar = new TopBar(shell.getTopBarRoot(), store, actions);
    topBar.mount();

    // Bottom-right viewer HUD -- desktop only. Same untransformed layer
    // PlayerLegend / DiscordLink use. clearActiveFrame routes through the
    // confirm-then-frame.clear flow so a stray click can't wipe a frame.
    // setZoom bypasses history like the other view transforms (wheel / +/-).
    viewerActions = new ViewerActions(shell.getViewer(), store, {
      clearActiveFrame: dispatchClearFrame,
      zoomIn: () => viewportCtl?.zoomIn(),
      zoomOut: () => viewportCtl?.zoomOut(),
      setZoom: (z) => store._apply({ zoom: z }),
    });
    viewerActions.mount();
  }

  // Mounted inside #app, not on document.body: every compact override in
  // styles/mobile-chrome.css is scoped to #app[data-layout="compact"], and a
  // body-level timeline silently kept its desktop `left: var(--sidebar-width)`
  // - a 110px sliver at the right edge with the add and play buttons off the
  // screen entirely. Desktop is unaffected; the timeline is position:fixed and
  // #app carries no transform, so fixed still resolves against the viewport.
  const frameTimeline = new FrameTimeline(root, store, history, playback);
  frameTimeline.mount();

  const confirmModal = new ConfirmModal(document.body, store);
  confirmModal.mount();

  const stratLibrary = new StratLibrary(document.body, store, {
    onLoad: loadFromLibrary,
    onNewSave: () => {
      // Close the modal first so the prompt is unobscured.
      const ui = store.get().ui;
      store._apply({ ui: { ...ui, libraryOpen: false } });
      void promptAndSave(true);
    },
  });
  stratLibrary.mount();

  const shareDialog = new ShareDialog(document.body, store, {
    getStratFile: currentStratFile,
  });
  shareDialog.mount();

  const changelogModal = new ChangelogModal(document.body, store);
  changelogModal.mount();

  // Compact chrome. Mounted on #map-viewer (shell.getViewer()):
  // the top bar (position:absolute; top:0) and menu sheet (bottom:0) sit at
  // the edges INSIDE the viewer box, so #map-viewer's overflow:hidden does
  // not clip them.
  let mobileChrome: MobileChrome | null = null;
  let mobileToolRail: MobileToolRail | null = null;
  let mobileColourSheet: MobileColourSheet | null = null;
  let keyboardAutoPan: KeyboardAutoPan | null = null;
  if (profile.mountCompactChrome) {
    // One manager for all six sheets - MobileChrome's five plus the colour sheet,
    // which is a separate component. Without a shared one they cannot close each
    // other. The menu button is exempt because it toggles its own sheet: if the
    // dismissal ate its tap the sheet would close and reopen in one gesture.
    const sheetManager = createSheetManager({
      isExempt: (t) => {
        if (!(t instanceof Element)) return false;
        // The menu button toggles its own sheet.
        if (document.querySelector('[data-testid="mobile-menu-btn"]')?.contains(t)) return true;
        // On-canvas handles for the selected item. The selection sheet is the
        // property editor for that same item, so grabbing its resize handle should
        // resize it, not spend the tap dismissing the editor.
        return t.classList.contains('shape-handle') || t.classList.contains('tbox-handle');
      },
    });
    mobileChrome = new MobileChrome(
      shell.getViewer(), store, store.get().mapId,
      profile.touchEdit
        ? {
            history,
            fitView: () => touchCtl?.resetToDefaultView(),
            clearFrame: dispatchClearFrame,
            playback,
            deleteSelection: () => deleteSelection(store, history),
            getToolPanel: () => toolsManager?.getActive()?.getContextPanel?.() ?? null,
            menuActions: {
              save: () => { void promptAndSave(); },
              newSave: () => { void promptAndSave(true); },
              openLibrary,
              importFile: importJson,
              exportPng: () => { void exportPng(); },
              exportGif: () => { void exportGif(); },
              exportJson,
              openShare,
              openChangelog,
              openLegal: () => legalModal.open(),
            },
          }
        : undefined,
      sheetManager,
    );
    mobileChrome.mount();
    if (profile.touchEdit) {
      // Holding an item opens the per-item action menu. It registers with the
      // same sheet manager as the six sheets, so it cannot open underneath one.
      openItemMenu = (ref, x, y) => {
        openItemActionMenu(ref, x, y, {
          store, history, host: shell.getViewer(), sheets: sheetManager,
        });
      };
      mobileColourSheet = new MobileColourSheet(shell.getViewer(), store, history, sheetManager);
      mobileColourSheet.mount();
      mobileToolRail = new MobileToolRail(shell.getViewer(), store, {
        onReopenSettings: () => mobileChrome!.reopenToolSettings(),
      });
      mobileToolRail.mount();
      // Keep a focused text box / sheet field above the mobile keyboard.
      keyboardAutoPan = new KeyboardAutoPan(store);
      keyboardAutoPan.attach();
    }
  }

  const onResize = (): void => {
    shell.applyTransform();
    strokeLayer.resizeVisible();
    playerLayer.resize();
    if (touchCtl) touchCtl.resetToDefaultView();
  };
  window.addEventListener('resize', onResize);

  // A share link pasted into an already-open tab only changes the hash.
  window.addEventListener('hashchange', () => {
    const next = readShareHash(window.location.hash.slice(1));
    if (next.bad) { toast.error("That share link couldn't be read."); return; }
    const file = next.file;
    if (!file) return;
    const open = (): void => {
      loadFile(file, null);
      toast.success('Opened shared strat');
    };
    if (!isContentPresent()) { open(); return; }
    const ui = store.get().ui;
    store._apply({ ui: { ...ui, confirmOpen: {
      kind: 'discard',
      title: 'Discard current strat?',
      body: 'Opening this link will replace the current strat.',
      confirmLabel: 'Discard & Open',
      onConfirm: open,
    }}});
  });

  // Debug handle used by the dev console and by the Playwright e2e suite.
  // Vite statically replaces import.meta.env.MODE so this whole assignment
  // gets tree-shaken out of `npm run build` (MODE === 'production'); the
  // dev server and the e2e build (which runs `vite build --mode e2e`)
  // both keep it. Real production browsers never see $debug.
  if (import.meta.env.MODE !== 'production') {
    (window as unknown as { $debug: unknown }).$debug = {
      store, history, actions, clipboard, keyboard, shell, sidebar, mapDropdown, toolRail, contextPanel, colourSlots, colourPicker, commandPalette, keyboardHints, topBar, offToolSettings,
      strokeLayer, calloutsLayer, shapeLayer, shapeHandlesLayer, coneLayer, playerLayer, quickAddLayer, textLayer, onionSkinLayer,
      viewportCtl, touchCtl, mobileChrome, mobileToolRail, mobileColourSheet, keyboardAutoPan, toolsManager, transitions, playback,
      confirmModal, stratLibrary, shareDialog, changelogModal, toast, notesPane, frameTimeline, frameCaptionOverlay, playerLegend, discordLink, viewerActions,
      persistence: { promptAndSave, exportPng, exportJson, importJson, loadFromLibrary, currentStratFile, loadFile },
      tools: { draw: drawTool, erase: eraseTool, shapes: shapesTool,
               cone: coneTool, player: playerTool, quickadd: quickAddTool,
               text: textTool, scanner: scannerTool,
               cursor: cursorTool, select: selectTool, lasso: lassoTool },
    };
  }

  // Crash-recovery. Only consider the recover slot when the user didn't open
  // the app onto a share / hash strat -- in those cases the URL is the
  // intentional starting point and shouldn't be silently replaced.
  // Read happens BEFORE the autosaver attaches so the autosaver can't clobber
  // the slot on the way past.
  const recovered = (hash == null) ? readRecover() : null;
  let recoverStale = false;
  if (recovered != null && recovered.libraryId != null) {
    try {
      const saved = loadStrat(recovered.libraryId);
      if (serialize(saved) === serialize(recovered.file)) recoverStale = true;
    } catch {
      // Library entry was deleted between sessions -- still worth offering
      // the autosaved copy as a recovery candidate.
    }
  }
  if (recovered != null && recoverStale) clearRecover();

  // Held back while the restore prompt is up: the empty boot strat (and the
  // boot zoom-fit) would otherwise clear the slot before the user answers.
  const startAutosaver = (): void => {
    autosaving = true;
    createAutosaver({
      store,
      currentStratFile,
      getCurrentLibraryId: () => currentLibraryId,
    });
  };
  const offerRestore = recovered != null && !recoverStale;
  if (!offerRestore) startAutosaver();

  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await hideBootSkeleton();

  // first-visit privacy banner; gates any future analytics (nothing tracks today)
  new ConsentBanner(document.body).maybeShow();

  if (badShareLink) toast.error("That share link couldn't be read, so a blank strat was opened.");

  if (v1Detected) {
    toast.info(
      v1DroppedKinds.length > 0
        ? `Imported a v1 strat -- ${v1DroppedKinds.join(', ')} couldn't be migrated. Re-save to lock in the new shape.`
        : 'Imported a strat from a v1 link.',
    );
  }
  if (offerRestore && recovered != null) {
    const message = recovered.libraryId != null
      ? 'Restore unsaved changes from your last session?'
      : 'Restore unsaved work from your last session?';
    let restored = false;
    const restore = (): void => {
      restored = true;
      loadFile(recovered.file, recovered.libraryId);
      startAutosaver();
      toast.success('Restored unsaved work');
    };
    const offer = (): void => toast.prompt(message, {
      actionLabel: 'Restore',
      onAction: () => {
        // Work started since boot gets the same discard check as any other load.
        if (!isContentPresent()) { restore(); return; }
        const ui = store.get().ui;
        store._apply({ ui: { ...ui, confirmOpen: {
          kind: 'discard',
          title: 'Discard current strat?',
          body: 'Restoring will replace the current strat.',
          confirmLabel: 'Discard & Restore',
          onConfirm: restore,
        }}});
        // Backing out of the confirm (any way) puts the prompt back rather than
        // losing the recovered work. ConfirmModal clears confirmOpen before it
        // runs onConfirm, so wait a tick to see whether restore ran.
        const off = store.subscribe(['ui'], (s) => {
          if (s.ui.confirmOpen) return;
          off();
          queueMicrotask(() => { if (!restored) offer(); });
        });
      },
      onDismiss: () => { clearRecover(); startAutosaver(); },
    });
    offer();
  }

  // Onboarding vs changelog: a truly first-time visitor (no markers at all)
  // gets the onboarding tour. A returning user on a new APP_VERSION gets the
  // changelog. Mutually exclusive on boot so we never stack two modals at
  // once. For the first-timer path we also mark the changelog as seen --
  // "what's new since last time" is irrelevant when there is no last time.
  if (shouldShowOnboarding()) {
    markOnboardingSeen();
    markChangelogSeen();
    startTour();
  } else if (shouldAutoOpenChangelog()) {
    const ui = store.get().ui;
    store._apply({ ui: { ...ui, changelogOpen: true } });
    markChangelogSeen();
  }

  // Reference long-lived teardowns so they don't get unused-var-warned. The
  // boot sequence intentionally holds these for the lifetime of the page.
  void detachLayerVisibility;
  void detachSelectionColourSync;
}

function mountBootError(root: HTMLElement, err: unknown): void {
  while (root.firstChild) root.removeChild(root.firstChild);
  const pre = document.createElement('pre');
  pre.style.cssText = 'color:#ff4655;padding:24px;font-family:ui-monospace,monospace;';
  pre.textContent = `Boot failed: ${String(err)}`;
  root.appendChild(pre);
}

boot().catch((err) => {
  console.error('[artifactgg] boot failed', err);
  const root = document.getElementById('app');
  if (root) mountBootError(root, err);
});
