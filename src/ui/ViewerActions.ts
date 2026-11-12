import '../styles/viewer-actions.css';
import type { Store } from '../app/store';
import { clampZoom } from '../app/viewport';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface ViewerActionsDeps {
  /** Clears every placed item from the active frame. Routes through the
   *  same confirm-then-frame.clear flow the keyboard shortcut uses, so the
   *  user can't accidentally lose a frame to a stray click. */
  clearActiveFrame(): void;
  /** Step zoom in around the viewer centre. */
  zoomIn(): void;
  /** Step zoom out around the viewer centre. */
  zoomOut(): void;
  /** Set an absolute zoom level (from the manual % input). Caller is
   *  expected to clamp through `clampZoom` -- the input pre-clamps too. */
  setZoom(zoom: number): void;
}

/**
 * Bottom-right viewer HUD: zoom in / zoom % input / zoom out + Clear all.
 * Anchored to #map-viewer (untransformed, like PlayerLegend and DiscordLink) so
 * it ignores zoom/pan. Pointer events are stopped on the buttons so the active
 * tool can't grab the pointer before the click resolves.
 *
 * The % input follows the store zoom; Enter or blur applies an absolute zoom.
 */
export class ViewerActions {
  private root: HTMLDivElement;
  private zoomInput: HTMLInputElement;
  private unsubZoom: () => void = () => {};

  constructor(
    private host: HTMLElement,
    private store: Store,
    private deps: ViewerActionsDeps,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'viewer-actions';
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Map actions');

    this.root.appendChild(this.makeButton({
      cls: 'viewer-actions-btn viewer-actions-zoom-in',
      label: 'Zoom in',
      title: 'Zoom in',
      icon: zoomInIcon,
      onClick: () => this.deps.zoomIn(),
    }));

    this.zoomInput = this.makeZoomInput();
    this.root.appendChild(this.zoomInput);

    this.root.appendChild(this.makeButton({
      cls: 'viewer-actions-btn viewer-actions-zoom-out',
      label: 'Zoom out',
      title: 'Zoom out',
      icon: zoomOutIcon,
      onClick: () => this.deps.zoomOut(),
    }));

    // Visual separator between the zoom cluster and the destructive Clear.
    const sep = document.createElement('div');
    sep.className = 'viewer-actions-sep';
    sep.setAttribute('aria-hidden', 'true');
    this.root.appendChild(sep);

    this.root.appendChild(this.makeButton({
      cls: 'viewer-actions-btn viewer-actions-clear',
      label: 'Clear frame',
      title: 'Clear every placed item from this frame',
      icon: clearIcon,
      onClick: () => this.deps.clearActiveFrame(),
    }));
  }

  mount(): void {
    this.host.appendChild(this.root);
    this.syncZoomInput();
    this.unsubZoom = this.store.subscribe(['zoom'], () => this.syncZoomInput());
  }

  destroy(): void {
    this.unsubZoom();
    this.root.remove();
  }

  /** Update the displayed zoom value from the store unless the user is
   *  mid-typing -- overwriting their in-progress input would feel hostile. */
  private syncZoomInput(): void {
    if (document.activeElement === this.zoomInput) return;
    const text = `${Math.round(this.store.get().zoom * 100)}%`;
    if (this.zoomInput.value !== text) this.zoomInput.value = text;
  }

  private makeZoomInput(): HTMLInputElement {
    const input = document.createElement('input');
    // Text rather than number so we can show the trailing "%" -- a number
    // input refuses any non-numeric character in its value. parseInt below
    // happily reads the leading digits and ignores the "%".
    input.type = 'text';
    input.className = 'viewer-actions-zoom-input';
    input.inputMode = 'numeric';
    input.maxLength = 5;
    input.title = 'Zoom (percent). Type a number and press Enter.';
    input.setAttribute('aria-label', 'Zoom percent');

    const commit = (): void => {
      const raw = parseInt(input.value, 10);
      if (!Number.isFinite(raw)) { this.syncZoomInput(); return; }
      const clamped = clampZoom(raw / 100);
      if (clamped !== this.store.get().zoom) this.deps.setZoom(clamped);
      // Re-sync from the store so an out-of-range input snaps to the clamp
      // value the user actually got.
      input.value = `${Math.round(clamped * 100)}%`;
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); input.blur(); }
      if (e.key === 'Escape') {
        e.preventDefault();
        // Blur BEFORE syncing so syncZoomInput's "skip when focused"
        // short-circuit doesn't strand the user-typed value.
        input.blur();
        this.syncZoomInput();
      }
    });
    input.addEventListener('change', commit);
    // Block pointer bubbling so the active tool's pointerdown can't capture
    // the gesture and steal focus from the input.
    const swallow = (e: Event): void => e.stopPropagation();
    input.addEventListener('pointerdown', swallow);
    input.addEventListener('pointerup', swallow);
    input.addEventListener('click', swallow);
    // Suppress the global keyboard handler (number 1-5 = colour slot, etc.)
    // while the input has focus so the user can actually type digits.
    input.addEventListener('keydown', (e) => e.stopPropagation());
    return input;
  }

  private makeButton(opts: {
    cls: string;
    label: string;
    title: string;
    icon: () => SVGSVGElement;
    onClick: () => void;
  }): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = opts.cls;
    b.title = opts.title;
    b.setAttribute('aria-label', opts.label);
    b.appendChild(opts.icon());

    // Stop pointer events leaking into the viewer -- the active tool's
    // pointerdown handler calls setPointerCapture, which would reroute the
    // synthesized click away from the button. Same fix DiscordLink applies.
    const swallow = (e: Event): void => e.stopPropagation();
    b.addEventListener('pointerdown', swallow);
    b.addEventListener('pointerup', swallow);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onClick();
    });
    return b;
  }
}

function svgRoot(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('viewer-actions-icon');
  return svg;
}

function appendPath(svg: SVGSVGElement, d: string): void {
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d);
  svg.appendChild(p);
}
function appendLine(svg: SVGSVGElement, x1: number, y1: number, x2: number, y2: number): void {
  const ln = document.createElementNS(SVG_NS, 'line');
  ln.setAttribute('x1', String(x1));
  ln.setAttribute('y1', String(y1));
  ln.setAttribute('x2', String(x2));
  ln.setAttribute('y2', String(y2));
  svg.appendChild(ln);
}
function appendCircle(svg: SVGSVGElement, cx: number, cy: number, r: number): void {
  const c = document.createElementNS(SVG_NS, 'circle');
  c.setAttribute('cx', String(cx));
  c.setAttribute('cy', String(cy));
  c.setAttribute('r', String(r));
  svg.appendChild(c);
}

function zoomInIcon(): SVGSVGElement {
  const svg = svgRoot();
  appendCircle(svg, 11, 11, 7);
  appendLine(svg, 21, 21, 16, 16);
  appendLine(svg, 8, 11, 14, 11);
  appendLine(svg, 11, 8, 11, 14);
  return svg;
}
function zoomOutIcon(): SVGSVGElement {
  const svg = svgRoot();
  appendCircle(svg, 11, 11, 7);
  appendLine(svg, 21, 21, 16, 16);
  appendLine(svg, 8, 11, 14, 11);
  return svg;
}
function clearIcon(): SVGSVGElement {
  // Trash can outline -- the conventional "clear / remove" glyph.
  const svg = svgRoot();
  appendPath(svg, 'M3 6h18');
  appendPath(svg, 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2');
  appendPath(svg, 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6');
  appendLine(svg, 10, 11, 10, 17);
  appendLine(svg, 14, 11, 14, 17);
  return svg;
}
