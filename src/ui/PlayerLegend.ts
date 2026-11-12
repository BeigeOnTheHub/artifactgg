import '../styles/player-legend.css';
import type { Store } from '../app/store';
import type { Player } from '../types/primitives';
import { TEAM_COLOURS } from '../render/team-colours';

/** Colonist rows before reyab rows, matching PlayerLayer's draw order. */
const TEAM_ORDER: Player['team'][] = ['colonist', 'reyab'];

/**
 * A small overlay listing every named player in the active frame, grouped by
 * side - each row shows the team-coloured per-team number, a colour dot, the
 * name, and a skull glyph if the player is down. Hidden entirely when nobody
 * has a name. Purely informational (pointer-events:none), so it never steals
 * clicks from the map. Ported from the v1 build's `#player-legend`.
 */
export class PlayerLegend {
  private el: HTMLDivElement;
  private unsub: () => void = () => {};
  private unsubLayout: () => void = () => {};
  /** Expanded state for the compact toggle. Only meaningful in compact mode. */
  private compactExpanded: boolean = false;

  constructor(private host: HTMLElement, private store: Store) {
    this.el = document.createElement('div');
    this.el.id = 'player-legend';
    this.el.setAttribute('aria-label', 'Named players');
  }

  mount(): void {
    this.host.appendChild(this.el);
    this.render();
    this.unsub = this.store.subscribe(['frames', 'activeFrameIdx'], () => this.render());
    this.unsubLayout = this.store.subscribe(['layoutMode'], () => {
      // Reset expanded state whenever layout mode changes so we start collapsed
      // each time compact mode is activated.
      this.compactExpanded = false;
      this.render();
    });
  }

  destroy(): void {
    this.unsub();
    this.unsubLayout();
    this.el.remove();
  }

  private isCompact(): boolean {
    return (this.store.get().layoutMode ?? 'desktop') === 'compact';
  }

  private render(): void {
    const s = this.store.get();
    const players = s.frames[s.activeFrameIdx]!.players;
    const numbering = perTeamNumbering(players);
    const named = players.filter((p) => p.name.trim() !== '');

    if (this.isCompact()) {
      this.renderCompact(named, numbering);
    } else {
      this.renderDesktop(named, numbering);
    }
  }

  private renderDesktop(named: Player[], numbering: Map<string, number>): void {
    if (named.length === 0) {
      this.el.hidden = true;
      this.el.replaceChildren();
      return;
    }
    this.el.hidden = false;
    this.el.replaceChildren(buildList(orderedRows(named, numbering)));
  }

  private renderCompact(named: Player[], numbering: Map<string, number>): void {
    // Same rule renderDesktop has: nobody named, nothing rendered. The compact
    // branch used to emit its expander arrow regardless, so a fresh strat had a
    // mystery button in the top-left corner that toggled an empty list.
    if (named.length === 0) {
      this.el.hidden = true;
      this.el.replaceChildren();
      return;
    }
    this.el.hidden = false;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'mob-legend-toggle';
    toggle.setAttribute('aria-label', 'Toggle player legend');
    toggle.setAttribute('aria-expanded', String(this.compactExpanded));
    toggle.setAttribute('data-testid', 'legend-toggle');
    toggle.textContent = this.compactExpanded ? '▲' : '▼';
    toggle.addEventListener('click', () => {
      this.compactExpanded = !this.compactExpanded;
      this.render();
    });

    const children: Node[] = [toggle];

    if (this.compactExpanded && named.length > 0) {
      children.push(buildList(orderedRows(named, numbering)));
    }

    this.el.replaceChildren(...children);
  }
}

function orderedRows(named: Player[], numbering: Map<string, number>): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (const team of TEAM_ORDER) {
    for (const p of named) {
      if (p.team !== team) continue;
      rows.push(legendRow(p, numbering.get(p.id) ?? 0));
    }
  }
  return rows;
}

/** Wrap a set of <li> rows in a <ul> so screen readers announce the count
 *  and let users navigate the legend as a list rather than a wall of text. */
function buildList(rows: HTMLElement[]): HTMLUListElement {
  const ul = document.createElement('ul');
  ul.className = 'legend-list';
  for (const row of rows) ul.appendChild(row);
  return ul;
}

/** Per-team 1-based numbering by array order - same scheme as PlayerLayer. */
function perTeamNumbering(players: Player[]): Map<string, number> {
  const out = new Map<string, number>();
  let nC = 0, nR = 0;
  for (const p of players) {
    out.set(p.id, p.team === 'colonist' ? ++nC : ++nR);
  }
  return out;
}

function legendRow(p: Player, num: number): HTMLElement {
  const colour = TEAM_COLOURS[p.team];
  const row = document.createElement('li');
  row.className = 'legend-row';

  const n = document.createElement('span');
  n.className = 'legend-num';
  n.style.color = colour;
  n.textContent = String(num);

  const dot = document.createElement('span');
  dot.className = 'legend-dot';
  dot.style.background = colour;

  const name = document.createElement('span');
  name.className = 'legend-name';
  name.textContent = p.name.trim();

  row.append(n, dot, name);

  if (p.dead) {
    // Skull-and-crossbones glyph marks a downed player, matching the v1 legend.
    const skull = document.createElement('span');
    skull.className = 'legend-skull';
    skull.textContent = '☠';
    skull.setAttribute('aria-label', 'down');
    row.appendChild(skull);
  }
  return row;
}
