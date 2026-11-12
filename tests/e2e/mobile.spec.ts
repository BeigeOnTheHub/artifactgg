import { test, expect, type Page } from '@playwright/test';
import { seedFirstRun } from './firstRunSeed';

// Every first-boot interstitial (changelog, onboarding tour, consent banner)
// would otherwise put something over the chrome that swallows the suite's
// first tap. The clear() inside also matters for tests like 'save lists the
// strat in the library' that assert exact row counts.
test.beforeEach(async ({ page }) => {
  await seedFirstRun(page);
});

// A 390×844 touch viewport matches both clauses of the compact media query:
//   (pointer: coarse) - because hasTouch:true makes Playwright report coarse
//   (max-width: 900px) - 390 < 900
// This triggers watchLayoutMode -> layoutMode:'compact' -> bootProfile:'compact'
// -> Shell sets #app[data-layout="compact"], MobileChrome mounts, touchCtl is
// the TouchViewportController, sidebar/topbar are hidden via layout.css.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('compact read-only viewer: full-bleed map, filmstrip, fit zoom, sheet', async ({ page }) => {
  await page.goto('/');
  // Wait for boot to complete and $debug to be exposed.
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // Sidebar is in the DOM but hidden by layout.css display:none in compact.
  await expect(page.locator('#sidebar-root')).toBeHidden();

  // MobileChrome mounts the top bar and the menu button onto #map-viewer.
  await expect(page.locator('[data-testid="mobile-topbar"]')).toBeVisible();

  // FrameTimeline is always mounted; in compact it repositions to the bottom
  // overlay and remains visible.
  await expect(page.locator('[data-testid="frame-timeline"]')).toBeVisible();

  // Full-bleed: in compact, #app[data-layout="compact"] #map-viewer { inset:0 }
  // must win, so the map area is flush to the left edge and spans the whole
  // viewport width. Without the tokens.css desktop-scoping fix the old
  // !important small-window rule would push #map-viewer to left:180px on this
  // 390px viewport, so x would be 180, not 0 - this assertion guards that.
  const viewerBox = await page.locator('#map-viewer').boundingBox();
  expect(viewerBox?.x).toBe(0);
  expect(viewerBox?.width).toBe(390);

  // resetToDefaultView() assertion: the compact boot calls resetToDefaultView() via rAF which
  // sets zoom to the fit value for the 390×844 viewport. To make the assertion
  // non-trivial and non-flaky we: (1) force zoom to a known-different value via
  // store._apply so the pre-call state is definitively not-fit, (2) call
  // resetToDefaultView(), (3) assert zoom changed back to a finite positive number and
  // is no longer the sentinel value. This proves the TouchViewportController is
  // attached, store is live, and resetToDefaultView() mutates zoom.
  const SENTINEL_ZOOM = 99;
  await page.evaluate((z) => {
    const dbg = (window as unknown as { $debug: { store: { _apply: (p: unknown) => void } } }).$debug;
    dbg.store._apply({ zoom: z });
  }, SENTINEL_ZOOM);

  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { touchCtl: { resetToDefaultView: () => void } | null } }).$debug;
    dbg.touchCtl!.resetToDefaultView();
  });

  const zoomAfter = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { zoom: number } } } }).$debug;
    return dbg.store.get().zoom;
  });
  expect(Number.isFinite(zoomAfter)).toBe(true);
  expect(zoomAfter).toBeGreaterThan(0);
  expect(zoomAfter).not.toBe(SENTINEL_ZOOM);

  // Open the sheet by tapping the menu button and verify the sheet is visible.
  await page.locator('[data-testid="mobile-menu-btn"]').click();
  await expect(page.locator('[data-testid="mobile-sheet"]')).toBeVisible();
  await expect(page.locator('[data-testid="mobile-sheet"]')).toContainText(/notes/i);
});

test('compact: tap-select an item, drag it, undo reverts', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // Inject a player at the map centre so it is visible at any fit-zoom.
  // We use store._apply (not history) so the injected player does NOT count as
  // an undoable command - the only undoable step is the drag that follows.
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: { players: unknown[] }[]; activeFrameIdx: number }; _apply: (p: unknown) => void } } }).$debug;
    const s = dbg.store.get();
    const idx = s.activeFrameIdx;
    const frame = s.frames[idx]!;
    const updated = {
      ...frame,
      players: [...(frame as { players: unknown[] }).players, { id: 'e2e-player-1', team: 'colonist', x: 960, y: 540, name: 'P1', dead: false }],
    };
    const newFrames = s.frames.map((f: unknown, i: number) => i === idx ? updated : f);
    dbg.store._apply({ frames: newFrames });
  });

  // Confirm the undo button is present - proves compact+touchEdit boot.
  await expect(page.locator('[data-testid="mobile-undo"]')).toBeVisible();

  // Snapshot pre-drag position.
  const before = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: { players: { id: string; x: number; y: number }[] }[]; activeFrameIdx: number } } } }).$debug;
    const s = dbg.store.get();
    const p = s.frames[s.activeFrameIdx]!.players.find((q) => q.id === 'e2e-player-1')!;
    return { id: p.id, x: p.x, y: p.y };
  });

  // Compute the client coords of the player from the live viewport.
  // $debug does not expose getViewport, so we reconstruct:
  //   client_x = mx * zoom + (viewerW - 1920 * zoom) / 2 + panX + rect.left
  //   client_y = my * zoom + (viewerH - 1080 * zoom) / 2 + panY + rect.top
  const pt = await page.evaluate((pid) => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { zoom: number; panX: number; panY: number; frames: { players: { id: string; x: number; y: number }[] }[]; activeFrameIdx: number } } } }).$debug;
    const s = dbg.store.get();
    const p = s.frames[s.activeFrameIdx]!.players.find((q) => q.id === pid)!;
    const viewer = document.getElementById('map-viewer')!;
    const rect = viewer.getBoundingClientRect();
    const W = 1920, H = 1080;
    const cx = p.x * s.zoom + (rect.width  - W * s.zoom) / 2 + s.panX + rect.left;
    const cy = p.y * s.zoom + (rect.height - H * s.zoom) / 2 + s.panY + rect.top;
    return { cx, cy };
  }, before.id);

  // Tap-select: pointerdown + pointerup at identical coords so the exact-equality
  // empty-space deselect branch in touchViewport does NOT fire on the up event
  // (it only fires when downEmpty is true AND coords are equal, which they are,
  // but downEmpty is false because we hit a player - so either way is fine).
  // Using dispatchEvent keeps down/up coords exactly equal.
  await page.evaluate(({ x, y }) => {
    const t = document.getElementById('map-viewer') as HTMLElement;
    const ev = (type: string): void => { t.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true })); };
    ev('pointerdown'); ev('pointerup');
  }, { x: pt.cx, y: pt.cy });

  // Assert the player is now selected.
  const sel = await page.evaluate(() =>
    (window as unknown as { $debug: { store: { get: () => { selection: unknown[] } } } }).$debug.store.get().selection
  );
  expect(sel).toEqual([{ kind: 'player', id: before.id }]);

  // Drag 80px right and 40px down; this exceeds GROUP_MOVE_THRESHOLD_MAP (4 map units).
  await page.evaluate(({ x, y }) => {
    const t = document.getElementById('map-viewer') as HTMLElement;
    const ev = (type: string, cx: number, cy: number): void => { t.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', clientX: cx, clientY: cy, bubbles: true, cancelable: true })); };
    ev('pointerdown', x, y);
    ev('pointermove', x + 80, y + 40);
    ev('pointerup',   x + 80, y + 40);
  }, { x: pt.cx, y: pt.cy });

  // Wait for the store to settle with the committed move.
  const movedX = await page.waitForFunction((pid) => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: { players: { id: string; x: number }[] }[]; activeFrameIdx: number } } } }).$debug;
    const s = dbg.store.get();
    const p = s.frames[s.activeFrameIdx]!.players.find((q) => q.id === pid);
    return p && p.x !== 960 ? p.x : null;
  }, before.id);
  expect(await movedX.jsonValue()).not.toBeNull();

  const moved = await page.evaluate((pid) => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: { players: { id: string; x: number; y: number }[] }[]; activeFrameIdx: number } } } }).$debug;
    const s = dbg.store.get();
    const p = s.frames[s.activeFrameIdx]!.players.find((q) => q.id === pid)!;
    return { x: p.x, y: p.y };
  }, before.id);
  expect(moved.x).not.toBe(before.x);

  // Click the mobile undo button and assert the player returns to its original position.
  await page.locator('[data-testid="mobile-undo"]').click();

  const reverted = await page.evaluate((pid) => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: { players: { id: string; x: number; y: number }[] }[]; activeFrameIdx: number } } } }).$debug;
    const s = dbg.store.get();
    const p = s.frames[s.activeFrameIdx]!.players.find((q) => q.id === pid)!;
    return { x: p.x, y: p.y };
  }, before.id);
  expect(reverted.x).toBe(before.x);
  expect(reverted.y).toBe(before.y);
});

