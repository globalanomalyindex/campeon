import type { Observation } from '../types';
import { fitDrift, fitQuadratic, fitQuadraticDrift, leverageScale } from './peak-fit';

export { mulberry32 } from './rng';

/** Peak cm/360 of a fit, or NaN if the fit is non-concave (no interior maximum → not a valid peak). */
const peakCm360 = (obs: Observation[]): number => {
  const { b1, b2 } = fitQuadratic(obs);
  if (b2 >= 0) return NaN;
  return Math.exp(-b1 / (2 * b2));
};

/**
 * The 5th/95th percentile band over `total` attempted resamples. Sorts in place.
 *
 * `peaks` holds only the resamples that produced a concave fit with an interior peak. The
 * band used to be taken over those survivors alone while still being labelled 90%, so when
 * a third of the resamples were non-concave the interval actually covered 90% of 67%, and
 * the label overstated its own coverage. A non-concave resample is evidence that the data
 * admits no interior peak, which is MORE uncertainty about where the peak sits, not less.
 *
 * So the dropped resamples stay in the denominator, and each is attributed to whichever
 * tail widens the interval. The band can then only grow when resamples fail, never shrink.
 * With nothing dropped this is arithmetically identical to the previous behaviour.
 */
export function percentileBand(peaks: number[], total: number = peaks.length): [number, number] {
  peaks.sort((a, b) => a - b);
  const k = peaks.length;
  const n = Math.max(total, k);
  const dropped = n - k;
  const LO = 0.05, HI = 0.95; // 90% CI
  const at = (i: number): number => peaks[Math.max(0, Math.min(k - 1, i))]!;
  return [at(Math.floor(LO * n) - dropped), at(Math.floor(HI * n))];
}

/**
 * Residual (semi-parametric) bootstrap 90% CI on the optimal cm/360.
 *
 * Resamples residuals around the fitted parabola, refits, and takes the 5th/95th percentiles.
 * Non-concave resamples yield no interior peak. They are excluded from the percentile values
 * but KEPT in the denominator (see `percentileBand`), so a run where many resamples fail
 * reports a wider band rather than a confident one over a shrunken sample.
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
 *
 * DRIFT-AWARE (A4, opt-in via `opts.drift` - the session controller sets it at FINALIZE ONLY): when
 * the extended ANCOVA fit is identifiable (all honesty guards in peak-fit's `fitDrift`), the bootstrap
 * ALSO resamples the EXTENDED-fit residuals and refits the extended model per resample, then unions
 * that band with the plain-fit band computed above it on the SAME seeded call - mirroring the
 * pooled/hetero union structure, so the CI may only WIDEN past the plain bound, never narrow. When
 * the guards fall back (no tau signal, too few points, collinear τ/x) the b3 column is DROPPED and the
 * plain path runs with identical RNG consumption - byte-identical CI, no silent regression.
 */
export interface BootstrapCiOptions {
  /** Union the extended (ANCOVA drift) resampling band with the plain band (A4, finalize-only). */
  drift?: boolean;
}

export function bootstrapCi(
  obs: Observation[],
  iters: number,
  rng: () => number,
  opts: BootstrapCiOptions = {},
): [number, number] {
  const fit = fitQuadratic(obs);
  // Fitted residuals are smaller than the true errors, because the fit is pulled toward every
  // point and hardest toward the high-leverage ones at the ends of the range. Resampling them raw
  // understates the noise and returns an interval narrower than the evidence supports. The
  // leverage scale removes that shrinkage, and it is always >= 1, so this can only widen.
  // Measured cost of NOT doing it: empirical coverage of the nominal 90% band sat near 87%.
  const lev = leverageScale(obs);
  const resid = obs.map((o, i) => (o.y - (fit.b0 + fit.b1 * o.x + fit.b2 * o.x * o.x)) * lev[i]!);

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

  // The plain-model band (pooled, unioned with the reliability-aware band when heteroscedastic).
  // Computed FIRST, on the leading draws of the seeded stream, so it is byte-identical to what the
  // drift-unaware call returns on the same seed - the A4 drift union below can then only ever widen it.
  const plain = ((): [number, number] => {
    if (homoscedastic) {
      throwIfEmpty(pooledPeaks.length);
      return percentileBand(pooledPeaks, iters);
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
    const pooled = pooledPeaks.length > 0 ? percentileBand(pooledPeaks, iters) : null;
    const hetero = heteroPeaks.length > 0 ? percentileBand(heteroPeaks, iters) : null;
    if (pooled === null) return hetero as [number, number];
    if (hetero === null) return pooled;
    return [Math.min(hetero[0], pooled[0]), Math.max(hetero[1], pooled[1])];
  })();
  if (!opts.drift) return plain;

  // A4 extended (ANCOVA drift) resampling - the SAME guarded fit the finalize peak uses, so the CI
  // and the reported peak can never disagree on which model ran. When any honesty guard falls back
  // the b3 column is DROPPED above (plain path, identical RNG consumption → byte-identical CI).
  const dcoef = fitDrift(obs);
  if (dcoef === null) return plain;
  const dFitted = (o: Observation): number =>
    dcoef.b0 + dcoef.b1 * o.x + dcoef.b2 * o.x * o.x + dcoef.b3 * (o.tau as number);
  const dResid = obs.map((o) => o.y - dFitted(o));
  const driftPeaks: number[] = [];
  for (let i = 0; i < iters; i++) {
    const resampled: Observation[] = obs.map((o) => ({
      x: o.x,
      tau: o.tau as number, // guarded: fitDrift returned non-null, so every tau is finite
      y: dFitted(o) + dResid[Math.floor(rng() * dResid.length)],
    }));
    try {
      const c = fitQuadraticDrift(resampled);
      if (c.b2 < 0) {
        const p = Math.exp(-c.b1 / (2 * c.b2));
        if (Number.isFinite(p) && p > 0) driftPeaks.push(p);
      }
    } catch {
      // singular resample design → no peak from this draw (dropped, like non-concave plain resamples)
    }
  }
  if (driftPeaks.length === 0) return plain; // nothing honest to add - never narrow, never fabricate
  const driftBand = percentileBand(driftPeaks, iters);
  // Widen-only union with the plain band computed on the same seeded call (mirrors pooled/hetero).
  return [Math.min(plain[0], driftBand[0]), Math.max(plain[1], driftBand[1])];
}
