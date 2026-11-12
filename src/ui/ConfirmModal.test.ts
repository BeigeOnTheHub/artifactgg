import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, type StratState } from '../app/store';
import { ConfirmModal } from './ConfirmModal';
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

describe('ConfirmModal', () => {
  let host: HTMLDivElement;
  let store: ReturnType<typeof createStore>;
  let modal: ConfirmModal;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore(initialState());
    modal = new ConfirmModal(host, store);
    modal.mount();
  });

  afterEach(() => {
    modal.destroy();
    if (host.parentElement) host.parentElement.removeChild(host);
  });

  it('renders nothing when confirmOpen is null', () => {
    expect(host.querySelector('.confirm-modal')).toBeNull();
  });

  it('renders the modal when confirmOpen has a payload', () => {
    const ui = store.get().ui;
    store._apply({ ui: { ...ui, confirmOpen: {
      kind: 'discard', title: 'Discard?', body: 'Sure?', confirmLabel: 'Discard', onConfirm: vi.fn(),
    }}});
    const modalEl = host.querySelector('.confirm-modal');
    expect(modalEl).not.toBeNull();
    expect(host.querySelector('.confirm-modal-title')!.textContent).toBe('Discard?');
    expect(host.querySelector('.confirm-modal-body')!.textContent).toBe('Sure?');
    expect((host.querySelector('.confirm-modal-confirm') as HTMLButtonElement).textContent).toBe('Discard');
  });

  it('applies kind-specific class on the confirm button', () => {
    const ui = store.get().ui;
    store._apply({ ui: { ...ui, confirmOpen: {
      kind: 'delete-strat', title: 'X', body: 'Y', confirmLabel: 'Delete', onConfirm: vi.fn(),
    }}});
    const btn = host.querySelector('.confirm-modal-confirm') as HTMLButtonElement;
    expect(btn.classList.contains('confirm-modal-confirm--delete-strat')).toBe(true);
  });

  it('cancel button closes without invoking onConfirm', () => {
    const onConfirm = vi.fn();
    const ui = store.get().ui;
    store._apply({ ui: { ...ui, confirmOpen: {
      kind: 'discard', title: 'X', body: 'Y', confirmLabel: 'Z', onConfirm,
    }}});
    (host.querySelector('.confirm-modal-cancel') as HTMLButtonElement).click();
    expect(store.get().ui.confirmOpen).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirm button invokes onConfirm and closes', () => {
    const onConfirm = vi.fn();
    const ui = store.get().ui;
    store._apply({ ui: { ...ui, confirmOpen: {
      kind: 'discard', title: 'X', body: 'Y', confirmLabel: 'Z', onConfirm,
    }}});
    (host.querySelector('.confirm-modal-confirm') as HTMLButtonElement).click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(store.get().ui.confirmOpen).toBeNull();
  });

  it('clicking the backdrop closes without invoking onConfirm', () => {
    const onConfirm = vi.fn();
    const ui = store.get().ui;
    store._apply({ ui: { ...ui, confirmOpen: {
      kind: 'discard', title: 'X', body: 'Y', confirmLabel: 'Z', onConfirm,
    }}});
    (host.querySelector('.confirm-modal-backdrop') as HTMLDivElement).click();
    expect(store.get().ui.confirmOpen).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('clicking inside the modal panel does not close', () => {
    const onConfirm = vi.fn();
    const ui = store.get().ui;
    store._apply({ ui: { ...ui, confirmOpen: {
      kind: 'discard', title: 'X', body: 'Y', confirmLabel: 'Z', onConfirm,
    }}});
    (host.querySelector('.confirm-modal-panel') as HTMLDivElement).click();
    expect(store.get().ui.confirmOpen).not.toBeNull();
  });

  it('open panel carries role=dialog, aria-modal, and aria-labelledby', () => {
    const ui = store.get().ui;
    store._apply({ ui: { ...ui, confirmOpen: {
      kind: 'discard', title: 'Discard?', body: 'Y', confirmLabel: 'Z', onConfirm: () => {},
    }}});
    const panel = host.querySelector<HTMLDivElement>('.confirm-modal-panel')!;
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    const labelledby = panel.getAttribute('aria-labelledby');
    expect(labelledby).toBeTruthy();
    const title = document.getElementById(labelledby!);
    expect(title?.textContent).toBe('Discard?');
  });

  it('focus restores to the trigger element when the modal closes', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const ui = store.get().ui;
    store._apply({ ui: { ...ui, confirmOpen: {
      kind: 'discard', title: 'X', body: 'Y', confirmLabel: 'Z', onConfirm: () => {},
    }}});
    expect(document.activeElement).not.toBe(trigger);
    store._apply({ ui: { ...store.get().ui, confirmOpen: null } });
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
