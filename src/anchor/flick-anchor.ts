import type { Counts360 } from '../types';
import { counts360 } from '../types';

/**
 * One open-loop reach.
 *
 * The name is the contract's and it means the FIRST SUBMOVEMENT of a reach, not the first reach of a
 * trial. That distinction is the whole instrument: using one reach per trial was measured at 13.7
 * percent mean absolute error and is not worth building, and using every reach at 4.6 percent, which
 * is why this ships. `index` is the reach's ordinal WITHIN its trial, counting from the first
 * acclimation lead-in reach (src/instruments/acclimation.ts records the reversal). An index of 0 is
 * therefore also the trial boundary, which is how the fit groups reaches without a trial id.
 */
export interface FirstReach {
  rendered: Counts360;
  landedFraction: number;
  index: number;
}

export interface FlickAnchor {
  identifiable: true;
  /** The believed counts per 360 the player walked in with: B0. */
  counts: Counts360;
  /** Standard error of ln(counts) from the fit's own residuals, floored. Never narrower. */
  logSd: number;
  /** The persistent motor bias in LOG units. Negative is the expected deliberate undershoot. */
  bias: number;
  /** Per-reach retention of the log belief error. 0 is instant re-anchoring, 1 is no adaptation. */
  adaptRate: number;
}

export interface FlickRefusal {
  identifiable: false;
  reason: 'no-covariance' | 'adapt-rate-at-bound' | 'too-few-reaches';
}

/** Reaches below this cannot support three parameters and their own residual spread. */
export const FLICK_MIN_REACHES = 40;
/** Distinct rendered gains below this leave ln(rendered) with too little range to identify B0. */
export const FLICK_MIN_LEVELS = 6;
export const ADAPT_RATE_MIN = 0.05;
export const ADAPT_RATE_MAX = 0.95;
/** Grid resolution for the profiled rate: rate = k / RATE_GRID for k in 0..RATE_GRID-1. */
export const RATE_GRID = 200;
/** One-sided critical value for the covariance precondition: the 99th percentile of the normal. */
export const COVARIANCE_MIN_Z = 2.3263478740408408;
/**
 * The floor on `logSd`, in log units.
 *
 * 4.6 percent mean absolute error is the best this estimator has ever demonstrated across simulated
 * sessions. For a lognormal, relative MAE is about 0.7979 times sigma, so 0.046 / 0.7979 is 0.0577.
 * A single session's OLS standard error can come out below that by luck, and reporting it would claim
 * precision the estimator has never shown. The floor only ever widens.
 */
export const FLICK_FLOOR_LOG_SD = 0.0577 + 0.0003;

interface Fit {
  lnB0: number;
  bias: number;
  rate: number;
  sse: number;
  varLnB0: number;
}

/**
 * Least squares at a FIXED rate. `ln f + rate^j * ln C_r = rate^j * ln B0 + bias` is linear in the
 * two unknowns, so this is a 2x2 normal-equation solve and there is nothing to seed or iterate.
 * Returns null when the design is singular, which is what happens as rate approaches 1: the
 * adaptation column becomes the intercept column and belief cannot be told from bias.
 */
function fitAt(rate: number, lnF: readonly number[], lnR: readonly number[], idx: readonly number[]): Fit | null {
  const n = lnF.length;
  let s11 = 0;
  let s12 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.pow(rate, idx[i]!);
    const y = lnF[i]! + w * lnR[i]!;
    s11 += w * w;
    s12 += w;
    b1 += w * y;
    b2 += y;
  }
  const det = s11 * n - s12 * s12;
  if (!(det > 1e-9)) return null;
  const lnB0 = (b1 * n - b2 * s12) / det;
  const bias = (b2 * s11 - b1 * s12) / det;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.pow(rate, idx[i]!);
    const r = lnF[i]! + w * lnR[i]! - (w * lnB0 + bias);
    sse += r * r;
  }
  // Three parameters: lnB0, bias, and the profiled rate. Charging the rate a degree of freedom is
  // what keeps the standard error from reading as though the rate had been known in advance.
  const dof = n - 3;
  const varLnB0 = dof > 0 ? (sse / dof) * (n / det) : Infinity;
  return { lnB0, bias, rate, sse, varLnB0 };
}

/** Pearson correlation. Returns 0 when either series has no spread. */
function correlation(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (!(da > 0) || !(db > 0)) return 0;
  return num / Math.sqrt(da * db);
}

