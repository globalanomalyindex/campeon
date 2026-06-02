import type { Observation } from '../types';
import { fitQuadratic } from './psychometric';

/** Deterministic seeded PRNG (mulberry32) — reproducible bootstrap + tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Peak cm/360 of a fit, or NaN if the fit is non-concave (no interior maximum → not a valid peak). */
const peakCm360 = (obs: Observation[]): number => {
  const { b1, b2 } = fitQuadratic(obs);
  if (b2 >= 0) return NaN;
  return Math.exp(-b1 / (2 * b2));
};

/**
 * Parametric bootstrap 90% CI on the optimal cm/360.
 * Resamples residuals around the fitted curve, refits, and takes the 5th/95th percentiles.
 * Non-concave resamples (no peak) are dropped, so the CI reflects only valid peak estimates.
 */
export function bootstrapCi(obs: Observation[], iters: number, rng: () => number): [number, number] {
  const fit = fitQuadratic(obs);
  const resid = obs.map((o) => o.y - (fit.b0 + fit.b1 * o.x + fit.b2 * o.x * o.x));
  const peaks: number[] = [];
  for (let i = 0; i < iters; i++) {
    const resampled: Observation[] = obs.map((o) => ({
      x: o.x,
      y: fit.b0 + fit.b1 * o.x + fit.b2 * o.x * o.x + resid[Math.floor(rng() * resid.length)],
    }));
    const p = peakCm360(resampled);
    if (Number.isFinite(p) && p > 0) peaks.push(p);
  }
  if (peaks.length === 0) {
    throw new Error(
      `bootstrapCi: all ${iters} resamples were non-concave; data may be too noisy or too sparse`,
    );
  }
  peaks.sort((a, b) => a - b);
  const at = (q: number) => peaks[Math.min(peaks.length - 1, Math.floor(q * peaks.length))];
  const LO = 0.05, HI = 0.95; // 90% CI
  return [at(LO), at(HI)];
}
