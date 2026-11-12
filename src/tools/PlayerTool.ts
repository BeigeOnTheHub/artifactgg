import { nanoid } from 'nanoid';
import type { Store } from '../app/store';
import type { History } from '../app/history';
import type { Player, Team } from '../types/primitives';
import { clientToMap, type Viewport } from '../render/coords';
import { playerRadiusFor } from '../render/PlayerLayer';
import type { ToolController } from '../app/tools';
import { sanitiseText } from '../app/sanitiseText';
import {
  getPlayerSizeMode, setPlayerSizeMode,
  getPlayerSizeFactor, setPlayerSizeFactor,
  MIN_PLAYER_FACTOR, MAX_PLAYER_FACTOR,
} from '../app/playerSizePref';

const MAX_PER_TEAM = 5;
const DRAG_THRESHOLD = 4;
// Base ring radius the node is drawn at, and the slightly-larger base hit
// radius (so the click target is a touch more forgiving than the visual ring).
const PLAYER_BASE_R = 14;
const PLAYER_HIT_R = 16;

export interface PlayerToolDeps {
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
  beforeDead: boolean;
}

export class PlayerTool implements ToolController {
  readonly id = 'place-player' as const;

  private team: Team = 'colonist';
  private nextName: string = '';
  private spawnDead: boolean = false;
  private downAt: { x: number; y: number } | null = null;
  private drag: InflightDrag | null = null;
  private offDown: () => void = () => {};
  private offMove: () => void = () => {};
  private offUp: () => void = () => {};
  private offContext: () => void = () => {};

  constructor(private deps: PlayerToolDeps) {}

  setTeam(team: Team): void { this.team = team; }
  getTeam(): Team { return this.team; }
  setNextName(name: string): void { this.nextName = name; }
  getNextName(): string { return this.nextName; }
  setSpawnDead(dead: boolean): void { this.spawnDead = dead; }
  getSpawnDead(): boolean { return this.spawnDead; }

  attach(target: HTMLElement): void {
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      e.preventDefault();
      const pt = this.toMap(e);
      const frame = this.deps.store.get().frames[this.deps.store.get().activeFrameIdx]!;
      const hit = findPlayerAt(frame.players, pt.x, pt.y, this.hitRadius());
      if (hit) {
        this.drag = {
          id: hit.id,
          startX: pt.x, startY: pt.y,
          beforeX: hit.x, beforeY: hit.y,
          beforeDead: hit.dead,
        };
        target.setPointerCapture(e.pointerId);
      } else {
        this.downAt = pt;
      }
    };
    const onMove = (e: PointerEvent): void => {
      if (!this.drag) return;
      const pt = this.toMap(e);
      const s = this.deps.store.get();
      const frame = s.frames[s.activeFrameIdx]!;
      const next = frame.players.map((p) => p.id === this.drag!.id
        ? { ...p, x: this.drag!.beforeX + (pt.x - this.drag!.startX),
                  y: this.drag!.beforeY + (pt.y - this.drag!.startY) }
        : p);
      this.deps.store._apply({
        frames: s.frames.map((f, i) =>
          i === s.activeFrameIdx ? { ...f, players: next } : f),
      });
    };
    const onUp = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      if (this.drag) {
        const id = this.drag.id;
        const s = this.deps.store.get();
        const frame = s.frames[s.activeFrameIdx]!;
        const after = frame.players.find((p) => p.id === id)!;
        const dx = after.x - this.drag.beforeX;
        const dy = after.y - this.drag.beforeY;
        const moved = Math.hypot(dx, dy) > DRAG_THRESHOLD;
        if (moved) {
          // Revert live-preview back to before position so history.dispatch
          // sees the "before" state and can correctly invert.
          this.deps.store._apply({
            frames: s.frames.map((f, i) => i === s.activeFrameIdx
              ? { ...f, players: f.players.map((p) => p.id === id
                  ? { ...p, x: this.drag!.beforeX, y: this.drag!.beforeY }
                  : p) }
              : f),
          });
          this.deps.history.dispatch({
            t: 'player.modify', id,
            before: { x: this.drag.beforeX, y: this.drag.beforeY },
            after: { x: after.x, y: after.y },
          });
        } else {
          // Click on player - revert live-preview (no actual move) then toggle dead.
          this.deps.store._apply({
            frames: s.frames.map((f, i) => i === s.activeFrameIdx
              ? { ...f, players: f.players.map((p) => p.id === id
                  ? { ...p, x: this.drag!.beforeX, y: this.drag!.beforeY }
                  : p) }
              : f),
          });
          this.deps.history.dispatch({
            t: 'player.modify', id,
            before: { dead: this.drag.beforeDead },
            after: { dead: !this.drag.beforeDead },
          });
        }
        this.drag = null;
        try { target.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      } else if (this.downAt) {
        const up = this.toMap(e);
        const dragged = Math.hypot(up.x - this.downAt.x, up.y - this.downAt.y) > DRAG_THRESHOLD;
        const startPt = this.downAt;
        this.downAt = null;
        if (dragged) return;
        const s = this.deps.store.get();
        const frame = s.frames[s.activeFrameIdx]!;
        const teamCount = frame.players.filter((p) => p.team === this.team).length;
        if (teamCount >= MAX_PER_TEAM) return;
        const player: Player = {
          id: nanoid(),
          team: this.team,
          x: startPt.x, y: startPt.y,
          name: sanitiseText(this.nextName, { maxLen: 24 }),
          dead: this.spawnDead,
        };
        this.deps.history.dispatch({ t: 'player.add', player });
      }
    };
    const onContext = (e: MouseEvent): void => {
      const pt = clientToMap(e.clientX, e.clientY, this.deps.getViewport());
      const s = this.deps.store.get();
      const frame = s.frames[s.activeFrameIdx]!;
      const hit = findPlayerAt(frame.players, pt.x, pt.y, this.hitRadius());
      if (!hit) return;
      e.preventDefault();
      this.deps.history.dispatch({ t: 'player.delete', ids: [hit.id] });
    };

