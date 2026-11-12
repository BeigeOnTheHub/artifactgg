import type { Store } from '../app/store';
import { sanitiseText } from '../app/sanitiseText';
import type { History } from '../app/history';
import { DASH_STYLES, type DashStyle, type SelectionRef, type Player, type Cone } from '../types/primitives';
import { SPREAD_PRESET_LABELS } from '../tools/cone-presets';

/**
 * Context panel for the cursor / select / lasso tools when exactly one item is
 * selected. Returns null for selections with no inline editor (the scanner), so
 * the caller falls back to the tool's panel. The compact viewer's selection
 * sheet renders the same thing.
 */
export function buildSelectionEditor(
  store: Store,
  history: History,
  ref: SelectionRef,
): HTMLElement | null {
  const state = store.get();
  // Not `!`: with no frames (or a stale activeFrameIdx) this is undefined, and the
  // branches below dereference it. Nothing to edit without a frame anyway.
  const frame = state.frames[state.activeFrameIdx];
  if (!frame) return null;

  if (ref.kind === 'textbox') {
    const box = frame.textboxes.find((b) => b.id === ref.id);
    if (!box) return null;
    return buildFontSizeEditor(store, history, ref.id, box.fontSize);
  }

  if (ref.kind === 'shape') {
    const shape = frame.shapes.find((s) => s.id === ref.id);
    if (!shape) return null;
    return buildShapeThicknessEditor(store, history, ref.id, shape.strokeWidth);
  }

  if (ref.kind === 'quickadd') {
    const qa = frame.quickadds.find((q) => q.id === ref.id);
    if (!qa || qa.type === 'scanner') return null; // scanner has no range overlay
    return buildShowRangesEditor(history, ref.id, qa.rangeVisible);
  }

  if (ref.kind === 'player') {
    const player = frame.players.find((p) => p.id === ref.id);
    if (!player) return null;
    return buildPlayerEditor(history, player);
  }

  if (ref.kind === 'cone') {
    const cone = frame.cones.find((c) => c.id === ref.id);
    if (!cone) return null;
    return buildConeSpreadEditor(history, ref.id, cone.spreadIdx);
  }

  if (ref.kind === 'stroke') {
    const stroke = frame.strokes.find((s) => s.id === ref.id);
    if (!stroke) return null;
    return buildStrokeStyleEditor(history, ref.id, stroke.dash ?? 'solid');
  }

  return null;
}

// Restyle a placed stroke's line between solid / dashed / dotted, the same
// segmented control the draw tool uses for new strokes. One stroke.modify per
// click so each change is a single undo step.
function buildStrokeStyleEditor(history: History, id: string, current: DashStyle): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'cp-panel cp-panel-selection';

  const label = document.createElement('span');
  label.className = 'cp-label';
  label.textContent = 'STYLE';
  panel.appendChild(label);

  const group = document.createElement('div');
  group.className = 'cp-segmented cp-segmented--wrap';

  let state = current;
  const buttons = new Map<DashStyle, HTMLButtonElement>();
  for (const style of DASH_STYLES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    const on = style === state;
    btn.className = on ? 'cp-segmented-btn active' : 'cp-segmented-btn';
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('data-dash', style);
    btn.textContent = style.toUpperCase();
    btn.addEventListener('click', () => {
      if (style === state) return;
      const before = state;
      state = style;
      for (const [s, b] of buttons) {
        const active = s === style;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      }
      history.dispatch({ t: 'stroke.modify', id, before: { dash: before }, after: { dash: style } });
    });
    buttons.set(style, btn);
    group.appendChild(btn);
  }
  panel.appendChild(group);
  return panel;
}

const FONT_MIN = 8;
const FONT_MAX = 48;

