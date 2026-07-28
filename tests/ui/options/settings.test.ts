import { describe, it, expect } from 'vitest';
import { normalizeBounds, DEFAULT_BOUNDS, boundsFromSeed, midOf } from '../../../src/ui/options/settings';
import { counts360, countsBounds } from '../../../src/types';

describe('options settings helpers', () => {
  it('normalizeBounds orders, clamps to [1600,47200], guarantees a >=1600 span, and never inverts', () => {
    expect(normalizeBounds(19200, 4800)).toEqual([4800, 19200]); // reorders
    expect(normalizeBounds(300, 2900)).toEqual([1600, 3200]);    // lo clamped; span widened to >=1600
    expect(normalizeBounds(9600, 9600)).toEqual([9600, 11200]);  // degenerate equal inputs
    expect(normalizeBounds(NaN, 12000)).toEqual(DEFAULT_BOUNDS);
    expect(normalizeBounds(60000, 61000)).toEqual([45600, 47200]); // both above HI: clamp, NEVER invert
    expect(normalizeBounds(46800, 47000)).toEqual([45600, 47200]); // near ceiling: pull lo down for the span
    expect(normalizeBounds(6400, 6600)).toEqual([6400, 8000]);     // tiny valid range widened to >=1600
    // invariants for every output
    for (const [a, b] of [
      [19200, 4800], [300, 2900], [9600, 9600], [60000, 61000], [46800, 47000], [6400, 6600], [900, 1000],
    ] as const) {
      const [lo, hi] = normalizeBounds(a, b);
      expect(lo).toBeGreaterThanOrEqual(1600);
      expect(hi).toBeLessThanOrEqual(47200);
      expect(hi - lo).toBeGreaterThanOrEqual(1600);
    }
  });
});

describe('boundsFromSeed', () => {
  it('centers a window on the seed within sane bounds', () => {
    const [lo, hi] = boundsFromSeed(counts360(9450)); // 9450/1.7 = 5558.8 .. 9450*1.7 = 16065
    expect(lo).toBeCloseTo(5558.8, 1);
    expect(hi).toBeCloseTo(16065, 1);
    expect(lo).toBeGreaterThanOrEqual(1600);
    expect(hi).toBeLessThanOrEqual(47200);
  });

  it('clamps a tiny seed to the minimum span', () => {
    const [lo, hi] = boundsFromSeed(counts360(900));
    expect(lo).toBe(1600);
    expect(hi).toBe(3200);
  });

  it('falls back to the default window for a bad seed', () => {
    expect(boundsFromSeed(counts360(NaN))).toEqual(DEFAULT_BOUNDS);
    expect(boundsFromSeed(counts360(0))).toEqual(DEFAULT_BOUNDS);
  });
});

describe('midOf', () => {
  it('reports the geometric midpoint of a window', () => {
    // The geometric midpoint, exact here because 4800 * 19200 is a perfect square; the arithmetic
    // mean would be 12000, a third of an octave high.
    expect(midOf(countsBounds(4800, 19200))).toBe(9600);
  });
});