    // pointercancel = interrupted gesture: revert any in-flight player drag
    // and drop the placement candidate instead of committing at the cursor's
    // interrupted position. Mirrors the ConeTool / SelectTool fix.
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
   *  live player move to its pre-drag snapshot and drop the placement
   *  candidate. Dispatches no command. */
  cancel(): void {
    if (this.drag) {
      const d = this.drag;
      const s = this.deps.store.get();
      this.deps.store._apply({
        frames: s.frames.map((f, i) => i === s.activeFrameIdx
          ? { ...f, players: f.players.map((p) => p.id === d.id
              ? { ...p, x: d.beforeX, y: d.beforeY } : p) }
          : f),
      });
      this.drag = null;
    }
    this.downAt = null;
  }

  getContextPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'cp-panel cp-panel-player';

    // Team row
    const teamRow = document.createElement('div');
    teamRow.className = 'cp-toggle-row';
    const teamLabel = document.createElement('span');
    teamLabel.className = 'cp-label';
    teamLabel.textContent = 'TEAM';
    const teamBtn = document.createElement('button');
    teamBtn.className = 'cp-segmented-btn active';
    teamBtn.setAttribute('data-team-toggle', '');
    teamBtn.textContent = this.team.toUpperCase();
    teamBtn.addEventListener('click', () => {
      this.team = this.team === 'colonist' ? 'reyab' : 'colonist';
      teamBtn.textContent = this.team.toUpperCase();
    });
    teamRow.appendChild(teamLabel);
    teamRow.appendChild(teamBtn);
    panel.appendChild(teamRow);

    // Name row - same .cp-toggle-row container as TEAM / SPAWN DEAD so the
    // three rows share one rhythm (label left, control right). The input is
    // sized to match the segmented pills by `.cp-toggle-row .cp-input` in
    // context-panel.css.
    const nameRow = document.createElement('div');
    nameRow.className = 'cp-toggle-row';
    const nameLabel = document.createElement('span');
    nameLabel.className = 'cp-label';
    nameLabel.textContent = 'NAME';
    const nameInput = document.createElement('input');
    nameInput.setAttribute('type', 'text');
    // Compact so the NAME row lines up with the TEAM / SPAWN-DEAD toggle rows.
    nameInput.className = 'cp-input cp-input--compact';
    nameInput.setAttribute('maxLength', '24');
    nameInput.value = this.nextName;
    nameInput.setAttribute('placeholder', 'Default for next spawn');
    nameInput.setAttribute('spellcheck', 'false');
    nameInput.setAttribute('autocomplete', 'off');
    nameInput.setAttribute('aria-label', 'Default player name');
    nameInput.addEventListener('input', () => {
      this.setNextName(nameInput.value);
    });
    nameRow.appendChild(nameLabel);
    nameRow.appendChild(nameInput);
    panel.appendChild(nameRow);