test('compact: resize a shape with its touch handle, undo reverts', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // Inject a square shape and select it via store._apply, so neither counts as
  // an undoable command - the resize drag is the only undoable step.
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: unknown[]; activeFrameIdx: number }; _apply: (p: unknown) => void } } }).$debug;
    const s = dbg.store.get();
    const idx = s.activeFrameIdx;
    const frame = s.frames[idx] as { shapes: unknown[] };
    const shape = { id: 'e2e-shape-1', kind: 'square', x: 760, y: 340, w: 400, h: 400, rotation: 0, stroke: '#00ff88', strokeWidth: 2, fill: false };
    dbg.store._apply({
      frames: s.frames.map((f: unknown, i: number) => i === idx ? { ...frame, shapes: [...frame.shapes, shape] } : f),
      selection: [{ kind: 'shape', id: 'e2e-shape-1' }],
    });
  });

  // Eight handles render for the selected shape in the compact touch viewer.
  await expect(page.locator('#shape-handles-layer .shape-handle')).toHaveCount(8);

  const before = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: { shapes: { id: string; w: number; h: number }[] }[]; activeFrameIdx: number } } } }).$debug;
    const s = dbg.store.get();
    return s.frames[s.activeFrameIdx]!.shapes.find((sh) => sh.id === 'e2e-shape-1')!;
  });

  // Drag the south-east handle outward with a touch pointer. The handle owns
  // its own drag (pointerdown on the rect, document-level move/up), so dispatch
  // down on the rect and move/up on document.
  await page.evaluate(() => {
    const se = document.querySelector('#shape-handles-layer .shape-handle[data-role="se"]') as SVGRectElement;
    const r = se.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    se.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', button: 0, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
    document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: cx + 60, clientY: cy + 60, bubbles: true, cancelable: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', button: 0, clientX: cx + 60, clientY: cy + 60, bubbles: true, cancelable: true }));
  });

  // Wait for the store to settle with the committed resize.
  const movedW = await page.waitForFunction(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: { shapes: { id: string; w: number }[] }[]; activeFrameIdx: number } } } }).$debug;
    const s = dbg.store.get();
    const sh = s.frames[s.activeFrameIdx]!.shapes.find((x) => x.id === 'e2e-shape-1');
    return sh && sh.w !== 400 ? sh.w : null;
  });
  expect(await movedW.jsonValue()).not.toBeNull();

  // The mobile undo button reverts the resize in one step.
  await page.locator('[data-testid="mobile-undo"]').click();

  const reverted = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: { shapes: { id: string; w: number; h: number }[] }[]; activeFrameIdx: number } } } }).$debug;
    const s = dbg.store.get();
    return s.frames[s.activeFrameIdx]!.shapes.find((sh) => sh.id === 'e2e-shape-1')!;
  });
  expect(reverted.w).toBe(before.w);
  expect(reverted.h).toBe(before.h);
});

/**
 * Hold a finger on a map point until the per-item action menu opens.
 * TouchViewportController drops pointerType 'mouse', so this has to synthesise
 * touch pointer events; and the press must not move more than TAP_SLOP_PX or the
 * long press is cancelled as a drag.
 */
async function longPressMap(page: Page, mapX: number, mapY: number): Promise<void> {
  await page.evaluate(([mx, my]) => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { zoom: number; panX: number; panY: number } } } }).$debug;
    const s = dbg.store.get();
    const t = document.getElementById('map-viewer')!;
    const r = t.getBoundingClientRect();
    const cx = mx! * s.zoom + (r.width - 1920 * s.zoom) / 2 + s.panX + r.left;
    const cy = my! * s.zoom + (r.height - 1080 * s.zoom) / 2 + s.panY + r.top;
    (window as unknown as { __lp: { x: number; y: number } }).__lp = { x: cx, y: cy };
    t.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
  }, [mapX, mapY]);
  // LONG_PRESS_MS is 500.
  await page.waitForTimeout(650);
  await page.evaluate(() => {
    const p = (window as unknown as { __lp: { x: number; y: number } }).__lp;
    document.getElementById('map-viewer')!.dispatchEvent(
      new PointerEvent('pointerup', { pointerId: 7, pointerType: 'touch', clientX: p.x, clientY: p.y, bubbles: true, cancelable: true }),
    );
  });
}

test('compact: multi-select marquee picks two items, delete removes them', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // Inject two players via store._apply (not undoable - only the delete is).
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: unknown[]; activeFrameIdx: number }; _apply: (p: unknown) => void } } }).$debug;
    const s = dbg.store.get();
    const idx = s.activeFrameIdx;
    const frame = s.frames[idx] as { players: unknown[] };
    const players = [
      { id: 'e2e-m1', team: 'colonist', x: 860, y: 500, name: 'M1', dead: false },
      { id: 'e2e-m2', team: 'colonist', x: 1060, y: 600, name: 'M2', dead: false },
    ];
    dbg.store._apply({
      frames: s.frames.map((f: unknown, i: number) => i === idx ? { ...frame, players: [...frame.players, ...players] } : f),
    });
  });

  // Turn multi-select on. The top-bar toggle is gone; the mode's entry point is
  // the long-press action menu's "Add to selection" row, so drive it the way a
  // user now would rather than poking the store.
  await longPressMap(page, 860, 500);
  await page.locator('[data-testid="mobile-itemmenu-add"]').click();
  await page.waitForTimeout(350);
  const multiOn = await page.evaluate(() =>
    (window as unknown as { $debug: { store: { get: () => { ui: { touchMultiSelect?: boolean } } } } }).$debug.store.get().ui.touchMultiSelect
  );
  expect(multiOn).toBe(true);

  // Client coords of a box whose corners are empty and which encloses both
  // players' centres. Map box (760,420) -> (1160,680).
  const box = await page.evaluate(() => {
    const s = (window as unknown as { $debug: { store: { get: () => { zoom: number; panX: number; panY: number } } } }).$debug.store.get();
    const viewer = document.getElementById('map-viewer')!;
    const rect = viewer.getBoundingClientRect();
    const W = 1920, H = 1080;
    const toClient = (mx: number, my: number) => ({
      x: mx * s.zoom + (rect.width  - W * s.zoom) / 2 + s.panX + rect.left,
      y: my * s.zoom + (rect.height - H * s.zoom) / 2 + s.panY + rect.top,
    });
    return { a: toClient(760, 420), b: toClient(1160, 680) };
  });

  // Drag the marquee from corner a to corner b.
  await page.evaluate(({ a, b }) => {
    const t = document.getElementById('map-viewer') as HTMLElement;
    const ev = (type: string, x: number, y: number): void => { t.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true })); };
    ev('pointerdown', a.x, a.y);
    ev('pointermove', b.x, b.y);
    ev('pointerup',   b.x, b.y);
  }, box);

  // Both players are now selected.
  const selCount = await page.waitForFunction(() => {
    const sel = (window as unknown as { $debug: { store: { get: () => { selection: unknown[] } } } }).$debug.store.get().selection;
    return sel.length === 2 ? sel.length : null;
  });
  expect(await selCount.jsonValue()).toBe(2);

  // Delete removes both; selection clears.
  await page.locator('[data-testid="mobile-delete"]').click();
  const after = await page.evaluate(() => {
    const s = (window as unknown as { $debug: { store: { get: () => { frames: { players: { id: string }[] }[]; activeFrameIdx: number; selection: unknown[] } } } }).$debug.store.get();
    const ids = s.frames[s.activeFrameIdx]!.players.map((p) => p.id);
    return { hasM1: ids.includes('e2e-m1'), hasM2: ids.includes('e2e-m2'), sel: s.selection.length };
  });
  expect(after.hasM1).toBe(false);
  expect(after.hasM2).toBe(false);
  expect(after.sel).toBe(0);
});

test('compact: pick Draw from the rail, drag a stroke, undo reverts, pinch still zooms', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // Tap the Draw button in the floating tool rail.
  await page.locator('[data-testid="mobile-tool-draw"]').click();
  const tool = await page.evaluate(() =>
    (window as unknown as { $debug: { store: { get: () => { tool: string } } } }).$debug.store.get().tool
  );
  expect(tool).toBe('draw');

  // One-finger drag near the map centre. The controller is dormant on one
  // finger with a creation tool active, so the event reaches DrawTool.
  await page.evaluate(() => {
    const viewer = document.getElementById('map-viewer') as HTMLElement;
    const r = viewer.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const ev = (type: string, x: number, y: number): void => {
      viewer.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    };
    ev('pointerdown', cx, cy);
    ev('pointermove', cx + 30, cy + 10);
    ev('pointermove', cx + 60, cy + 25);
    ev('pointerup',   cx + 60, cy + 25);
  });

  // The stroke persisted in the active frame.
  const strokeCount = await page.waitForFunction(() => {
    const s = (window as unknown as { $debug: { store: { get: () => { frames: { strokes: unknown[] }[]; activeFrameIdx: number } } } }).$debug.store.get();
    const n = s.frames[s.activeFrameIdx]!.strokes.length;
    return n > 0 ? n : null;
  });
  expect(await strokeCount.jsonValue()).toBe(1);

  // The mobile undo button reverts the stroke in one step.
  await page.locator('[data-testid="mobile-undo"]').click();
  const afterUndo = await page.evaluate(() => {
    const s = (window as unknown as { $debug: { store: { get: () => { frames: { strokes: unknown[] }[]; activeFrameIdx: number } } } }).$debug.store.get();
    return s.frames[s.activeFrameIdx]!.strokes.length;
  });
  expect(afterUndo).toBe(0);

  // A two-finger pinch still changes the zoom while Draw is active.
  const zoomBefore = await page.evaluate(() =>
    (window as unknown as { $debug: { store: { get: () => { zoom: number } } } }).$debug.store.get().zoom
  );
  await page.evaluate(() => {
    const viewer = document.getElementById('map-viewer') as HTMLElement;
    const r = viewer.getBoundingClientRect();
    const cy = r.top + r.height / 2;
    const ev = (type: string, id: number, x: number, y: number): void => {
      viewer.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
    };
    ev('pointerdown', 1, r.left + r.width * 0.4, cy);
    ev('pointerdown', 2, r.left + r.width * 0.6, cy);
    ev('pointermove', 2, r.left + r.width * 0.9, cy);
    ev('pointerup',   2, r.left + r.width * 0.9, cy);
    ev('pointerup',   1, r.left + r.width * 0.4, cy);
  });
  const zoomAfter = await page.evaluate(() =>
    (window as unknown as { $debug: { store: { get: () => { zoom: number } } } }).$debug.store.get().zoom
  );
  expect(zoomAfter).not.toBe(zoomBefore);
});

