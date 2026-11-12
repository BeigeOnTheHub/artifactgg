import type { Store } from './store';

/** Gap kept between a focused field's bottom edge and the keyboard top. */
const KEYBOARD_MARGIN_PX = 16;

/**
 * Pixels a focused field must shift up so its bottom edge sits `margin` above
 * the keyboard. `fieldBottom` and `keyboardTop` are client-space Y values
 * (`keyboardTop` is the bottom edge of the visible visual viewport). Zero when
 * the field is already clear; never negative.
 */
export function keyboardLift(fieldBottom: number, keyboardTop: number, margin: number): number {
  return Math.max(0, fieldBottom + margin - keyboardTop);
}

/**
 * Compact-only: keeps a focused `<input>` / `<textarea>` visible above the mobile
 * keyboard (the keyboard shrinks `visualViewport`). A field in a `.mob-sheet`
 * lifts the sheet with `translateY`; a text box textarea (inside `.tbox`, which
 * moves with the map) pans the map via `store._apply`, bypassing history. On
 * blur the sheet drops back but the pan stays. Inert without `visualViewport`.
 */
export class KeyboardAutoPan {
  private readonly vv: VisualViewport | null;
  private focused: HTMLElement | null = null;
  private liftedSheet: HTMLElement | null = null;
  private off: Array<() => void> = [];

  constructor(private store: Store) {
    this.vv = window.visualViewport ?? null;
  }

  attach(): void {
    const vv = this.vv;
    if (!vv) return; // no visualViewport -> inert (graceful degradation)
    const onFocusIn = (e: FocusEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
        this.focused = t;
        this.adjust();
      }
    };
    const onFocusOut = (): void => {
      this.focused = null;
      this.resetSheet();
    };
    const onResize = (): void => this.adjust();
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    vv.addEventListener('resize', onResize);
    // iOS sometimes only fires 'scroll' on the visual viewport when the
    // keyboard slides in (offsetTop changes, height doesn't). Without this
    // the sheet lift is one keyboard-open behind on those phones.
    vv.addEventListener('scroll', onResize);
    this.off = [
      () => document.removeEventListener('focusin', onFocusIn),
      () => document.removeEventListener('focusout', onFocusOut),
      () => vv.removeEventListener('resize', onResize),
      () => vv.removeEventListener('scroll', onResize),
    ];
  }

  detach(): void {
    for (const f of this.off) f();
    this.off = [];
    this.resetSheet();
    this.focused = null;
  }

  /**
   * Lift the focused field clear of the keyboard if occluded. Safe to call
   * repeatedly: the sheet branch clears its transform before measuring, and the
   * tbox branch measures after earlier pans (store._apply is synchronous), so
   * it only pans by the residual overlap and settles at zero.
   */
  private adjust(): void {
    const vv = this.vv;
    if (!vv || !this.focused) return;
    const keyboardTop = vv.offsetTop + vv.height;
    const sheet = this.focused.closest<HTMLElement>('.mob-sheet');
    if (sheet) {
      // Measure the field at its natural position (transform cleared first),
      // then translate the whole sheet up by the computed lift.
      sheet.style.transform = '';
      const lift = keyboardLift(this.focused.getBoundingClientRect().bottom, keyboardTop, KEYBOARD_MARGIN_PX);
      sheet.style.transform = lift > 0 ? `translateY(-${lift}px)` : '';
      this.liftedSheet = lift > 0 ? sheet : null;
      return;
    }
    if (this.focused.closest('.tbox')) {
      // A text box's textarea: pan the map up (cosmetic, bypasses history).
      const lift = keyboardLift(this.focused.getBoundingClientRect().bottom, keyboardTop, KEYBOARD_MARGIN_PX);
      if (lift > 0) this.store._apply({ panY: this.store.get().panY - lift });
    }
  }

  /** Drop any lifted sheet back to its resting position. */
  private resetSheet(): void {
    if (this.liftedSheet) {
      this.liftedSheet.style.transform = '';
      this.liftedSheet = null;
    }
  }
}