function buildFontSizeEditor(store: Store, history: History, id: string, current: number): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'cp-panel cp-panel-selection';

  panel.appendChild(buildTextRow(store, history, id));

  const row = document.createElement('div');
  row.className = 'cp-row';

  const label = document.createElement('span');
  label.className = 'cp-label';
  label.textContent = 'FONT SIZE';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'cp-slider';
  slider.min = String(FONT_MIN);
  slider.max = String(FONT_MAX);
  slider.value = String(current);
  slider.setAttribute('aria-label', 'Font size');

  const value = document.createElement('span');
  value.className = 'cp-value';
  value.textContent = String(current);

  // Snapshot the box's font size at the start of a drag so the whole drag
  // collapses into one undo step. During the drag itself we _apply each tick
  // live -- previously only the displayed label moved while the box stayed
  // frozen at the start size, which felt broken on a slow drag. The single
  // history command on `change` records before -> after for undo.
  let before = current;
  const currentFontSize = (): number => {
    const s = store.get();
    const b = s.frames[s.activeFrameIdx]!.textboxes.find((x) => x.id === id);
    return b ? b.fontSize : current;
  };
  slider.addEventListener('pointerdown', () => { before = currentFontSize(); });
  slider.addEventListener('input', () => {
    const cur = Number(slider.value);
    value.textContent = String(cur);
    // Live preview via _apply -- not undoable on its own. The single
    // history command lands on `change`, see below.
    const s = store.get();
    const tbs = s.frames[s.activeFrameIdx]!.textboxes;
    const nextBoxes = tbs.map((b) => b.id === id ? { ...b, fontSize: cur } : b);
    const nextFrames = s.frames.map((f, i) => i === s.activeFrameIdx ? { ...f, textboxes: nextBoxes } : f);
    store._apply({ frames: nextFrames });
  });
  slider.addEventListener('change', () => {
    const after = Number(slider.value);
    if (after === before) return;
    history.dispatch({ t: 'textbox.modify', id, before: { fontSize: before }, after: { fontSize: after } });
  });

  row.append(label, slider, value);
  panel.append(row);
  return panel;
}

/**
 * The text box's words in a normal-sized field. The on-map textarea sits inside
 * the zoomed `#map-canvas-wrap`, so on a phone (portrait zoom 0.406) a 13px font
 * renders at about 5px and you cannot place a caret in it. This is the way in on
 * touch; both write the same `textbox.modify`.
 *
 * Like the font size slider below: `input` previews via `_apply`, `change` lands
 * one history command.
 */
function buildTextRow(store: Store, history: History, id: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'cp-row';

  const label = document.createElement('span');
  label.className = 'cp-label';
  label.textContent = 'TEXT';

  const field = document.createElement('textarea');
  field.className = 'cp-text-input';
  field.dataset['testid'] = 'textbox-text-input';
  field.rows = 2;
  field.setAttribute('aria-label', 'Text box contents');
  field.value = currentText(store, id);

  // Snapshot before the first keystroke of a burst, so the whole burst is one
  // undo step rather than one per character.
  let before = field.value;
  field.addEventListener('focus', () => { before = currentText(store, id); });
  field.addEventListener('input', () => {
    const s = store.get();
    const next = sanitiseText(field.value, { allowNewlines: true, collapseWhitespace: false, maxLen: 2048 });
    const boxes = s.frames[s.activeFrameIdx]!.textboxes.map((b) => (b.id === id ? { ...b, text: next } : b));
    store._apply({ frames: s.frames.map((f, i) => (i === s.activeFrameIdx ? { ...f, textboxes: boxes } : f)) });
  });
  field.addEventListener('change', () => {
    const after = currentText(store, id);
    if (after === before) return;
    history.dispatch({ t: 'textbox.modify', id, before: { text: before }, after: { text: after } });
    before = after;
  });

  row.append(label, field);
  return row;
}

function currentText(store: Store, id: string): string {
  const s = store.get();
  return s.frames[s.activeFrameIdx]!.textboxes.find((b) => b.id === id)?.text ?? '';
}