test('compact: pick Shapes from the rail, drag a shape, undo reverts', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // Tap Shapes in the floating tool rail; it has a settings panel, so the
  // tool-settings sheet auto-opens.
  await page.locator('[data-testid="mobile-tool-shapes"]').click();
  const tool = await page.evaluate(() =>
    (window as unknown as { $debug: { store: { get: () => { tool: string } } } }).$debug.store.get().tool
  );
  expect(tool).toBe('shapes');
  expect(await page.locator('[data-testid="mobile-toolsheet"]').count()).toBe(1);

  // One-finger drag near the map centre - the controller is dormant on one
  // finger with a creation tool active, so the event reaches ShapesTool.
  await page.evaluate(() => {
    const viewer = document.getElementById('map-viewer') as HTMLElement;
    const r = viewer.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const ev = (type: string, x: number, y: number): void => {
      viewer.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    };
    ev('pointerdown', cx, cy);
    ev('pointermove', cx + 50, cy + 40);
    ev('pointermove', cx + 90, cy + 70);
    ev('pointerup',   cx + 90, cy + 70);
  });

  // The shape persisted in the active frame.
  const shapeCount = await page.waitForFunction(() => {
    const s = (window as unknown as { $debug: { store: { get: () => { frames: { shapes: unknown[] }[]; activeFrameIdx: number } } } }).$debug.store.get();
    const n = s.frames[s.activeFrameIdx]!.shapes.length;
    return n > 0 ? n : null;
  });
  expect(await shapeCount.jsonValue()).toBe(1);

  // The mobile undo button reverts the shape in one step.
  await page.locator('[data-testid="mobile-undo"]').click();
  const afterUndo = await page.evaluate(() => {
    const s = (window as unknown as { $debug: { store: { get: () => { frames: { shapes: unknown[] }[]; activeFrameIdx: number } } } }).$debug.store.get();
    return s.frames[s.activeFrameIdx]!.shapes.length;
  });
  expect(afterUndo).toBe(0);
});

test('compact: pick Cone from the rail, tap places a cone', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // Tap Cone in the rail; its spread settings panel auto-opens.
  await page.locator('[data-testid="mobile-tool-place-cone"]').click();
  const tool = await page.evaluate(() =>
    (window as unknown as { $debug: { store: { get: () => { tool: string } } } }).$debug.store.get().tool
  );
  expect(tool).toBe('place-cone');
  expect(await page.locator('[data-testid="mobile-toolsheet"]').count()).toBe(1);

  // A one-finger tap near the map centre places a cone.
  await page.evaluate(() => {
    const viewer = document.getElementById('map-viewer') as HTMLElement;
    const r = viewer.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const ev = (type: string, x: number, y: number): void => {
      viewer.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    };
    ev('pointerdown', cx, cy);
    ev('pointerup',   cx, cy);
  });

  const coneCount = await page.waitForFunction(() => {
    const s = (window as unknown as { $debug: { store: { get: () => { frames: { cones: unknown[] }[]; activeFrameIdx: number } } } }).$debug.store.get();
    const n = s.frames[s.activeFrameIdx]!.cones.length;
    return n > 0 ? n : null;
  });
  expect(await coneCount.jsonValue()).toBe(1);
});

test('compact: pick Erase from the rail, rub out an injected stroke', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // Inject a stroke through the map centre via store._apply (not undoable,
  // only the erase that follows is).
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: unknown[]; activeFrameIdx: number }; _apply: (p: unknown) => void } } }).$debug;
    const s = dbg.store.get();
    const idx = s.activeFrameIdx;
    const frame = s.frames[idx] as { strokes: unknown[] };
    const stroke = { id: 'e2e-stroke-1', type: 'draw', color: '#00ff88', alpha: 0.92, size: 6,
      points: [{ x: 900, y: 540 }, { x: 1020, y: 540 }] };
    dbg.store._apply({
      frames: s.frames.map((f: unknown, i: number) => i === idx ? { ...frame, strokes: [...frame.strokes, stroke] } : f),
    });
  });

  // Tap Erase in the rail; it has no settings panel, so no tool-settings sheet.
  await page.locator('[data-testid="mobile-tool-erase"]').click();
  expect(await page.locator('[data-testid="mobile-toolsheet"]').count()).toBe(0);

  // One-finger drag along the stroke erases it.
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { zoom: number; panX: number; panY: number } } } }).$debug;
    const s = dbg.store.get();
    const viewer = document.getElementById('map-viewer') as HTMLElement;
    const r = viewer.getBoundingClientRect();
    const W = 1920, H = 1080;
    const toClient = (mx: number, my: number) => ({
      x: mx * s.zoom + (r.width - W * s.zoom) / 2 + s.panX + r.left,
      y: my * s.zoom + (r.height - H * s.zoom) / 2 + s.panY + r.top,
    });
    const a = toClient(900, 540);
    const b = toClient(1020, 540);
    const ev = (type: string, x: number, y: number): void => {
      viewer.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    };
    ev('pointerdown', a.x, a.y);
    ev('pointermove', (a.x + b.x) / 2, a.y);
    ev('pointermove', b.x, b.y);
    ev('pointerup',   b.x, b.y);
  });

  const erased = await page.waitForFunction(() => {
    const s = (window as unknown as { $debug: { store: { get: () => { frames: { strokes: { id: string }[] }[]; activeFrameIdx: number } } } }).$debug.store.get();
    return s.frames[s.activeFrameIdx]!.strokes.length === 0 ? true : null;
  });
  expect(await erased.jsonValue()).toBe(true);
});

test('compact: pick Player from the rail, tap places a player, undo reverts', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // Tap Player in the floating tool rail; it has a settings panel, so the
  // tool-settings sheet auto-opens.
  await page.locator('[data-testid="mobile-tool-place-player"]').click();
  const tool = await page.evaluate(() =>
    (window as unknown as { $debug: { store: { get: () => { tool: string } } } }).$debug.store.get().tool
  );
  expect(tool).toBe('place-player');
  expect(await page.locator('[data-testid="mobile-toolsheet"]').count()).toBe(1);

  // A one-finger tap near the map centre places a player.
  await page.evaluate(() => {
    const viewer = document.getElementById('map-viewer') as HTMLElement;
    const r = viewer.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const ev = (type: string, x: number, y: number): void => {
      viewer.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    };
    ev('pointerdown', cx, cy);
    ev('pointerup',   cx, cy);
  });

  const playerCount = await page.waitForFunction(() => {
    const s = (window as unknown as { $debug: { store: { get: () => { frames: { players: unknown[] }[]; activeFrameIdx: number } } } }).$debug.store.get();
    const n = s.frames[s.activeFrameIdx]!.players.length;
    return n > 0 ? n : null;
  });
  expect(await playerCount.jsonValue()).toBe(1);

  // The mobile undo button reverts the player in one step.
  await page.locator('[data-testid="mobile-undo"]').click();
  const afterUndo = await page.evaluate(() => {
    const s = (window as unknown as { $debug: { store: { get: () => { frames: { players: unknown[] }[]; activeFrameIdx: number } } } }).$debug.store.get();
    return s.frames[s.activeFrameIdx]!.players.length;
  });
  expect(afterUndo).toBe(0);
});

test('compact: pick Text from the rail, tap places a box and hands off to select', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // Tap Text in the rail; its font-size settings panel auto-opens.
  await page.locator('[data-testid="mobile-tool-place-text"]').click();
  expect(await page.locator('[data-testid="mobile-toolsheet"]').count()).toBe(1);

  // A one-finger tap near the map centre places a text box.
  await page.evaluate(() => {
    const viewer = document.getElementById('map-viewer') as HTMLElement;
    const r = viewer.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const ev = (type: string, x: number, y: number): void => {
      viewer.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    };
    ev('pointerdown', cx, cy);
    ev('pointerup',   cx, cy);
  });

  const boxCount = await page.waitForFunction(() => {
    const s = (window as unknown as { $debug: { store: { get: () => { frames: { textboxes: unknown[] }[]; activeFrameIdx: number } } } }).$debug.store.get();
    const n = s.frames[s.activeFrameIdx]!.textboxes.length;
    return n > 0 ? n : null;
  });
  expect(await boxCount.jsonValue()).toBe(1);

  // Desktop parity: placing a box hands the active tool off to Select.
  const tool = await page.evaluate(() =>
    (window as unknown as { $debug: { store: { get: () => { tool: string } } } }).$debug.store.get().tool
  );
  expect(tool).toBe('cursor');
});

test('compact: pick QuickAdd from the rail, the type grid rides the sheet, tap places one', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // Tap QuickAdd in the rail; its type-grid settings panel auto-opens.
  await page.locator('[data-testid="mobile-tool-place-quickadd"]').click();
  const tool = await page.evaluate(() =>
    (window as unknown as { $debug: { store: { get: () => { tool: string } } } }).$debug.store.get().tool
  );
  expect(tool).toBe('place-quickadd');
  // The type grid rides the auto-open tool-settings sheet.
  expect(await page.locator('[data-testid="mobile-toolsheet"] [data-type="grenade"]').count()).toBe(1);

  // A one-finger tap near the map centre places a quickadd.
  await page.evaluate(() => {
    const viewer = document.getElementById('map-viewer') as HTMLElement;
    const r = viewer.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const ev = (type: string, x: number, y: number): void => {
      viewer.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    };
    ev('pointerdown', cx, cy);
    ev('pointerup',   cx, cy);
  });

  const qaCount = await page.waitForFunction(() => {
    const s = (window as unknown as { $debug: { store: { get: () => { frames: { quickadds: unknown[] }[]; activeFrameIdx: number } } } }).$debug.store.get();
    const n = s.frames[s.activeFrameIdx]!.quickadds.length;
    return n > 0 ? n : null;
  });
  expect(await qaCount.jsonValue()).toBe(1);
});

