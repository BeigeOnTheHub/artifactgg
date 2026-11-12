import { describe, it, expect } from 'vitest';
import { hex } from '../types/hex';
import { FALLBACK_COLOUR, activeColour, hexToRgb, rgbToHex, rgbToHsb, hsbToRgb } from './colour';

describe('app/colour', () => {
  it('FALLBACK_COLOUR is #00ff88', () => {
    expect(FALLBACK_COLOUR).toBe(hex('#00ff88'));
  });

  it('activeColour returns slot value when present', () => {
    expect(activeColour([hex('#ff4655'), null, null, null, null], 0)).toBe(hex('#ff4655'));
  });

  it('activeColour returns FALLBACK_COLOUR when slot is null', () => {
    expect(activeColour([null, null, null, null, null], 0)).toBe(FALLBACK_COLOUR);
  });

  it('activeColour returns FALLBACK_COLOUR when activeSlot is out of range', () => {
    expect(activeColour([hex('#ff4655')], 99)).toBe(FALLBACK_COLOUR);
  });
});

describe('app/colour - conversions', () => {
  it('hexToRgb parses #00ff88', () => {
    expect(hexToRgb('#00ff88')).toEqual({ r: 0, g: 255, b: 136 });
  });

  it('hexToRgb parses 3-char shorthand #0f8', () => {
    expect(hexToRgb('#0f8')).toEqual({ r: 0, g: 255, b: 136 });
  });

  it('hexToRgb returns null for invalid input', () => {
    expect(hexToRgb('xyz')).toBeNull();
    expect(hexToRgb('#12345')).toBeNull();
    expect(hexToRgb('#zzzzzz')).toBeNull();
  });

  it('rgbToHex round-trips with hexToRgb', () => {
    const original = '#ff4655';
    const rgb = hexToRgb(original)!;
    expect(rgbToHex(rgb)).toBe(hex(original));
  });

  it('hsbToRgb / rgbToHsb round-trip preserves a primary colour', () => {
    const rgb = { r: 0, g: 255, b: 136 };
    const hsb = rgbToHsb(rgb);
    const back = hsbToRgb(hsb);
    expect(Math.round(back.r)).toBe(rgb.r);
    expect(Math.round(back.g)).toBe(rgb.g);
    expect(Math.round(back.b)).toBe(rgb.b);
  });

  it('rgbToHsb({0,0,0}) returns h=0,s=0,b=0', () => {
    expect(rgbToHsb({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, b: 0 });
  });

  it('hsbToRgb({h:0,s:0,b:1}) returns white', () => {
    expect(hsbToRgb({ h: 0, s: 0, b: 1 })).toEqual({ r: 255, g: 255, b: 255 });
  });
});
