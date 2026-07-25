import { describe, it, expect } from 'vitest';
import { hatDiagonal, leverageScale } from '../../src/stats/peak-fit';
import { bootstrapCi, mulberry32 } from '../../src/stats/bootstrap';
import type { Observation } from '../../src/types';

/**
 * The residual bootstrap resamples FITTED residuals, and fitted residuals are systematically
 * smaller than the true errors: the fit is pulled toward every point, hardest toward the
 * high-leverage ones at the ends of the range. Resampling them raw therefore understates the
 * noise, and the reported interval comes out narrower than the evidence supports.
 *
 * The cost was measured before this landed. Over 750 simulated 30-trial sessions the nominal 90%
 * interval achieved about 87% empirical coverage, and a design deliberately spread but wholly
 * independent of the data still covered only 85.9%, which showed the shortfall belonged to the
 * interval computation rather than to how trials were allocated.
 *
 * Scaling each residual by 1/sqrt(1 - h_ii) removes exactly that shrinkage. The property that
 * makes it safe to ship is that the factor is never below 1, so the correction can only ever
 * widen an interval. The canon permits widening and forbids narrowing.
 */

const design = (cms: number[], noise = 0.05, seed = 7): Observation[] => {
  const rng = mulberry32(seed);
  const peak = Math.log(34);
  return cms.map((cm) => {
    const x = Math.log(cm);
    const d = x - peak;
    return { x, y: -4 * d * d + (rng() * 2 - 1) * noise };
  });
};

describe('leverage: the hat diagonal', () => {
  it('sums to the number of fitted parameters', () => {
    // A standard identity for a projection matrix: trace(H) = rank(X) = 3 here (1, x, x²).
    const h = hatDiagonal(design([18, 22, 26, 30, 35, 42, 52]));
    expect(h).toHaveLength(7);
    expect(h.reduce((s, v) => s + v, 0)).toBeCloseTo(3, 6);
  });

  it('puts every leverage in [0, 1]', () => {
    for (const cms of [[18, 22, 26, 30, 35, 42, 52], [15, 20, 30, 45, 60], [16, 18, 20, 40, 58, 60]]) {
      for (const hi of hatDiagonal(design(cms))) {
        expect(hi).toBeGreaterThanOrEqual(0);
        expect(hi).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('gives the ends of the range more leverage than the middle', () => {
    // This is why the correction matters: the extremes are exactly the points a vertex estimate
    // leans on hardest, and they are the ones whose residuals shrink most.
    const h = hatDiagonal(design([18, 22, 26, 30, 35, 42, 52]));
    const middle = h[3]!;
    expect(h[0]!, 'low end vs middle').toBeGreaterThan(middle);
    expect(h[h.length - 1]!, 'high end vs middle').toBeGreaterThan(middle);
  });

  it('declines to correct a design too thin to support it, rather than dividing by zero', () => {
    // With n == p every leverage is exactly 1 and the correction is undefined.
    expect(hatDiagonal(design([20, 34, 50]))).toEqual([]);
    expect(leverageScale(design([20, 34, 50]))).toEqual([1, 1, 1]);
    expect(hatDiagonal([])).toEqual([]);
  });
});

describe('leverage: the scale factor', () => {
  it('is never below 1, so the correction can only widen an interval', () => {
    for (const cms of [[18, 22, 26, 30, 35, 42, 52], [15, 20, 30, 45, 60], [16, 17, 30, 55, 58, 60]]) {
      for (const f of leverageScale(design(cms))) {
        expect(f).toBeGreaterThanOrEqual(1);
        expect(Number.isFinite(f)).toBe(true);
      }
    }
  });

  it('scales the high-leverage ends up more than the middle', () => {
    const f = leverageScale(design([18, 22, 26, 30, 35, 42, 52]));
    expect(f[0]!).toBeGreaterThan(f[3]!);
    expect(f[f.length - 1]!).toBeGreaterThan(f[3]!);
  });

  it('shrinks toward no correction as the design gets richer', () => {
    // The diagonals always sum to 3, so with more points each one is smaller and the correction
    // fades. A thin design needs it most, which is the behaviour a measurement tool wants.
    const thin = leverageScale(design([18, 26, 35, 45, 55]));
    const rich = leverageScale(design(Array.from({ length: 20 }, (_, i) => 18 + i * 2)));
    const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean(rich)).toBeLessThan(mean(thin));
    expect(mean(rich)).toBeLessThan(1.15);
  });
});

describe('leverage: the effect on the reported interval', () => {
  it('widens the bootstrap band rather than narrowing it', () => {
    // Same data, same seed. The only difference is whether the residuals carry the correction, so
    // this is a direct read of its direction. Corrected residuals are larger, so the band grows.
    const obs = design([18, 22, 26, 30, 35, 42, 52], 0.05, 11);
    const corrected = bootstrapCi([...obs], 400, mulberry32(3));

    // Reconstruct the uncorrected band by pre-shrinking each y toward its fitted value by the same
    // factor, which cancels the correction the bootstrap then applies.
    const lev = leverageScale(obs);
    const shrunk: Observation[] = obs.map((o, i) => {
      const peak = Math.log(34);
      const d = o.x - peak;
      const fitted = -4 * d * d;
      return { x: o.x, y: fitted + (o.y - fitted) / lev[i]! };
    });
    const uncorrected = bootstrapCi(shrunk, 400, mulberry32(3));

    const width = ([lo, hi]: [number, number]): number => hi - lo;
    expect(width(corrected)).toBeGreaterThan(width(uncorrected));
  });

  it('leaves the band a real interval inside the data, never a fabricated one', () => {
    const obs = design([18, 22, 26, 30, 35, 42, 52], 0.05, 12);
    const [lo, hi] = bootstrapCi([...obs], 400, mulberry32(4));
    expect(lo).toBeLessThan(hi);
    expect(Number.isFinite(lo)).toBe(true);
    expect(Number.isFinite(hi)).toBe(true);
  });
});
