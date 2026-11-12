import '../styles/colour-picker.css';
import type { Store } from '../app/store';
import type { History } from '../app/history';
import { register as registerOutsideClick } from '../app/outsideClick';
import { hex, type Hex } from '../types/hex';
import { hexToRgb, rgbToHex, rgbToHsb, hsbToRgb, type HSB } from '../app/colour';
import { paintWheel, wheelPointToHsb } from './colourWheel';

const WHEEL_SIZE = 200; // px - square HS wheel (hue around the rim, saturation toward centre)

export class ColourPicker {
  private root: HTMLElement;
  private hexInput!: HTMLInputElement;
  private wheelCanvas!: HTMLCanvasElement;
  private wheelCursor!: HTMLDivElement;
  private brightnessSlider!: HTMLInputElement;
  private brightnessTrack!: HTMLDivElement;
  private preview!: HTMLElement;
  private hsb: HSB = { h: 140, s: 1, b: 1 };
  private wheelDragging = false;
  private dragSnapshotBefore: Hex | null = null;
  private unsubColours: () => void = () => {};
  private unsubUi: () => void = () => {};
  private offDocMouseDown: () => void = () => {};

  constructor(
    private host: HTMLElement,
    private store: Store,
    private history: History,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'colour-picker';
    this.root.hidden = true;
  }

  mount(): void {
    this.host.appendChild(this.root);
    this.buildDom();
    this.syncFromStore();
    this.syncOpenState();

    this.unsubColours = this.store.subscribe(['colourSlots', 'activeSlot'], () => this.syncFromStore());
    this.unsubUi = this.store.subscribe(['ui'], () => this.syncOpenState());

    this.offDocMouseDown = registerOutsideClick(
      (target) => {
        if (!this.store.get().ui.colourPickerOpen) return true;
        const node = target as Element | null;
        if (!node) return false;
        if (this.root.contains(node)) return true;
        // The colour-slot row is allowed to keep the picker open - clicking
        // another slot switches the active slot, the picker should follow it
        // instead of flashing closed and re-opening on the click.
        if (node.closest?.('.colour-slots')) return true;
        return false;
      },
      () => this.setOpen(false),
    );
  }

  destroy(): void {
    this.unsubColours();
    this.unsubUi();
    this.offDocMouseDown();
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
  }

  private setOpen(open: boolean): void {
    const ui = this.store.get().ui;
    if (ui.colourPickerOpen === open) return;
    this.store._apply({ ui: { ...ui, colourPickerOpen: open } });
  }

