import type { HSB } from '../app/colour';

/**
 * Shared HS-wheel rendering + pointer maths, extracted verbatim from
 * ColourPicker so the desktop picker and the compact MobileColourSheet paint
 * and read exactly the same wheel (the anchoredZoomPan / hitTestPoint
 * extraction precedent). Pure apart from `paintWheel`'s canvas write.
 */

/**
 * Paint the HS wheel onto `canvas`: hue around the rim (rotational),
 * saturation 0->1 from centre->rim, brightness fixed at 1. Per-pixel blit so
 * the colour space is exact (a CSS conic-gradient clips on Chromium when
 * stacked). No-op when the 2d context is unavailable (e.g. jsdom).
 */
export function paintWheel(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(cx, cy);
  const img = ctx.createImageData(w, h);
  const data = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      const i = (y * w + x) * 4;
      if (r > radius) {
        data[i + 3] = 0;
        continue;
      }
      const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      const sat = r / radius;
      const rgb = hsbToRgbInline(hue, sat, 1);
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Translate a wheel-local pointer offset (dx, dy from the wheel centre, px)
 * into an HSB value. `radius` is the wheel's pixel radius; saturation is the
 * clamped distance ratio, hue is the angle, brightness is carried through
 * unchanged from `currentB`.
 */
export function wheelPointToHsb(dx: number, dy: number, radius: number, currentB: number): HSB {
  const r = Math.min(Math.hypot(dx, dy), radius);
  const h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  const s = radius === 0 ? 0 : r / radius;
  return { h, s, b: currentB };
}

/** Local HSB->RGB to keep the per-pixel paint loop allocation-free. */
function hsbToRgbInline(h: number, s: number, b: number): [number, number, number] {
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
  return [(rn + m) * 255, (gn + m) * 255, (bn + m) * 255];
}
