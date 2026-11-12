import { test, expect } from '@playwright/test';
import { encodeHash } from '../../src/app/persistence';
import { seedFirstRun, FIRST_RUN_ENTRIES } from './firstRunSeed';
import { LAST_SEEN_KEY } from '../../src/app/version';

// Every first-boot interstitial (changelog, onboarding tour, consent banner)
// puts something over the chrome that blocks the first click, so seed them all
// as seen. Tests that specifically exercise an auto-open path override this
// with their own addInitScript afterwards - later init scripts win.
test.beforeEach(async ({ page }) => {
  await seedFirstRun(page);
});

test('boots and loads the default Suna map', async ({ page }) => {
  await page.goto('/');
  // The site display name is artifactgg.com; the old /artifact\.gg/ pattern
  // wanted a literal dot and stopped matching at the rename. Storage keys and
  // code ids still use the old artifact-gg strings on purpose - this is only
  // the document title.
  await expect(page).toHaveTitle(/artifactgg\.com/i);

  const viewer = page.getByTestId('map-viewer');
  await expect(viewer).toBeVisible();

  const img = page.getByTestId('map-image');
  await expect(img).toHaveAttribute('src', /\/assets\/maps\/suna\/map\.png$/);
});

test('changes the map when a map.select command is dispatched', async ({ page }) => {
  await page.goto('/');
  const img = page.getByTestId('map-image');
  await expect(img).toHaveAttribute('src', /suna/);

  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug;
    dbg.history.dispatch({ t: 'map.select', mapId: 'miru' });
  });

  await expect(img).toHaveAttribute('src', /\/assets\/maps\/miru\/map\.png$/);
});

test('loads a strat from a v2 URL hash', async ({ page }) => {
  // Build the hash via the same encoder the app uses - avoids hardcoding a
  // pre-computed hash that could drift out of sync with the schema.
  const khidiHash = encodeHash({
    v: 2,
    map: 'khidi',
    notes: '',
    view: { zoom: 1, panX: 0, panY: 0 },
    frames: [
      { strokes: [], shapes: [], cones: [], players: [], textboxes: [], quickadds: [], scanner: null },
    ],
    activeFrame: 0,
  });

  await page.goto(`/#s=${khidiHash}`);
  const img = page.getByTestId('map-image');
  await expect(img).toHaveAttribute('src', /khidi/);
});

test('draws a stroke and stores it under the active frame', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug;
    dbg.history.dispatch({ t: 'tool.set', tool: 'draw' });
  });

  const viewer = await page.getByTestId('map-viewer').boundingBox();
  if (!viewer) throw new Error('map-viewer has no bounding box');
  const cx = viewer.x + viewer.width / 2;
  const cy = viewer.y + viewer.height / 2;

  await page.mouse.move(cx - 100, cy - 50);
  await page.mouse.down();
  await page.mouse.move(cx + 100, cy + 50, { steps: 20 });
  await page.mouse.up();

  const strokeCount = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: { strokes: unknown[] }[]; activeFrameIdx: number } } } }).$debug;
    const s = dbg.store.get();
    return s.frames[s.activeFrameIdx]!.strokes.length;
  });
  expect(strokeCount).toBe(1);
});

test('erases a stroke via the EraseTool drag', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug;
    dbg.history.dispatch({ t: 'tool.set', tool: 'draw' });
  });

  const viewer = await page.getByTestId('map-viewer').boundingBox();
  if (!viewer) throw new Error('map-viewer has no bounding box');
  const cx = viewer.x + viewer.width / 2;
  const cy = viewer.y + viewer.height / 2;

  await page.mouse.move(cx - 50, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 50, cy, { steps: 10 });
  await page.mouse.up();

  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug;
    dbg.history.dispatch({ t: 'tool.set', tool: 'erase' });
  });

  await page.mouse.move(cx - 30, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 30, cy, { steps: 10 });
  await page.mouse.up();

  const strokeCount = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: { strokes: unknown[] }[]; activeFrameIdx: number } } } }).$debug;
    const s = dbg.store.get();
    return s.frames[s.activeFrameIdx]!.strokes.length;
  });
  expect(strokeCount).toBe(0);
});

test('places a shape via ShapesTool drag and the SVG node appears', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const dbg = (window as unknown as {
      $debug: {
        history: { dispatch: (c: unknown) => void };
        tools: { shapes: { setKind: (k: string) => void } };
      };
    }).$debug;
    dbg.tools.shapes.setKind('square');
    dbg.history.dispatch({ t: 'tool.set', tool: 'shapes' });
  });

  const viewer = await page.getByTestId('map-viewer').boundingBox();
  if (!viewer) throw new Error('map-viewer has no bounding box');
  const cx = viewer.x + viewer.width / 2;
  const cy = viewer.y + viewer.height / 2;

  await page.mouse.move(cx - 60, cy - 40);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy + 40, { steps: 10 });
  await page.mouse.up();

  const rectCount = await page.locator('[data-shape-id]').count();
  expect(rectCount).toBe(1);
});

test('places a cone at the click point', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug;
    dbg.history.dispatch({ t: 'tool.set', tool: 'place-cone' });
  });

  const viewer = await page.getByTestId('map-viewer').boundingBox();
  if (!viewer) throw new Error('map-viewer has no bounding box');
  const cx = viewer.x + viewer.width / 2;
  const cy = viewer.y + viewer.height / 2;

  await page.mouse.click(cx, cy);

  const coneCount = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: { cones: unknown[] }[]; activeFrameIdx: number } } } }).$debug;
    const s = dbg.store.get();
    return s.frames[s.activeFrameIdx]!.cones.length;
  });
  expect(coneCount).toBe(1);

  await expect(page.locator('[data-cone-id]')).toHaveCount(1);
});

