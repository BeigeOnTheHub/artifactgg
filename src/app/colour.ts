import { hex, type Hex } from '../types/hex';

/** Default active-slot colour when no explicit colour has been picked. */
export const FALLBACK_COLOUR: Hex = hex('#00ff88');

/**
 * Read the active colour slot. Returns FALLBACK_COLOUR when the slot is empty
 * (the only path that can yield empty is a fresh boot before the user has
 * picked anything, since slot 0 is initialised to FALLBACK_COLOUR in main.ts).
 */
export function activeColour(slots: readonly (Hex | null)[], activeSlot: number): Hex {
  const c = slots[activeSlot];
  return c ?? FALLBACK_COLOUR;
}

export interface RGB { r: number; g: number; b: number; }
export interface HSB { h: number; s: number; b: number; }

/** Parse #rrggbb / #rgb / rrggbb into {r,g,b} (0-255). Returns null on invalid. */
export function hexToRgb(input: string): RGB | null {
  const cleaned = input.trim().replace(/^#/, '');
  let s = cleaned;
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (s.length !== 6) return null;
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

/** Format {r,g,b} as a 6-char lowercase hex string with leading '#'. */
export function rgbToHex(rgb: RGB): Hex {
  const c = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return hex(`#${c(rgb.r)}${c(rgb.g)}${c(rgb.b)}`);
}

/** Convert RGB (0-255) to HSB (h: 0-360, s,b: 0-1). */
export function rgbToHsb({ r, g, b }: RGB): HSB {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d === 0) h = 0;
  else if (max === rn) h = 60 * (((gn - bn) / d) % 6);
  else if (max === gn) h = 60 * ((bn - rn) / d + 2);
  else h = 60 * ((rn - gn) / d + 4);
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : d / max;
  return { h, s, b: max };
}

/** Convert HSB (h: 0-360, s,b: 0-1) to RGB (0-255). */
export function hsbToRgb({ h, s, b }: HSB): RGB {
  const hh = ((h % 360) + 360) % 360;
  const c = b * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = b - c;
  let rn = 0, gn = 0, bn = 0;
  if (hh < 60)       { rn = c; gn = x; bn = 0; }
  else if (hh < 120) { rn = x; gn = c; bn = 0; }
  else if (hh < 180) { rn = 0; gn = c; bn = x; }
  else if (hh < 240) { rn = 0; gn = x; bn = c; }
  else if (hh < 300) { rn = x; gn = 0; bn = c; }
  else               { rn = c; gn = 0; bn = x; }
  return { r: (rn + m) * 255, g: (gn + m) * 255, b: (bn + m) * 255 };
}