    // Dead row
    const deadRow = document.createElement('div');
    deadRow.className = 'cp-toggle-row';
    const deadLabel = document.createElement('span');
    deadLabel.className = 'cp-label';
    deadLabel.textContent = 'SPAWN DEAD';
    const deadBtn = document.createElement('button');
    deadBtn.className = this.spawnDead ? 'cp-segmented-btn active' : 'cp-segmented-btn';
    deadBtn.setAttribute('data-dead-toggle', '');
    deadBtn.textContent = this.spawnDead ? 'YES' : 'NO';
    deadBtn.addEventListener('click', () => {
      this.spawnDead = !this.spawnDead;
      deadBtn.textContent = this.spawnDead ? 'YES' : 'NO';
      if (this.spawnDead) {
        deadBtn.classList.add('active');
      } else {
        deadBtn.classList.remove('active');
      }
    });
    deadRow.appendChild(deadLabel);
    deadRow.appendChild(deadBtn);
    panel.appendChild(deadRow);

    // SIZE - auto (fixed constant size) vs manual (scales with the map zoom).
    // The SCALE slider only applies in manual mode, so it greys out on auto.
    const sizeRow = document.createElement('div');
    sizeRow.className = 'cp-toggle-row';
    const sizeLabel = document.createElement('span');
    sizeLabel.className = 'cp-label';
    sizeLabel.textContent = 'SIZE';
    sizeRow.appendChild(sizeLabel);

    const modeGroup = document.createElement('div');
    modeGroup.className = 'cp-segmented';
    const modeButtons = new Map<'auto' | 'manual', HTMLButtonElement>();

    // SCALE slider row (built first so the mode buttons can toggle it).
    const scaleRow = document.createElement('div');
    scaleRow.className = 'cp-row';
    const scaleLabel = document.createElement('span');
    scaleLabel.className = 'cp-label';
    scaleLabel.textContent = 'SCALE';
    const scaleSlider = document.createElement('input');
    scaleSlider.type = 'range';
    scaleSlider.className = 'cp-slider';
    scaleSlider.min = String(Math.round(MIN_PLAYER_FACTOR * 100));
    scaleSlider.max = String(Math.round(MAX_PLAYER_FACTOR * 100));
    scaleSlider.step = '5';
    scaleSlider.value = String(Math.round(getPlayerSizeFactor() * 100));
    scaleSlider.setAttribute('aria-label', 'Player node scale');
    const scaleValue = document.createElement('span');
    scaleValue.className = 'cp-value';
    scaleValue.textContent = `${scaleSlider.value}%`;

    const syncScaleEnabled = (): void => {
      const manual = getPlayerSizeMode() === 'manual';
      scaleSlider.disabled = !manual;
      scaleRow.classList.toggle('cp-row--disabled', !manual);
    };

    scaleSlider.addEventListener('input', () => {
      setPlayerSizeFactor(Number(scaleSlider.value) / 100);
      scaleValue.textContent = `${scaleSlider.value}%`;
    });

    for (const mode of ['auto', 'manual'] as const) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const on = getPlayerSizeMode() === mode;
      btn.className = on ? 'cp-segmented-btn active' : 'cp-segmented-btn';
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('data-size-mode', mode);
      btn.textContent = mode.toUpperCase();
      btn.addEventListener('click', () => {
        setPlayerSizeMode(mode);
        for (const [m, b] of modeButtons) {
          const active = m === mode;
          b.classList.toggle('active', active);
          b.setAttribute('aria-pressed', String(active));
        }
        syncScaleEnabled();
      });
      modeButtons.set(mode, btn);
      modeGroup.appendChild(btn);
    }
    sizeRow.appendChild(modeGroup);
    panel.appendChild(sizeRow);

    scaleRow.appendChild(scaleLabel);
    scaleRow.appendChild(scaleSlider);
    scaleRow.appendChild(scaleValue);
    panel.appendChild(scaleRow);
    syncScaleEnabled();

    return panel;
  }

  private toMap(e: PointerEvent): { x: number; y: number } {
    return clientToMap(e.clientX, e.clientY, this.deps.getViewport());
  }

  // Hit testing happens in map space but the node is drawn in screen pixels, so
  // convert the rendered ring radius back through the zoom. Keep the same little
  // bit of extra slack the original fixed radius had (16 vs 14) so the click
  // target stays a touch more forgiving than the visible ring.
  private hitRadius(): number {
    const zoom = this.deps.getViewport().zoom || 1;
    const screenR = playerRadiusFor(zoom) * (PLAYER_HIT_R / PLAYER_BASE_R);
    return screenR / zoom;
  }
}

function findPlayerAt(players: Player[], mx: number, my: number, hitR: number): Player | null {
  // Iterate in reverse so the topmost (most recently placed) wins ties.
  for (let i = players.length - 1; i >= 0; i--) {
    const p = players[i]!;
    if (Math.hypot(p.x - mx, p.y - my) < hitR) return p;
  }
  return null;
}
