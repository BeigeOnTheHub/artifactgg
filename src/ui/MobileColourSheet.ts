import type { Store } from '../app/store';
import type { History } from '../app/history';
import { hex, type Hex } from '../types/hex';
import { hexToRgb, rgbToHex, rgbToHsb, hsbToRgb, type HSB } from '../app/colour';
import { paintWheel, wheelPointToHsb } from './colourWheel';
import { insulateChromePointerEvents } from './touchChrome';
import { createSheetManager, type SheetManager } from './sheetManager';

/** px - the touch HS wheel. Was 240, which made the colour sheet 59% of a
 *  390x844 phone. refreshCursor() positions the cursor in CSS px off this
 *  constant, so it must stay in sync with `.mcs-wheel` / `.mcs-wheel-canvas` in
 *  styles/mobile-chrome.css or the cursor lands outside the wheel. */
const WHEEL_SIZE = 200;

/**
 * The compact touch colour sheet: a bottom sheet with the five
 * colour slots, an enlarged HS wheel, the brightness slider and the hex
 * input. Store-driven open via `ui.colourPickerOpen` (the rail's foot swatch
 * sets it). Live-preview via `_apply`, a single `colour.set` command on
 * release - identical semantics to the desktop ColourPicker.
 */
export class MobileColourSheet {
  private root: HTMLDivElement;
  private slotButtons: HTMLButtonElement[] = [];
  private wheelCanvas!: HTMLCanvasElement;
  private wheelCursor!: HTMLDivElement;
  private brightnessSlider!: HTMLInputElement;
  private hexInput!: HTMLInputElement;
  private hsb: HSB = { h: 140, s: 1, b: 1 };
  private wheelDragging = false;
  private dragSnapshotBefore: Hex | null = null;
  private offColours: () => void = () => {};
  private offUi: () => void = () => {};

  /**
   * `sheets` is the manager MobileChrome shares (main.ts builds one), so this sheet
   * and the five over there are mutually exclusive - it used to be a separate
   * component with its own open flag, and could sit open underneath the menu.
   * Optional so the unit tests can construct it alone.
   */
  constructor(
    private host: HTMLElement,
    private store: Store,
    private history: History,
    private sheets: SheetManager = createSheetManager(),
  ) {
    this.root = document.createElement('div');
    this.root.className = 'mob-sheet mob-coloursheet';
    this.root.dataset['testid'] = 'mobile-coloursheet';
    this.root.hidden = true;
  }

  mount(): void {
    this.buildDom();
    this.host.appendChild(this.root);
    insulateChromePointerEvents(this.root);
    this.syncFromStore();
    this.syncOpenState();
    this.offColours = this.store.subscribe(['colourSlots', 'activeSlot'], () => this.syncFromStore());
    this.offUi = this.store.subscribe(['ui'], () => this.syncOpenState());
  }

  destroy(): void {
    this.offColours();
    this.offUi();
    // Deregister, or the manager keeps a record pointing at a dead sheet and its
    // document-level dismiss listener stays live - swallowing every later tap.
    if (this.sheets.current() === this.root) this.sheets.close();
    this.root.remove();
  }