test('compact: the menu launcher opens the strat library', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // Open the menu sheet from the top-bar menu button.
  await page.locator('[data-testid="mobile-menu-btn"]').click();
  await expect(page.locator('[data-testid="mobile-sheet"]')).toBeVisible();

  // The File launcher group exposes a Library action; tapping it opens the
  // strat-library modal and closes the menu sheet.
  await page.locator('[data-testid="mobile-action-library"]').click();
  await expect(page.locator('.strat-library')).toBeVisible();
  expect(await page.locator('[data-testid="mobile-sheet"]').count()).toBe(0);
});

test('compact: save lists the strat in the library and delete raises a confirm', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // Save via the launcher's File group.
  await page.locator('[data-testid="mobile-menu-btn"]').click();
  await page.locator('[data-testid="mobile-action-save"]').click();

  // promptAndSave is async (it captures a thumbnail); wait for the library
  // index to land in localStorage.
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('artifact-gg.v2.library.index');
    if (!raw) return false;
    try { return (JSON.parse(raw) as unknown[]).length > 0; } catch { return false; }
  });

  // Reopen the menu and the library; the saved strat is listed.
  await page.locator('[data-testid="mobile-menu-btn"]').click();
  await page.locator('[data-testid="mobile-action-library"]').click();
  await expect(page.locator('.strat-library-row')).toHaveCount(1);

  // Tapping the row's Delete button raises the confirm modal.
  await page.locator('.strat-library-row-delete').click();
  await expect(page.locator('.confirm-modal')).toBeVisible();
});

test('compact: the launcher opens the share dialog', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // Open the menu sheet, tap the Share row.
  await page.locator('[data-testid="mobile-menu-btn"]').click();
  await page.locator('[data-testid="mobile-action-share"]').click();

  // The share dialog opens and the menu sheet closes.
  await expect(page.locator('.share-dialog')).toBeVisible();
  expect(await page.locator('[data-testid="mobile-sheet"]').count()).toBe(0);
});

test('compact: the launcher exports a .strat.json file', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // Open the menu sheet; arm the download listener before tapping Export.
  await page.locator('[data-testid="mobile-menu-btn"]').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-testid="mobile-action-export-json"]').click();

  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.strat\.json$/);
});

test('compact: the launcher import action opens a file chooser', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // Open the menu sheet; arm the file-chooser listener before tapping Import.
  await page.locator('[data-testid="mobile-menu-btn"]').click();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('[data-testid="mobile-action-import"]').click();

  const chooser = await chooserPromise;
  expect(chooser.isMultiple()).toBe(false);
});

test('compact: the launcher opens the changelog', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // Open the menu sheet, tap the Changelog row.
  await page.locator('[data-testid="mobile-menu-btn"]').click();
  await page.locator('[data-testid="mobile-action-changelog"]').click();

  // The changelog modal opens and the menu sheet closes.
  await expect(page.locator('.changelog-modal')).toBeVisible();
  expect(await page.locator('[data-testid="mobile-sheet"]').count()).toBe(0);
});

test('compact: the launcher opens the privacy and legal notice', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // Open the menu sheet, tap the Privacy & legal row.
  await page.locator('[data-testid="mobile-menu-btn"]').click();
  await page.locator('[data-testid="mobile-action-legal"]').click();

  // The legal modal opens and the menu sheet closes.
  await expect(page.locator('.legal-modal')).toBeVisible();
  expect(await page.locator('[data-testid="mobile-sheet"]').count()).toBe(0);
});

test('compact: switch map from the map sheet and the title follows', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // No hash on this boot, so main.ts's mapId default (hash?.map ?? 'suna') applies.
  await expect(page.locator('.mob-title')).toHaveText('suna');

  await page.locator('[data-testid="mobile-menu-btn"]').click();
  await page.locator('[data-testid="mobile-action-map"]').click();
  await expect(page.locator('[data-testid="mobile-mapsheet"]')).toBeVisible();

  await page.locator('.map-dropdown-row[data-mapid="frio"]').click();

  await expect(page.locator('[data-testid="mobile-mapsheet"]')).toBeHidden();
  await expect(page.locator('.mob-title')).toHaveText('frio');

  const mapId = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { mapId: string } } } }).$debug;
    return dbg.store.get().mapId;
  });
  expect(mapId).toBe('frio');
});

test('compact: the map sheet toggles callouts', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  await page.locator('[data-testid="mobile-menu-btn"]').click();
  await page.locator('[data-testid="mobile-action-map"]').click();

  const row = page.locator('.map-dropdown-callouts-row');
  const before = await row.getAttribute('aria-pressed');
  await row.click();
  await expect(row).not.toHaveAttribute('aria-pressed', before ?? '');
});

test('compact: the view sheet hides a layer', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  await page.locator('[data-testid="mobile-menu-btn"]').click();
  await page.locator('[data-testid="mobile-action-view"]').click();
  await expect(page.locator('[data-testid="mobile-viewsheet"]')).toBeVisible();

  await page.locator('.layer-visibility-btn[data-layer="players"]').click();

  const hidden = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { ui: { layerVisibility?: Record<string, boolean> } } } } }).$debug;
    return dbg.store.get().ui.layerVisibility?.players;
  });
  expect(hidden).toBe(false);
});

test('compact: reset view refits after a zoom, clear frame confirms first', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  const SENTINEL_ZOOM = 99;
  await page.evaluate((z) => {
    const dbg = (window as unknown as { $debug: { store: { _apply: (p: unknown) => void } } }).$debug;
    dbg.store._apply({ zoom: z });
  }, SENTINEL_ZOOM);

  await page.locator('[data-testid="mobile-menu-btn"]').click();
  await page.locator('[data-testid="mobile-action-view"]').click();
  await page.locator('[data-testid="mobile-reset-view"]').click();

  const zoomAfter = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { zoom: number } } } }).$debug;
    return dbg.store.get().zoom;
  });
  expect(zoomAfter).not.toBe(SENTINEL_ZOOM);
  expect(zoomAfter).toBeGreaterThan(0);
  // Reset lands on the same default as boot and a map switch, rather than on
  // something merely non-sentinel - this used to assert only "not 99".
  const viewer = (await page.locator('#map-viewer').boundingBox())!;
  const expected = Math.min(Math.min(viewer.width / 1920, viewer.height / 1080) * 2, viewer.height / 1080);
  expect(zoomAfter).toBeCloseTo(expected, 4);

  // dispatchClearFrame no-ops on an empty frame (nothing to confirm away),
  // so seed one player onto the active frame first.
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug;
    dbg.history.dispatch({ t: 'player.add', player: { id: 'e2e-clear-p1', team: 'colonist', x: 100, y: 200, name: 'T', dead: false } });
  });

  await page.locator('[data-testid="mobile-menu-btn"]').click();
  await page.locator('[data-testid="mobile-action-view"]').click();
  await page.locator('[data-testid="mobile-clear-frame"]').click();
  await expect(page.locator('.confirm-modal')).toBeVisible();
});

test('compact: notes are editable and survive closing the sheet', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  await page.locator('[data-testid="mobile-menu-btn"]').click();
  await page.locator('[data-testid="mobile-action-notes"]').click();

  const ta = page.locator('[data-testid="mobile-notessheet"] textarea');
  await expect(ta).toBeVisible();
  await ta.fill('default smoke mid, flash for entry');

  await page.locator('[data-testid="mobile-notessheet-close"]').click();
  await expect(page.locator('[data-testid="mobile-notessheet"]')).toBeHidden();

  const notes = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { notes: string } } } }).$debug;
    return dbg.store.get().notes;
  });
  expect(notes).toBe('default smoke mid, flash for entry');

  await page.locator('[data-testid="mobile-menu-btn"]').click();
  await page.locator('[data-testid="mobile-action-notes"]').click();
  await expect(page.locator('[data-testid="mobile-notessheet"] textarea')).toHaveValue('default smoke mid, flash for entry');
});

test('compact: the frame timeline spans the viewport and its buttons are reachable', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // The compact override in mobile-chrome.css keys off #app[data-layout="compact"],
  // so the timeline has to live inside #app for it to apply at all. Mounted on
  // document.body it kept the desktop `left: var(--sidebar-width)` and sat in a
  // 110px sliver at the right edge with its buttons off-screen entirely.
  const box = await page.locator('[data-testid="frame-timeline"]').boundingBox();
  expect(box?.x).toBe(0);
  expect(box?.width).toBe(390);

  // Every timeline button must be inside the viewport. Add was at x=386
  // (right=426) and Play at x=468 (right=508) before the fix.
  const offscreen = await page.evaluate(() => {
    const t = document.querySelector('[data-testid="frame-timeline"]')!;
    return Array.from(t.querySelectorAll('button'))
      .filter((b) => { const r = b.getBoundingClientRect(); return r.right > window.innerWidth || r.left < 0; })
      .map((b) => b.getAttribute('data-testid') ?? b.className);
  });
  expect(offscreen).toEqual([]);

  // ...and the add button actually works through a tap.
  const frames = async (): Promise<number> => page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: unknown[] } } } }).$debug;
    return dbg.store.get().frames.length;
  });
  const before = await frames();
  await page.locator('.frame-timeline-add').tap();
  expect(await frames()).toBe(before + 1);
});

test('compact: no sheet takes more than 45% of the screen', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  const pct = async (sel: string): Promise<number> => {
    const box = await page.locator(sel).boundingBox();
    return Math.round(((box?.height ?? 0) / 844) * 100);
  };

  // The sheets host the desktop context-panel DOM, which stacks label above
  // control at full width. Measured before this was tightened: Player 42%,
  // colour sheet 59%, menu sheet 63%. Player is the tallest of the seven tool
  // sheets (five control rows) and now measures 33%, so 35 is the guard.
  await page.locator('[data-testid="mobile-tool-place-player"]').tap();
  expect(await pct('[data-testid="mobile-toolsheet"]')).toBeLessThanOrEqual(35);
  await page.locator('[data-testid="mobile-toolsheet-close"]').tap();

  await page.locator('[data-testid="mobile-colour-swatch"]').tap();
  expect(await pct('[data-testid="mobile-coloursheet"]')).toBeLessThanOrEqual(45);

  await page.locator('[data-testid="mobile-coloursheet-close"]').tap();
  await page.locator('[data-testid="mobile-menu-btn"]').tap();
  expect(await pct('[data-testid="mobile-sheet"]')).toBeLessThanOrEqual(45);
});

