import { describe, it, expect } from 'vitest';
import { GP, matern52, fitGpParams, type GpParams } from '../../src/optimizer/gp';
import type { Observation } from '../../src/types';

const params: GpParams = { signalVar: 1, lengthScale: 0.5, noiseVar: 1e-6 };

describe('matern52', () => {
  it('equals signalVar at zero distance and decays monotonically toward 0', () => {
    expect(matern52(2, 2, 1, 0.5)).toBeCloseTo(1, 12);
    const near = matern52(2, 2.1, 1, 0.5);
    const far = matern52(2, 3, 1, 0.5);
    expect(near).toBeLessThan(1);
    expect(far).toBeLessThan(near);
    expect(far).toBeGreaterThan(0);
  });
});

describe('GP regression', () => {
  it('interpolates training points when noise is tiny', () => {
    const obs: Observation[] = [{ x: 0, y: 1 }, { x: 1, y: -2 }, { x: 2, y: 0.5 }];
    const gp = new GP(params, obs);
    for (const o of obs) expect(gp.predict(o.x).mean).toBeCloseTo(o.y, 3);
  });

  it('reverts to the prior mean and full signal variance far from data', () => {
    const obs: Observation[] = [{ x: 0, y: 5 }, { x: 0.2, y: 5 }];
    const gp = new GP(params, obs);
    const far = gp.predict(100);
    expect(far.mean).toBeCloseTo(5, 6);
    expect(far.variance).toBeCloseTo(params.signalVar, 6);
  });

  it('variance is ~0 at a low-noise training point and grows between points', () => {
    const obs: Observation[] = [{ x: 0, y: 0 }, { x: 2, y: 0 }];
    const gp = new GP(params, obs);
    expect(gp.predict(0).variance).toBeLessThan(1e-3);
    expect(gp.predict(1).variance).toBeGreaterThan(gp.predict(0).variance);
  });

  it('empty history returns the prior', () => {
    const gp = new GP(params, []);
    expect(gp.predict(3)).toEqual({ mean: 0, variance: params.signalVar });
  });

  it('handles replicated x via the noise nugget (no singular matrix)', () => {
    const noisy: GpParams = { signalVar: 1, lengthScale: 0.5, noiseVar: 0.1 };
    const obs: Observation[] = [{ x: 1, y: 0 }, { x: 1, y: 0.4 }, { x: 2, y: -1 }];
    const gp = new GP(noisy, obs);
    expect(Number.isFinite(gp.predict(1).mean)).toBe(true);
    expect(gp.predict(1).variance).toBeGreaterThan(0);
  });

  it('per-point noise downweights a noisy observation', () => {
    const base: Observation[] = [{ x: 0, y: 0 }, { x: 0.05, y: 0, noise: 1e-6 }];
    const trusted = new GP(params, [...base, { x: 0.1, y: 5, noise: 1e-6 }]);
    const noisy = new GP(params, [...base, { x: 0.1, y: 5, noise: 1e3 }]);
    // The trusted y=5 point pulls the estimate at x=0.1 far harder than the noisy one.
    expect(trusted.predict(0.1).mean).toBeGreaterThan(noisy.predict(0.1).mean + 1);
  });
});

describe('fitGpParams (marginal-likelihood hyperparameter fit, finalize-only)', () => {
  const bounds: [number, number] = [15, 60]; // L = ln(60/15) = ln(4) ≈ 1.386
  const base: GpParams = { signalVar: 1, lengthScale: 0.6, noiseVar: 0.1 };
  const L = Math.log(bounds[1] / bounds[0]);

  /** A smooth (low-curvature) and a jagged (alternating) field over the same x-grid. */
  const grid = (n: number): number[] =>
    Array.from({ length: n }, (_, i) => Math.log(bounds[0]) + (i / (n - 1)) * L);

  it('returns base unchanged for fewer than 8 observations', () => {
    const obs: Observation[] = grid(6).map((x, i) => ({ x, y: Math.sin(x) + 0.01 * i }));
    expect(fitGpParams(obs, base, bounds)).toEqual(base);
  });

  it('pins signalVar to base and keeps lengthScale / noiseVar inside the spec grid bounds', () => {
    const xs = grid(12);
    const obs: Observation[] = xs.map((x) => ({ y: -((x - 3.2) ** 2), x }));
    const fit = fitGpParams(obs, base, bounds);
    expect(fit.signalVar).toBe(base.signalVar);
    expect(fit.lengthScale).toBeGreaterThanOrEqual(0.1 * L - 1e-12);
    expect(fit.lengthScale).toBeLessThanOrEqual(1.0 * L + 1e-12);
    expect(fit.noiseVar).toBeGreaterThanOrEqual(1e-3 * base.signalVar - 1e-12);
    expect(fit.noiseVar).toBeLessThanOrEqual(1 * base.signalVar + 1e-12);
  });

  it('picks a larger lengthScale for clearly-smooth data than for a jagged set', () => {
    const lo = Math.log(bounds[0]);
    const xs = grid(20);
    // Both are deterministic structure (so neither is honestly "noise"), but the jagged field
    // oscillates many times faster across the range, so resolving it demands a SHORTER lengthScale.
    const smooth: Observation[] = xs.map((x) => ({ y: Math.sin(((x - lo) / L) * Math.PI), x }));
    const jagged: Observation[] = xs.map((x) => ({ y: Math.sin(((x - lo) / L) * Math.PI * 6), x }));
    const smoothFit = fitGpParams(smooth, base, bounds);
    const jaggedFit = fitGpParams(jagged, base, bounds);
    expect(smoothFit.lengthScale).toBeGreaterThan(jaggedFit.lengthScale);
  });

  it('is deterministic (same obs → same params)', () => {
    const obs: Observation[] = grid(12).map((x) => ({ y: -((x - 3.0) ** 2), x }));
    expect(fitGpParams(obs, base, bounds)).toEqual(fitGpParams(obs, base, bounds));
  });
});
