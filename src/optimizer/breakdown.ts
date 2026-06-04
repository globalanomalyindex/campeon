import type { Cm360, Degrees, Ms, TrialResult } from '../types';

export interface Breakdown {
  /** cm/360 where the calibrate gain crosses 1 (the bias-zero sensitivity, spec §4.3). */
  biasZeroCm360: Cm360;
  /** Minimum calibrate σ_R observed - the precision floor (skill/hardware), not a recommendation. */
  precisionFloorDeg: Degrees;
  /** Strike time-to-kill at the optimum. */
  ttkMs: Ms;
  /** Strike hit rate at the optimum. */
  hitRate: number;
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

/** Pure breakdown of the one answer into each facet's contribution. Missing data → NaN (no fabrication). */
export function computeBreakdown(trials: readonly TrialResult[], optimalCm360: Cm360): Breakdown {
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
  };
}