test('compact: no hud overlay lands in the top bar band', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // The HUD overlays are positioned for the desktop shell, where the topbar sits
  // OUTSIDE #map-viewer. In compact they mount into the box the 56px .mob-topbar
  // occupies and landed on it. Geometry assertion, not hit-testing: the hint and
  // legend are pointer-events:none, so elementFromPoint walks straight through.
  const clashes = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="mobile-topbar"]')!.getBoundingClientRect();
    const out: string[] = [];
    for (const sel of ['#player-legend', '.discord-link', '.canvas-hint']) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || (el as HTMLElement).hidden) continue;
      const r = el.getBoundingClientRect();
      const ox = Math.min(r.right, bar.right) - Math.max(r.left, bar.left);
      const oy = Math.min(r.bottom, bar.bottom) - Math.max(r.top, bar.top);
      if (ox > 1 && oy > 1) out.push(`${sel} overlaps the top bar by ${Math.round(ox)}x${Math.round(oy)}px`);
    }
    return out;
  });
  expect(clashes).toEqual([]);
});

test('compact: the tallest sheet cannot bury a tool rail button', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // The menu sheet is the tallest of the six. The rail used to stretch to
  // bottom:96px regardless of its content, so with any sheet open its lower
  // buttons sat underneath it - the colour swatch was unreachable without closing
  // the sheet first. The rail now stops above the tallest possible sheet and
  // scrolls its own overflow instead, so the two boxes must never intersect.
  await page.locator('[data-testid="mobile-menu-btn"]').tap();
  await expect(page.locator('[data-testid="mobile-sheet"]')).toBeVisible();

  const overlap = await page.evaluate(() => {
    const rail = document.querySelector('.mob-tool-rail')!.getBoundingClientRect();
    const sheet = document.querySelector('[data-testid="mobile-sheet"]')!.getBoundingClientRect();
    const ox = Math.min(rail.right, sheet.right) - Math.max(rail.left, sheet.left);
    const oy = Math.min(rail.bottom, sheet.bottom) - Math.max(rail.top, sheet.top);
    return ox > 1 && oy > 1 ? { ox: Math.round(ox), oy: Math.round(oy) } : null;
  });
  expect(overlap).toBeNull();

  // Everything inside the rail's visible box stays hit-testable - anything past
  // it is a scroll away, which is what overflow-y:auto is there for.
  const buried = await page.evaluate(() => {
    const rail = document.querySelector('.mob-tool-rail') as HTMLElement;
    const box = rail.getBoundingClientRect();
    const out: string[] = [];
    for (const el of Array.from(rail.children)) {
      const r = el.getBoundingClientRect();
      if (r.top < box.top || r.bottom > box.bottom) continue; // scrolled out of view
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (!(hit && (el === hit || el.contains(hit)))) {
        out.push(`${el.getAttribute('data-testid') ?? el.className} blocked by ${(hit as HTMLElement | null)?.className ?? 'nothing'}`);
      }
    }
    return out;
  });
  expect(buried).toEqual([]);

  // No empty column: the rail box was 692px tall for 467px of buttons, a long
  // translucent strip down the left edge of the map. Either it is scrolling (so
  // it is full of content by definition) or it ends just after its last button.
  const slack = await page.evaluate(() => {
    const rail = document.querySelector('.mob-tool-rail') as HTMLElement;
    if (rail.scrollHeight > rail.clientHeight) return 0;
    const items = Array.from(rail.children) as HTMLElement[];
    const last = items[items.length - 1]!.getBoundingClientRect();
    return Math.round(rail.getBoundingClientRect().bottom - last.bottom);
  });
  expect(slack).toBeLessThanOrEqual(12);
});

test('compact: two fingers moving together pan the map, under a creation tool too', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // Same-direction two-finger drag, separation held constant. Before
  // pinchTransform this moved the pan by (-4, -3): applyPinch fed
  // anchoredZoomPan alone, which only compensates pan for a change of zoom, so a
  // drag that does not change the finger separation moved nothing.
  const r = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { panX: number; panY: number; zoom: number }; _apply: (p: unknown) => void } } }).$debug;
    dbg.store._apply({ tool: 'draw' }); // a creation tool owns one finger; two must still pan
    const before = dbg.store.get();
    const t = document.getElementById('map-viewer')!;
    const ev = (type: string, id: number, x: number, y: number): void => {
      t.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
    };
    ev('pointerdown', 1, 150, 400); ev('pointerdown', 2, 250, 400);
    for (let i = 1; i <= 8; i++) { ev('pointermove', 1, 150 + i * 10, 400 + i * 5); ev('pointermove', 2, 250 + i * 10, 400 + i * 5); }
    const after = dbg.store.get();
    ev('pointerup', 1, 230, 440); ev('pointerup', 2, 330, 440);
    return { dx: after.panX - before.panX, dy: after.panY - before.panY, zoomBefore: before.zoom, zoomAfter: after.zoom };
  });
  expect(r.dx).toBeCloseTo(80, 0);
  expect(r.dy).toBeCloseTo(40, 0);
  expect(r.zoomAfter).toBeCloseTo(r.zoomBefore, 6);
});

test('compact: the frame strip is short and its cards do not overlap themselves', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug;
    for (let i = 0; i < 3; i++) dbg.history.dispatch({ t: 'frame.add' });
  });

  // 73px before. The floor is a 44px play button + 8px padding + the 1px top
  // border = 53, so 54 is the guard.
  const strip = await page.locator('[data-testid="frame-timeline"]').boundingBox();
  expect(strip!.height).toBeLessThanOrEqual(54);

  // No two things inside a card may intersect. They did: the blanket 44px rule
  // pushed 146px of chips into a 96px card, so the caption chip sat on the index.
  const clashes = await page.evaluate(() => {
    const out: string[] = [];
    for (const card of Array.from(document.querySelectorAll('.frame-timeline-card'))) {
      const chips = Array.from(card.querySelectorAll('button, .frame-timeline-card-index'))
        .map((e) => ({ n: e.className, r: e.getBoundingClientRect() }))
        .filter((c) => c.r.width > 0 && c.r.height > 0);
      for (let i = 0; i < chips.length; i++) for (let j = i + 1; j < chips.length; j++) {
        const a = chips[i]!.r, b = chips[j]!.r;
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 1 && oy > 1) out.push(`${chips[i]!.n} over ${chips[j]!.n}`);
      }
    }
    return out;
  });
  expect(clashes).toEqual([]);

  // Only the active card carries its chips.
  const cards = await page.evaluate(() => Array.from(document.querySelectorAll('.frame-timeline-card')).map((c) => ({
    active: c.getAttribute('aria-current') === 'true',
    chips: Array.from(c.querySelectorAll('button')).filter((b) => getComputedStyle(b).display !== 'none').length,
  })));
  for (const c of cards) expect(c.chips === 0 || c.active).toBe(true);
  expect(cards.some((c) => c.active && c.chips > 0)).toBe(true);

  // The delay stepper moved to the View sheet, so the strip must not still have one.
  expect(await page.locator('[data-testid="frame-timeline"] .frame-timeline-delay').isVisible()).toBe(false);
  await page.locator('[data-testid="mobile-menu-btn"]').tap();
  await page.locator('[data-testid="mobile-action-view"]').tap();
  await expect(page.locator('[data-testid="mobile-viewsheet"] .frame-timeline-delay')).toBeVisible();
});

test('compact: a tap near a node selects it at the default zoom', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // The touch hit radius was a fixed 16 map units, which is 3.3px on screen at the
  // fit zoom this boots to - you had to land within 5px of the node's centre.
  const selected = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { zoom: number; panX: number; panY: number; frames: Array<Record<string, unknown>>; activeFrameIdx: number; selection: unknown[] }; _apply: (p: unknown) => void } } }).$debug;
    const s = dbg.store.get();
    const idx = s.activeFrameIdx;
    const frame = s.frames[idx]!;
    dbg.store._apply({
      frames: s.frames.map((f, i) => (i === idx ? { ...frame, players: [{ id: 'e2e-near', team: 'colonist', x: 960, y: 540, name: '', dead: false }] } : f)),
      tool: 'cursor', selection: [],
    });
    const v = dbg.store.get();
    const t = document.getElementById('map-viewer')!;
    const r = t.getBoundingClientRect();
    // 18px off centre - a realistic finger miss, well inside a 44px target
    const cx = 960 * v.zoom + (r.width - 1920 * v.zoom) / 2 + v.panX + r.left + 18;
    const cy = 540 * v.zoom + (r.height - 1080 * v.zoom) / 2 + v.panY + r.top;
    const ev = (type: string): void => {
      t.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
    };
    ev('pointerdown'); ev('pointerup');
    return dbg.store.get().selection;
  });
  expect(selected).toEqual([{ kind: 'player', id: 'e2e-near' }]);
});

test('compact portrait: boots to twice fit zoom, and a double-tap shows the whole map', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));
  // Let the rAF-scheduled boot fit land.
  await page.waitForTimeout(300);

  const box = (await page.locator('#map-viewer').boundingBox())!;
  const fit = Math.min(box.width / 1920, box.height / 1080);
  const zoom = await page.evaluate(() =>
    (window as unknown as { $debug: { store: { get: () => { zoom: number } } } }).$debug.store.get().zoom);

  // Plain fit is width-limited in portrait: 390x219 in a 735px clear band, about
  // a quarter of the height with everything on it too small to read.
  expect(zoom).toBeCloseTo(fit * 2, 4);
  expect(Math.round(1920 * zoom)).toBe(780);
  expect(Math.round(1080 * zoom)).toBe(439);

  // The overview is still one gesture away: toggleZoom compares against plain
  // fit, so from the new default a double-tap goes out rather than in.
  await page.evaluate(() => {
    const t = document.getElementById('map-viewer')!;
    const tap = (): void => {
      for (const type of ['pointerdown', 'pointerup']) {
        t.dispatchEvent(new PointerEvent(type, { pointerId: 3, pointerType: 'touch', clientX: 195, clientY: 400, bubbles: true, cancelable: true }));
      }
    };
    tap(); tap();
  });
  const after = await page.evaluate(() =>
    (window as unknown as { $debug: { store: { get: () => { zoom: number } } } }).$debug.store.get().zoom);
  expect(after).toBeCloseTo(fit, 4);
});