// Match the shapes tool's clamp so editing a placed shape and drawing a fresh
// one share the same thickness range.
const THICKNESS_MIN = 1;
const THICKNESS_MAX = 20;

// Lets the user change a placed shape's line thickness after it's been
// dropped and deselected, the same way the font-size slider works for a text
// box. Live-previews via _apply each tick and lands a single shape.modify on
// change so the whole drag is one undo step.
function buildShapeThicknessEditor(store: Store, history: History, id: string, current: number): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'cp-panel cp-panel-selection';

  const row = document.createElement('div');
  row.className = 'cp-row';

  const label = document.createElement('span');
  label.className = 'cp-label';
  label.textContent = 'THICKNESS';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'cp-slider';
  slider.min = String(THICKNESS_MIN);
  slider.max = String(THICKNESS_MAX);
  slider.value = String(current);
  slider.setAttribute('aria-label', 'Shape thickness');

  const value = document.createElement('span');
  value.className = 'cp-value';
  value.textContent = String(current);

  const currentWidth = (): number => {
    const s = store.get();
    const sh = s.frames[s.activeFrameIdx]!.shapes.find((x) => x.id === id);
    return sh ? sh.strokeWidth : current;
  };
  let before = current;
  slider.addEventListener('pointerdown', () => { before = currentWidth(); });
  slider.addEventListener('input', () => {
    const cur = Number(slider.value);
    value.textContent = String(cur);
    const s = store.get();
    const shapes = s.frames[s.activeFrameIdx]!.shapes;
    const nextShapes = shapes.map((sh) => sh.id === id ? { ...sh, strokeWidth: cur } : sh);
    const nextFrames = s.frames.map((f, i) => i === s.activeFrameIdx ? { ...f, shapes: nextShapes } : f);
    store._apply({ frames: nextFrames });
  });
  slider.addEventListener('change', () => {
    const after = Number(slider.value);
    if (after === before) return;
    history.dispatch({ t: 'shape.modify', id, before: { strokeWidth: before }, after: { strokeWidth: after } });
  });

  row.append(label, slider, value);
  panel.append(row);
  return panel;
}

function buildShowRangesEditor(history: History, id: string, current: boolean): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'cp-panel cp-panel-selection';

  const row = document.createElement('div');
  row.className = 'cp-toggle-row';

  const label = document.createElement('span');
  label.className = 'cp-label';
  label.textContent = 'SHOW RANGES';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = current ? 'cp-segmented-btn active' : 'cp-segmented-btn';
  btn.setAttribute('aria-pressed', String(current));
  btn.textContent = current ? 'ON' : 'OFF';

  let state = current;
  btn.addEventListener('click', () => {
    const next = !state;
    state = next;
    btn.textContent = next ? 'ON' : 'OFF';
    btn.classList.toggle('active', next);
    btn.setAttribute('aria-pressed', String(next));
    history.dispatch({ t: 'quickadd.modify', id, before: { rangeVisible: !next }, after: { rangeVisible: next } });
  });

  row.append(label, btn);
  panel.append(row);
  return panel;
}

/**
 * Edit a placed player: team, name and down-state. SIZE and SCALE are left out
 * on purpose: they are an app-wide preference (app/playerSizePref, `Player` has
 * no size field), so changing them here would resize every player on the map.
 * One player.modify per change.
 */
