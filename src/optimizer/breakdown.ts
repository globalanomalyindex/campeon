import type { Cm360, Degrees, InstrumentId, Ms, Profile, TrialResult } from '../types';
import { mean, sampleStd } from '../scoring/stats';

export interface Breakdown {
  /** cm/360 where the calibrate gain crosses 1 (the bias-zero sensitivity, spec §4.3). */
  biasZeroCm360: Cm360;
  /** Minimum calibrate σ_R observed - the precision floor (skill/hardware), not a recommendation. */
  precisionFloorDeg: Degrees;
  /** Strike time-to-kill at the optimum. */
  ttkMs: Ms;
  /** Strike hit rate at the optimum. */
  hitRate: number;
  /** Track's AFFINE-FUSED contribution at the optimum: the SAME w·(score−mu)/sd quantity the optimizer
   *  fuses (objective.ts), evaluated at the track trial nearest the optimum in ln-space. NOT a raw-score
   *  argmax masquerading as a facet recommendation. NaN when <2 trials / no spread / no profile, exactly
   *  like biasZero/precisionFloor already dash. Optional so OLD saved Results render number-only. */
  trackContribZ?: number;
  /** Flick's AFFINE-FUSED contribution at the optimum - see `trackContribZ`. */
  flickContribZ?: number;
}

const byInstrument = (trials: readonly TrialResult[], id: TrialResult['instrument']) =>
  trials.filter((t) => t.instrument === id);

/** cm/360 where gain = 1, interpolated in ln-space across the bracketing pair; else nearest-to-1. */
function biasZero(cal: readonly TrialResult[]): Cm360 {
  const pts = cal
    .filter((t) => Number.isFinite(t.raw.gain) && t.cm360 > 0)
    .map((t) => ({ lx: Math.log(t.cm360), g: t.raw.gain, cm: t.cm360 }))
    .sort((a, b) => a.lx - b.lx);
  if (pts.length === 0) return NaN;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if ((a.g - 1) === 0) return a.cm;
    // Opposite signs ⇒ a.g and b.g straddle 1, so b.g ≠ a.g and the divisor below is nonzero.
    if ((a.g - 1) * (b.g - 1) < 0) {
      const f = (1 - a.g) / (b.g - a.g); // a.g + f·(b.g−a.g) = 1
      return Math.exp(a.lx + f * (b.lx - a.lx));
    }
  }
  // No crossing: report the trial whose gain is closest to 1 (honest nearest estimate).
  return pts.reduce((best, p) => (Math.abs(p.g - 1) < Math.abs(best.g - 1) ? p : best)).cm;
}

/**
 * Track/flick's AFFINE-FUSED contribution at the optimum: the SAME w·(score−mu)/sd quantity objective.ts
 * fuses (mu/sd taken across THIS instrument's own trials, weight from the profile), evaluated at the trial
 * nearest the optimum in ln-space. This is deliberately NOT a standalone raw-score argmax. Returns NaN
 * (→ dash) with <2 trials, no spread (sd not > 0), or no profile - exactly as biasZero/precisionFloor dash.
 */
function fusedContribAt(
  trials: readonly TrialResult[],
  id: InstrumentId,
  optimalCm360: Cm360,
  profile?: Profile,
): number {
  if (!profile) return NaN;
  const w = profile.instrumentWeights[id];
  if (!w) return NaN;
  const own = byInstrument(trials, id);
  const scores = own.map((t) => t.score);
  const sd = sampleStd(scores);
  if (!(sd > 0)) return NaN; // <2 trials / all-equal / NaN-poisoned → no usable signal (mirror objective.ts)
  const mu = mean(scores);
  const lOpt = Math.log(optimalCm360);
  const nearest = own.reduce((best, t) =>
    Math.abs(Math.log(t.cm360) - lOpt) < Math.abs(Math.log(best.cm360) - lOpt) ? t : best,
  );
  return w * ((nearest.score - mu) / sd);
}

/** Pure breakdown of the one answer into each facet's contribution. Missing data → NaN (no fabrication). */
export function computeBreakdown(
  trials: readonly TrialResult[],
  optimalCm360: Cm360,
  profile?: Profile,
): Breakdown {
  const cal = byInstrument(trials, 'calibrate');
  const str = byInstrument(trials, 'strike');

  const sigmas = cal.map((t) => t.raw.sigmaR).filter((v): v is number => Number.isFinite(v));
  const precisionFloorDeg = sigmas.length ? Math.min(...sigmas) : NaN;

  const lOpt = Math.log(optimalCm360);
  const nearest = str
    .filter((t) => t.cm360 > 0)
    .reduce<TrialResult | null>(
      (best, t) =>
        best === null || Math.abs(Math.log(t.cm360) - lOpt) < Math.abs(Math.log(best.cm360) - lOpt)
          ? t
          : best,
      null,
    );

  return {
    biasZeroCm360: biasZero(cal),
    precisionFloorDeg,
    ttkMs: nearest ? (nearest.raw.ttkMs ?? NaN) : NaN,
    hitRate: nearest ? (nearest.raw.hitRate ?? NaN) : NaN,
    trackContribZ: fusedContribAt(trials, 'track', optimalCm360, profile),
    flickContribZ: fusedContribAt(trials, 'flick', optimalCm360, profile),
  };
}
