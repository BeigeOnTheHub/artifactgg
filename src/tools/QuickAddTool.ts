import { nanoid } from 'nanoid';
import type { Store } from '../app/store';
import type { History } from '../app/history';
import type { QuickAdd, QuickAddType } from '../types/primitives';
import type { Command } from '../types/commands';
import { clientToMap, type Viewport } from '../render/coords';
import type { ToolController } from '../app/tools';

const DRAG_THRESHOLD = 4;
const QA_HIT_R = 16;

const QUICKADD_TYPES_ORDER: readonly QuickAddType[] = [
  'grenade', 'impact_grenade', 'flash', 'smoke', 'thermite', 'vortex_mine', 'scanner',
];

const QUICKADD_LABELS: Record<QuickAddType, string> = {
  grenade: 'GRENADE',
  impact_grenade: 'IMPACT',
  flash: 'FLASH',
  smoke: 'SMOKE',
  thermite: 'THERMITE',
  vortex_mine: 'VORTEX',
  scanner: 'SCANNER',
};

export interface QuickAddToolDeps {
  store: Store;
  history: History;
  getViewport(): Viewport;
}

interface InflightDrag {
  id: string;
  startX: number;
  startY: number;
  beforeX: number;
  beforeY: number;
}

export class QuickAddTool implements ToolController {
  readonly id = 'place-quickadd' as const;

  private type: QuickAddType = 'grenade';
  /** When on, newly-placed quickadds spawn with rangeVisible:true and the
   * toggle also flips every existing quickadd in the active frame to match,
   * so users can audit damage/flash/smoke radii at a glance instead of
   * staring at icon-only sprites. Restored from the v1 build. */
  private showRanges: boolean = false;
  private drag: InflightDrag | null = null;
  private offDown: () => void = () => {};
  private offMove: () => void = () => {};
  private offUp: () => void = () => {};
  private offContext: () => void = () => {};

  constructor(private deps: QuickAddToolDeps) {}

  setType(type: QuickAddType): void { this.type = type; }
  getType(): QuickAddType { return this.type; }

  getShowRanges(): boolean { return this.showRanges; }

  /** Flip the show-ranges toggle. Updates the in-memory tool default for
   * future placements and emits a single batched modify so every existing
   * quickadd in the active frame flips with one undo step. */
  setShowRanges(visible: boolean): void {
    if (this.showRanges === visible) return;
    this.showRanges = visible;

    const state = this.deps.store.get();
    const frame = state.frames[state.activeFrameIdx]!;
    const cmds: Command[] = [];
    for (const qa of frame.quickadds) {
      if (qa.rangeVisible !== visible) {
        cmds.push({
          t: 'quickadd.modify', id: qa.id,
          before: { rangeVisible: qa.rangeVisible },
          after: { rangeVisible: visible },
        });
      }
    }
    if (cmds.length === 1) this.deps.history.dispatch(cmds[0]!);
    else if (cmds.length > 1) this.deps.history.dispatch({ t: 'batch', cmds });
  }

  /** Toggle the rangeVisible flag on a specific item, undoably. */
  setRangeVisibleForId(id: string, visible: boolean): void {
    const frame = this.deps.store.get().frames[this.deps.store.get().activeFrameIdx]!;
    const qa = frame.quickadds.find((q) => q.id === id);
    if (!qa || qa.rangeVisible === visible) return;
    this.deps.history.dispatch({
      t: 'quickadd.modify', id,
      before: { rangeVisible: qa.rangeVisible },
      after: { rangeVisible: visible },
    });
  }

  attach(target: HTMLElement): void {
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      e.preventDefault();
      const pt = this.toMap(e);
      const frame = this.deps.store.get().frames[this.deps.store.get().activeFrameIdx]!;
      const hit = findQuickAddAt(frame.quickadds, pt.x, pt.y);
      if (hit) {
        this.drag = {
          id: hit.id,
          startX: pt.x, startY: pt.y,
          beforeX: hit.x, beforeY: hit.y,
        };
        target.setPointerCapture(e.pointerId);
        return;
      }
      // Spawn on pointerdown, not pointerup - waiting for the up felt sluggish.
      const qa: QuickAdd = {
        id: nanoid(),
        type: this.type,
        x: pt.x, y: pt.y,
        rangeVisible: this.showRanges,
      };
      this.deps.history.dispatch({ t: 'quickadd.add', qa });
      // Keep the gesture alive so the user can drag the item they just
      // dropped without lifting and re-clicking it. onMove/onUp treat the
      // spawn position as the drag origin.
      this.drag = {
        id: qa.id,
        startX: pt.x, startY: pt.y,
        beforeX: pt.x, beforeY: pt.y,
      };
      target.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent): void => {
      if (!this.drag) return;
      const pt = this.toMap(e);
      const newX = this.drag.beforeX + (pt.x - this.drag.startX);
      const newY = this.drag.beforeY + (pt.y - this.drag.startY);
      const state = this.deps.store.get();
      const next = state.frames[state.activeFrameIdx]!.quickadds.map((q) =>
        q.id === this.drag!.id ? { ...q, x: newX, y: newY } : q,
      );
      this.deps.store._apply({
        frames: state.frames.map((f, i) =>
          i === state.activeFrameIdx ? { ...f, quickadds: next } : f),
      });
    };
    const onUp = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      if (this.drag) {
        const id = this.drag.id;
        const frame = this.deps.store.get().frames[this.deps.store.get().activeFrameIdx]!;
        const after = frame.quickadds.find((q) => q.id === id)!;
        const moved = Math.hypot(after.x - this.drag.beforeX, after.y - this.drag.beforeY) > DRAG_THRESHOLD;
        if (moved) {
          // Restore pre-drag state, then dispatch a single undoable command.
          const state = this.deps.store.get();
          this.deps.store._apply({
            frames: state.frames.map((f, i) => i === state.activeFrameIdx
              ? { ...f, quickadds: f.quickadds.map((q) => q.id === id
                  ? { ...q, x: this.drag!.beforeX, y: this.drag!.beforeY }
                  : q) }
              : f),
          });
          this.deps.history.dispatch({
            t: 'quickadd.modify', id,
            before: { x: this.drag.beforeX, y: this.drag.beforeY },
            after: { x: after.x, y: after.y },
          });
        }
        this.drag = null;
        try { target.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      }
    };
    const onContext = (e: MouseEvent): void => {
      const pt = clientToMap(e.clientX, e.clientY, this.deps.getViewport());
      const frame = this.deps.store.get().frames[this.deps.store.get().activeFrameIdx]!;
      const hit = findQuickAddAt(frame.quickadds, pt.x, pt.y);
      if (!hit) return;
      e.preventDefault();
      this.deps.history.dispatch({ t: 'quickadd.delete', ids: [hit.id] });
    };

