import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LegalModal } from './LegalModal';

describe('LegalModal', () => {
  let host: HTMLElement;
  let modal: LegalModal;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    modal = new LegalModal(host);
    modal.mount();
  });

  afterEach(() => {
    modal.destroy();
    if (host.parentElement) document.body.removeChild(host);
  });

  it('mounts hidden by default', () => {
    const root = host.querySelector<HTMLElement>('.legal-modal');
    expect(root).not.toBeNull();
    expect(root!.hidden).toBe(true);
  });

  it('open() shows it, close() hides it', () => {
    modal.open();
    expect(host.querySelector<HTMLElement>('.legal-modal')!.hidden).toBe(false);
    modal.close();
    expect(host.querySelector<HTMLElement>('.legal-modal')!.hidden).toBe(true);
  });

  it('renders the parsed legal HTML body', () => {
    modal.open();
    const body = host.querySelector('.legal-modal-body');
    expect(body).not.toBeNull();
    expect(body!.querySelector('h2')?.textContent).toMatch(/privacy/i);
    // The fan-project disclaimer must actually be in there.
    expect((body!.textContent ?? '').toLowerCase()).toContain('not made, run, or endorsed');
  });

  it('header title covers terms, privacy and legal', () => {
    const title = host.querySelector('.legal-modal-title');
    expect(title?.textContent).toBe('TERMS, PRIVACY & LEGAL');
  });

  it('renders the Terms of use and Copyright/takedown sections', () => {
    modal.open();
    const body = host.querySelector('.legal-modal-body')!;
    const h3s = Array.from(body.querySelectorAll('h3')).map((h) => h.textContent ?? '');
    expect(h3s.some((t) => /terms of use/i.test(t))).toBe(true);
    expect(h3s.some((t) => /copyright/i.test(t))).toBe(true);
    // key terms content actually present
    expect((body.textContent ?? '').toLowerCase()).toContain('at least 13');
    expect((body.textContent ?? '').toLowerCase()).toContain('counter-notice');
  });

  it('clicking the close button hides it', () => {
    modal.open();
    host.querySelector<HTMLButtonElement>('.legal-modal-close')?.click();
    expect(host.querySelector<HTMLElement>('.legal-modal')!.hidden).toBe(true);
  });

  it('clicking the backdrop hides it', () => {
    modal.open();
    host.querySelector<HTMLElement>('.legal-modal-backdrop')?.click();
    expect(host.querySelector<HTMLElement>('.legal-modal')!.hidden).toBe(true);
  });

  it('clicking inside the panel does NOT close it', () => {
    modal.open();
    host.querySelector<HTMLElement>('.legal-modal-panel')?.click();
    expect(host.querySelector<HTMLElement>('.legal-modal')!.hidden).toBe(false);
  });

  it('does NOT attach its own document keydown listener (Escape is routed through the keyboard controller)', () => {
    // Open it - then a bare Escape on document/window should be a no-op here.
    // The keyboard controller (covered in keyboard.test.ts) is what closes it
    // via the isOpen/close surface.
    modal.open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(modal.isOpen()).toBe(true);
    expect(host.querySelector<HTMLElement>('.legal-modal')!.hidden).toBe(false);
  });

  it('isOpen + close are the surface the keyboard controller drives', () => {
    expect(modal.isOpen()).toBe(false);
    modal.open();
    expect(modal.isOpen()).toBe(true);
    modal.close();
    expect(modal.isOpen()).toBe(false);
  });

  it('destroy() removes the DOM', () => {
    modal.destroy();
    expect(host.querySelector('.legal-modal')).toBeNull();
    modal = new LegalModal(host);
    modal.mount();
  });

  it('fills the contact link href from CONTACT_URL', async () => {
    const { CONTACT_URL } = await import('../app/contact');
    modal.open();
    const a = host.querySelector<HTMLAnchorElement>('.legal-contact')!;
    expect(a.getAttribute('href')).toBe(CONTACT_URL);
  });

  it('report hint asks for the link', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    modal.open();
    host.querySelector<HTMLButtonElement>('.legal-report-btn')!.click();
    expect(open).toHaveBeenCalled();
    const hint = host.querySelector('.legal-report-hint')!.textContent ?? '';
    expect(hint.toLowerCase()).toContain('paste the link');
  });
});