/** Three named players, which is what makes the legend appear at all. */
async function seedNamedPlayers(page: Page): Promise<void> {
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: Array<Record<string, unknown>>; activeFrameIdx: number }; _apply: (p: unknown) => void } } }).$debug;
    const s = dbg.store.get();
    const players = [
      { id: 'np1', x: 900, y: 500, team: 'colonist', name: 'Beige', dead: false },
      { id: 'np2', x: 1000, y: 500, team: 'colonist', name: 'Fenrir', dead: false },
      { id: 'np3', x: 1100, y: 500, team: 'reyab', name: 'Longname McGee', dead: false },
    ];
    dbg.store._apply({
      frames: s.frames.map((f, i) => (i === s.activeFrameIdx ? { ...f, players } : f)),
      selection: [],
    });
  });
}

test('compact: the player legend is not buried under the tool rail', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));
  await seedNamedPlayers(page);

  const legend = page.locator('#player-legend');
  await expect(legend).toBeVisible();

  // player-legend.css puts it top-left for the desktop shell, where the rail is
  // inside the sidebar - a different element, outside #map-viewer. In compact the
  // rail mounts into #map-viewer at left:8px and wins on z-index, so 50 of the
  // legend's 66px was hidden in portrait and all 66 of it sideways.
  const l = (await legend.boundingBox())!;
  const rail = (await page.locator('[data-testid="mobile-tool-rail"]').boundingBox())!;
  const overlaps = l.x < rail.x + rail.width && l.x + l.width > rail.x
    && l.y < rail.y + rail.height && l.y + l.height > rail.y;
  expect(overlaps).toBe(false);

  // Nor may it sit under the frame strip, which is the obvious way to get this
  // wrong in the other direction.
  const strip = (await page.locator('[data-testid="frame-timeline"]').boundingBox())!;
  expect(l.y + l.height).toBeLessThanOrEqual(strip.y);
});

test('compact: holding an item opens the action menu, and each row works', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));
  await seedNamedPlayers(page);

  await longPressMap(page, 900, 500);
  const menu = page.locator('[data-testid="mobile-itemmenu"]');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.mob-itemmenu-row')).toHaveText(['Delete', 'Duplicate', 'Add to selection']);

  // It opens at the finger, not in a corner.
  const box = (await menu.boundingBox())!;
  const viewer = (await page.locator('#map-viewer').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(viewer.x);
  expect(box.x + box.width).toBeLessThanOrEqual(viewer.x + viewer.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(viewer.y + viewer.height + 0.5);

  const count = (): Promise<number> => page.evaluate(() => {
    const s = (window as unknown as { $debug: { store: { get: () => { frames: Array<{ players: unknown[] }>; activeFrameIdx: number } } } }).$debug.store.get();
    return s.frames[s.activeFrameIdx]!.players.length;
  });

  await page.locator('[data-testid="mobile-itemmenu-duplicate"]').click();
  expect(await count()).toBe(4);
  await expect(menu).toHaveCount(0); // closes after an action
  await page.waitForTimeout(350);

  await longPressMap(page, 900, 500);
  await page.locator('[data-testid="mobile-itemmenu-delete"]').click();
  expect(await count()).toBe(3);

  // One undo step per action.
  await page.locator('[data-testid="mobile-undo"]').click();
  expect(await count()).toBe(4);
});

test('compact: the action menu stays on screen when held near an edge', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // A player near the right-hand edge of the map: at 390px wide, a 168px menu
  // opened to the right of the finger would hang half off the screen.
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: Array<Record<string, unknown>>; activeFrameIdx: number }; _apply: (p: unknown) => void } } }).$debug;
    const s = dbg.store.get();
    dbg.store._apply({
      frames: s.frames.map((f, i) => (i === s.activeFrameIdx
        ? { ...f, players: [{ id: 'edge', x: 1880, y: 1040, team: 'colonist', name: 'E', dead: false }] }
        : f)),
      selection: [],
    });
  });

  await longPressMap(page, 1880, 1040);
  const menu = page.locator('[data-testid="mobile-itemmenu"]');
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  const viewer = (await page.locator('#map-viewer').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(viewer.x - 0.5);
  expect(box.x + box.width).toBeLessThanOrEqual(viewer.x + viewer.width + 0.5);
  expect(box.y).toBeGreaterThanOrEqual(viewer.y - 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(viewer.y + viewer.height + 0.5);
});

test('compact: the top bar has no multi-select toggle', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));
  await expect(page.locator('[data-testid="mobile-multi"]')).toHaveCount(0);
  await expect(page.locator('.mob-topbar button')).toHaveCount(5); // title + undo/redo/delete + menu
});

test('compact: a two-finger tap undoes, a pinch does not', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  const addPlayer = (id: string): Promise<void> => page.evaluate((pid) => {
    (window as unknown as { $debug: { history: { dispatch: (c: unknown) => void } } }).$debug
      .history.dispatch({ t: 'player.add', player: { id: pid, team: 'colonist', x: 900, y: 500, name: '', dead: false } });
  }, id);
  const count = (): Promise<number> => page.evaluate(() => {
    const s = (window as unknown as { $debug: { store: { get: () => { frames: Array<{ players: unknown[] }>; activeFrameIdx: number } } } }).$debug.store.get();
    return s.frames[s.activeFrameIdx]!.players.length;
  });
  // Two fingers, optionally spreading the second one to make it a pinch.
  const twoFinger = (spread: boolean): Promise<void> => page.evaluate((sp) => {
    const t = document.getElementById('map-viewer')!;
    const ev = (type: string, id: number, x: number, y: number): void => {
      t.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
    };
    ev('pointerdown', 11, 120, 400);
    ev('pointerdown', 12, 260, 400);
    if (sp) ev('pointermove', 12, 360, 400);
    ev('pointerup', 11, 120, 400);
    ev('pointerup', 12, sp ? 360 : 260, 400);
  }, spread);

  await addPlayer('e2e-tf1');
  expect(await count()).toBe(1);

  await twoFinger(false);
  expect(await count()).toBe(0);

  // A pinch must not undo - it is the same two fingers, distinguished only by
  // having moved.
  await addPlayer('e2e-tf2');
  await page.waitForTimeout(350);
  await twoFinger(true);
  expect(await count()).toBe(1);
});

test('compact: placing a text box opens a sheet you can actually type into', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  await page.locator('[data-testid="mobile-tool-place-text"]').click();
  await page.waitForTimeout(400);

  // Tap to place. TextTool hands off to the select tool, so the selection sheet
  // opens on the new box by itself.
  await page.evaluate(() => {
    const s = (window as unknown as { $debug: { store: { get: () => { zoom: number; panX: number; panY: number } } } }).$debug.store.get();
    const t = document.getElementById('map-viewer')!;
    const r = t.getBoundingClientRect();
    const cx = 900 * s.zoom + (r.width - 1920 * s.zoom) / 2 + s.panX + r.left;
    const cy = 500 * s.zoom + (r.height - 1080 * s.zoom) / 2 + s.panY + r.top;
    for (const type of ['pointerdown', 'pointerup']) {
      t.dispatchEvent(new PointerEvent(type, { pointerId: 31, pointerType: 'touch', clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
    }
  });
  await page.waitForTimeout(500);

  const field = page.locator('[data-testid="textbox-text-input"]');
  await expect(field).toBeVisible();

  // The point of the exercise: the box on the map is scaled by the zoom, so its
  // own field is about 13px tall with a 5px font at the portrait default. This
  // one has to be a real target.
  const box = (await field.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);

  await field.fill('smoke here');
  await field.blur();
  await page.waitForTimeout(300);

  const text = await page.evaluate(() => {
    const s = (window as unknown as { $debug: { store: { get: () => { frames: Array<{ textboxes?: Array<{ text: string }> }>; activeFrameIdx: number } } } }).$debug.store.get();
    return s.frames[s.activeFrameIdx]?.textboxes?.map((t) => t.text) ?? [];
  });
  expect(text).toEqual(['smoke here']);

  // And it is one undo step.
  await page.locator('[data-testid="mobile-undo"]').click();
  const undone = await page.evaluate(() => {
    const s = (window as unknown as { $debug: { store: { get: () => { frames: Array<{ textboxes?: Array<{ text: string }> }>; activeFrameIdx: number } } } }).$debug.store.get();
    return s.frames[s.activeFrameIdx]?.textboxes?.map((t) => t.text) ?? [];
  });
  expect(undone).toEqual(['']);
});

test('compact: a tap selects a drawn stroke', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // Stroke selection was a desktop-only feature by accident. SelectTool chained a
  // second call to findStrokeAt after hitTestPoint, and hitTestPoint - which is
  // all the touch controller calls - had no idea strokes existed. A player at the
  // same coordinates selected fine, which is what pinned it on the hit test
  // rather than on the tap.
  const selected = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { zoom: number; panX: number; panY: number; frames: Array<Record<string, unknown>>; activeFrameIdx: number; selection: unknown[] }; _apply: (p: unknown) => void } } }).$debug;
    const s = dbg.store.get();
    const idx = s.activeFrameIdx;
    const points: Array<{ x: number; y: number }> = [];
    for (let x = 700; x <= 1200; x += 5) points.push({ x, y: 540 });
    dbg.store._apply({
      frames: s.frames.map((f, i) => (i === idx
        ? { ...f, strokes: [{ id: 'e2e-stroke', type: 'draw', color: '#ff0000', alpha: 1, size: 8, points }] }
        : f)),
      tool: 'cursor', selection: [],
    });
    const v = dbg.store.get();
    const t = document.getElementById('map-viewer')!;
    const r = t.getBoundingClientRect();
    const cx = 950 * v.zoom + (r.width - 1920 * v.zoom) / 2 + v.panX + r.left;
    const cy = 540 * v.zoom + (r.height - 1080 * v.zoom) / 2 + v.panY + r.top;
    // TouchViewportController drops pointerType 'mouse', so page.mouse would be
    // silently ignored here.
    const ev = (type: string): void => {
      t.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
    };
    ev('pointerdown'); ev('pointerup');
    return dbg.store.get().selection;
  });
  expect(selected).toEqual([{ kind: 'stroke', id: 'e2e-stroke' }]);
});