test('places a Colonist player and toggles dead state on click', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug;
    dbg.history.dispatch({ t: 'tool.set', tool: 'place-player' });
  });

  const viewer = await page.getByTestId('map-viewer').boundingBox();
  if (!viewer) throw new Error('map-viewer has no bounding box');
  const cx = viewer.x + viewer.width / 2;
  const cy = viewer.y + viewer.height / 2;

  await page.mouse.click(cx, cy);
  await expect(page.locator('[data-player-id]')).toHaveCount(1);

  // Click the placed player to toggle dead.
  await page.mouse.click(cx, cy);
  const dead = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: { players: { dead: boolean }[] }[]; activeFrameIdx: number } } } }).$debug;
    const s = dbg.store.get();
    return s.frames[s.activeFrameIdx]!.players[0]!.dead;
  });
  expect(dead).toBe(true);
});

test('places a smoke quickadd and toggles its range', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void }; tools: { quickadd: { setType: (t: string) => void } } } }).$debug;
    dbg.history.dispatch({ t: 'tool.set', tool: 'place-quickadd' });
    dbg.tools.quickadd.setType('smoke');
  });

  const viewer = await page.getByTestId('map-viewer').boundingBox();
  if (!viewer) throw new Error('map-viewer has no bounding box');
  const cx = viewer.x + viewer.width / 2;
  const cy = viewer.y + viewer.height / 2;

  await page.mouse.click(cx, cy);
  await expect(page.locator('[data-quickadd-id]')).toHaveCount(1);

  const id = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: { quickadds: { id: string }[] }[]; activeFrameIdx: number } } } }).$debug;
    return dbg.store.get().frames[dbg.store.get().activeFrameIdx]!.quickadds[0]!.id;
  });
  await page.evaluate((qaId) => {
    const dbg = (window as unknown as { $debug: { tools: { quickadd: { setRangeVisibleForId: (id: string, vis: boolean) => void } } } }).$debug;
    dbg.tools.quickadd.setRangeVisibleForId(qaId, true);
  }, id);
  const visible = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: { quickadds: { rangeVisible: boolean }[] }[]; activeFrameIdx: number } } } }).$debug;
    return dbg.store.get().frames[dbg.store.get().activeFrameIdx]!.quickadds[0]!.rangeVisible;
  });
  expect(visible).toBe(true);
});

test('places a textbox and types into it', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug;
    dbg.history.dispatch({ t: 'tool.set', tool: 'place-text' });
  });

  const viewer = await page.getByTestId('map-viewer').boundingBox();
  if (!viewer) throw new Error('map-viewer has no bounding box');
  const cx = viewer.x + viewer.width / 2;
  const cy = viewer.y + viewer.height / 2;

  await page.mouse.click(cx, cy);
  await expect(page.locator('.tbox')).toHaveCount(1);

  // The textarea inside the new tbox should be focused. Type into it.
  await page.keyboard.type('hello v2');
  // Click empty space to blur and commit.
  await page.mouse.click(cx + 400, cy + 200);

  const text = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: { textboxes: { text: string }[] }[]; activeFrameIdx: number } } } }).$debug;
    return dbg.store.get().frames[dbg.store.get().activeFrameIdx]!.textboxes[0]!.text;
  });
  expect(text).toBe('hello v2');
});

test('places, drags, and clears the singleton scanner', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug;
    dbg.history.dispatch({ t: 'tool.set', tool: 'place-scanner' });
  });

  const viewer = await page.getByTestId('map-viewer').boundingBox();
  if (!viewer) throw new Error('map-viewer has no bounding box');
  const cx = viewer.x + viewer.width / 2;
  const cy = viewer.y + viewer.height / 2;

  await page.mouse.click(cx, cy);
  await expect(page.locator('.scanner-el')).toHaveCount(1);

  // Right-click clears.
  await page.locator('.scanner-el').click({ button: 'right' });
  await expect(page.locator('.scanner-el')).toHaveCount(0);

  const scanner = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: { scanner: unknown }[]; activeFrameIdx: number } } } }).$debug;
    return dbg.store.get().frames[dbg.store.get().activeFrameIdx]!.scanner;
  });
  expect(scanner).toBeNull();
});

test('marquee selects two players and Delete + Undo round-trips both', async ({ page }) => {
  await page.goto('/');
  // Place two players first.
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug;
    dbg.history.dispatch({ t: 'tool.set', tool: 'place-player' });
  });
  const viewer = await page.getByTestId('map-viewer').boundingBox();
  if (!viewer) throw new Error('map-viewer has no bounding box');
  const cx = viewer.x + viewer.width / 2;
  const cy = viewer.y + viewer.height / 2;
  await page.mouse.click(cx - 60, cy);
  await page.mouse.click(cx + 60, cy);
  await expect(page.locator('[data-player-id]')).toHaveCount(2);

  // Switch to select mode and marquee both.
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug;
    dbg.history.dispatch({ t: 'tool.set', tool: 'select' });
  });
  await page.mouse.move(cx - 200, cy - 100);
  await page.mouse.down();
  await page.mouse.move(cx + 200, cy + 100, { steps: 10 });
  await page.mouse.up();
  const selCount = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { selection: unknown[] } } } }).$debug;
    return dbg.store.get().selection.length;
  });
  expect(selCount).toBe(2);

  // Press Delete - both gone.
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-player-id]')).toHaveCount(0);

  // Undo - both back.
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { history: { undo: () => void } } }).$debug;
    dbg.history.undo();
  });
  await expect(page.locator('[data-player-id]')).toHaveCount(2);
});

test('cursor-mode click selects a single player', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug;
    dbg.history.dispatch({ t: 'tool.set', tool: 'place-player' });
  });
  const viewer = await page.getByTestId('map-viewer').boundingBox();
  if (!viewer) throw new Error('map-viewer has no bounding box');
  const cx = viewer.x + viewer.width / 2;
  const cy = viewer.y + viewer.height / 2;
  await page.mouse.click(cx, cy);

  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug;
    dbg.history.dispatch({ t: 'tool.set', tool: 'cursor' });
  });
  await page.mouse.click(cx, cy);
  const sel = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { selection: { kind: string; id: string }[] } } } }).$debug;
    return dbg.store.get().selection;
  });
  expect(sel).toHaveLength(1);
  expect(sel[0]!.kind).toBe('player');
});

