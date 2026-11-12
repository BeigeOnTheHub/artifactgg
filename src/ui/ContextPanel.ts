import '../styles/context-panel.css';
import type { Store } from '../app/store';
import type { History } from '../app/history';
import type { ToolsManager } from '../app/tools';
import { buildSelectionEditor } from './selectionEditors';

/** Tools that share the selection editors (rather than their own panel). */
const SELECTION_TOOLS = new Set(['cursor', 'select', 'lasso']);

export class ContextPanel {
  private container: HTMLElement;
  private unsub: () => void = () => {};

  constructor(
    private host: HTMLElement,
    private store: Store,
    private history: History,
    private manager: ToolsManager,
  ) {
    this.container = document.createElement('div');
    this.container.className = 'context-panel';
  }

  mount(): void {
    while (this.host.firstChild) this.host.removeChild(this.host.firstChild);
    this.host.appendChild(this.container);
    this.render();
    this.unsub = this.store.subscribe(['tool', 'selection'], () => this.render());
  }

  destroy(): void {
    this.unsub();
    while (this.host.firstChild) this.host.removeChild(this.host.firstChild);
  }

  private render(): void {
    while (this.container.firstChild) this.container.removeChild(this.container.firstChild);
    const s = this.store.get();

    // With a selection tool active and exactly one item selected, show the
    // editor for that item (font size for a text box, show-ranges for a
    // quickadd). Falls through to the tool panel otherwise.
    if (SELECTION_TOOLS.has(s.tool) && s.selection.length === 1) {
      const editor = buildSelectionEditor(this.store, this.history, s.selection[0]!);
      if (editor) { this.container.appendChild(editor); return; }
    }

    const tool = this.manager.getTool(s.tool);
    const panel = tool?.getContextPanel?.();
    if (panel) this.container.appendChild(panel);
  }
}