function buildPlayerEditor(history: History, player: Player): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'cp-panel cp-panel-selection';

  const row = (labelText: string): HTMLDivElement => {
    const r = document.createElement('div');
    r.className = 'cp-toggle-row';
    const l = document.createElement('span');
    l.className = 'cp-label';
    l.textContent = labelText;
    r.appendChild(l);
    return r;
  };

  const teamRow = row('TEAM');
  const teamBtn = document.createElement('button');
  teamBtn.type = 'button';
  teamBtn.className = 'cp-segmented-btn active';
  teamBtn.setAttribute('data-team-toggle', '');
  teamBtn.textContent = player.team.toUpperCase();
  teamBtn.addEventListener('click', () => {
    const before = teamBtn.textContent === 'COLONIST' ? 'colonist' : 'reyab';
    const after: Player['team'] = before === 'colonist' ? 'reyab' : 'colonist';
    teamBtn.textContent = after.toUpperCase();
    history.dispatch({ t: 'player.modify', id: player.id, before: { team: before }, after: { team: after } });
  });
  teamRow.appendChild(teamBtn);
  panel.appendChild(teamRow);

  const nameRow = row('NAME');
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'cp-input cp-input--compact';
  nameInput.maxLength = 24;
  nameInput.value = player.name;
  nameInput.spellcheck = false;
  nameInput.autocomplete = 'off';
  nameInput.setAttribute('placeholder', 'Unnamed');
  nameInput.setAttribute('aria-label', 'Player name');
  // On change, not input: one command per edit rather than one per keystroke, so
  // undo steps back over a whole rename.
  let nameBefore = player.name;
  nameInput.addEventListener('change', () => {
    const after = nameInput.value;
    if (after === nameBefore) return;
    history.dispatch({ t: 'player.modify', id: player.id, before: { name: nameBefore }, after: { name: after } });
    nameBefore = after;
  });
  nameRow.appendChild(nameInput);
  panel.appendChild(nameRow);

  // 'DEAD', not the tool panel's 'SPAWN DEAD': this player already exists, so
  // "spawn" means nothing here - the field is whether they are down.
  const deadRow = row('DEAD');
  const deadBtn = document.createElement('button');
  deadBtn.type = 'button';
  let dead = player.dead;
  deadBtn.className = dead ? 'cp-segmented-btn active' : 'cp-segmented-btn';
  deadBtn.setAttribute('data-dead-toggle', '');
  deadBtn.textContent = dead ? 'YES' : 'NO';
  deadBtn.addEventListener('click', () => {
    const after = !dead;
    history.dispatch({ t: 'player.modify', id: player.id, before: { dead }, after: { dead: after } });
    dead = after;
    deadBtn.textContent = dead ? 'YES' : 'NO';
    deadBtn.classList.toggle('active', dead);
  });
  deadRow.appendChild(deadBtn);
  panel.appendChild(deadRow);

  return panel;
}

/**
 * Edit a placed cone's spread, the same three presets the Cone tool offers. The
 * cone's length and direction are already editable by dragging its arc handle, so
 * this is the one setting with nowhere else to live.
 */
function buildConeSpreadEditor(history: History, id: string, current: Cone['spreadIdx']): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'cp-panel cp-panel-selection';

  const label = document.createElement('div');
  label.className = 'cp-label';
  label.textContent = 'SPREAD';
  panel.appendChild(label);

  const group = document.createElement('div');
  group.className = 'cp-segmented';

  let spreadIdx = current;
  ([0, 1, 2] as const).forEach((idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = idx === spreadIdx ? 'cp-segmented-btn active' : 'cp-segmented-btn';
    btn.setAttribute('data-spread', String(idx));
    btn.textContent = SPREAD_PRESET_LABELS[idx];
    btn.addEventListener('click', () => {
      if (idx === spreadIdx) return; // no-op taps must not stack undo steps
      // customHalfAngle is cleared alongside: a preset and a hand-dragged angle
      // are alternatives, and leaving the custom value set would win over the
      // preset the user just picked.
      history.dispatch({
        t: 'cone.modify', id,
        before: { spreadIdx, customHalfAngle: null },
        after: { spreadIdx: idx, customHalfAngle: null },
      });
      spreadIdx = idx;
      group.querySelectorAll('.cp-segmented-btn').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-spread') === String(idx));
      });
    });
    group.appendChild(btn);
  });

  panel.appendChild(group);
  return panel;
}
