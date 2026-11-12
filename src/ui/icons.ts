import type { ToolId } from '../types/primitives';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface IconPng { kind: 'png'; src: string; }
export interface IconSvg {
  kind: 'svg';
  /** Imperative builder. Mutates the supplied <svg> by appending children. */
  build: (svg: SVGSVGElement) => void;
}
export type IconSource = IconPng | IconSvg;

function setAttrs(el: Element, attrs: Record<string, string>): void {
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
}

function svgChild(parent: Element, tag: string, attrs: Record<string, string>): Element {
  const el = document.createElementNS(SVG_NS, tag);
  setAttrs(el, attrs);
  parent.appendChild(el);
  return el;
}

// Mask ids are document-global and the rail is built more than once (desktop
// and mobile), so each shapes icon gets its own.
let shapesMaskSeq = 0;
const SHAPES_CIRCLE = { cx: '9', cy: '14.7', r: '3.2' };
const SHAPES_TRIANGLE = '16.2,10.3 19.2,16 13.4,16';

/**
 * Per-ToolId icon source.
 * - PNGs from assets/tools/button-icons/ (mirrored to public/).
 * - Hand-rolled stroke SVGs for shapes, cone, quick-add and scanner.
 *
 * SVG viewBox / stroke / fill set on the wrapping <svg> by the renderer (ToolRail).
 */
export const TOOL_ICONS: Record<ToolId, IconSource> = {
  cursor:           { kind: 'png', src: 'assets/tools/button-icons/cursor.png' },
  select:           { kind: 'png', src: 'assets/tools/button-icons/select.png' },
  lasso:            { kind: 'png', src: 'assets/tools/button-icons/lasso-select.png' },
  draw:             { kind: 'png', src: 'assets/tools/button-icons/draw.png' },
  erase:            { kind: 'png', src: 'assets/tools/button-icons/erase.png' },
  shapes: {
    kind: 'svg',
    // Circle and triangle sit in front of the square: the mask cuts the square
    // back from both, with a gap, so no outlines cross.
    build: (svg) => {
      const id = `shapes-icon-mask-${++shapesMaskSeq}`;
      const mask = svgChild(svg, 'mask', { id, maskUnits: 'userSpaceOnUse', x: '0', y: '0', width: '24', height: '24' });
      svgChild(mask, 'rect', { width: '24', height: '24', fill: '#fff' });
      svgChild(mask, 'circle', { ...SHAPES_CIRCLE, fill: '#000', stroke: '#000', 'stroke-width': '3.1' });
      svgChild(mask, 'polygon', { points: SHAPES_TRIANGLE, fill: '#000', stroke: '#000', 'stroke-width': '3.1' });
      const g = svgChild(svg, 'g', { 'stroke-width': '1.15' });
      svgChild(g, 'path', { d: 'M8 12.4V6.2H14.2V12.4', mask: `url(#${id})` });
      svgChild(g, 'circle', SHAPES_CIRCLE);
      svgChild(g, 'polygon', { points: SHAPES_TRIANGLE });
    },
  },
  'place-cone': {
    kind: 'svg',
    build: (svg) => {
      svgChild(svg, 'path', { d: 'M4.5 12C6.75 8.25 9.4 6.75 12 6.75s5.25 1.5 7.5 5.25c-2.25 3.75-4.9 5.25-7.5 5.25S6.75 15.75 4.5 12Z' });
      svgChild(svg, 'circle', { cx: '12', cy: '12', r: '2.6' });
      svgChild(svg, 'circle', { cx: '12', cy: '12', r: '0.75', fill: 'currentColor' });
    },
  },
  'place-player':   { kind: 'png', src: 'assets/tools/button-icons/player.png' },
  'place-text':     { kind: 'png', src: 'assets/tools/button-icons/text.png' },
  'place-quickadd': {
    kind: 'svg',
    build: (svg) => {
      svgChild(svg, 'circle', { cx: '12', cy: '12', r: '3' });
      svgChild(svg, 'circle', { cx: '12', cy: '12', r: '7', 'stroke-dasharray': '2 2' });
    },
  },
  // Scanner is still placeable via the QuickAdd tool - the standalone tool
  // was redundant and is hidden from the rail (see TOOL_ORDER).
  'place-scanner': {
    kind: 'svg',
    build: (svg) => {
      svgChild(svg, 'rect', { x: '3', y: '6', width: '18', height: '12', rx: '1' });
      svgChild(svg, 'line', { x1: '7', y1: '10', x2: '17', y2: '10' });
      svgChild(svg, 'line', { x1: '7', y1: '14', x2: '13', y2: '14' });
    },
  },
};

/** Display label for the button title attribute. */
export const TOOL_LABELS: Record<ToolId, string> = {
  cursor: 'Cursor / Pan',
  select: 'Select (box)',
  lasso: 'Lasso Select',
  draw: 'Draw',
  erase: 'Erase',
  shapes: 'Shapes',
  'place-cone': 'Vision Cone',
  'place-player': 'Place Player',
  'place-text': 'Text Box',
  'place-quickadd': 'Quick Add',
  'place-scanner': 'Scanner',
};

/**
 * Keyboard shortcut per tool. The command/keyboard
 * layer (registerActions) wires these as the actual hotkeys, and the tool rail
 * shows them in the tooltip + aria-label so they're discoverable without
 * opening the hints modal.
 */
export const TOOL_HOTKEY: Partial<Record<ToolId, string>> = {
  cursor: 'V',
  select: 'S',
  lasso: 'L',
  draw: 'D',
  erase: 'E',
  shapes: 'R',
  'place-cone': 'C',
  'place-player': 'P',
  'place-text': 'T',
  'place-quickadd': 'Q',
};

/**
 * Display order for the rail buttons. The standalone `place-scanner` tool was
 * removed - scanner is now reachable via the QuickAdd tool's preset list.
 */
export const TOOL_ORDER: readonly ToolId[] = [
  'cursor', 'select', 'lasso',
  'draw', 'erase', 'shapes',
  'place-cone', 'place-player', 'place-text',
  'place-quickadd',
];
