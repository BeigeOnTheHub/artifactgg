import { insulateChromePointerEvents } from './touchChrome';

export interface MobileSheetOpts {
  /** Extra class after `mob-sheet`, e.g. 'mob-mapsheet'. Also derives the
   *  close button's class and so must stay stable - the e2e specs select on
   *  the resulting `${variant}-close`. */
  variant: string;
  testid: string;
  closeLabel: string;
  closeTestid: string;
  onClose: () => void;
  /** Optional heading. The selection and tool sheets predate it and pass none. */
  title?: string;
}

/**
 * Wrap a supplied element in dismissible bottom-sheet chrome. Pulled out of
 * MobileChrome, where buildSelSheet and buildToolSheet were already doing this
 * identically and three more sheets were about to make it five copies.
 */
export function buildMobileSheet(content: HTMLElement, opts: MobileSheetOpts): HTMLDivElement {
  const sheet = document.createElement('div');
  sheet.className = `mob-sheet ${opts.variant}`;
  sheet.dataset['testid'] = opts.testid;
  insulateChromePointerEvents(sheet);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = `mob-menu-btn ${opts.variant}-close`;
  close.dataset['testid'] = opts.closeTestid;
  close.setAttribute('aria-label', opts.closeLabel);
  // A glyph, not the word 'Close'. As text it needed a 44px button on a row of
  // its own in every sheet; as a corner glyph it shares the title line, which is
  // ~54px back off the height of all five sheets. The aria-label carries the
  // meaning for screen readers.
  close.textContent = '×';
  close.addEventListener('click', opts.onClose);
  sheet.appendChild(close);

  if (opts.title != null) {
    const h = document.createElement('h3');
    h.textContent = opts.title;
    sheet.appendChild(h);
  }

  sheet.appendChild(content);
  return sheet;
}
