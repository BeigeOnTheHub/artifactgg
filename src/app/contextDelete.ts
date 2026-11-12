import type { Store } from './store';
import type { History } from './history';
import type { SelectionRef } from '../types/primitives';
import { clientToMap, type Viewport } from '../render/coords';
import { hitTestPoint } from './selectionMove';
import { deleteRefs } from './clipboard';

export interface ContextDeleteDeps {
  store: Store;
  history: History;
  getViewport: () => Viewport;
}

/**
 * Right-click a node to delete just that node, under any tool, no prior
 * selection needed. Picks the topmost node under the cursor (same node-then-
 * stroke order and screen-constant hit radii as SelectTool's cursor hit-test),
 * deletes it as one undo step, and swallows the browser context menu over the
 * map. Right-clicking empty space is a no-op (the menu is still suppressed).
 */
export function installContextDelete(viewer: HTMLElement, deps: ContextDeleteDeps): () => void {
  // A long press on Android raises `contextmenu`, which must not delete without
  // confirmation; that gesture belongs to ui/ItemActionMenu.ts. The guard is here
  // and not in the boot profile because compact is `(pointer: coarse),
  // (max-width: 900px)`, so a narrow desktop window with a mouse counts as touch
  // too. Only the pointer that opened the menu tells them apart.
  let lastPointerType = 'mouse';
  const onPointerDown = (e: PointerEvent): void => { lastPointerType = e.pointerType || 'mouse'; };

  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    if (lastPointerType === 'touch' || lastPointerType === 'pen') return;
    const v = deps.getViewport();
    const mp = clientToMap(e.clientX, e.clientY, v);
    const z = Math.max(0.001, v.zoom);
    // 8 for strokes, 16 for everything else.
    const ref: SelectionRef | null = hitTestPoint(deps.store.get(), mp, 16 / z, 8 / z);
    if (ref) deleteRefs(deps.store, deps.history, [ref]);
  };
  // Capture, so the pointer type is recorded even where something downstream
  // stops propagation (TouchViewportController is on the same element).
  viewer.addEventListener('pointerdown', onPointerDown, true);
  viewer.addEventListener('contextmenu', onContextMenu);
  return () => {
    viewer.removeEventListener('pointerdown', onPointerDown, true);
    viewer.removeEventListener('contextmenu', onContextMenu);
  };
}