  private buildDom(): void {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'mob-menu-btn mob-coloursheet-close';
    close.dataset['testid'] = 'mobile-coloursheet-close';
    close.setAttribute('aria-label', 'Close colour picker');
    // Glyph, matching buildMobileSheet's close button - this sheet predates that
    // helper and builds its own chrome, so it has to be kept in step by hand. The
    // shared CSS gives every *sheet-close a 36px corner box, which the word
    // 'Close' overflows.
    close.textContent = '×';
    close.addEventListener('click', () => this.setOpen(false));

    const slotRow = document.createElement('div');
    slotRow.className = 'mcs-slots';
    for (let i = 0; i < 5; i++) {
      const idx = i as 0 | 1 | 2 | 3 | 4;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mcs-slot';
      b.dataset['slot'] = String(idx);
      b.dataset['testid'] = `mobile-colour-slot-${idx}`;
      b.setAttribute('aria-label', `Colour slot ${idx + 1}`);
      b.addEventListener('click', () => this.store._apply({ activeSlot: idx }));
      slotRow.appendChild(b);
      this.slotButtons.push(b);
    }

    const wheelWrap = document.createElement('div');
    wheelWrap.className = 'mcs-wheel';
    this.wheelCanvas = document.createElement('canvas');
    this.wheelCanvas.className = 'mcs-wheel-canvas';
    this.wheelCanvas.width = WHEEL_SIZE;
    this.wheelCanvas.height = WHEEL_SIZE;
    this.wheelCanvas.setAttribute('aria-label', 'Hue/saturation wheel');
    paintWheel(this.wheelCanvas);
    this.wheelCursor = document.createElement('div');
    this.wheelCursor.className = 'mcs-wheel-cursor';
    wheelWrap.append(this.wheelCanvas, this.wheelCursor);

    const onWheelDown = (e: PointerEvent): void => {
      this.wheelDragging = true;
      this.dragSnapshotBefore = this.activeColour();
      try { this.wheelCanvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this.onWheel(e);
    };
    const onWheelMove = (e: PointerEvent): void => { if (this.wheelDragging) this.onWheel(e); };
    const onWheelUp = (e: PointerEvent): void => {
      if (!this.wheelDragging) return;
      this.wheelDragging = false;
      try { this.wheelCanvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      this.commitFromHsb();
    };
    this.wheelCanvas.addEventListener('pointerdown', onWheelDown);
    this.wheelCanvas.addEventListener('pointermove', onWheelMove);
    this.wheelCanvas.addEventListener('pointerup', onWheelUp);
    this.wheelCanvas.addEventListener('pointercancel', onWheelUp);

    this.brightnessSlider = document.createElement('input');
    this.brightnessSlider.type = 'range';
    this.brightnessSlider.min = '0';
    this.brightnessSlider.max = '100';
    this.brightnessSlider.value = '100';
    this.brightnessSlider.className = 'mcs-brightness';
    this.brightnessSlider.setAttribute('aria-label', 'Brightness');
    this.brightnessSlider.addEventListener('pointerdown', () => {
      this.dragSnapshotBefore = this.activeColour();
    });
    this.brightnessSlider.addEventListener('input', () => {
      this.hsb = { ...this.hsb, b: Number(this.brightnessSlider.value) / 100 };
      this.previewLiveFromHsb();
    });
    this.brightnessSlider.addEventListener('change', () => this.commitFromHsb());

    const hexRow = document.createElement('div');
    hexRow.className = 'mcs-hex-row';
    const hash = document.createElement('span');
    hash.textContent = '#';
    this.hexInput = document.createElement('input');
    this.hexInput.type = 'text';
    this.hexInput.className = 'mcs-hex';
    this.hexInput.maxLength = 6;
    this.hexInput.spellcheck = false;
    this.hexInput.setAttribute('aria-label', 'Hex colour value');
    this.hexInput.addEventListener('change', () => this.commitHex());
    hexRow.append(hash, this.hexInput);

    this.root.append(close, slotRow, wheelWrap, this.brightnessSlider, hexRow);
  }

  private setOpen(open: boolean): void {
    const ui = this.store.get().ui;
    if (ui.colourPickerOpen === open) return;
    this.store._apply({ ui: { ...ui, colourPickerOpen: open } });
  }

  /**
   * Open state is store-driven (`ui.colourPickerOpen`), so registering happens here
   * rather than at the tap site. onClose writes the flag back through setOpen, which
   * keeps the store and the manager in step whichever end closed it - the manager
   * clears its record before calling onClose, so this cannot recurse.
   */
  private syncOpenState(): void {
    const open = this.store.get().ui.colourPickerOpen === true;
    this.root.hidden = !open;
    if (open && this.sheets.current() !== this.root) {
      this.sheets.open({ el: this.root, onClose: () => this.setOpen(false), dismiss: 'swallow' });
    } else if (!open && this.sheets.current() === this.root) {
      this.sheets.close();
    }
  }

  private activeColour(): Hex | null {
    const s = this.store.get();
    return s.colourSlots[s.activeSlot] ?? null;
  }

  /** Pointer event on the wheel canvas -> (h, s) -> live update. */
  private onWheel(e: PointerEvent): void {
    const rect = this.wheelCanvas.getBoundingClientRect();
    const dx = e.clientX - rect.left - rect.width / 2;
    const dy = e.clientY - rect.top - rect.height / 2;
    this.hsb = wheelPointToHsb(dx, dy, rect.width / 2, this.hsb.b);
    this.previewLiveFromHsb();
  }

  /** Live-preview a colour update via _apply from the current HSB state. */
  private previewLiveFromHsb(): void {
    const nextHex = rgbToHex(hsbToRgb(this.hsb));
    const slots = [...this.store.get().colourSlots];
    slots[this.store.get().activeSlot] = nextHex;
    this.store._apply({ colourSlots: slots });
    this.refreshCursor();
  }

  /** Finalise an in-flight HSB change with one undoable colour.set command. */
  private commitFromHsb(): void {
    const before = this.dragSnapshotBefore;
    this.dragSnapshotBefore = null;
    const after = this.activeColour();
    if (before == null || after == null || after === before) return;
    const slot = this.store.get().activeSlot;
    const slots = [...this.store.get().colourSlots];
    slots[slot] = before;
    this.store._apply({ colourSlots: slots });
    this.history.dispatch({ t: 'colour.set', slot, before, after });
  }

  private commitHex(): void {
    const rgb = hexToRgb(this.hexInput.value.trim());
    if (!rgb) { this.syncFromStore(); return; }
    const after = rgbToHex(rgb);
    const before = this.activeColour();
    if (before == null || after === before) { this.syncFromStore(); return; }
    this.history.dispatch({ t: 'colour.set', slot: this.store.get().activeSlot, before, after });
  }

  private syncFromStore(): void {
    const s = this.store.get();
    this.slotButtons.forEach((btn, i) => {
      const c = s.colourSlots[i] ?? null;
      btn.style.backgroundColor = c ?? '';
      btn.classList.toggle('active', i === s.activeSlot);
      btn.classList.toggle('empty', c == null);
    });
    const c = this.activeColour() ?? hex('#000000');
    const rgb = hexToRgb(c) ?? { r: 0, g: 0, b: 0 };
    this.hexInput.value = c.replace(/^#/, '');
    // Avoid clobbering an in-flight wheel/slider drag.
    if (!this.wheelDragging) this.hsb = rgbToHsb(rgb);
    if (!this.brightnessSlider.matches(':active')) {
      this.brightnessSlider.value = String(Math.round(this.hsb.b * 100));
    }
    this.refreshCursor();
  }

  private refreshCursor(): void {
    const radius = WHEEL_SIZE / 2;
    const a = this.hsb.h * Math.PI / 180;
    const r = this.hsb.s * radius;
    this.wheelCursor.style.left = `${radius + Math.cos(a) * r}px`;
    this.wheelCursor.style.top = `${radius + Math.sin(a) * r}px`;
  }
}