  private buildDom(): void {
    while (this.root.firstChild) this.root.removeChild(this.root.firstChild);

    // Preview swatch + hex input row
    const headRow = document.createElement('div');
    headRow.className = 'cp-head';

    this.preview = document.createElement('div');
    this.preview.className = 'cp-preview';

    const hash = document.createElement('span');
    hash.className = 'cp-hash';
    hash.textContent = '#';

    this.hexInput = document.createElement('input');
    this.hexInput.type = 'text';
    this.hexInput.className = 'cp-hex-input';
    this.hexInput.maxLength = 6;
    this.hexInput.spellcheck = false;
    this.hexInput.setAttribute('aria-label', 'Hex colour value');
    this.hexInput.addEventListener('change', () => this.commitHex());

    headRow.appendChild(this.preview);
    headRow.appendChild(hash);
    headRow.appendChild(this.hexInput);

    // HS wheel (hue around rim, saturation toward centre).
    const wheelWrap = document.createElement('div');
    wheelWrap.className = 'cp-wheel';
    this.wheelCanvas = document.createElement('canvas');
    this.wheelCanvas.className = 'cp-wheel-canvas';
    this.wheelCanvas.width = WHEEL_SIZE;
    this.wheelCanvas.height = WHEEL_SIZE;
    this.wheelCanvas.setAttribute('aria-label', 'Hue/saturation wheel');
    paintWheel(this.wheelCanvas);
    this.wheelCursor = document.createElement('div');
    this.wheelCursor.className = 'cp-wheel-cursor';
    wheelWrap.appendChild(this.wheelCanvas);
    wheelWrap.appendChild(this.wheelCursor);

    const onWheelDown = (e: PointerEvent): void => {
      this.wheelDragging = true;
      this.dragSnapshotBefore = this.activeColour();
      try { this.wheelCanvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this.handleWheelEvent(e);
    };
    const onWheelMove = (e: PointerEvent): void => {
      if (!this.wheelDragging) return;
      this.handleWheelEvent(e);
    };
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

    // Brightness slider (vertical strip from black -> full V at current H/S).
    const brightnessRow = document.createElement('div');
    brightnessRow.className = 'cp-brightness-row';
    const bLabel = document.createElement('span');
    bLabel.className = 'cp-brightness-label';
    bLabel.textContent = 'V';
    this.brightnessTrack = document.createElement('div');
    this.brightnessTrack.className = 'cp-brightness-track';
    this.brightnessSlider = document.createElement('input');
    this.brightnessSlider.type = 'range';
    this.brightnessSlider.min = '0';
    this.brightnessSlider.max = '100';
    this.brightnessSlider.value = '100';
    this.brightnessSlider.className = 'cp-brightness-slider';
    this.brightnessSlider.setAttribute('aria-label', 'Brightness');
    this.brightnessSlider.addEventListener('pointerdown', () => {
      this.dragSnapshotBefore = this.activeColour();
    });
    this.brightnessSlider.addEventListener('input', () => {
      this.hsb = { ...this.hsb, b: Number(this.brightnessSlider.value) / 100 };
      this.previewLiveFromHsb();
    });
    this.brightnessSlider.addEventListener('change', () => this.commitFromHsb());
    this.brightnessTrack.appendChild(this.brightnessSlider);
    brightnessRow.appendChild(bLabel);
    brightnessRow.appendChild(this.brightnessTrack);

    this.root.appendChild(headRow);
    this.root.appendChild(wheelWrap);
    this.root.appendChild(brightnessRow);
  }

  /** Live-preview a colour update via _apply, computed from the current HSB state. */
  private previewLiveFromHsb(): void {
    const rgb = hsbToRgb(this.hsb);
    const nextHex = rgbToHex(rgb);
    const slot = this.store.get().activeSlot;
    const slots = [...this.store.get().colourSlots];
    slots[slot] = nextHex;
    this.store._apply({ colourSlots: slots });
    this.refreshCursorPosition();
    this.refreshBrightnessTrack();
  }

  /** Finalise an in-flight HSB change. Deliberately does NOT push history --
   *  a colour-wheel drag is treated like zoom/pan: a view-state tweak the
   *  user doesn't want clogging the undo stack. The live preview via _apply
   *  in previewLiveFromHsb has already moved the slot to `after`; we just
   *  clear the snapshot here. */
  private commitFromHsb(): void {
    this.dragSnapshotBefore = null;
  }

  /** Translate a pointer event on the wheel canvas to (h, s) and live-update. */
  private handleWheelEvent(e: PointerEvent): void {
    const rect = this.wheelCanvas.getBoundingClientRect();
    const dx = e.clientX - rect.left - rect.width / 2;
    const dy = e.clientY - rect.top - rect.height / 2;
    this.hsb = wheelPointToHsb(dx, dy, rect.width / 2, this.hsb.b);
    this.previewLiveFromHsb();
  }

  private commitHex(): void {
    const raw = this.hexInput.value.trim();
    const rgb = hexToRgb(raw);
    if (!rgb) {
      // Invalid - revert input
      this.syncFromStore();
      return;
    }
    const after = rgbToHex(rgb);
    const before = this.activeColour();
    if (after === before) {
      this.syncFromStore();
      return;
    }
    const slot = this.store.get().activeSlot;
    this.history.dispatch({ t: 'colour.set', slot, before, after });
  }

  private activeColour(): Hex | null {
    const s = this.store.get();
    return s.colourSlots[s.activeSlot] ?? null;
  }

  private syncFromStore(): void {
    const c = this.activeColour() ?? hex('#000000');
    const rgb = hexToRgb(c) ?? { r: 0, g: 0, b: 0 };
    this.hexInput.value = c.replace(/^#/, '');
    this.preview.style.backgroundColor = c;
    // Avoid clobbering an in-flight wheel/slider drag - the user is holding
    // the pointer down and the live state already matches.
    if (!this.wheelDragging) this.hsb = rgbToHsb(rgb);
    if (!this.brightnessSlider.matches(':active')) {
      this.brightnessSlider.value = String(Math.round(this.hsb.b * 100));
    }
    this.refreshCursorPosition();
    this.refreshBrightnessTrack();
  }

  private refreshCursorPosition(): void {
    if (!this.wheelCursor) return;
    const radius = WHEEL_SIZE / 2;
    const a = this.hsb.h * Math.PI / 180;
    const r = this.hsb.s * radius;
    const x = radius + Math.cos(a) * r;
    const y = radius + Math.sin(a) * r;
    this.wheelCursor.style.left = `${x}px`;
    this.wheelCursor.style.top = `${y}px`;
  }

  private refreshBrightnessTrack(): void {
    if (!this.brightnessTrack) return;
    // Show the gradient from black up to the current H/S at full V so the
    // slider is contextual rather than a generic grey ramp.
    const fullV = rgbToHex(hsbToRgb({ h: this.hsb.h, s: this.hsb.s, b: 1 }));
    this.brightnessTrack.style.background = `linear-gradient(to right, #000, ${fullV})`;
  }

  private syncOpenState(): void {
    const open = this.store.get().ui.colourPickerOpen;
    this.root.hidden = !open;
  }
}
