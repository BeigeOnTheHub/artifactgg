import { describe, it, expect } from 'vitest';
import { buildMobileSheet } from './mobileSheet';

function opts(overrides: Partial<Parameters<typeof buildMobileSheet>[1]> = {}) {
  return {
    variant: 'mob-testsheet',
    testid: 'mobile-testsheet',
    closeLabel: 'Close test',
    closeTestid: 'mobile-testsheet-close',
    onClose: () => {},
    ...overrides,
  };
}

describe('buildMobileSheet', () => {
  it('wraps the content in sheet chrome', () => {
    const content = document.createElement('p');
    const sheet = buildMobileSheet(content, opts());
    expect(sheet.className).toBe('mob-sheet mob-testsheet');
    expect(sheet.dataset['testid']).toBe('mobile-testsheet');
    expect(sheet.contains(content)).toBe(true);
  });

  it('the close button is a glyph with the label as its accessible name', () => {
    const sheet = buildMobileSheet(document.createElement('div'), opts());
    const close = sheet.querySelector('button') as HTMLButtonElement;
    // A glyph, not the word 'Close'. As text it needed a 44px button on a row of
    // its own in every one of the five sheets; as a corner glyph it shares the
    // title line. The aria-label is now the only accessible name, so it has to
    // stay set.
    expect(close.textContent).toBe('×');
    expect(close.getAttribute('aria-label')).toBe('Close test');
  });

  it('derives the close button class and testid from the variant', () => {
    const sheet = buildMobileSheet(document.createElement('div'), opts());
    const close = sheet.querySelector('button') as HTMLButtonElement;
    expect(close.className).toBe('mob-menu-btn mob-testsheet-close');
    expect(close.dataset['testid']).toBe('mobile-testsheet-close');
    expect(close.getAttribute('aria-label')).toBe('Close test');
  });

  it('runs onClose when the close button is tapped', () => {
    let closed = 0;
    const sheet = buildMobileSheet(document.createElement('div'), opts({ onClose: () => { closed += 1; } }));
    (sheet.querySelector('button') as HTMLButtonElement).click();
    expect(closed).toBe(1);
  });

  it('renders an optional heading between the close button and the content', () => {
    const sheet = buildMobileSheet(document.createElement('div'), opts({ title: 'Map' }));
    const h = sheet.querySelector('h3');
    expect(h?.textContent).toBe('Map');
  });

  it('omits the heading when no title is given', () => {
    const sheet = buildMobileSheet(document.createElement('div'), opts());
    expect(sheet.querySelector('h3')).toBeNull();
  });
});
