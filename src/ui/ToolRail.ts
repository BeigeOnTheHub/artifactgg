import '../styles/tool-rail.css';
import type { Store } from '../app/store';
import type { History } from '../app/history';
import type { ToolId } from '../types/primitives';
import { TOOL_ICONS, TOOL_LABELS, TOOL_ORDER, TOOL_HOTKEY } from './icons';

const SVG_NS = 'http://www.w3.org/2000/svg';

export class ToolRail {
  private buttons = new Map<ToolId, HTMLButtonElement>();
  private grid: HTMLElement;
  private unsubTool: () => void = () => {};

  constructor(
    private host: HTMLElement,
    private store: Store,
    private history: History,
  ) {
    this.grid = document.createElement('div');
    this.grid.className = 'tool-rail';
    this.grid.setAttribute('role', 'toolbar');
    this.grid.setAttribute('aria-label', 'Drawing tools');
  }

  mount(): void {
    while (this.host.firstChild) this.host.removeChild(this.host.firstChild);
    this.host.appendChild(this.grid);

    for (const id of TOOL_ORDER) this.grid.appendChild(this.buildButton(id));

    this.syncActive();
    this.unsubTool = this.store.subscribe(['tool'], () => this.syncActive());
  }

  destroy(): void {
    this.unsubTool();
    while (this.host.firstChild) this.host.removeChild(this.host.firstChild);
    this.buttons.clear();
  }

  private buildButton(id: ToolId): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tool-rail-btn';
    btn.dataset['tool'] = id;
    // Show the hotkey in the tooltip + aria-label ("Draw (D)") so it's
    // discoverable without opening the keyboard-hints modal.
    const hk = TOOL_HOTKEY[id];
    const label = hk ? `${TOOL_LABELS[id]} (${hk})` : TOOL_LABELS[id];
    btn.title = label;
    btn.setAttribute('aria-label', label);

    const icon = TOOL_ICONS[id];
    if (icon.kind === 'png') {
      const img = document.createElement('img');
      img.className = 'tool-rail-icon';
      img.src = `${import.meta.env.BASE_URL}${icon.src}`;
      img.alt = '';
      img.draggable = false;
      btn.appendChild(img);
    } else {
      const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
      svg.classList.add('tool-rail-icon');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.5');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      icon.build(svg);
      btn.appendChild(svg);
    }

    btn.addEventListener('click', () => {
      // Tool switches bypass history on purpose: apply
      // straight to the store so undo/redo never replays a tool change.
      this.store._apply({ tool: id });
    });

    this.buttons.set(id, btn);
    return btn;
  }

  private syncActive(): void {
    const active = this.store.get().tool;
    for (const [id, btn] of this.buttons) {
      const on = id === active;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    }
  }
}
