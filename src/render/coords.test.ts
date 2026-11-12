import { describe, it, expect } from 'vitest';
import { clientToMap, mapToClient, type Viewport } from './coords';

const BASE: Pick<Viewport, 'left' | 'top' | 'width' | 'height' | 'w' | 'h'> = {
  left: 0,
  top: 0,
  width: 800,
  height: 600,
  w: 1920,
  h: 1080,
};

describe('coords', () => {
  it('round-trips at zoom=1 pan=0', () => {
    const v: Viewport = { ...BASE, zoom: 1, panX: 0, panY: 0 };
    const m = clientToMap(100, 200, v);
    const c = mapToClient(m.x, m.y, v);
    expect(c.x).toBeCloseTo(100, 5);
    expect(c.y).toBeCloseTo(200, 5);
  });

  it('round-trips at zoom=2.5 pan=(-120, 80)', () => {
    const v: Viewport = { ...BASE, zoom: 2.5, panX: -120, panY: 80 };
    const m = clientToMap(450, 330, v);
    const c = mapToClient(m.x, m.y, v);
    expect(c.x).toBeCloseTo(450, 5);
    expect(c.y).toBeCloseTo(330, 5);
  });

  it('centre of viewport at zoom=1 maps to centre of natural map', () => {
    const v: Viewport = { ...BASE, zoom: 1, panX: 0, panY: 0 };
    const m = clientToMap(v.width / 2, v.height / 2, v);
    expect(m.x).toBeCloseTo(v.w / 2, 5);
    expect(m.y).toBeCloseTo(v.h / 2, 5);
  });
});
