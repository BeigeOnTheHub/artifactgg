/**
 * One owner for the compact bottom sheets (MobileChrome's six plus
 * MobileColourSheet). Holds at most one open sheet and installs the
 * tap-away-to-close listeners once. Knows nothing about the store; a sheet hands
 * over its element and how to close itself.
 */

/**
 * What a dismissing tap does after closing the sheet.
 * - `swallow`: the tap stops here, so dismissing can't also edit the strat.
 * - `passthrough`: the tap reaches the map. For the tool-settings sheet, which
 *   auto-opens on tool pick: the first stroke after choosing Draw should draw.
 */
export type DismissMode = 'swallow' | 'passthrough';

export interface OpenSheet {
  /** The sheet element. A pointerdown inside it never dismisses. */
  el: HTMLElement;
  /** Tear the sheet down. Called at most once per open. */
  onClose: () => void;
  dismiss: DismissMode;
}

export interface SheetManagerOpts {
  /**
   * Targets that must not dismiss. The menu button toggles its own sheet, so if
   * the dismissal ate its tap the sheet would close and reopen in the same gesture.
   */
  isExempt?: (target: EventTarget | null) => boolean;
}

export interface SheetManager {
  /** Open a sheet, closing whatever was open first. */
  open(sheet: OpenSheet): void;
  /** Close the open sheet, if any. Idempotent. */
  close(): void;
  /** Same as close(); reads better at the launcher call sites. */
  closeAll(): void;
  /** The open sheet's element, or null. */
  current(): HTMLElement | null;
  destroy(): void;
}

export function createSheetManager(opts: SheetManagerOpts = {}): SheetManager {
  let open: OpenSheet | null = null;
  let listening = false;

  const closeCurrent = (): void => {
    const sheet = open;
    if (!sheet) return;
    // Clear the record BEFORE the callback: MobileColourSheet's onClose writes a
    // store flag whose subscriber calls back in here, and that would recurse.
    open = null;
    stopListening();
    sheet.onClose();
  };

  const onPointerDown = (e: PointerEvent): void => {
    const sheet = open;
    if (!sheet) return;
    const t = e.target as Node | null;
    if (t && sheet.el.contains(t)) return;
    if (opts.isExempt?.(e.target ?? null)) return;
    const mode = sheet.dismiss;
    closeCurrent();
    if (mode === 'swallow') {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !open) return;
    e.preventDefault();
    closeCurrent();
  };

  function startListening(): void {
    if (listening) return;
    // Capture phase, so a swallowed tap is stopped before it reaches the map's own
    // capture-phase pointer handlers.
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    listening = true;
  }

  function stopListening(): void {
    if (!listening) return;
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown);
    listening = false;
  }

  return {
    open(sheet: OpenSheet): void {
      closeCurrent();
      open = sheet;
      startListening();
    },
    close: closeCurrent,
    closeAll: closeCurrent,
    current: () => open?.el ?? null,
    destroy(): void {
      closeCurrent();
      stopListening();
    },
  };
}
