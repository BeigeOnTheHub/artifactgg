import { describe, it, expect } from 'vitest';
import { wheelPointToHsb, paintWheel } from './colourWheel';

describe('wheelPointToHsb', () => {
  it('the centre point is fully desaturated', () => {
    const hsb = wheelPointToHsb(0, 0, 100, 0.5);
    expect(hsb.s).toBe(0);
    expect(hsb.b).toBe(0.5);
  });

  it('the rim is fully saturated and a point past the radius clamps', () => {
    expect(wheelPointToHsb(100, 0, 100, 1).s).toBe(1);
    expect(wheelPointToHsb(250, 0, 100, 1).s).toBe(1);
  });

  it('hue is the angle: +x is 0, +y is 90, -x is 180', () => {
    expect(wheelPointToHsb(50, 0, 100, 1).h).toBeCloseTo(0);
    expect(wheelPointToHsb(0, 50, 100, 1).h).toBeCloseTo(90);
    expect(wheelPointToHsb(-50, 0, 100, 1).h).toBeCloseTo(180);
  });

  it('carries the supplied brightness through unchanged', () => {
    expect(wheelPointToHsb(10, 10, 100, 0.33).b).toBe(0.33);
  });

  it('is safe with a zero radius (a degenerate / unlaid-out canvas)', () => {
    const hsb = wheelPointToHsb(0, 0, 0, 1);
    expect(hsb.s).toBe(0);
    expect(Number.isFinite(hsb.h)).toBe(true);
  });
});

describe('paintWheel', () => {
  it('does not throw on a canvas (no-op when the 2d context is unavailable)', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    expect(() => paintWheel(canvas)).not.toThrow();
  });
});
