import { describe, it, expect } from 'vitest';
import { GP, matern52, type GpParams } from '../../src/optimizer/gp';
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
