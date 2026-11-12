import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DiscordLink } from './DiscordLink';
import { CONTACT_URL } from '../app/contact';

describe('DiscordLink', () => {
  let host: HTMLElement;
  let link: DiscordLink;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    link = new DiscordLink(host);
    link.mount();
  });

  afterEach(() => {
    link.destroy();
    if (host.parentElement) host.parentElement.removeChild(host);
  });

  function el(): HTMLAnchorElement {
    return host.querySelector('.discord-link') as HTMLAnchorElement;
  }

  it('mounts an anchor tagged with .discord-link', () => {
    expect(el()).not.toBeNull();
    expect(el().tagName).toBe('A');
  });

  it('href points at the single-source CONTACT_URL', () => {
    expect(el().getAttribute('href')).toBe(CONTACT_URL);
  });

  it('opens in a new tab and is hardened against tab-jacking', () => {
    expect(el().target).toBe('_blank');
    expect(el().rel).toContain('noopener');
    expect(el().rel).toContain('noreferrer');
  });

  it('carries an accessible label', () => {
    expect(el().getAttribute('aria-label')).toContain('Discord');
  });

  it('contains an aria-hidden SVG glyph (decorative -- the aria-label is on the link)', () => {
    const svg = el().querySelector('svg.discord-link-icon');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('aria-hidden')).toBe('true');
  });

  it('destroy() removes the anchor from the host', () => {
    expect(host.querySelector('.discord-link')).not.toBeNull();
    link.destroy();
    expect(host.querySelector('.discord-link')).toBeNull();
  });

  it('click opens CONTACT_URL via window.open with noopener,noreferrer', () => {
    const spy = vi.spyOn(window, 'open').mockReturnValue(null);
    el().click();
    expect(spy).toHaveBeenCalledWith(CONTACT_URL, '_blank', 'noopener,noreferrer');
    spy.mockRestore();
  });

  it('does not let pointerdown/click bubble to the viewer (stops the active tool grabbing the gesture)', () => {
    const hostDown = vi.fn();
    const hostClick = vi.fn();
    host.addEventListener('pointerdown', hostDown);
    host.addEventListener('click', hostClick);
    vi.spyOn(window, 'open').mockReturnValue(null);

    el().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    el().click();

    expect(hostDown).not.toHaveBeenCalled();
    expect(hostClick).not.toHaveBeenCalled();
  });
});
