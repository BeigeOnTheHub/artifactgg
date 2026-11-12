import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type StratState } from '../app/store';
import { createHistory } from '../app/history';
import { buildSelectionEditor } from './selectionEditors';
import { emptyFrame } from '../types/primitives';
import { hex } from '../types/hex';

function makeStore(): ReturnType<typeof createStore> {
  const initial: StratState = {
    mapId: 'miru', zoom: 1, panX: 0, panY: 0,
    frames: [emptyFrame()], activeFrameIdx: 0,
    notes: '', tool: 'cursor',
    colourSlots: [hex('#00ff88'), null, null, null, null], activeSlot: 0,
    selection: [],
    ui: { sidebarTab: 'tools', mode: 'frame', paletteOpen: false, shareOpen: false, libraryOpen: false, mapDropdownOpen: false, colourPickerOpen: false, hintsOpen: false, calloutsVisible: true, changelogOpen: false, confirmOpen: null },
  };
  return createStore(initial);
}

describe('buildSelectionEditor', () => {
  let store: ReturnType<typeof makeStore>;
  let history: ReturnType<typeof createHistory>;

  beforeEach(() => {
    store = makeStore();
    history = createHistory(store);
  });

  it('textbox: the slider commits one undoable fontSize modify on change', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, textboxes: [{ id: 'tb1', x: 0, y: 0, w: 80, h: 32, text: 'x', fontSize: 13, color: hex('#ffffff') }] }] });
    const el = buildSelectionEditor(store, history, { kind: 'textbox', id: 'tb1' })!;
    expect(el).not.toBeNull();
    const slider = el.querySelector('.cp-slider') as HTMLInputElement;
    expect(slider.value).toBe('13');

    slider.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    slider.value = '20';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));

    expect(store.get().frames[0]!.textboxes[0]!.fontSize).toBe(20);
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(store.get().frames[0]!.textboxes[0]!.fontSize).toBe(13);
  });

  it('textbox: the sheet carries a text field, because the box itself is 5px on a phone', () => {
    // A text box lives inside #map-canvas-wrap, which is scaled by the zoom, so
    // at the portrait default of 0.406 a 13px font renders at 5.3px in a 13px
    // tall field. Editable in principle, unusable in practice - hence a
    // normal-sized field in the sheet that already opens when a box is selected.
    store._apply({ frames: [{ ...store.get().frames[0]!, textboxes: [{ id: 'tb1', x: 0, y: 0, w: 80, h: 32, text: 'hello', fontSize: 13, color: hex('#ffffff') }] }] });
    const el = buildSelectionEditor(store, history, { kind: 'textbox', id: 'tb1' })!;
    const field = el.querySelector('[data-testid="textbox-text-input"]') as HTMLTextAreaElement;
    expect(field).not.toBeNull();
    expect(field.value).toBe('hello');
  });

  it('textbox: typing previews live and commits one undo step on change', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, textboxes: [{ id: 'tb1', x: 0, y: 0, w: 80, h: 32, text: 'hello', fontSize: 13, color: hex('#ffffff') }] }] });
    const el = buildSelectionEditor(store, history, { kind: 'textbox', id: 'tb1' })!;
    const field = el.querySelector('[data-testid="textbox-text-input"]') as HTMLTextAreaElement;

    field.value = 'smoke here';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    // Live preview so you can see it land on the map while typing.
    expect(store.get().frames[0]!.textboxes[0]!.text).toBe('smoke here');
    expect(history.canUndo()).toBe(false);

    field.dispatchEvent(new Event('change', { bubbles: true }));
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(store.get().frames[0]!.textboxes[0]!.text).toBe('hello');
  });

  it('textbox: a text change back to the same string commits nothing', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, textboxes: [{ id: 'tb1', x: 0, y: 0, w: 80, h: 32, text: 'hello', fontSize: 13, color: hex('#ffffff') }] }] });
    const el = buildSelectionEditor(store, history, { kind: 'textbox', id: 'tb1' })!;
    const field = el.querySelector('[data-testid="textbox-text-input"]') as HTMLTextAreaElement;
    field.value = 'hello';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    expect(history.canUndo()).toBe(false);
  });

  it('textbox: strips control characters but keeps an apostrophe', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, textboxes: [{ id: 'tb1', x: 0, y: 0, w: 80, h: 32, text: '', fontSize: 13, color: hex('#ffffff') }] }] });
    const el = buildSelectionEditor(store, history, { kind: 'textbox', id: 'tb1' })!;
    const field = el.querySelector('[data-testid="textbox-text-input"]') as HTMLTextAreaElement;
    field.value = "Beige's smoke";
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.get().frames[0]!.textboxes[0]!.text).toBe("Beige's smoke");
  });

  it('textbox: a change back to the same value commits nothing', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, textboxes: [{ id: 'tb1', x: 0, y: 0, w: 80, h: 32, text: 'x', fontSize: 13, color: hex('#ffffff') }] }] });
    const el = buildSelectionEditor(store, history, { kind: 'textbox', id: 'tb1' })!;
    const slider = el.querySelector('.cp-slider') as HTMLInputElement;
    slider.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    slider.value = '13';
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    expect(history.canUndo()).toBe(false);
  });

  it('quickadd (non-scanner): the toggle flips rangeVisible undoably', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, quickadds: [{ id: 'q1', type: 'grenade', x: 5, y: 5, rangeVisible: false }] }] });
    const el = buildSelectionEditor(store, history, { kind: 'quickadd', id: 'q1' })!;
    expect(el).not.toBeNull();
    const btn = el.querySelector('.cp-segmented-btn') as HTMLButtonElement;
    expect(btn.textContent).toBe('OFF');
    btn.click();
    expect(store.get().frames[0]!.quickadds[0]!.rangeVisible).toBe(true);
    expect(btn.textContent).toBe('ON');
    history.undo();
    expect(store.get().frames[0]!.quickadds[0]!.rangeVisible).toBe(false);
  });

  it('quickadd: returns null for a scanner', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, quickadds: [{ id: 'sc', type: 'scanner', x: 5, y: 5, rangeVisible: false }] }] });
    expect(buildSelectionEditor(store, history, { kind: 'quickadd', id: 'sc' })).toBeNull();
  });

  it('stroke: the style buttons restyle the dash undoably', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, strokes: [{ id: 'st1', type: 'draw', color: hex('#00ff88'), alpha: 1, size: 4, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }] }] });
    const el = buildSelectionEditor(store, history, { kind: 'stroke', id: 'st1' })!;
    expect(el).not.toBeNull();
    const dotted = el.querySelector('[data-dash="dotted"]') as HTMLButtonElement;
    dotted.click();
    expect(store.get().frames[0]!.strokes[0]!.dash).toBe('dotted');
    expect(dotted.classList.contains('active')).toBe(true);
    history.undo();
    expect(store.get().frames[0]!.strokes[0]!.dash ?? 'solid').toBe('solid');
  });

  it('stroke: re-picking the current style commits nothing', () => {
    store._apply({ frames: [{ ...store.get().frames[0]!, strokes: [{ id: 'st1', type: 'draw', color: hex('#00ff88'), alpha: 1, size: 4, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], dash: 'dashed' }] }] });
    const el = buildSelectionEditor(store, history, { kind: 'stroke', id: 'st1' })!;
    const dashed = el.querySelector('[data-dash="dashed"]') as HTMLButtonElement;
    expect(dashed.classList.contains('active')).toBe(true);
    dashed.click();
    expect(history.canUndo()).toBe(false);
  });

  it('returns null for shape / player / cone / scanner refs', () => {
    expect(buildSelectionEditor(store, history, { kind: 'shape', id: 'x' })).toBeNull();
    expect(buildSelectionEditor(store, history, { kind: 'player', id: 'x' })).toBeNull();
    expect(buildSelectionEditor(store, history, { kind: 'cone', id: 'x' })).toBeNull();
    expect(buildSelectionEditor(store, history, { kind: 'scanner', id: 'scanner' })).toBeNull();
  });

  it('stroke: returns null when the stroke does not exist', () => {
    expect(buildSelectionEditor(store, history, { kind: 'stroke', id: 'nope' })).toBeNull();
  });

  it('returns null when the referenced item does not exist', () => {
    expect(buildSelectionEditor(store, history, { kind: 'textbox', id: 'nope' })).toBeNull();
    expect(buildSelectionEditor(store, history, { kind: 'quickadd', id: 'nope' })).toBeNull();
  });
});

