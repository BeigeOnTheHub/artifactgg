import type { Store } from '../app/store';
import type { StrokeLayer } from './StrokeLayer';
import type { ShapeLayer } from './ShapeLayer';
import type { ConeLayer } from './ConeLayer';
import type { PlayerLayer } from './PlayerLayer';
import type { QuickAddLayer } from './QuickAddLayer';
import type { TextLayer } from './TextLayer';

/**
 * Tools under which a selection is meaningful, and so gets the highlight. Same
 * set ContextPanel uses to decide whether to show the selection editor. The
 * compact viewer's select id is `cursor`, so it is covered by this too.
 */
const SELECTION_TOOLS: ReadonlySet<string> = new Set(['cursor', 'select', 'lasso']);

export interface HighlightLayers {
  strokeLayer: StrokeLayer;
  shapeLayer: ShapeLayer;
  coneLayer: ConeLayer;
  playerLayer: PlayerLayer;
  quickAddLayer: QuickAddLayer;
  textLayer: TextLayer;
}

/**
 * Paints `.sel-highlight` (the green glow in styles/selection.css) onto whatever
 * is in `store.selection`.
 *
 * Driven off the store, not SelectTool, because the compact viewer never attaches
 * SelectTool (touch selection goes through TouchViewportController, which only
 * writes store.selection). Mounted by both profiles.
 */
export class SelectionHighlight {
  private unsub: () => void = () => {};

  constructor(private store: Store, private layers: HighlightLayers) {}

  mount(): void {
    this.apply();
    // frames/activeFrameIdx: the layers rebuild their nodes on a frame switch,
    // which would otherwise drop the highlight off a still-live selection.
    this.unsub = this.store.subscribe(
      ['selection', 'tool', 'frames', 'activeFrameIdx'],
      () => this.apply(),
    );
  }

  destroy(): void {
    this.unsub();
    this.unsub = () => {};
    this.clear();
  }

  private clear(): void {
    document.querySelectorAll('.sel-highlight').forEach((el) => el.classList.remove('sel-highlight'));
    this.layers.strokeLayer.setHighlightedIds(new Set());
  }

  private apply(): void {
    const s = this.store.get();
    const sel = SELECTION_TOOLS.has(s.tool) ? s.selection : [];

    const byKind: Record<string, Set<string>> = {
      player: new Set(), cone: new Set(), shape: new Set(),
      textbox: new Set(), quickadd: new Set(), stroke: new Set(),
      scanner: new Set(),
    };
    for (const r of sel) byKind[r.kind]?.add(r.id);

    const frame = s.frames[s.activeFrameIdx];
    if (!frame) { this.clear(); return; }

    const paint = (node: Element | null, on: boolean): void => {
      if (!node) return;
      node.classList.toggle('sel-highlight', on);
    };

    for (const p of frame.players) paint(this.layers.playerLayer.getNode(p.id), byKind['player']!.has(p.id));
    for (const c of frame.cones) paint(this.layers.coneLayer.getNode(c.id), byKind['cone']!.has(c.id));
    for (const sh of frame.shapes) paint(this.layers.shapeLayer.getNode(sh.id), byKind['shape']!.has(sh.id));
    for (const b of frame.textboxes) paint(this.layers.textLayer.getNode(b.id), byKind['textbox']!.has(b.id));
    for (const q of frame.quickadds) paint(this.layers.quickAddLayer.getNode(q.id), byKind['quickadd']!.has(q.id));

    this.layers.strokeLayer.setHighlightedIds(byKind['stroke']!);

    const sc = document.querySelector('.scanner-el');
    paint(sc, byKind['scanner']!.has('scanner'));
  }
}
