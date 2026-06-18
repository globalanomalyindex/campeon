import type { Observation } from '../types';
import { fitQuadratic } from './peak-fit';

export { mulberry32 } from './rng';

/** Peak cm/360 of a fit, or NaN if the fit is non-concave (no interior maximum → not a valid peak). */
const peakCm360 = (obs: Observation[]): number => {
  const { b1, b2 } = fitQuadratic(obs);
  if (b2 >= 0) return NaN;
  return Math.exp(-b1 / (2 * b2));
};

/** 5th/95th percentiles of a list of peak estimates (90% CI). Sorts in place. */
function percentileBand(peaks: number[]): [number, number] {
  peaks.sort((a, b) => a - b);
  const at = (q: number) => peaks[Math.min(peaks.length - 1, Math.floor(q * peaks.length))];
  const LO = 0.05, HI = 0.95; // 90% CI
  return [at(LO), at(HI)];
}

/**
 * Residual (semi-parametric) bootstrap 90% CI on the optimal cm/360.
 *
 * Resamples residuals around the fitted parabola, refits, and takes the 5th/95th percentiles.
 * Non-concave resamples (no peak) are dropped, so the CI reflects only valid peak estimates.
 *
 * RELIABILITY-AWARE (P1-3, heteroscedastic): instead of pooling every instrument's residual into
 * one bag and resampling it uniformly - which lets one noisy facet inflate (or, worse, a lucky-quiet
 * facet deflate) every point's CI - each residual is first standardized by its own per-point noise
 * sd, drawn from that unit-variance pool, then RE-scaled to the TARGET point's noise sd. A loud facet
 * therefore receives large perturbations (its uncertainty widens the CI) while a quiet facet stays
 * quiet (it cannot be contaminated by the loud facet's spread).
 *
 * Determinism: the standardized pool is drawn with the SAME seeded RNG sequence as the old pooled
 * bag, so a given seed yields a given CI. When the input is homoscedastic - every `noise` undefined,
 * or every `noise` equal - the standardize/rescale factors all cancel to 1 and the result is
 * BYTE-IDENTICAL to the old uniformly-pooled CI (no silent regression).
 *
 * Honesty floor: the heteroscedastic CI is unioned with the conservative pooled CI (computed on the
 * SAME seeded draws), so it can only ever be WIDER than - never narrower than - the pooled bound. A
 * reliability weighting is allowed to widen a facet's uncertainty, never to silence it.
 */
export function bootstrapCi(obs: Observation[], iters: number, rng: () => number): [number, number] {
  const fit = fitQuadratic(obs);
  const resid = obs.map((o) => o.y - (fit.b0 + fit.b1 * o.x + fit.b2 * o.x * o.x));

  // Per-point noise SD; undefined noise → a shared unit reference so missing+uniform are equivalent.
  // Any non-finite/non-positive value is treated as the unit reference (no honest spread to weight by).
  const sd = obs.map((o) =>
    o.noise !== undefined && Number.isFinite(o.noise) && o.noise > 0 ? Math.sqrt(o.noise) : 1,
  );
  // The map is reliability-aware ONLY when facets actually differ in measured noise. When every point
  // shares the same sd (all undefined, or all equal) the standardize/rescale factors cancel to 1, so
  // we take the original single-pass pooled bootstrap UNCHANGED - byte-identical CI, no regression and
  // no extra RNG draws.
  const homoscedastic = sd.every((s) => s === sd[0]);

  // Conservative (pooled) resampling: draw the RAW residual uniformly, exactly as the original code.
  const fitted = (x: number) => fit.b0 + fit.b1 * x + fit.b2 * x * x;
  const pooledPeaks: number[] = [];
  for (let i = 0; i < iters; i++) {
    const resampled: Observation[] = obs.map((o) => ({
      x: o.x,
      y: fitted(o.x) + resid[Math.floor(rng() * resid.length)],
    }));
    const p = peakCm360(resampled);
    if (Number.isFinite(p) && p > 0) pooledPeaks.push(p);
  }
  const throwIfEmpty = (n: number) => {
    if (n === 0) {
      throw new Error(
        `bootstrapCi: all ${iters} resamples were non-concave; data may be too noisy or too sparse`,
      );
    }
  };

  if (homoscedastic) {
    throwIfEmpty(pooledPeaks.length);
    return percentileBand(pooledPeaks);
  }

  // Heteroscedastic resampling (drawn from a SEPARATE seeded stream so the pooled floor above stays
  // identical to the homoscedastic path): standardize each residual by its own noise sd into a
  // unit-variance pool, draw, then rescale to the TARGET point's noise sd. A loud facet receives large
  // perturbations (widening the CI); a quiet facet stays quiet (no contamination from the loud facet).
  const stdResid = resid.map((r, i) => r / sd[i]);
  const heteroPeaks: number[] = [];
  for (let i = 0; i < iters; i++) {
    const resampled: Observation[] = obs.map((o, j) => ({
      x: o.x,
      y: fitted(o.x) + stdResid[Math.floor(rng() * resid.length)] * sd[j],
    }));
    const p = peakCm360(resampled);
    if (Number.isFinite(p) && p > 0) heteroPeaks.push(p);
  }
  throwIfEmpty(pooledPeaks.length + heteroPeaks.length);

  // Honest floor: union the reliability-aware band with the conservative pooled band, so the result
  // can only ever WIDEN - never narrow below the pooled bound when facets genuinely disagree.
  const pooled = pooledPeaks.length > 0 ? percentileBand(pooledPeaks) : null;
  const hetero = heteroPeaks.length > 0 ? percentileBand(heteroPeaks) : null;
  if (pooled === null) return hetero as [number, number];
  if (hetero === null) return pooled;
  return [Math.min(hetero[0], pooled[0]), Math.max(hetero[1], pooled[1])];
}
