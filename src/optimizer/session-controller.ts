import type { Cm360, Observation, Report } from '../types';
import { fitPeak } from '../stats/psychometric';
import { bootstrapCi } from '../stats/bootstrap';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export interface FinalizeOptions {
  /** Bootstrap resamples for the CI (default 400). */
  bootstrapIters?: number;
  /** If set, widen the CI when the GP peak and the curve peak disagree (spec §5.3). */
  gpPeakCm360?: number;
  /** Log-space disagreement threshold for the GP/curve widen (default 0.15 ≈ 16% relative). */
  disagreeLogThreshold?: number;
}

/**
 * Honest fallback when no peak can be located: the best-observed cm/360 plus the FULL-bounds CI.
 * Seeded at the geometric midpoint (log-space, matching the optimizer's ln domain); any real
 * observation beats the −Infinity seed (blended z-scores are routinely negative).
 */
function fallbackReport(obs: readonly Observation[], lo: Cm360, hi: Cm360): Report {
  let best = { x: Math.log(Math.sqrt(lo * hi)), y: -Infinity };
  for (const o of obs) if (o.y > best.y) best = o;
  return {
    optimalCm360: clamp(Math.exp(best.x), lo, hi),
    ci90: [lo, hi],
    curve: [...obs].map((o) => ({ x: o.x, mean: o.y })).sort((a, b) => a.x - b.x),
  };
}

/**
 * Observations → Report. Fits the peaked psychometric curve, bootstraps the 90% CI, clamps to
 * bounds. When no peak can be located — too few points (<3), a non-concave fit, or a singular
 * /degenerate design — it honestly reports the best-observed cm/360 with the FULL bounds as the CI;
 * a wide CI is the honesty signal, never hidden. Unexpected errors are re-thrown, not masked. If a
 * GP peak is supplied and disagrees with the curve peak, the CI is widened to span both (spec §5.3).
 */
export function finalizeReport(
  obs: readonly Observation[],
  bounds: [Cm360, Cm360],
  rng: () => number,
  opts: FinalizeOptions = {},
): Report {
  const [lo, hi] = bounds;
  const iters = opts.bootstrapIters ?? 400;
  if (obs.length < 3) return fallbackReport(obs, lo, hi); // a quadratic fit needs ≥3 points

  let fit: ReturnType<typeof fitPeak>;
  try {
    fit = fitPeak([...obs]);
  } catch (err) {
    // Expected: "not concave" (no interior peak) or "singular matrix" (degenerate design) → the
    // data cannot locate a peak, so report honestly. Anything else is a real bug — re-throw it.
    if (!(err instanceof Error) || !/not concave|singular/.test(err.message)) throw err;
    return fallbackReport(obs, lo, hi);
  }

  const peak = clamp(fit.optimalCm360, lo, hi);
  let ci: [Cm360, Cm360];
  try {
    const raw = bootstrapCi([...obs], iters, rng);
    ci = [clamp(Math.min(raw[0], raw[1]), lo, hi), clamp(Math.max(raw[0], raw[1]), lo, hi)];
  } catch {
    ci = [lo, hi]; // bootstrap could not bound it → honest wide range
  }
  if (opts.gpPeakCm360 !== undefined) {
    const gp = clamp(opts.gpPeakCm360, lo, hi);
    const thresh = opts.disagreeLogThreshold ?? 0.15;
    if (Math.abs(Math.log(gp) - Math.log(peak)) > thresh) {
      ci = [Math.min(ci[0], gp, peak), Math.max(ci[1], gp, peak)];
    }
  }
  return { optimalCm360: peak, ci90: ci, curve: fit.curve };
}
