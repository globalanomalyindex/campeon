import { describe, it, expect } from 'vitest';
import { fitQuadratic, fitPeak } from '../../src/stats/peak-fit';
import type { Observation } from '../../src/types';

describe('parabolic peak fit', () => {
  // y = -2 (x - ln35)^2 + 5  → peak at x = ln(35)
  const peakX = Math.log(35);
  const obs: Observation[] = [];
  for (const s of [18, 24, 30, 35, 42, 50, 58]) {
    const x = Math.log(s);
    obs.push({ x, y: -2 * (x - peakX) ** 2 + 5 });
  }

  it('recovers quadratic coefficients (β2 < 0)', () => {
    const { b2 } = fitQuadratic(obs);
    expect(b2).toBeLessThan(0);
  });

  it('recovers the optimal cm/360 ≈ 35', () => {
    expect(fitPeak(obs).optimalCm360).toBeCloseTo(35, 1);
  });

  it('returns a curve for plotting', () => {
    expect(fitPeak(obs).curve.length).toBeGreaterThan(10);
  });

  it('throws when the fit is convex (no interior peak)', () => {
    // monotonically increasing data → convex/linear fit, b2 ≥ 0
    const monotone = [10, 20, 30, 40, 50].map((s) => ({ x: Math.log(s), y: s }));
    expect(() => fitPeak(monotone)).toThrow(/not concave/);
  });
});