test('Ctrl+D duplicates the selected player at +20,+20', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug;
    dbg.history.dispatch({ t: 'tool.set', tool: 'place-player' });
  });
  const viewer = await page.getByTestId('map-viewer').boundingBox();
  if (!viewer) throw new Error('map-viewer has no bounding box');
  const cx = viewer.x + viewer.width / 2;
  const cy = viewer.y + viewer.height / 2;
  await page.mouse.click(cx, cy);

  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug;
    dbg.history.dispatch({ t: 'tool.set', tool: 'cursor' });
  });
  await page.mouse.click(cx, cy);
  await page.keyboard.press('Control+d');
  await expect(page.locator('[data-player-id]')).toHaveCount(2);

  // The new player is selected (one ref in selection slice).
  const selKinds = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { selection: { kind: string; id: string }[] } } } }).$debug;
    return dbg.store.get().selection.map((r) => r.kind);
  });
  expect(selKinds).toEqual(['player']);
});

test('lasso polygon selects an enclosed cone', async ({ page }) => {
  await page.goto('/');
  // Place a cone at viewer centre.
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug;
    dbg.history.dispatch({ t: 'tool.set', tool: 'place-cone' });
  });
  const viewer = await page.getByTestId('map-viewer').boundingBox();
  if (!viewer) throw new Error('map-viewer has no bounding box');
  const cx = viewer.x + viewer.width / 2;
  const cy = viewer.y + viewer.height / 2;
  await page.mouse.click(cx, cy);
  await expect(page.locator('[data-cone-id]')).toHaveCount(1);

  // Switch to lasso mode and draw a polygon enclosing the cone.
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug;
    dbg.history.dispatch({ t: 'tool.set', tool: 'lasso' });
  });
  await page.mouse.move(cx - 200, cy - 100);
  await page.mouse.down();
  await page.mouse.move(cx + 250, cy - 100, { steps: 5 });
  await page.mouse.move(cx + 250, cy + 100, { steps: 5 });
  await page.mouse.move(cx - 200, cy + 100, { steps: 5 });
  await page.mouse.up();

  const sel = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { selection: { kind: string; id: string }[] } } } }).$debug;
    return dbg.store.get().selection;
  });
  expect(sel.some((r) => r.kind === 'cone')).toBe(true);
});

test('loading a strat clears undo so Ctrl+Z cannot drag the old strat back', async ({ page }) => {
  await page.goto('/');
  const img = page.getByTestId('map-image');
  const canUndoAfterLoad = await page.evaluate(() => {
    type Dbg = {
      history: { dispatch: (c: unknown) => void; canUndo: () => boolean; undo: () => void };
      persistence: { loadFile: (f: unknown, id: string | null) => void };
    };
    const dbg = (window as unknown as { $debug: Dbg }).$debug;
    dbg.history.dispatch({ t: 'map.select', mapId: 'miru' });
    dbg.persistence.loadFile({
      v: 2,
      map: 'khidi',
      notes: '',
      view: { zoom: 1, panX: 0, panY: 0 },
      frames: [{ strokes: [], shapes: [], cones: [], players: [], textboxes: [], quickadds: [], scanner: null }],
      activeFrame: 0,
    }, null);
    const canUndo = dbg.history.canUndo();
    dbg.history.undo();
    return canUndo;
  });
  expect(canUndoAfterLoad).toBe(false);
  await expect(img).toHaveAttribute('src', /khidi/);
});

test('loading from the library asks first when only a later frame has content', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));
  const confirmOpen = await page.evaluate(async () => {
    type Dbg = {
      store: { get: () => { ui: { confirmOpen: unknown } }; _apply: (p: unknown) => void };
      persistence: { promptAndSave: () => Promise<void>; loadFromLibrary: (id: string) => void };
    };
    const dbg = (window as unknown as { $debug: Dbg }).$debug;
    await dbg.persistence.promptAndSave();
    const id = (JSON.parse(localStorage.getItem('artifact-gg.v2.library.index')!) as { id: string }[])[0]!.id;
    const empty = { strokes: [], shapes: [], cones: [], players: [], textboxes: [], quickadds: [], scanner: null };
    const p = { id: 'p1', team: 'colonist', x: 100, y: 100, name: '', dead: false };
    dbg.store._apply({ frames: [empty, { ...empty, players: [p] }], activeFrameIdx: 1, notes: '' });
    dbg.persistence.loadFromLibrary(id);
    const laterFrame = dbg.store.get().ui.confirmOpen;
    dbg.store._apply({ ui: { ...dbg.store.get().ui, confirmOpen: null } });

    // Work left behind on another map counts too.
    (dbg as unknown as { history: { dispatch: (c: unknown) => void } }).history.dispatch({ t: 'map.select', mapId: 'miru' });
    dbg.persistence.loadFromLibrary(id);
    const otherMap = dbg.store.get().ui.confirmOpen;
    return laterFrame && otherMap;
  });
  expect(confirmOpen).toBeTruthy();
});

