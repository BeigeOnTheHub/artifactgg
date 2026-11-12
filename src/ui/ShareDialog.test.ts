import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { createStore, type StratState } from '../app/store';
import { ShareDialog } from './ShareDialog';
import { emptyFrame } from '../types/primitives';
import { hex } from '../types/hex';
import type { StratFile } from '../types/stratFile';

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

function makeFile(): StratFile {
  return {
    v: 2, map: 'miru', notes: '',
    view: { zoom: 1, panX: 0, panY: 0 },
    frames: [emptyFrame()], activeFrame: 0,
  };
}

describe('ShareDialog', () => {
  let host: HTMLElement;
  let store: ReturnType<typeof createStore>;
  let dialog: ShareDialog;
  let getStratFile: Mock<() => StratFile>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore(initialState());
    getStratFile = vi.fn(() => makeFile());
    dialog = new ShareDialog(host, store, { getStratFile });
    dialog.mount();
  });

  afterEach(() => {
    dialog.destroy();
    if (host.parentElement) host.parentElement.removeChild(host);
  });

  function open(): void {
    const ui = store.get().ui;
    store._apply({ ui: { ...ui, shareOpen: true } });
  }

  it('renders nothing when shareOpen is false', () => {
    expect(host.querySelector('.share-dialog')).toBeNull();
  });

  it('renders a hash-link URL synchronously on open', () => {
    open();
    expect(host.querySelector('.share-dialog')).not.toBeNull();
    const url = (host.querySelector('.share-dialog-url') as HTMLInputElement).value;
    expect(url).toContain('/#s=');
    expect(getStratFile).toHaveBeenCalled();
  });

  it('shows no upload/QR/delete affordances', () => {
    open();
    expect(host.querySelector('.share-dialog-notice')).toBeNull();
    expect(host.querySelector('.share-dialog-qr')).toBeNull();
    expect(host.querySelector('.share-dialog-delete')).toBeNull();
    expect(host.querySelector('.share-dialog-loading')).toBeNull();
    expect(host.querySelector('.share-dialog-original')).toBeNull();
  });

  it('Copy button calls navigator.clipboard.writeText with the URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    open();
    (host.querySelector('.share-dialog-copy') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/#s='));
  });

  it('Done button closes via _apply', () => {
    open();
    (host.querySelector('.share-dialog-done') as HTMLButtonElement).click();
    expect(store.get().ui.shareOpen).toBe(false);
  });

  it('re-opening after close re-encodes the strat', () => {
    open();
    (host.querySelector('.share-dialog-done') as HTMLButtonElement).click();
    open();
    expect(host.querySelector('.share-dialog')).not.toBeNull();
    expect(getStratFile).toHaveBeenCalledTimes(2);
  });

  it('Backdrop click closes', () => {
    open();
    (host.querySelector('.share-dialog-backdrop') as HTMLDivElement).click();
    expect(store.get().ui.shareOpen).toBe(false);
  });

  it('Panel click does not close (stopPropagation)', () => {
    open();
    (host.querySelector('.share-dialog-panel') as HTMLDivElement).click();
    expect(store.get().ui.shareOpen).toBe(true);
  });
});
