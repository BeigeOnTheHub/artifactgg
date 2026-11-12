import '../styles/command-palette.css';
import type { Store } from '../app/store';
import type { Actions, Action } from '../app/actions';
import { activateModalA11y } from '../app/modalA11y';

interface ScoredAction { action: Action; score: number; }

/**
 * Subsequence + density score. Returns NaN when the query characters do not all appear
 * in `text` in order. Higher scores = better matches (substring = highest).
 */
function fuzzyScore(text: string, query: string): number {
  if (query.length === 0) return 1;
  const T = text.toLowerCase();
  const Q = query.toLowerCase();
  let i = 0; // T index
  let j = 0; // Q index
  let lastIdx = -1;
  let densitySum = 0;
  while (i < T.length && j < Q.length) {
    if (T[i] === Q[j]) {
      const gap = lastIdx < 0 ? 0 : i - lastIdx - 1;
      densitySum += 1 / (1 + gap);
      lastIdx = i;
      j++;
    }
    i++;
  }
  if (j < Q.length) return NaN;
  return densitySum;
}

export class CommandPalette {
  private root: HTMLElement;
  private inner: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLElement;
  private rows: HTMLElement[] = [];
  private selectedIdx = 0;
  private query = '';
  private filtered: Action[] = [];
  private deactivateA11y: (() => void) | null = null;
  private unsubUi: () => void = () => {};

  constructor(
    private host: HTMLElement,
    private store: Store,
    private actions: Actions,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'command-palette';
    this.root.hidden = true;

    this.inner = document.createElement('div');
    this.inner.className = 'cp-inner';

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'cp-input';
    this.input.placeholder = 'Type a command...';
    this.input.spellcheck = false;
    this.input.setAttribute('aria-label', 'Command palette filter');

    this.list = document.createElement('div');
    this.list.className = 'cp-list';

    this.inner.appendChild(this.input);
    this.inner.appendChild(this.list);
    this.root.appendChild(this.inner);
  }

  mount(): void {
    this.host.appendChild(this.root);

    this.input.addEventListener('input', () => {
      this.query = this.input.value;
      this.selectedIdx = 0;
      this.renderList();
    });
    this.input.addEventListener('keydown', (e) => this.onInputKey(e));

    this.unsubUi = this.store.subscribe(['ui'], () => this.syncOpenState());
    this.renderList();
    this.syncOpenState();
  }

  destroy(): void {
    this.unsubUi();
    if (this.deactivateA11y) {
      this.deactivateA11y();
      this.deactivateA11y = null;
    }
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
  }

  private syncOpenState(): void {
    const open = this.store.get().ui.paletteOpen;
    if (open === !this.root.hidden) return; // no change
    this.root.hidden = !open;
    if (open) {
      this.input.value = '';
      this.query = '';
      this.selectedIdx = 0;
      this.renderList();
      this.deactivateA11y = activateModalA11y({
        panel: this.inner, ariaLabel: 'Command palette', initialFocus: this.input,
      });
    } else if (this.deactivateA11y) {
      this.deactivateA11y();
      this.deactivateA11y = null;
    }
  }

  private onInputKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.move(+1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.move(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.runSelected();
    }
    // Esc handled by app/keyboard.ts router precedence.
  }

  private move(delta: number): void {
    if (this.filtered.length === 0) return;
    this.selectedIdx = (this.selectedIdx + delta + this.filtered.length) % this.filtered.length;
    this.renderSelection();
  }

  private renderSelection(): void {
    this.rows.forEach((row, i) => row.classList.toggle('selected', i === this.selectedIdx));
  }

  private renderList(): void {
    while (this.list.firstChild) this.list.removeChild(this.list.firstChild);
    this.rows = [];

    if (this.query.length === 0) {
      this.filtered = this.actions.list();
    } else {
      const scored: ScoredAction[] = [];
      for (const a of this.actions.list()) {
        const idScore = fuzzyScore(a.id, this.query);
        const titleScore = fuzzyScore(a.title, this.query);
        const combined = fuzzyScore(`${a.title} ${a.id}`, this.query);
        const candidates = [idScore, titleScore, combined].filter((s) => !Number.isNaN(s));
        if (candidates.length === 0) continue;
        const score = Math.max(...candidates);
        scored.push({ action: a, score });
      }
      scored.sort((x, y) => y.score - x.score);
      this.filtered = scored.map((s) => s.action);
    }

    const state = this.store.get();
    for (const a of this.filtered) {
      const row = document.createElement('div');
      row.className = 'cp-row';
      row.dataset['id'] = a.id;
      const enabled = !a.canRun || a.canRun(state);
      if (!enabled) row.classList.add('disabled');

      const group = document.createElement('span');
      group.className = 'cp-group';
      group.textContent = a.group;

      const title = document.createElement('span');
      title.className = 'cp-title';
      title.textContent = a.title;

      const hk = document.createElement('span');
      hk.className = 'cp-hotkey';
      hk.textContent = a.hotkey ?? '';

      row.appendChild(group);
      row.appendChild(title);
      row.appendChild(hk);

      row.addEventListener('click', () => {
        if (!enabled) return;
        this.runAction(a);
      });

      this.list.appendChild(row);
      this.rows.push(row);
    }

    if (this.selectedIdx >= this.rows.length) this.selectedIdx = Math.max(0, this.rows.length - 1);
    this.renderSelection();
  }

  private runSelected(): void {
    const a = this.filtered[this.selectedIdx];
    if (!a) return;
    const state = this.store.get();
    if (a.canRun && !a.canRun(state)) return;
    this.runAction(a);
  }

  private runAction(a: Action): void {
    this.actions.run(a.id);
    const ui = this.store.get().ui;
    this.store._apply({ ui: { ...ui, paletteOpen: false } });
  }
}
