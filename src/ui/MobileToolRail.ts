import type { Store } from '../app/store';
import type { ToolId } from '../types/primitives';
import { TOOL_ICONS, TOOL_LABELS } from './icons';
import { FALLBACK_COLOUR } from '../app/colour';
import { insulateChromePointerEvents } from './touchChrome';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Top-to-bottom rail order: Select (the `cursor` select-family id) then the
 * seven creation tools. The desktop `select` / `lasso` ids are deliberately
 * omitted - Select plus the multi-select toggle already cover box
 * and additive selection.
 */
const MOBILE_TOOL_ORDER: readonly ToolId[] = [
  'cursor', 'draw', 'erase', 'shapes', 'place-cone', 'place-player', 'place-text', 'place-quickadd',
];

export interface MobileToolRailOpts {
  /**
   * Called when the already-active rail button is tapped again. The store
   * `tool` does not change on a re-tap, so MobileChrome cannot react via a
   * `['tool']` subscription - the rail signals it directly.
   */
  onReopenSettings: () => void;
}

/**
 * The compact touch tool rail: a floating, translucent vertical rail pinned
 * to the viewer's left edge. Tool buttons write `store.tool`
 * (tool switches bypass history); the colour swatch at the foot opens the
 * touch colour sheet by setting `ui.colourPickerOpen`.
 */
export class MobileToolRail {
  private rail: HTMLDivElement;
  private buttons = new Map<ToolId, HTMLButtonElement>();
  private swatch: HTMLButtonElement | null = null;
  private offTool: () => void = () => {};
  private offColour: () => void = () => {};

  constructor(
    private host: HTMLElement,
    private store: Store,
    private opts: MobileToolRailOpts,
  ) {
    this.rail = document.createElement('div');
    this.rail.className = 'mob-tool-rail';
    this.rail.dataset['testid'] = 'mobile-tool-rail';
  }

  mount(): void {
    for (const id of MOBILE_TOOL_ORDER) this.rail.appendChild(this.buildToolButton(id));
    this.rail.appendChild(this.buildSwatch());
    this.host.appendChild(this.rail);
    insulateChromePointerEvents(this.rail);
    this.syncActive();
    this.syncSwatch();
    this.offTool = this.store.subscribe(['tool'], () => this.syncActive());
    this.offColour = this.store.subscribe(['colourSlots', 'activeSlot'], () => this.syncSwatch());
  }

  destroy(): void {
    this.offTool();
    this.offColour();
    this.rail.remove();
    this.buttons.clear();
  }

  private buildToolButton(id: ToolId): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mob-tool-btn';
    btn.dataset['tool'] = id;
    btn.dataset['testid'] = `mobile-tool-${id}`;
    btn.setAttribute('aria-label', TOOL_LABELS[id]);
    btn.appendChild(buildIcon(id));
    btn.addEventListener('click', () => {
      if (this.store.get().tool === id) {
        // Re-tap of the active tool: the store will not change, so ask
        // MobileChrome to re-open the settings sheet directly.
        this.opts.onReopenSettings();
      } else {
        // Tool switches bypass history on purpose.
        this.store._apply({ tool: id });
      }
    });
    this.buttons.set(id, btn);
    return btn;
  }

  private buildSwatch(): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mob-tool-swatch';
    b.dataset['testid'] = 'mobile-colour-swatch';
    b.setAttribute('aria-label', 'Colour');
    b.addEventListener('click', () => {
      const ui = this.store.get().ui;
      this.store._apply({ ui: { ...ui, colourPickerOpen: true } });
    });
    this.swatch = b;
    return b;
  }

  private syncActive(): void {
    const t = this.store.get().tool;
    for (const [id, btn] of this.buttons) btn.classList.toggle('active', id === t);
  }

  private syncSwatch(): void {
    if (!this.swatch) return;
    const s = this.store.get();
    this.swatch.style.backgroundColor = s.colourSlots[s.activeSlot] ?? FALLBACK_COLOUR;
  }
}

/** Build the icon node for a rail button, reusing the desktop TOOL_ICONS. */
function buildIcon(id: ToolId): HTMLElement | SVGSVGElement {
  const icon = TOOL_ICONS[id];
  if (icon.kind === 'png') {
    const img = document.createElement('img');
    img.className = 'mob-tool-icon';
    img.src = `${import.meta.env.BASE_URL}${icon.src}`;
    img.alt = '';
    img.draggable = false;
    return img;
  }
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.classList.add('mob-tool-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  icon.build(svg);
  return svg;
}