test('compact: one sheet at a time, and tapping the map closes it', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  const open = (): Promise<string[]> => page.evaluate(() => {
    const ids = ['mobile-sheet', 'mobile-mapsheet', 'mobile-viewsheet', 'mobile-notessheet', 'mobile-toolsheet', 'mobile-selsheet', 'mobile-coloursheet'];
    return ids.filter((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
      return el != null && !el.hidden && getComputedStyle(el).display !== 'none';
    });
  });

  // The menu used to open on top of the map sheet, and the colour sheet - a
  // separate component - could sit under either of them.
  await page.locator('[data-testid="mobile-menu-btn"]').tap();
  await page.locator('[data-testid="mobile-action-map"]').tap();
  expect(await open()).toEqual(['mobile-mapsheet']);

  await page.locator('[data-testid="mobile-menu-btn"]').tap();
  expect(await open()).toEqual(['mobile-sheet']);

  await page.locator('#map-viewer').tap({ position: { x: 195, y: 150 } });
  expect(await open()).toEqual([]);

  await page.locator('[data-testid="mobile-colour-swatch"]').tap();
  expect(await open()).toEqual(['mobile-coloursheet']);
  await page.locator('[data-testid="mobile-menu-btn"]').tap();
  expect(await open()).toEqual(['mobile-sheet']);

  await page.locator('#map-viewer').tap({ position: { x: 195, y: 150 } });
  expect(await open()).toEqual([]);
});

test('compact: a dismissing tap does not edit the strat, but a tool tap still draws', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));
  const players = (): Promise<number> => page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: Array<{ players: unknown[] }>; activeFrameIdx: number } } } }).$debug;
    const s = dbg.store.get();
    return s.frames[s.activeFrameIdx]!.players.length;
  });

  // Player tool selected, menu open: the tap that closes the menu must not place
  // anything - 'swallow' on the modal-ish sheets.
  await page.locator('[data-testid="mobile-tool-place-player"]').tap();
  await page.locator('[data-testid="mobile-menu-btn"]').tap();
  const before = await players();
  await page.locator('#map-viewer').tap({ position: { x: 195, y: 300 } });
  expect(await players()).toBe(before);

  // The tool sheet is 'passthrough': it auto-opens when a tool is picked, so a tap
  // on the map places a player rather than being eaten closing the panel.
  await page.locator('[data-testid="mobile-tool-place-player"]').tap();
  await expect(page.locator('[data-testid="mobile-toolsheet"]')).toBeVisible();
  await page.locator('#map-viewer').tap({ position: { x: 195, y: 320 } });
  expect(await players()).toBe(before + 1);
});

test('compact: a selected node shows the highlight glow', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // The glow used to be painted by SelectTool, which compact never attaches, so a
  // touch selection was real in the store and completely invisible on screen.
  const tapPlayer = (): Promise<boolean> => page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { zoom: number; panX: number; panY: number; frames: Array<Record<string, unknown>>; activeFrameIdx: number; selection: unknown[] }; _apply: (p: unknown) => void } } }).$debug;
    const s = dbg.store.get();
    const idx = s.activeFrameIdx;
    dbg.store._apply({
      frames: s.frames.map((f, i) => (i === idx ? { ...f, players: [{ id: 'e2e-glow', team: 'colonist', x: 960, y: 540, name: '', dead: false }] } : f)),
      tool: 'cursor', selection: [],
    });
    const v = dbg.store.get();
    const t = document.getElementById('map-viewer')!;
    const r = t.getBoundingClientRect();
    const cx = 960 * v.zoom + (r.width - 1920 * v.zoom) / 2 + v.panX + r.left;
    const cy = 540 * v.zoom + (r.height - 1080 * v.zoom) / 2 + v.panY + r.top;
    for (const type of ['pointerdown', 'pointerup']) {
      t.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
    }
    return dbg.store.get().selection.length === 1;
  });
  expect(await tapPlayer()).toBe(true);
  await expect(page.locator('#player-layer .sel-highlight')).toHaveCount(1);

  // ...and tapping empty space takes it away again. The wait matters: inside the
  // 300ms double-tap window this second tap is a double-tap, which zooms (and
  // nulls panStart) rather than deselecting.
  await page.waitForTimeout(350);
  // (250,250) is bare map: clear of the top bar (56px), the tool rail (x<66), the
  // Discord badge, and the selection sheet that now opens along the bottom for a
  // selected player.
  await page.locator('#map-viewer').tap({ position: { x: 250, y: 250 } });
  await expect(page.locator('.sel-highlight')).toHaveCount(0);
});

test('compact: selecting a player opens an editor for it', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));

  // buildSelectionEditor returned null for players and cones, so selecting one
  // gave you an empty panel on desktop and no sheet at all on a phone.
  await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: Array<Record<string, unknown>>; activeFrameIdx: number }; _apply: (p: unknown) => void } } }).$debug;
    const s = dbg.store.get();
    const idx = s.activeFrameIdx;
    dbg.store._apply({
      frames: s.frames.map((f, i) => (i === idx ? { ...f, players: [{ id: 'e2e-edit', team: 'colonist', x: 960, y: 540, name: 'jett', dead: false }] } : f)),
      tool: 'cursor',
      selection: [{ kind: 'player', id: 'e2e-edit' }],
    });
  });

  const sheet = page.locator('[data-testid="mobile-selsheet"]');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.cp-label')).toHaveText(['TEAM', 'NAME', 'DEAD']);
  await expect(sheet.locator('input[type="text"]')).toHaveValue('jett');

  await sheet.locator('[data-team-toggle]').tap();
  const team = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: Array<{ players: Array<{ team: string }> }>; activeFrameIdx: number } } } }).$debug;
    const s = dbg.store.get();
    return s.frames[s.activeFrameIdx]!.players[0]!.team;
  });
  expect(team).toBe('reyab');

  // one undo step per change
  await page.locator('[data-testid="mobile-undo"]').tap();
  const reverted = await page.evaluate(() => {
    const dbg = (window as unknown as { $debug: { store: { get: () => { frames: Array<{ players: Array<{ team: string }> }>; activeFrameIdx: number } } } }).$debug;
    const s = dbg.store.get();
    return s.frames[s.activeFrameIdx]!.players[0]!.team;
  });
  expect(reverted).toBe('colonist');
});

