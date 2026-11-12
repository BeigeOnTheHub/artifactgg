import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChangelogModal } from './ChangelogModal';
import { APP_VERSION } from '../app/version';
import { createStore, type StratState } from '../app/store';
import { emptyFrame } from '../types/primitives';
import { hex } from '../types/hex';

function initialState(): StratState {
  return {
    mapId: 'miru', zoom: 1, panX: 0, panY: 0,
    frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '', tool: 'cursor',
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
}

describe('ChangelogModal', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let modal: ChangelogModal;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore(initialState());
    modal = new ChangelogModal(host, store);
    modal.mount();
  });

  afterEach(() => {
    modal.destroy();
    document.body.removeChild(host);
  });

  it('mounts hidden by default', () => {
    const root = host.querySelector<HTMLElement>('.changelog-modal');
    expect(root).not.toBeNull();
    expect(root!.hidden).toBe(true);
  });

  it('opens when state.ui.changelogOpen flips to true', () => {
    store._apply({ ui: { ...store.get().ui, changelogOpen: true } });
    const root = host.querySelector<HTMLElement>('.changelog-modal');
    expect(root!.hidden).toBe(false);
  });

  it('renders the parsed changelog HTML body inside .changelog-modal-body', () => {
    store._apply({ ui: { ...store.get().ui, changelogOpen: true } });
    const body = host.querySelector('.changelog-modal-body');
    expect(body).not.toBeNull();
    // Against APP_VERSION rather than a literal. The changelog body is rewritten
    // each release and this used to hardcode the number, so it failed on the
    // version bump itself - and worse, it would have passed happily if someone
    // bumped APP_VERSION and forgot to write the changelog, which is the thing
    // actually worth catching. The modal auto-opens on a version it does not
    // describe otherwise.
    expect(body!.querySelector('h2')?.textContent).toContain(APP_VERSION);
  });

  it('clicking the close button flips changelogOpen to false', () => {
    store._apply({ ui: { ...store.get().ui, changelogOpen: true } });
    const closeBtn = host.querySelector<HTMLButtonElement>('.changelog-modal-close');
    closeBtn?.click();
    expect(store.get().ui.changelogOpen).toBe(false);
  });

  it('clicking the backdrop flips changelogOpen to false', () => {
    store._apply({ ui: { ...store.get().ui, changelogOpen: true } });
    const backdrop = host.querySelector<HTMLElement>('.changelog-modal-backdrop');
    backdrop?.click();
    expect(store.get().ui.changelogOpen).toBe(false);
  });

  it('clicking inside the modal panel does NOT close it', () => {
    store._apply({ ui: { ...store.get().ui, changelogOpen: true } });
    const panel = host.querySelector<HTMLElement>('.changelog-modal-panel');
    panel?.click();
    expect(store.get().ui.changelogOpen).toBe(true);
  });

  it('destroy() unsubscribes and removes DOM', () => {
    modal.destroy();
    expect(host.querySelector('.changelog-modal')).toBeNull();
    modal = new ChangelogModal(host, store);
    modal.mount();
  });
});
