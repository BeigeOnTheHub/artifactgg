import '../styles/colour-slots.css';
import type { Store } from '../app/store';

type SlotIdx = 0 | 1 | 2 | 3 | 4;

export class ColourSlots {
  private container: HTMLElement;
  private buttons: HTMLElement[] = [];
  private unsub: () => void = () => {};

  constructor(private host: HTMLElement, private store: Store) {
    this.container = document.createElement('div');
    this.container.className = 'colour-slots';
    this.container.setAttribute('role', 'group');
    this.container.setAttribute('aria-label', 'Colour palette');
  }

  mount(): void {
    while (this.host.firstChild) this.host.removeChild(this.host.firstChild);
    this.host.appendChild(this.container);

    for (let i = 0; i < 5; i++) {
      const idx = i as SlotIdx;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'colour-slot';
      btn.dataset['slot'] = String(idx);
      btn.setAttribute('aria-label', `Colour slot ${idx + 1}`);
      btn.title = `Colour slot ${idx + 1} (${idx + 1})`;
      btn.addEventListener('click', () => {
        this.onClick(idx);
        // No btn.blur() here -- :focus-visible (see colour-slots.css) only
        // shows a focus ring on keyboard navigation, so a mouse click no
        // longer leaves a stale ring behind. Stripping focus on click broke
        // Tab order for keyboard users.
      });
      // Enter on a focused slot = "select this slot and open the picker for it".
      // (Space keeps the native button click, i.e. plain select.)
      btn.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const s = this.store.get();
        this.store._apply({ activeSlot: idx, ui: { ...s.ui, colourPickerOpen: true } });
      });
      this.container.appendChild(btn);
      this.buttons.push(btn);
    }

    // Trailing "edit" button: opens the colour picker for whatever slot is
    // active. Same gesture as re-clicking the active swatch, just always
    // visible so it's discoverable.
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'colour-slot-edit';
    edit.setAttribute('aria-label', 'Edit active colour');
    edit.title = 'Edit active colour';
    edit.appendChild(buildPencilIcon());
    edit.addEventListener('click', () => {
      const s = this.store.get();
      this.store._apply({ ui: { ...s.ui, colourPickerOpen: true } });
    });
    this.container.appendChild(edit);

    this.sync();
    this.unsub = this.store.subscribe(['colourSlots', 'activeSlot'], () => this.sync());
  }

  destroy(): void {
    this.unsub();
    while (this.host.firstChild) this.host.removeChild(this.host.firstChild);
    this.buttons = [];
  }

  private onClick(idx: SlotIdx): void {
    const s = this.store.get();
    if (s.activeSlot !== idx) {
      // Inactive slot - activate. If empty, also open the picker immediately.
      const isEmpty = s.colourSlots[idx] == null;
      this.store._apply({
        activeSlot: idx,
        ui: { ...s.ui, colourPickerOpen: isEmpty ? true : s.ui.colourPickerOpen },
      });
    } else {
      // Already-active slot - toggle picker.
      this.store._apply({ ui: { ...s.ui, colourPickerOpen: !s.ui.colourPickerOpen } });
    }
  }

  private sync(): void {
    const s = this.store.get();
    this.buttons.forEach((btn, i) => {
      const colour = s.colourSlots[i] ?? null;
      const on = i === s.activeSlot;
      btn.classList.toggle('active', on);
      btn.classList.toggle('empty', colour == null);
      btn.style.backgroundColor = colour ?? '';
      btn.setAttribute('aria-pressed', String(on));
    });
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A small pencil glyph for the "edit active colour" button. */
function buildPencilIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const body = document.createElementNS(SVG_NS, 'path');
  body.setAttribute('d', 'M4 20h4L19 9l-4-4L4 16v4z');
  svg.appendChild(body);
  const nib = document.createElementNS(SVG_NS, 'path');
  nib.setAttribute('d', 'M13.5 6.5l4 4');
  svg.appendChild(nib);
  return svg;
}
