import '../styles/discord-link.css';
import { CONTACT_URL, CONTACT_LABEL } from '../app/contact';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Top-right HUD link to the project Discord. Anchored to the map viewer
 * (not the topbar) so it stays visible regardless of which sidebar tab is
 * open. Mirrors PlayerLegend's top-left placement. The URL lives in
 * app/contact.ts.
 */
export class DiscordLink {
  private el: HTMLAnchorElement;

  constructor(private host: HTMLElement) {
    this.el = document.createElement('a');
    this.el.className = 'discord-link';
    this.el.href = CONTACT_URL;
    this.el.target = '_blank';
    // noopener stops the opened tab from reaching back through window.opener;
    // noreferrer keeps the Discord side from learning where the click came
    // from.
    this.el.rel = 'noopener noreferrer';
    this.el.title = `Join the ${CONTACT_LABEL}`;
    this.el.setAttribute('aria-label', `Join the project ${CONTACT_LABEL}`);
    this.el.appendChild(buildDiscordIcon());

    // The map viewer is the pointer-capture target for the active tool's
    // pan / select / draw gestures. Without these stoppers a pointerdown on
    // the link bubbles to the viewer, the tool calls setPointerCapture, and
    // the synthesized click gets retargeted to the viewer -- the anchor's
    // default navigation never fires and the link looks dead. Mirrors the
    // approach LegalModal uses for the abuse-report button (explicit
    // window.open with noopener/noreferrer).
    const swallow = (e: Event): void => e.stopPropagation();
    this.el.addEventListener('pointerdown', swallow);
    this.el.addEventListener('pointerup', swallow);
    this.el.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      window.open(CONTACT_URL, '_blank', 'noopener,noreferrer');
    });
  }

  mount(): void {
    this.host.appendChild(this.el);
  }

  destroy(): void {
    this.el.remove();
  }
}

/** Build the Discord brand glyph as an SVG, imperatively (no innerHTML --
 *  the CSP forbids it). Path data is the Simple Icons "discord" mark
 *  (CC0); rendered in currentColor so the host link controls the colour. */
function buildDiscordIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('discord-link-icon');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute(
    'd',
    'M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.956 2.42-2.157 2.42zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.946 2.42-2.157 2.42z',
  );
  svg.appendChild(path);
  return svg;
}