describe('buildSelectionEditor - placed player', () => {
  let store: ReturnType<typeof createStore>;
  let history: ReturnType<typeof createHistory>;

  beforeEach(() => {
    store = makeStore();
    history = createHistory(store);
    store._apply({
      frames: [{ ...store.get().frames[0]!, players: [{ id: 'p1', team: 'colonist', x: 100, y: 100, name: 'jett', dead: false }] }],
    });
  });

  const editor = (): HTMLElement =>
    buildSelectionEditor(store, history, { kind: 'player', id: 'p1' })!;
  const player = () => store.get().frames[0]!.players[0]!;

  it('renders team, name and dead - the three fields a player actually has', () => {
    // SIZE and SCALE are on the Player tool panel but live in playerSizePref as an
    // app-wide setting, so they are deliberately not here: dragging SCALE in a
    // node's editor would resize every player on the map.
    const el = editor();
    expect(el).not.toBeNull();
    const labels = Array.from(el.querySelectorAll('.cp-label')).map((l) => l.textContent);
    expect(labels).toEqual(['TEAM', 'NAME', 'DEAD']);
    expect(el.querySelector('.cp-slider')).toBeNull();
  });

  it('flips the team with one player.modify', () => {
    const el = editor();
    (el.querySelector('[data-team-toggle]') as HTMLButtonElement).click();
    expect(player().team).toBe('reyab');
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(player().team).toBe('colonist');
  });

  it('renames with one player.modify', () => {
    const el = editor();
    const input = el.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input.value).toBe('jett');
    input.value = 'sova';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(player().name).toBe('sova');
    history.undo();
    expect(player().name).toBe('jett');
  });

  it('toggles dead with one player.modify', () => {
    const el = editor();
    (el.querySelector('[data-dead-toggle]') as HTMLButtonElement).click();
    expect(player().dead).toBe(true);
    history.undo();
    expect(player().dead).toBe(false);
  });

  it('returns null for a player that is not in the frame', () => {
    expect(buildSelectionEditor(store, history, { kind: 'player', id: 'nope' })).toBeNull();
  });
});