/**
 * The joint fit over belief, motor bias and adaptation rate, with the two guards that keep it from
 * answering when it should not.
 *
 * Why a joint fit rather than the obvious simplification. Pinning the bias from the player's adapted
 * tail and subtracting it was measured at 9.5 percent against 4.6, because the tail is never fully
 * adapted and a biased point estimate propagates into every trial's intercept. The persistent
 * undershoot is what makes this identifiable rather than what breaks it: belief washes out with
 * exposure and bias does not, so the curvature separates them.
 *
 * The conflict with the allocator, documented rather than silently absorbed. Simulation put the
 * anchor's error at 4.5 percent with a 1.3x explored band rising to 11.2 percent at 4x, so the
 * anchor wants a NARROW band. The c-optimality screen in src/optimizer/evolution.ts wants the
 * opposite, because a parabola's vertex is worst determined by points crowded around it. And the
 * covariance precondition below needs ln(rendered) to vary at all, which pulls the same way as the
 * allocator. This code resolves nothing: it refuses when the band has narrowed past identifiability,
 * and it carries the cost of a wide band in `logSd`, measured from the fit's own residuals rather
 * than assumed. Nothing here reweights the allocator, because letting the anchor steer trial
 * placement would put a measurement in charge of its own design.
 */
export function anchorFromReaches(reaches: readonly FirstReach[]): FlickAnchor | FlickRefusal {
  const usable = reaches.filter(
    (r) =>
      Number.isFinite(r.landedFraction) &&
      r.landedFraction > 0 &&
      Number.isFinite(r.rendered) &&
      r.rendered > 0 &&
      Number.isInteger(r.index) &&
      r.index >= 0,
  );
  const levels = new Set(usable.map((r) => r.rendered)).size;
  if (usable.length < FLICK_MIN_REACHES || levels < FLICK_MIN_LEVELS) {
    return { identifiable: false, reason: 'too-few-reaches' };
  }

  const lnF = usable.map((r) => Math.log(r.landedFraction));
  const lnR = usable.map((r) => Math.log(r.rendered));
  const idx = usable.map((r) => r.index);

  // Guard one: landedFraction must demonstrably covary with the RECIPROCAL of the rendered gain.
  //
  // With no signal at all this estimator returned 28 percent mean absolute error and a range of
  // minus 43 to plus 61 percent, and it returned them confidently. The model says the opening reach
  // of each trial has ln f = ln B0 - ln C_r + bias, so a slope of exactly -1 on ln(rendered), which
  // means the correlation of ln f with ln(rendered) must be strongly NEGATIVE before the fit is
  // allowed to speak. Tested on the opening reaches only, where adaptation has not yet attenuated
  // the term. One-sided on purpose: a positive covariance is not weaker evidence of belief, it is
  // evidence of something else entirely, and it must refuse rather than fit a sign flip.
  const openers = usable.map((r, i) => ({ f: lnF[i]!, r: lnR[i]!, index: r.index })).filter((o) => o.index === 0);
  const rho = -correlation(
    openers.map((o) => o.f),
    openers.map((o) => o.r),
  );
  // Fisher z, clamped so a degenerate perfect correlation is a large finite number rather than
  // Infinity, and refusing outright below five trials where the transform has no calibration.
  const clamped = Math.max(-0.999999, Math.min(0.999999, rho));
  const z = openers.length >= 5 ? Math.atanh(clamped) * Math.sqrt(openers.length - 3) : 0;
  if (!(z >= COVARIANCE_MIN_Z)) {
    return { identifiable: false, reason: 'no-covariance' };
  }

  // Profile the rate. rate = 1 is not searched: the design is exactly singular there, and the
  // refusal bound at ADAPT_RATE_MAX is what catches a player heading toward it.
  let best: Fit | null = null;
  for (let k = 0; k < RATE_GRID; k++) {
    const fit = fitAt(k / RATE_GRID, lnF, lnR, idx);
    if (fit === null || !Number.isFinite(fit.sse)) continue;
    if (best === null || fit.sse < best.sse) best = fit;
  }
  if (best === null) {
    // No rate on the grid produced a solvable design. That is a statement about the data, not a
    // numerical accident: it happens when the reach ordinals carry no variation, so the adaptation
    // column is the intercept column and two of three parameters are all the design can hold.
    return { identifiable: false, reason: 'too-few-reaches' };
  }

  // Guard two: the fitted adaptation rate pinning at a boundary.
  //
  // At the lower bound the player re-anchors on whatever gain was just rendered, so only the opening
  // reach of each trial carries belief and every later one is pure bias. Simulation put that player
  // at 12.7 percent while the estimator still answered, and the pin is its signature. At the upper
  // bound the player does not adapt within the trial at all, and then the intercept and the
  // asymptote are the same column, so the belief mismatch cannot be separated from the motor bias
  // however good the residuals look. Both are one refusal, because both mean the same thing: three
  // parameters were fitted and only two were identified.
  if (best.rate <= ADAPT_RATE_MIN || best.rate >= ADAPT_RATE_MAX) {
    return { identifiable: false, reason: 'adapt-rate-at-bound' };
  }

  const counts = Math.exp(best.lnB0);
  const sd = Math.sqrt(best.varLnB0);
  if (!Number.isFinite(counts) || !(counts > 0) || !Number.isFinite(sd)) {
    return { identifiable: false, reason: 'too-few-reaches' };
  }
  return {
    identifiable: true,
    counts: counts360(counts),
    logSd: Math.max(FLICK_FLOOR_LOG_SD, sd),
    bias: best.bias,
    adaptRate: best.rate,
  };
}