test('the recover slot survives while the restore prompt is still waiting', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    const empty = { strokes: [], shapes: [], cones: [], players: [], textboxes: [], quickadds: [], scanner: null };
    const p = { id: 'p1', team: 'colonist', x: 100, y: 100, name: '', dead: false };
    const file = { v: 2, map: 'suna', notes: '', view: { zoom: 1, panX: 0, panY: 0 }, frames: [{ ...empty, players: [p] }], activeFrame: 0 };
    localStorage.setItem('artifact-gg.v2.recover', JSON.stringify({ libraryId: null, fileJson: JSON.stringify(file), savedAt: Date.now() }));
  });
  await page.goto('/');
  await expect(page.getByText(/Restore unsaved work/)).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { $debug: { store: { _apply: (p: unknown) => void } } }).$debug.store._apply({ zoom: 1.3 });
  });
  await page.waitForTimeout(1600);
  expect(await page.evaluate(() => localStorage.getItem('artifact-gg.v2.recover'))).not.toBeNull();

  // Work started since boot gets a discard check before Restore replaces it.
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { _apply: (p: unknown) => void } } }).$debug;
    dbg.store._apply({ notes: 'new work' });
  });
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('Discard current strat?')).toBeVisible();

  // Backing out of the discard keeps the recovered work on offer.
  await page.locator('.confirm-modal-cancel').click();
  await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { $debug: { store: { _apply: (p: unknown) => void } } }).$debug.store._apply({ zoom: 1.1 });
  });
  await page.waitForTimeout(1600);
  const slot = await page.evaluate(() => localStorage.getItem('artifact-gg.v2.recover'));
  expect(slot).toContain('p1');
});

test('a double save makes one library entry and the recover slot follows it', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));
  const result = await page.evaluate(async () => {
    type Dbg = {
      store: { _apply: (p: unknown) => void };
      persistence: { promptAndSave: () => Promise<void> };
    };
    const dbg = (window as unknown as { $debug: Dbg }).$debug;
    dbg.store._apply({ notes: 'work' });
    await new Promise((r) => setTimeout(r, 1300)); // let the autosaver write the slot
    await Promise.all([dbg.persistence.promptAndSave(), dbg.persistence.promptAndSave()]);
    const index = JSON.parse(localStorage.getItem('artifact-gg.v2.library.index')!) as { id: string }[];
    const slot = JSON.parse(localStorage.getItem('artifact-gg.v2.recover')!) as { libraryId: string | null };
    return { count: index.length, slotId: slot.libraryId, entryId: index[0]!.id };
  });
  expect(result.count).toBe(1);
  expect(result.slotId).toBe(result.entryId);
});

test('a broken share link says so instead of booting an empty strat silently', async ({ page }) => {
  await page.goto('/#s=not-a-real-strat');
  await expect(page.getByText(/share link couldn't be read/i)).toBeVisible();
});

test('switching frame mid-drag cancels the drag on the frame it started on', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));
  type Dbg = {
    store: { get: () => { frames: { players: { x: number }[] }[] }; _apply: (p: unknown) => void };
    history: { dispatch: (c: unknown) => void; canUndo: () => boolean; clear: () => void };
  };
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: Dbg }).$debug;
    const empty = { strokes: [], shapes: [], cones: [], textboxes: [], quickadds: [], scanner: null };
    const p = { id: 'p1', team: 'colonist', x: 960, y: 540, name: '', dead: false };
    dbg.store._apply({ frames: [{ ...empty, players: [p] }, { ...empty, players: [p] }], activeFrameIdx: 0 });
    dbg.history.dispatch({ t: 'tool.set', tool: 'place-player' });
    dbg.history.clear();
  });
  const dot = await page.locator('[data-player-id="p1"]').first().boundingBox();
  if (!dot) throw new Error('player has no bounding box');
  await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
  await page.mouse.down();
  await page.mouse.move(dot.x + 200, dot.y + 120, { steps: 5 });
  await page.evaluate(() => {
    (window as unknown as { $debug: Dbg }).$debug.history.dispatch({ t: 'frame.switch', idx: 1 });
  });
  await page.mouse.up();
  const xs = await page.evaluate(() => {
    const s = (window as unknown as { $debug: Dbg }).$debug.store.get();
    return s.frames.map((f) => f.players[0]!.x);
  });
  expect(xs).toEqual([960, 960]);
});

test('pasting a new share link into an open tab loads it, asking first over unsaved work', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));
  await page.evaluate(() => {
    (window as unknown as { $debug: { store: { _apply: (p: unknown) => void } } }).$debug.store._apply({ notes: 'unsaved' });
  });
  const khidi = encodeHash({
    v: 2, map: 'khidi', notes: '', view: { zoom: 1, panX: 0, panY: 0 },
    frames: [{ strokes: [], shapes: [], cones: [], players: [], textboxes: [], quickadds: [], scanner: null }],
    activeFrame: 0,
  });
  await page.evaluate((h) => { window.location.hash = `s=${h}`; }, khidi);
  await expect(page.getByText('Discard current strat?')).toBeVisible();
  await page.locator('.confirm-modal-confirm').click();
  await expect(page.getByTestId('map-image')).toHaveAttribute('src', /khidi/);
});

test('the page itself never scrolls, even in a small window', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 380 });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));
  const scrolled = await page.evaluate(() => {
    window.scrollTo(200, 200);
    document.body.scrollTo(200, 200);
    return window.scrollX + window.scrollY + document.body.scrollLeft + document.body.scrollTop;
  });
  expect(scrolled).toBe(0);
});

test('onion-skin ghost textboxes do not catch clicks', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('artifact-gg.v2.onion', '1'));
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { _apply: (p: unknown) => void } } }).$debug;
    const empty = { strokes: [], shapes: [], cones: [], players: [], textboxes: [], quickadds: [], scanner: null };
    const box = { id: 't1', x: 800, y: 400, w: 240, h: 120, text: 'ghost', fontSize: 16, color: '#ffffff' };
    dbg.store._apply({ frames: [{ ...empty, textboxes: [box] }, empty], activeFrameIdx: 1 });
  });
  const ghost = page.locator('.tbox').first();
  await expect(ghost).toHaveCount(1);
  const b = await ghost.boundingBox();
  if (!b) throw new Error('ghost textbox has no bounding box');
  const hitTbox = await page.evaluate(([x, y]) => {
    return Boolean(document.elementFromPoint(x!, y!)?.closest('.tbox'));
  }, [b.x + b.width / 2, b.y + b.height / 2]);
  expect(hitTbox).toBe(false);
});

