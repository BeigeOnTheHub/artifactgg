export interface Viewport {
  left: number;
  top: number;
  width: number;
  height: number;
  /** natural map width */
  w: number;
  /** natural map height */
  h: number;
  zoom: number;
  panX: number;
  panY: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Translation: tx = (vpW - mapW*zoom)/2 + panX - matches v1's formula. */
function translation(v: Viewport): Point {
  return {
    x: (v.width - v.w * v.zoom) / 2 + v.panX,
    y: (v.height - v.h * v.zoom) / 2 + v.panY,
  };
}

export function clientToMap(cx: number, cy: number, v: Viewport): Point {
  const t = translation(v);
  const localX = cx - v.left - t.x;
  const localY = cy - v.top - t.y;
  return { x: localX / v.zoom, y: localY / v.zoom };
}

export function mapToClient(mx: number, my: number, v: Viewport): Point {
  const t = translation(v);
  return {
    x: mx * v.zoom + t.x + v.left,
    y: my * v.zoom + t.y + v.top,
  };
}