// 844x390 is a phone held sideways. It hits the compact query on both clauses
// exactly like portrait does, but it also hits the short-wide band in
// styles/mobile-chrome.css: (max-height: 500px) and (min-width: 600px). In that
// band the rail wraps to two columns and the sheets become a right-hand column
// instead of a bottom band. A 1024x768 tablet is compact but NOT short-wide, so
// it keeps bottom sheets - which is why the block keys on height, not orientation.
test.describe('compact landscape', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true });

  const boot = async (page: Page): Promise<void> => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as unknown as { $debug?: unknown }).$debug));
  };

  test('every rail tool is reachable without scrolling', async ({ page }) => {
    await boot(page);
    const rail = page.locator('[data-testid="mobile-tool-rail"]');
    await expect(rail).toBeVisible();

    // The bug this guards: max-height reserved 45dvh for a bottom sheet, which on
    // a 390px-tall screen left the rail 151px and clipped 6 of its 9 buttons.
    const metrics = await rail.evaluate((el) => ({
      scrollH: el.scrollHeight,
      clientH: el.clientHeight,
      children: el.children.length,
    }));
    expect(metrics.children).toBe(9);
    expect(metrics.scrollH).toBeLessThanOrEqual(metrics.clientH);

    // Belt and braces: assert each button is actually inside the rail's box, not
    // merely that the box is tall enough for them.
    const clipped = await rail.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return Array.from(el.children).filter((k) => {
        const kr = k.getBoundingClientRect();
        return kr.top < r.top - 0.5 || kr.bottom > r.bottom + 0.5;
      }).length;
    });
    expect(clipped).toBe(0);
  });

  test('the player legend is not buried under the tool rail', async ({ page }) => {
    await boot(page);
    await seedNamedPlayers(page);
    const legend = page.locator('#player-legend');
    await expect(legend).toBeVisible();

    // Sideways the rail is two columns and 97px wide, so it covered the legend
    // completely - this is the worse of the two orientations.
    const l = (await legend.boundingBox())!;
    const rail = (await page.locator('[data-testid="mobile-tool-rail"]').boundingBox())!;
    const overlaps = l.x < rail.x + rail.width && l.x + l.width > rail.x
      && l.y < rail.y + rail.height && l.y + l.height > rail.y;
    expect(overlaps).toBe(false);

    const strip = (await page.locator('[data-testid="frame-timeline"]').boundingBox())!;
    expect(l.y + l.height).toBeLessThanOrEqual(strip.y);
  });

  test('landscape boot zoom is untouched by the portrait doubling', async ({ page }) => {
    await boot(page);
    await page.waitForTimeout(300);
    const box = (await page.locator('#map-viewer').boundingBox())!;
    const fit = Math.min(box.width / 1920, box.height / 1080);
    const zoom = await page.evaluate(() =>
      (window as unknown as { $debug: { store: { get: () => { zoom: number } } } }).$debug.store.get().zoom);
    // compactViewZoom caps at the height fit, and sideways the map is already
    // height-limited - so the doubling cannot apply and no orientation branch is
    // needed anywhere. This test is that claim.
    expect(zoom).toBeCloseTo(fit, 4);
    expect(Math.round(1920 * zoom)).toBe(693);
  });

  test('chrome bands are trimmed', async ({ page }) => {
    await boot(page);
    const bar = await page.locator('[data-testid="mobile-topbar"]').boundingBox();
    const strip = await page.locator('[data-testid="frame-timeline"]').boundingBox();
    // Both bands are smaller than the portrait ones they override (56 and 53).
    expect(bar!.height).toBeLessThan(56);
    expect(strip!.height).toBeLessThan(53);
    // 109px of a 390px axis was 28%. It measures 95 now, and 95 is close to the
    // floor: the controls are 44px tap targets and .mob-menu-btn sizes itself
    // 44px with a 1px border and no border-box, so each band is really 46-48
    // before any padding. The cap is a regression guard, not a target.
    expect(bar!.height + strip!.height).toBeLessThanOrEqual(96);
  });

  test('a sheet is a right-hand column, not a bottom band', async ({ page }) => {
    await boot(page);
    await page.locator('[data-testid="mobile-menu-btn"]').click();
    const sheet = page.locator('[data-testid="mobile-sheet"]');
    await expect(sheet).toBeVisible();

    const box = (await sheet.boundingBox())!;
    const viewer = (await page.locator('#map-viewer').boundingBox())!;
    const rail = (await page.locator('[data-testid="mobile-tool-rail"]').boundingBox())!;

    // A column on the right, not a band across the bottom. The menu and colour
    // sheets are deliberately wider than the other four (520 and 500 against
    // 400), so this checks the shape rather than one fixed width: it starts
    // clear of the rail, stops well short of full-bleed, and is taller than the
    // 176px band it replaced.
    expect(box.x).toBeGreaterThan(rail.x + rail.width);
    expect(box.width).toBeLessThanOrEqual(viewer.width * 0.65);
    expect(box.x + box.width).toBeCloseTo(viewer.width, 0);
    expect(box.height).toBeGreaterThan(250);
  });

  test('an open sheet leaves the rail, the top bar and the strip reachable', async ({ page }) => {
    await boot(page);
    await page.locator('[data-testid="mobile-menu-btn"]').click();
    const sheet = (await page.locator('[data-testid="mobile-sheet"]').boundingBox())!;

    // The invariant #41 set for the rail, now held for all three chrome regions:
    // opening a sheet must never bury a control. The old bottom sheet ran from
    // y=215 to y=391 and swallowed the whole frame strip, play button included.
    const overlaps = (b: { x: number; y: number; width: number; height: number }): boolean =>
      b.x < sheet.x + sheet.width && b.x + b.width > sheet.x &&
      b.y < sheet.y + sheet.height && b.y + b.height > sheet.y;

    for (const sel of [
      '[data-testid="mobile-tool-rail"]',
      '[data-testid="mobile-undo"]',
      '[data-testid="mobile-delete"]',
      '.frame-timeline-play',
    ]) {
      const box = await page.locator(sel).boundingBox();
      expect(box, `${sel} should be laid out`).not.toBeNull();
      expect(overlaps(box!), `${sel} must not sit under the open sheet`).toBe(false);
    }
  });

  test('the map sheet fits without scrolling', async ({ page }) => {
    await boot(page);
    await page.locator('[data-testid="mobile-menu-btn"]').click();
    await page.locator('[data-testid="mobile-action-map"]').click();
    const sheet = page.locator('[data-testid="mobile-mapsheet"]');
    await expect(sheet).toBeVisible();

    // Six maps in a 2-col grid plus the callouts row came to 292px against a
    // 176px bottom sheet. The right-hand column is nearly 300px tall.
    const m = await sheet.evaluate((el) => ({ scrollH: el.scrollHeight, clientH: el.clientHeight }));
    expect(m.scrollH).toBeLessThanOrEqual(m.clientH);
  });

  test('the colour sheet fits without scrolling', async ({ page }) => {
    await boot(page);
    await page.locator('[data-testid="mobile-colour-swatch"]').click();
    const sheet = page.locator('[data-testid="mobile-coloursheet"]');
    await expect(sheet).toBeVisible();

    // 358px of content in a 298px sheet, so the foot of the wheel and the hex
    // field were below the fold. Shrinking the wheel to fit vertically would put
    // it under 130px across, which is unusable - two columns instead.
    const m = await sheet.evaluate((el) => ({ scrollH: el.scrollHeight, clientH: el.clientHeight }));
    expect(m.scrollH).toBeLessThanOrEqual(m.clientH);

    // The wheel keeps its size; that was the whole point of going sideways.
    const wheel = (await page.locator('.mcs-wheel').boundingBox())!;
    expect(wheel.width).toBeGreaterThanOrEqual(200);

    // And it still must not bury the rail or the frame strip.
    const box = (await sheet.boundingBox())!;
    const rail = (await page.locator('[data-testid="mobile-tool-rail"]').boundingBox())!;
    expect(box.x).toBeGreaterThan(rail.x + rail.width);
  });

  test('the menu sheet shows far more of its rows', async ({ page }) => {
    await boot(page);
    await page.locator('[data-testid="mobile-menu-btn"]').click();
    const sheet = page.locator('[data-testid="mobile-sheet"]');
    await expect(sheet).toBeVisible();

    // Two columns show 7 of 13 and scroll the rest. Not all 13: grid rows line up
    // across columns and 13 rows of 44px targets need 572px however arranged.
    // A measured floor, not an exact count, so a copy change does not break this.
    //
    // Containment is checked on both axes: column-count in a fixed-height box
    // overflows sideways, and a top/bottom check alone called that 13 of 13.
    const visible = await sheet.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return Array.from(el.querySelectorAll('.mob-menu-action')).filter((k) => {
        const kr = k.getBoundingClientRect();
        return kr.top >= r.top - 0.5 && kr.bottom <= r.bottom + 0.5
          && kr.left >= r.left - 0.5 && kr.right <= r.right + 0.5;
      }).length;
    });
    expect(visible).toBeGreaterThanOrEqual(7);

    // Nothing may hide sideways: the sheet scrolls down, never across.
    const overflow = await sheet.evaluate((el) => ({ scrollW: el.scrollWidth, clientW: el.clientWidth }));
    expect(overflow.scrollW).toBeLessThanOrEqual(overflow.clientW);

    const rail = (await page.locator('[data-testid="mobile-tool-rail"]').boundingBox())!;
    const box = (await sheet.boundingBox())!;
    expect(box.x).toBeGreaterThan(rail.x + rail.width);
  });

  test('the notes textarea fills its sheet instead of overflowing it', async ({ page }) => {
    await boot(page);
    await page.locator('[data-testid="mobile-menu-btn"]').click();
    await page.locator('[data-testid="mobile-action-notes"]').click();
    const sheet = page.locator('[data-testid="mobile-notessheet"]');
    await expect(sheet).toBeVisible();

    // notes-pane.css gives .notes-pane height:100%, so it claimed the sheet's
    // whole content box and the h3 pushed the foot of the field below the fold -
    // 328px of content in a 298px sheet.
    const m = await sheet.evaluate((el) => ({ scrollH: el.scrollHeight, clientH: el.clientHeight }));
    expect(m.scrollH).toBeLessThanOrEqual(m.clientH);

    // And it should use the room, not sit at a 30vh minimum with the rest empty.
    const box = (await page.locator('[data-testid="notes-textarea"]').boundingBox())!;
    expect(box.height).toBeGreaterThan(200);
  });

  test('the side safe-area padding survives being parsed', async ({ page }) => {
    await boot(page);
    await page.locator('[data-testid="mobile-menu-btn"]').click();

    // Playwright reports every env(safe-area-inset-*) as 0, so the insets
    // themselves cannot be tested here - MANUAL-TESTS.md covers that on a device.
    // What this does catch is the failure mode that matters: one malformed max()
    // or calc() invalidates the whole padding shorthand, and the element silently
    // falls back to zero padding on every side. These are the zero-inset values.
    const read = async (sel: string): Promise<[string, string]> =>
      page.locator(sel).evaluate((el) => {
        const cs = getComputedStyle(el);
        return [cs.paddingLeft, cs.paddingRight] as [string, string];
      });

    expect(await read('[data-testid="mobile-topbar"]')).toEqual(['10px', '10px']);
    expect(await read('[data-testid="frame-timeline"]')).toEqual(['10px', '10px']);
    expect(await read('[data-testid="mobile-sheet"]')).toEqual(['12px', '12px']);
  });

  test('the six sheets still open, close and exclude each other', async ({ page }) => {
    await boot(page);
    const menu = page.locator('[data-testid="mobile-sheet"]');
    const map = page.locator('[data-testid="mobile-mapsheet"]');

    await page.locator('[data-testid="mobile-menu-btn"]').click();
    await expect(menu).toBeVisible();

    // Opening the map sheet from the menu launcher must tear the menu down -
    // sheetManager holds at most one. Both sheets share the same anchor, so a
    // stale one would sit underneath with its controls unreachable.
    await page.locator('[data-testid="mobile-action-map"]').click();
    await expect(map).toBeVisible();
    await expect(menu).toHaveCount(0);

    // Escape closes whatever is open.
    await page.keyboard.press('Escape');
    await expect(map).toHaveCount(0);

    // The colour sheet is MobileColourSheet's, not MobileChrome's, and shares the
    // same manager. 350ms clear of the previous tap so it is not read as a
    // double-tap on the map underneath.
    await page.waitForTimeout(350);
    await page.locator('[data-testid="mobile-colour-swatch"]').click();
    await expect(page.locator('[data-testid="mobile-coloursheet"]')).toBeVisible();
  });
});