test('undo restores a deleted player (single undo step)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug;
    dbg.history.dispatch({ t: 'tool.set', tool: 'place-player' });
  });

  const viewer = await page.getByTestId('map-viewer').boundingBox();
  if (!viewer) throw new Error('map-viewer has no bounding box');
  const cx = viewer.x + viewer.width / 2;
  const cy = viewer.y + viewer.height / 2;

  await page.mouse.click(cx, cy);
  await expect(page.locator('[data-player-id]')).toHaveCount(1);

  // Delete the player via the debugger API instead of right-clicking.
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void }; store: { get: () => { frames: { players: { id: string }[] }[]; activeFrameIdx: number } } } }).$debug;
    const s = dbg.store.get();
    const playerId = s.frames[s.activeFrameIdx]!.players[0]!.id;
    dbg.history.dispatch({ t: 'player.delete', ids: [playerId] });
  });
  await expect(page.locator('[data-player-id]')).toHaveCount(0);

  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { history: { undo: () => void } } }).$debug;
    dbg.history.undo();
  });
  await expect(page.locator('[data-player-id]')).toHaveCount(1);
});

test.describe('Sidebar Chrome', () => {
  test('click ToolRail draw button switches to draw tool', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-tool="draw"]');
    await page.click('[data-tool="draw"]');
    // Active highlight class applied
    await expect(page.locator('[data-tool="draw"]')).toHaveClass(/active/);
    // Cursor button no longer active
    await expect(page.locator('[data-tool="cursor"]')).not.toHaveClass(/active/);
  });

  test('MapDropdown switches map', async ({ page }) => {
    await page.goto('/');
    await page.click('.map-dropdown-btn');
    await page.waitForSelector('.map-dropdown-list:not([hidden])');
    await page.click('[data-mapid="khidi"]');
    await expect(page.locator('.map-dropdown-btn')).toContainText('KHIDI');
    // Map image src ends with khidi/map.png
    const img = page.getByTestId('map-image');
    await expect(img).toHaveAttribute('src', /khidi\/map\.png$/);
  });

  test('1-5 hotkeys switch active colour slot', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-slot="0"].active');
    await page.keyboard.press('3');
    await expect(page.locator('[data-slot="2"]')).toHaveClass(/active/);
    await expect(page.locator('[data-slot="0"]')).not.toHaveClass(/active/);
  });

  test('clicking active colour slot opens picker; valid hex commit changes colour', async ({ page }) => {
    await page.goto('/');
    // Click slot 0 (already active) -> opens picker
    await page.click('[data-slot="0"]');
    await page.waitForSelector('.colour-picker:not([hidden])');
    const hexInput = page.locator('.cp-hex-input');
    await hexInput.fill('ff4655');
    await hexInput.press('Enter');
    // Slot 0 background should now reflect the new colour (pixel test via element style attribute)
    await expect.poll(async () =>
      await page.locator('[data-slot="0"]').evaluate((el) => (el as HTMLElement).style.backgroundColor)
    ).toMatch(/255,\s*70,\s*85/);
  });

  test('switching to PlayerTool reveals team toggle in context panel', async ({ page }) => {
    await page.goto('/');
    await page.click('[data-tool="place-player"]');
    // Team toggle exists with COLONIST label initially
    const teamBtn = page.locator('[data-team-toggle]');
    await expect(teamBtn).toHaveText('COLONIST');
    await teamBtn.click();
    await expect(teamBtn).toHaveText('REYAB');
  });
});

test.describe('Command Surface', () => {
  test('Ctrl+K opens command palette and Enter on "draw" activates draw tool', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-tool="draw"]');

    await page.keyboard.press('Control+k');
    await page.waitForSelector('.command-palette:not([hidden])');

    const input = page.locator('.command-palette .cp-input');
    await expect(input).toBeFocused();
    await input.fill('draw');

    // Top row should match Tool · Draw.
    const firstRow = page.locator('.command-palette .cp-row').first();
    await expect(firstRow).toContainText('Draw');

    await input.press('Enter');
    await expect(page.locator('.command-palette')).toBeHidden();
    await expect(page.locator('[data-tool="draw"]')).toHaveClass(/active/);
  });

  test('? opens keyboard hints modal listing >= 20 entries; Esc closes', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Shift+?');
    await page.waitForSelector('.keyboard-hints:not([hidden])');

    const rowCount = await page.locator('.kh-row').count();
    expect(rowCount).toBeGreaterThanOrEqual(20);

    await page.keyboard.press('Escape');
    await expect(page.locator('.keyboard-hints')).toBeHidden();
  });

  test('Ctrl+Z and Ctrl+Shift+Z route through actions registry', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug;
      dbg.history.dispatch({ t: 'tool.set', tool: 'place-player' });
    });
    const viewer = await page.getByTestId('map-viewer').boundingBox();
    if (!viewer) throw new Error('viewer missing');
    const cx = viewer.x + viewer.width / 2;
    const cy = viewer.y + viewer.height / 2;
    await page.mouse.click(cx, cy);
    await expect(page.locator('[data-player-id]')).toHaveCount(1);

    await page.keyboard.press('Control+z');
    await expect(page.locator('[data-player-id]')).toHaveCount(0);

    await page.keyboard.press('Control+Shift+z');
    await expect(page.locator('[data-player-id]')).toHaveCount(1);
  });

  test('Ctrl+C / Ctrl+V via actions duplicate a player', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug;
      dbg.history.dispatch({ t: 'tool.set', tool: 'place-player' });
    });
    const viewer = await page.getByTestId('map-viewer').boundingBox();
    if (!viewer) throw new Error('viewer missing');
    const cx = viewer.x + viewer.width / 2;
    const cy = viewer.y + viewer.height / 2;
    await page.mouse.click(cx, cy);
    await page.evaluate(() => {
      const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug;
      dbg.history.dispatch({ t: 'tool.set', tool: 'cursor' });
    });
    await page.mouse.click(cx, cy);

    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await expect(page.locator('[data-player-id]')).toHaveCount(2);
  });

  test('Esc with picker open closes ONLY the picker (no tool reset)', async ({ page }) => {
    await page.goto('/');
    // Switch to draw tool first.
    await page.click('[data-tool="draw"]');
    await expect(page.locator('[data-tool="draw"]')).toHaveClass(/active/);

    // Open colour picker.
    await page.click('[data-slot="0"]');
    await page.waitForSelector('.colour-picker:not([hidden])');

    await page.keyboard.press('Escape');
    await expect(page.locator('.colour-picker')).toBeHidden();

    // Esc closes the picker without also dropping the draw tool.
    await expect(page.locator('[data-tool="draw"]')).toHaveClass(/active/);
  });

  test('input-focus guard: typing in player-name input does not switch tool', async ({ page }) => {
    await page.goto('/');
    // Switch to PlayerTool - context panel exposes a name input with a stable aria-label.
    await page.click('[data-tool="place-player"]');
    // Use aria-label to disambiguate from the CommandPalette's .cp-input (same class).
    const nameInput = page.locator('input[aria-label="Default player name"]');
    await nameInput.click();
    await nameInput.focus();

    await page.keyboard.press('d'); // 'd' would switch to draw if guard fails

    // Tool still place-player.
    await expect(page.locator('[data-tool="place-player"]')).toHaveClass(/active/);
    // Input still focused.
    await expect(nameInput).toBeFocused();
  });

  test('sidebar help button opens keyboard hints', async ({ page }) => {
    await page.goto('/');
    await page.click('[aria-label="Open keyboard shortcuts"]');
    await page.waitForSelector('.keyboard-hints:not([hidden])');
    await page.keyboard.press('Escape');
    await expect(page.locator('.keyboard-hints')).toBeHidden();
  });
});

