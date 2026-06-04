import { describe, it, expect } from 'vitest';
import { orderedDither } from '../../../src/ui/viewmodel/dither';

/** The only legal output values for a channel: round(k/levels · 255) for k in 0..levels. */
function quantLevels(levels: number): number[] {
  const out: number[] = [];
  for (let k = 0; k <= levels; k++) out.push(Math.round((k / levels) * 255));
  return out;
}

/** Fill a w×h RGBA buffer with a constant gray (alpha 255). */
function flat(w: number, h: number, value: number, alpha = 255): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = value;
    d[i + 1] = value;
    d[i + 2] = value;
    d[i + 3] = alpha;
  }
  return d;
}

describe('orderedDither — Bayer dither + posterize', () => {
  it('snaps every channel to one of the levels+1 quantization values', () => {
    const allowed = new Set(quantLevels(6)); // {0,43,85,128,170,213,255}
    // a ramp of inputs across the full range, on a 4×4 tile so all Bayer cells are exercised
    for (const v of [0, 17, 64, 106, 128, 200, 240, 255]) {
      const d = orderedDither(flat(4, 4, v), 4, 4, { levels: 6 });
      for (let i = 0; i < d.length; i += 4) {
        expect(allowed.has(d[i]!)).toBe(true);
        expect(allowed.has(d[i + 1]!)).toBe(true);
        expect(allowed.has(d[i + 2]!)).toBe(true);
      }
    }
  });

  it('keeps pure black and pure white flat (no dithering at the extremes)', () => {
    const black = orderedDither(flat(4, 4, 0), 4, 4);
    const white = orderedDither(flat(4, 4, 255), 4, 4);
    for (let i = 0; i < black.length; i += 4) {
      expect(black[i]).toBe(0);
      expect(white[i]).toBe(255);
    }
  });

  it('dithers a between-levels tone into the two bracketing palette values', () => {
    // 106/255 ≈ 0.4157 sits between level 2 (85) and level 3 (128); the Bayer threshold splits it.
    const d = orderedDither(flat(4, 4, 106), 4, 4, { levels: 6 });
    const seen = new Set<number>();
    for (let i = 0; i < d.length; i += 4) seen.add(d[i]!);
    expect(seen).toEqual(new Set([85, 128]));
  });

  it('never modifies the alpha channel (keyed transparency survives)', () => {
    const d = flat(4, 4, 140, 0); // alpha 0 (keyed-out) everywhere
    d[3] = 255; // …except one opaque pixel
    orderedDither(d, 4, 4);
    expect(d[3]).toBe(255);
    for (let i = 7; i < d.length; i += 4) expect(d[i]).toBe(0);
  });

  it('is deterministic — same buffer in, same buffer out', () => {
    const a = orderedDither(flat(8, 8, 99), 8, 8);
    const b = orderedDither(flat(8, 8, 99), 8, 8);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
