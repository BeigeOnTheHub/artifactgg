import type { Store } from './store';
import type { ToolId } from '../types/primitives';

export interface ToolController {
  readonly id: ToolId;
  attach(target: HTMLElement): void;
  detach(): void;
  /** Return the per-tool settings panel, or null if the tool has no panel. */
  getContextPanel?(): HTMLElement | null;
  /**
   * Abort any in-flight gesture: drop inflight state, clear layer previews,
   * revert any live-preview `_apply`. Dispatches NO command - an aborted
   * gesture leaves the undo history untouched. Optional; the desktop build
   * never calls it. Invoked only by the touch controller's second-finger
   * path when a creation tool's gesture must yield to pinch/pan.
   */
  cancel?(): void;
  /** Like cancel, but leaves view-only gestures (a pan) running. Used before a
   *  frame change, which shouldn't stop the user scrolling. Falls back to cancel. */
  cancelEdits?(): void;
}

export class ToolsManager {
  private active: ToolController | null = null;
  private unsub: () => void = () => {};

  constructor(
    private target: HTMLElement,
    private store: Store,
    private tools: Map<ToolId, ToolController>,
  ) {}

  start(): void {
    this.swap(this.store.get().tool);
    this.unsub = this.store.subscribe(['tool'], (state) => this.swap(state.tool));
  }

  stop(): void {
    this.unsub();
    if (this.active) this.active.detach();
    this.active = null;
  }

  /** Test/debug helper - read currently attached tool id. */
  getActiveId(): ToolId | null { return this.active?.id ?? null; }

  /** The currently attached tool controller, or null (e.g. when the active
   *  id is not in this manager's map - the compact select-family case). */
  getActive(): ToolController | null { return this.active; }

  /** Test/debug helper - get a registered tool by id. */
  getTool(id: ToolId): ToolController | null { return this.tools.get(id) ?? null; }

  private swap(next: ToolId): void {
    if (this.active) {
      this.active.detach();
      this.active = null;
    }
    const tool = this.tools.get(next);
    if (tool) {
      tool.attach(this.target);
      this.active = tool;
    }
  }
}