test.describe('persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));
    // clear() wipes the first-run seeds from the global beforeEach (changelog,
    // onboarding, consent). The changelog auto-open check runs after $debug is
    // exposed, so without re-seeding in the same evaluate its backdrop opens
    // mid-test and eats page.click().
    await page.evaluate((entries: ReadonlyArray<readonly [string, string]>) => {
      localStorage.clear();
      for (const [k, v] of entries) localStorage.setItem(k, v);
    }, FIRST_RUN_ENTRIES);
  });

  test('save -> reload -> load round-trip via the library', async ({ page }) => {
    // Place a player so the strat has visible content.
    await page.evaluate(() => {
      const $debug = (window as unknown as { $debug: { history: { dispatch: (cmd: unknown) => void } } }).$debug;
      $debug.history.dispatch({ t: 'tool.set', tool: 'place-player' });
      $debug.history.dispatch({ t: 'player.add', player: {
        id: 'p1', team: 'colonist', x: 100, y: 100, name: 'Alpha', dead: false,
      }});
    });

    // Save via Ctrl+S - the quick-save auto-names the entry with a timestamp.
    await page.keyboard.press('Control+s');
    await expect(page.locator('.toast-text')).toContainText('Saved');

    // Open the library.
    await page.keyboard.press('Control+Shift+l');
    await expect(page.locator('.strat-library')).toBeVisible();
    await expect(page.locator('.strat-library-row')).toHaveCount(1);
    await expect(page.locator('.strat-library-row-name')).toHaveText(/^Strat \d{4}-\d{2}-\d{2} /);

    // Mutate state and load - the load-conflict guard appears because content is present.
    // Replace p1 with a different player so content remains present (triggers guard)
    // but we can verify the load truly restored the original snapshot.
    await page.evaluate(() => {
      const $debug = (window as unknown as { $debug: { history: { dispatch: (cmd: unknown) => void } } }).$debug;
      $debug.history.dispatch({ t: 'player.delete', ids: ['p1'] });
      $debug.history.dispatch({ t: 'player.add', player: {
        id: 'spurious', team: 'reyab', x: 200, y: 200, name: 'Bravo', dead: false,
      }});
    });
    await page.locator('.strat-library-row-load').click();
    await expect(page.locator('.confirm-modal')).toBeVisible();
    await page.locator('.confirm-modal-confirm').click();

    // The original player is back; the spurious one is gone.
    const players = await page.evaluate(() => {
      const $debug = (window as unknown as { $debug: { store: { get: () => { frames: { players: { id: string }[] }[]; activeFrameIdx: number } } } }).$debug;
      return $debug.store.get().frames[$debug.store.get().activeFrameIdx]!.players.map((p) => p.id);
    });
    expect(players).toEqual(['p1']);
  });

  test('PNG export downloads with the expected filename pattern', async ({ page }) => {
    await page.evaluate(() => {
      const $debug = (window as unknown as { $debug: { history: { dispatch: (cmd: unknown) => void } } }).$debug;
      $debug.history.dispatch({ t: 'map.select', mapId: 'miru' });
    });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-action="export-png"]'),
    ]);
    expect(download.suggestedFilename()).toMatch(/^artifact-miru-\d{8}-\d{4}\.png$/);
    await expect(page.locator('.toast-text')).toContainText('Exported PNG');
  });

  test('.strat.json round-trip via EXPORT-JSON -> IMPORT-JSON', async ({ page }) => {
    // Set up a recognisable state. Notes are not currently part of the
    // history-dispatcher's command surface, so we apply them via store._apply.
    await page.evaluate(() => {
      const $debug = (window as unknown as { $debug: { history: { dispatch: (cmd: unknown) => void }; store: { _apply: (patch: unknown) => void } } }).$debug;
      $debug.history.dispatch({ t: 'map.select', mapId: 'cliffside' });
      $debug.store._apply({ notes: 'smoke-roundtrip' });
    });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-action="export-json"]'),
    ]);
    expect(download.suggestedFilename()).toMatch(/^artifact-cliffside-\d{8}-\d{4}\.strat\.json$/);
    const path = await download.path();
    if (!path) throw new Error('download.path() returned null');

    // Mutate state, then import the file we just downloaded.
    await page.evaluate(() => {
      const $debug = (window as unknown as { $debug: { history: { dispatch: (cmd: unknown) => void }; store: { _apply: (patch: unknown) => void } } }).$debug;
      $debug.history.dispatch({ t: 'map.select', mapId: 'suna' });
      $debug.store._apply({ notes: '' });
    });

    // Drive the file picker via the file-chooser API. The IMPORT button creates
    // an <input type=file> on click; chooseFiles populates it.
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('[data-action="import"]'),
    ]);
    await chooser.setFiles(path);

    // Content was empty before import (notes wiped); no confirm modal expected.
    await expect(page.locator('.toast-text')).toContainText('Imported strat');

    const reloaded = await page.evaluate(() => {
      const $debug = (window as unknown as { $debug: { store: { get: () => { mapId: string; notes: string } } } }).$debug;
      const s = $debug.store.get();
      return { mapId: s.mapId, notes: s.notes };
    });
    expect(reloaded.mapId).toBe('cliffside');
    expect(reloaded.notes).toBe('smoke-roundtrip');
  });
});

