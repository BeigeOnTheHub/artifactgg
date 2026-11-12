import type { Store } from '../app/store';
import type { History } from '../app/history';
import type { SelectionRef } from '../types/primitives';
import { deleteRefs, duplicate } from '../app/clipboard';
import { mergeRefs } from '../app/selection';
import { insulateChromePointerEvents } from './touchChrome';
import type { SheetManager } from './sheetManager';

/** Gap between the press point and the menu, so a finger does not cover it. */
const OFFSET_PX = 12;
/** Keep the menu this far inside the viewer when a press lands near an edge. */
const EDGE_MARGIN_PX = 8;

export interface ItemActionMenuDeps {
  store: Store;
  history: History;
  /** The compact chrome host (`#map-viewer`), which is the positioning context. */
  host: HTMLElement;
  /**
   * Shared with every bottom sheet. The menu is a popover rather than a sheet,
   * but registering here is what gives it tap-outside, Escape, and "only one
   * thing open at a time" without a second copy of any of them - and stops it
   * opening underneath a sheet that is already up.
   */
  sheets: SheetManager;
}

/**
 * The per-item action menu: a popover at the finger, opened by holding an item
 * on touch. Right-click covers this on desktop; touch needed its own route
 * because a long-press `contextmenu` used to just delete the node unconfirmed.
 */
export function openItemActionMenu(
  ref: SelectionRef, clientX: number, clientY: number, deps: ItemActionMenuDeps,
): HTMLDivElement {
  const { store, history, host, sheets } = deps;

  const menu = document.createElement('div');
  menu.className = 'mob-itemmenu';
  menu.dataset['testid'] = 'mobile-itemmenu';
  menu.setAttribute('role', 'menu');
  insulateChromePointerEvents(menu);

  const close = (): void => sheets.close();

  const row = (label: string, testid: string, onPick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mob-itemmenu-row';
    b.dataset['testid'] = testid;
    b.setAttribute('role', 'menuitem');
    b.textContent = label;
    b.addEventListener('click', () => { onPick(); close(); });
    return b;
  };

  menu.append(
    row('Delete', 'mobile-itemmenu-delete', () => {
      deleteRefs(store, history, [ref]);
    }),
    row('Duplicate', 'mobile-itemmenu-duplicate', () => {
      // duplicate() works on whatever is selected, so point the selection at
      // this item first - holding an item that was not selected should still
      // duplicate the one you held.
      store._apply({ selection: [ref] });
      duplicate(store, history);
    }),
    row('Add to selection', 'mobile-itemmenu-add', () => {
      // Turning the mode on here is what let the multi-select toggle leave the
      // top bar: the following taps keep toggling membership, and a tap on
      // empty space leaves the mode again.
      const s = store.get();
      store._apply({
        selection: mergeRefs(s.selection, [ref]),
        ui: { ...s.ui, touchMultiSelect: true },
      });
    }),
  );

  host.appendChild(menu);
  positionWithin(menu, host, clientX, clientY);

  sheets.open({
    el: menu,
    // Capture the element rather than reading a field: opening another sheet
    // must not let a stale record tear down its replacement.
    onClose: () => menu.remove(),
    // Swallow, so dismissing the menu can never also edit the strat - the map
    // is directly underneath it.
    dismiss: 'swallow',
  });
  return menu;
}

/**
 * Place the menu near the press point, then pull it back inside the host if it
 * would hang off an edge. A press near the right edge is the common case: on a
 * 390px phone a 160px menu opened at x=320 would be half off-screen.
 */
function positionWithin(menu: HTMLElement, host: HTMLElement, clientX: number, clientY: number): void {
  const hostBox = host.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;

  let left = clientX - hostBox.left + OFFSET_PX;
  let top = clientY - hostBox.top + OFFSET_PX;

  const maxLeft = hostBox.width - w - EDGE_MARGIN_PX;
  const maxTop = hostBox.height - h - EDGE_MARGIN_PX;
  // Flip to the other side of the finger rather than just clamping, so the menu
  // does not end up sitting under the hand that opened it.
  if (left > maxLeft) left = clientX - hostBox.left - w - OFFSET_PX;
  if (top > maxTop) top = clientY - hostBox.top - h - OFFSET_PX;

  menu.style.left = `${Math.max(EDGE_MARGIN_PX, Math.min(left, Math.max(EDGE_MARGIN_PX, maxLeft)))}px`;
  menu.style.top = `${Math.max(EDGE_MARGIN_PX, Math.min(top, Math.max(EDGE_MARGIN_PX, maxTop)))}px`;
}