describe('buildSelectionEditor - placed cone', () => {
  let store: ReturnType<typeof createStore>;
  let history: ReturnType<typeof createHistory>;

  beforeEach(() => {
    store = makeStore();
    history = createHistory(store);
    store._apply({
      frames: [{ ...store.get().frames[0]!, cones: [{ id: 'c1', x: 300, y: 300, angle: 0, length: 130, spreadIdx: 1, customHalfAngle: null, color: hex('#aeb6bb'), attachedPlayerId: null }] }],
    });
  });

  const cone = () => store.get().frames[0]!.cones[0]!;

  it('renders the same spread control the cone tool has', () => {
    const el = buildSelectionEditor(store, history, { kind: 'cone', id: 'c1' })!;
    expect(el).not.toBeNull();
    const buttons = Array.from(el.querySelectorAll('.cp-segmented-btn')).map((b) => b.textContent);
    expect(buttons).toEqual(['NARROW', 'MEDIUM', 'WIDE']);
    // spreadIdx 1 is the active one
    expect(el.querySelector('.cp-segmented-btn.active')!.textContent).toBe('MEDIUM');
  });

  it('changes the spread with one cone.modify, and clears any custom half-angle', () => {
    const el = buildSelectionEditor(store, history, { kind: 'cone', id: 'c1' })!;
    (el.querySelector('[data-spread="2"]') as HTMLButtonElement).click();
    expect(cone().spreadIdx).toBe(2);
    expect(cone().customHalfAngle).toBeNull();
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(cone().spreadIdx).toBe(1);
  });

  it('does not dispatch when the spread is already the one tapped', () => {
    const el = buildSelectionEditor(store, history, { kind: 'cone', id: 'c1' })!;
    (el.querySelector('[data-spread="1"]') as HTMLButtonElement).click();
    expect(history.canUndo()).toBe(false);
  });

  it('returns null for a cone that is not in the frame', () => {
    expect(buildSelectionEditor(store, history, { kind: 'cone', id: 'nope' })).toBeNull();
  });
});