test.describe('Frame & Layout', () => {
  test('frame timeline: + adds a frame, click switches, strokes are per-frame', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

    // The frame timeline is always visible (FRAME / ANIMATION modes merged).
    await expect(page.locator('.frame-timeline')).toBeVisible();

    // Initially 1 card.
    await expect(page.locator('.frame-timeline-card')).toHaveCount(1);

    // Click + -> 2 cards. After 16dd78c (FrameTimeline left:280px clears the
    // sidebar) the strip is no longer obscured by the sidebar overlay.
    await page.locator('.frame-timeline-add').click();
    await expect(page.locator('.frame-timeline-card')).toHaveCount(2);

    // Click the second card -> activeFrameIdx=1.
    await page.locator('.frame-timeline-card').nth(1).click();
    const active1 = await page.evaluate(() => {
      const dbg = (window as unknown as { $debug: { store: { get: () => { activeFrameIdx: number } } } }).$debug;
      return dbg.store.get().activeFrameIdx;
    });
    expect(active1).toBe(1);

    // Draw a stroke on frame 1 - tool.set still goes via $debug because the
    // tool rail's draw button is in the sidebar (TOOLS-only) and clicking it
    // is asserted by the sidebar smoke; here we just need a stroke recorded.
    await page.evaluate(() => {
      const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug;
      dbg.history.dispatch({ t: 'tool.set', tool: 'draw' });
    });
    const viewer = await page.getByTestId('map-viewer').boundingBox();
    if (!viewer) throw new Error('map-viewer has no bounding box');
    const cx = viewer.x + viewer.width / 2;
    const cy = viewer.y + viewer.height / 2;
    await page.mouse.move(cx - 30, cy - 30);
    await page.mouse.down();
    await page.mouse.move(cx + 30, cy + 30, { steps: 10 });
    await page.mouse.up();

    const counts = await page.evaluate(() => {
      const dbg = (window as unknown as { $debug: { store: { get: () => { frames: { strokes: unknown[] }[] } } } }).$debug;
      return dbg.store.get().frames.map((f) => f.strokes.length);
    });
    expect(counts).toEqual([0, 1]);

    // Switch back to frame 0 via real click.
    await page.locator('.frame-timeline-card').nth(0).click();
    const active0 = await page.evaluate(() => {
      const dbg = (window as unknown as { $debug: { store: { get: () => { activeFrameIdx: number } } } }).$debug;
      return dbg.store.get().activeFrameIdx;
    });
    expect(active0).toBe(0);
  });

  test('NOTES tab swaps content + debounced typing roundtrips into state.notes', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

    await page.locator('.sidebar-tab[data-tab="notes"]').click();
    await expect(page.getByTestId('notes-textarea')).toBeVisible();
    // Tool rail and colour slots hidden.
    await expect(page.locator('.sidebar-tools')).not.toBeVisible();
    await expect(page.locator('.sidebar-colours')).not.toBeVisible();

    await page.getByTestId('notes-textarea').fill('A test plan for Suna spawn rush');

    // Wait past the 500 ms debounce.
    await page.waitForTimeout(600);

    const notes = await page.evaluate(() => {
      const dbg = (window as unknown as { $debug: { store: { get: () => { notes: string } } } }).$debug;
      return dbg.store.get().notes;
    });
    expect(notes).toBe('A test plan for Suna spawn rush');
  });

  test('FrameTimeline × button deletes the frame', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

    await page.locator('.frame-timeline-add').click();
    await page.locator('.frame-timeline-add').click();
    await expect(page.locator('.frame-timeline-card')).toHaveCount(3);

    // Hover the second card to reveal the delete button, then click it.
    const card1 = page.locator('.frame-timeline-card').nth(1);
    await card1.hover();
    await card1.locator('.frame-timeline-card-delete').click();

    await expect(page.locator('.frame-timeline-card')).toHaveCount(2);
  });
});

