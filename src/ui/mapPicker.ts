import type { Store } from '../app/store';
import type { History } from '../app/history';
import { announce } from '../app/announcer';
import { MAPS, mapSupportsCallouts, type MapId } from '../types/maps';

export interface MapPickerOpts {
  /** Runs after the map.select dispatch. Desktop closes the dropdown; mobile
   *  closes the sheet and refits the view. */
  onSelect?: (id: MapId) => void;
}

/**
 * The map listbox: one option per map plus the CALLOUTS toggle row, shared by
 * the desktop dropdown and the mobile Map sheet. The returned element is the
 * listbox itself so the role="option" rows stay direct children. Showing and
 * hiding it is the caller's job.
 */
export function buildMapPicker(
  store: Store,
  history: History,
  opts: MapPickerOpts = {},
): { el: HTMLElement; destroy: () => void } {
  const list = document.createElement('div');
  list.className = 'map-dropdown-list';
  list.setAttribute('role', 'listbox');

  const rows = new Map<MapId, HTMLElement>();

  for (const m of MAPS) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'map-dropdown-row';
    row.setAttribute('role', 'option');
    row.dataset['mapid'] = m.id;

    const thumb = document.createElement('img');
    thumb.className = 'map-dropdown-thumb';
    thumb.src = `${import.meta.env.BASE_URL}${m.folder}/thumbnail.png`;
    thumb.alt = '';
    thumb.draggable = false;

    const label = document.createElement('span');
    label.className = 'map-dropdown-label';
    label.textContent = m.name;

    row.appendChild(thumb);
    row.appendChild(label);

    // WIP maps stay selectable (Kiiro is playable, just rough) - the badge
    // only flags that bits of them are not final.
    if (m.wip) {
      const badge = document.createElement('span');
      badge.className = 'map-dropdown-wip-badge';
      badge.textContent = 'WIP';
      row.appendChild(badge);
      row.title = 'Work in progress - playable, but some bits aren\'t final';
    }

    row.addEventListener('click', () => {
      history.dispatch({ t: 'map.select', mapId: m.id });
      announce(`${m.name} map selected`);
      opts.onSelect?.(m.id);
    });

    list.appendChild(row);
    rows.set(m.id, row);
  }

  const calloutsRow = document.createElement('button');
  calloutsRow.type = 'button';
  calloutsRow.className = 'map-dropdown-callouts-row';

  const calloutsLabel = document.createElement('span');
  calloutsLabel.className = 'map-dropdown-callouts-label';
  calloutsLabel.textContent = 'CALLOUTS';

  const calloutsPill = document.createElement('span');
  calloutsPill.className = 'map-dropdown-callouts-pill';
  calloutsPill.textContent = 'ON';

  calloutsRow.appendChild(calloutsLabel);
  calloutsRow.appendChild(calloutsPill);
  calloutsRow.addEventListener('click', (e) => {
    e.stopPropagation();
    // No callouts on maps where they are still being worked on (e.g. Kiiro).
    if (!mapSupportsCallouts(store.get().mapId)) return;
    history.dispatch({ t: 'callouts.toggle', visible: !store.get().ui.calloutsVisible });
  });
  list.appendChild(calloutsRow);

  const syncActiveRow = (): void => {
    const active = store.get().mapId;
    for (const [id, row] of rows) row.classList.toggle('active', id === active);
  };

  const syncCalloutsRow = (): void => {
    if (!mapSupportsCallouts(store.get().mapId)) {
      calloutsPill.textContent = 'OFF';
      calloutsRow.setAttribute('aria-pressed', 'false');
      calloutsRow.disabled = true;
      calloutsRow.setAttribute('aria-disabled', 'true');
      calloutsRow.title = 'Callouts aren\'t ready on this map yet';
      return;
    }
    calloutsRow.disabled = false;
    calloutsRow.removeAttribute('aria-disabled');
    calloutsRow.removeAttribute('title');
    const v = store.get().ui.calloutsVisible;
    calloutsPill.textContent = v ? 'ON' : 'OFF';
    calloutsRow.setAttribute('aria-pressed', String(v));
  };

  syncActiveRow();
  syncCalloutsRow();

  // The callouts row enables/disables per map, so it refreshes on a switch too.
  const unsubMap = store.subscribe(['mapId'], () => {
    syncActiveRow();
    syncCalloutsRow();
  });
  const unsubUi = store.subscribe(['ui'], syncCalloutsRow);

  return {
    el: list,
    destroy: (): void => {
      unsubMap();
      unsubUi();
      rows.clear();
    },
  };
}