    // pointercancel = interrupted gesture: revert the in-flight drag (which
    // followed a tap-place) to the spawn position instead of committing a
    // quickadd.modify at the cursor's interrupted location.
    const onCancel = (e: PointerEvent): void => {
      try { target.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      this.cancel();
    };

    target.addEventListener('pointerdown', onDown);
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onCancel);
    target.addEventListener('contextmenu', onContext);
    this.offDown = () => target.removeEventListener('pointerdown', onDown);
    this.offMove = () => target.removeEventListener('pointermove', onMove);
    this.offUp = () => {
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onCancel);
    };
    this.offContext = () => target.removeEventListener('contextmenu', onContext);
  }

  detach(): void {
    this.offDown(); this.offMove(); this.offUp(); this.offContext();
    // Revert a half-done drag; it has no undo entry yet.
    this.cancel();
  }

  /** Abort an in-flight gesture (touch second-finger interruption): revert a
   *  live quickadd move to its pre-drag snapshot and drop the drag state.
   *  Dispatches no command. */
  cancel(): void {
    if (this.drag) {
      const d = this.drag;
      const s = this.deps.store.get();
      this.deps.store._apply({
        frames: s.frames.map((f, i) => i === s.activeFrameIdx
          ? { ...f, quickadds: f.quickadds.map((q) => q.id === d.id
              ? { ...q, x: d.beforeX, y: d.beforeY } : q) }
          : f),
      });
      this.drag = null;
    }
  }

  private toMap(e: PointerEvent): { x: number; y: number } {
    return clientToMap(e.clientX, e.clientY, this.deps.getViewport());
  }

  getContextPanel(): HTMLElement | null {
    const panel = document.createElement('div');
    panel.setAttribute('class', 'cp-panel cp-panel-quickadd');

    const segmented = document.createElement('div');
    segmented.setAttribute('class', 'cp-segmented cp-segmented-grid');

    QUICKADD_TYPES_ORDER.forEach((t) => {
      const btn = document.createElement('button');
      btn.setAttribute('class', 'cp-segmented-btn');
      btn.setAttribute('data-type', t);
      btn.textContent = QUICKADD_LABELS[t];

      if (t === this.type) {
        btn.classList.add('active');
      }

      btn.addEventListener('click', () => {
        this.setType(t);
        // Re-sync all buttons' active classes
        const allBtns = segmented.querySelectorAll('.cp-segmented-btn');
        allBtns.forEach((b) => {
          const btnType = b.getAttribute('data-type') as QuickAddType;
          if (btnType === this.type) {
            b.classList.add('active');
          } else {
            b.classList.remove('active');
          }
        });
      });

      segmented.appendChild(btn);
    });

    panel.appendChild(segmented);

    // Show-ranges toggle. Restored from v1 - flips every quickadd in the
    // active frame between the icon sprite and the calibrated radius
    // overlay, and seeds future placements with the same default.
    const toggleRow = document.createElement('div');
    toggleRow.className = 'cp-toggle-row';

    const toggleLabel = document.createElement('span');
    toggleLabel.className = 'cp-label';
    toggleLabel.textContent = 'SHOW RANGES';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'cp-segmented-btn';
    toggleBtn.setAttribute('data-toggle', 'show-ranges');
    toggleBtn.setAttribute('aria-pressed', String(this.showRanges));
    toggleBtn.textContent = this.showRanges ? 'ON' : 'OFF';
    if (this.showRanges) toggleBtn.classList.add('active');

    toggleBtn.addEventListener('click', () => {
      this.setShowRanges(!this.showRanges);
      toggleBtn.textContent = this.showRanges ? 'ON' : 'OFF';
      toggleBtn.classList.toggle('active', this.showRanges);
      toggleBtn.setAttribute('aria-pressed', String(this.showRanges));
    });

    toggleRow.appendChild(toggleLabel);
    toggleRow.appendChild(toggleBtn);
    panel.appendChild(toggleRow);

    return panel;
  }
}

function findQuickAddAt(items: QuickAdd[], mx: number, my: number): QuickAdd | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const q = items[i]!;
    if (Math.hypot(q.x - mx, q.y - my) < QA_HIT_R) return q;
  }
  return null;
}