test.describe('share (hash-only)', () => {
  test.beforeEach(async ({ page }) => {
    // The onboarding tour used to be suppressed again here; seedFirstRun in the
    // global beforeEach already does it for every spec.
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));
  });

  test('SHARE click -> dialog opens -> hash-link URL rendered and copyable', async ({ page }) => {
    await page.evaluate(() => {
      const calls: string[] = [];
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: (t: string) => { calls.push(t); return Promise.resolve(); } },
        configurable: true,
      });
      (window as unknown as { __clipCalls?: string[] }).__clipCalls = calls;
    });

    await page.click('[data-action="share"]');
    await expect(page.locator('.share-dialog')).toBeVisible();

    const url = await page.locator('.share-dialog-url').inputValue();
    expect(url).toContain('/#s=');

    await page.locator('.share-dialog-copy').click();
    const calls = await page.evaluate(() => (window as unknown as { __clipCalls: string[] }).__clipCalls);
    expect(calls).toEqual([expect.stringContaining('/#s=')]);
    await expect(page.locator('.toast-text')).toContainText('copied');
  });
});

test.describe('Gaps & Polish', () => {
  test('Callouts toggle row shows and hides the callouts overlay image', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

    // Initially hidden - callouts default off (see "boot: callouts off by default").
    await expect(page.locator('.callouts-layer-img')).toBeHidden();

    // Open the map dropdown to expose the callouts row.
    await page.locator('.map-dropdown-btn').click();
    await expect(page.locator('.map-dropdown-callouts-row')).toBeVisible();

    // Click the row - should toggle on.
    await page.locator('.map-dropdown-callouts-row').click();
    const visibleAfter = await page.evaluate(() => {
      const dbg = (window as unknown as { $debug: { store: { get: () => { ui: { calloutsVisible: boolean } } } } }).$debug;
      return dbg.store.get().ui.calloutsVisible;
    });
    expect(visibleAfter).toBe(true);
    await expect(page.locator('.callouts-layer-img')).toBeVisible();

    // Pill text reflects the new state.
    await expect(page.locator('.map-dropdown-callouts-pill')).toHaveText('ON');

    // Toggle back off.
    await page.locator('.map-dropdown-callouts-row').click();
    await expect(page.locator('.callouts-layer-img')).toBeHidden();
    await expect(page.locator('.map-dropdown-callouts-pill')).toHaveText('OFF');
  });

  test('Changelog modal auto-opens on first boot per version, then stays closed on reload', async ({ page }) => {
    // Override the global beforeEach seed so the auto-open path fires - but
    // ONLY for the first navigation. On the subsequent reload we want the
    // global seed of APP_VERSION to win so the modal stays closed (verifying
    // that markChangelogSeen() ran during the first auto-open). Use a
    // sessionStorage marker as a one-shot guard: addInitScript runs in
    // registration order (global setItem first, then this removeItem); the
    // marker survives the reload, so on the second boot this script no-ops.
    await page.addInitScript((key: string) => {
      try {
        if (!sessionStorage.getItem('artifact-gg.test.firstBootDone')) {
          localStorage.removeItem(key);
          sessionStorage.setItem('artifact-gg.test.firstBootDone', '1');
        }
      } catch { /* disabled */ }
    }, LAST_SEEN_KEY);

    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

    // The auto-open runs after loader.hide(); give it a moment to settle.
    await expect(page.locator('.changelog-modal-panel')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.changelog-modal-title')).toHaveText('CHANGELOG');

    // Close - clicking the × should hide the modal.
    await page.locator('.changelog-modal-close').click();
    await expect(page.locator('.changelog-modal')).toBeHidden();

    // Subsequent reload should NOT re-open (markChangelogSeen ran during the auto-open path).
    await page.reload();
    await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));
    await page.waitForTimeout(300);
    await expect(page.locator('.changelog-modal')).toBeHidden();

    // Sidebar i button re-opens.
    await page.locator('[aria-label="Open changelog"]').click();
    await expect(page.locator('.changelog-modal-panel')).toBeVisible();
  });

});

test('switching maps stashes per-map frames, restores them on return, and fits the map to the window', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  const startMap = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { mapId: string } } } }).$debug;
    return dbg.store.get().mapId;
  });
  const otherMap = startMap === 'miru' ? 'suna' : 'miru';

  // Put a player on the start map and move the view off 100%.
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void }; store: { _apply: (p: unknown) => void } } }).$debug;
    dbg.history.dispatch({ t: 'player.add', player: { id: 'pe2e', team: 'reyab', x: 300, y: 300, name: 'Echo', dead: false } });
    dbg.store._apply({ zoom: 3, panX: 80, panY: -40 });
  });

  // Switch to the other map: the board is empty and the whole map fits the viewer.
  await page.evaluate((m) => {
    const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug;
    dbg.history.dispatch({ t: 'map.select', mapId: m });
  }, otherMap);
  const away = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { mapId: string; zoom: number; panX: number; panY: number; frames: { players: unknown[] }[]; activeFrameIdx: number } } } }).$debug;
    const s = dbg.store.get();
    return { mapId: s.mapId, zoom: s.zoom, panX: s.panX, panY: s.panY, players: s.frames[s.activeFrameIdx]!.players.length };
  });
  expect(away.mapId).toBe(otherMap);
  // Fit = the largest zoom showing the whole 1920x1080 map in the viewer.
  const box = (await page.getByTestId('map-viewer').boundingBox())!;
  const fit = Math.min(box.width / 1920, box.height / 1080);
  expect(away.zoom).toBeCloseTo(fit, 5);
  expect(away.panX).toBe(0);
  expect(away.panY).toBe(0);
  expect(away.players).toBe(0);

  // Switch back: the player is restored, and the map is fitted again (every switch refits).
  await page.evaluate((m) => {
    const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug;
    dbg.history.dispatch({ t: 'map.select', mapId: m });
  }, startMap);
  const back = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { mapId: string; zoom: number; frames: { players: { id: string }[] }[]; activeFrameIdx: number } } } }).$debug;
    const s = dbg.store.get();
    return { mapId: s.mapId, zoom: s.zoom, players: s.frames[s.activeFrameIdx]!.players.map((p) => p.id) };
  });
  expect(back.mapId).toBe(startMap);
  expect(back.zoom).toBeCloseTo(fit, 5);
  expect(back.players).toEqual(['pe2e']);
});
