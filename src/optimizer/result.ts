import type { Cm360, Dpi, GameId, Profile, Report, Result, TrialResult } from '../types';
import { perGameSens } from '../convert/schools';
import { computeBreakdown } from './breakdown';

export type CiConcord = 'tight' | 'moderate' | 'wide';

/**
 * Bucket the 90% CI into a LOG-SPACE WIDTH-RELATIVE descriptor by thresholds only - NOT an invented
 * agreement score. Reads exactly the CI width in ln(cm/360) space, `ln(hi) - ln(lo)`, which is the same
 * scale the curve is fit on and is scale-invariant (a 30→33 CI buckets identically to a 60→66 one). The
 * descriptor is purely a width bucket; the COPY that renders it must never assert a single cause (a wide
 * CI cannot distinguish short-session sampling noise from facet disagreement). Returns undefined for a
 * degenerate/non-finite CI so no descriptor is fabricated for an unmeasurable bound.
 */
export function ciConcord(_optimal: Cm360, ci90: readonly [Cm360, Cm360]): CiConcord | undefined {
  const [lo, hi] = ci90;
  if (!(lo > 0) || !(hi > 0) || !(hi > lo)) return undefined;
  const w = Math.log(hi) - Math.log(lo); // CI width in ln space (scale-invariant)
  if (w <= 0.18) return 'tight';   // ratio hi/lo ≲ 1.20
  if (w >= 0.55) return 'wide';    // ratio hi/lo ≳ 1.73
  return 'moderate';
}

/**
 * Assemble the player-facing Result: the one cm/360 answer + CI, the native per-game sensitivities
 * at that answer, and the breakdown of how each facet contributed. `games` optionally restricts the
 * per-game table (default: all games in the yaw table).
 *
 * When `bounds` is supplied, the Report's fitted `curve` is copied VERBATIM and the bounds are
 * persisted so the result screen can redraw the convergence plot with a correct x-axis even after a
 * localStorage reload (this is strictly downstream of scoring - NO smoothing, NO refit). Headless/old
 * callers that omit `bounds` produce a number-only Result.
 *
 * `profile` is the SAME profile the optimizer fused with; when supplied, the breakdown reports each
 * facet's affine-fused contribution (track/flick) at the optimum, and the result carries the user's
 * speed↔accuracy lean (`profile.speedAccuracy`, the real taste knob). Omitting it leaves the contributions
 * NaN (→ dash) and the lean absent, so old/headless callers stay number-only.
 */
export function buildResult(
  report: Report,
  trials: readonly TrialResult[],
  dpi: Dpi,
  games?: readonly GameId[],
  bounds?: [Cm360, Cm360],
  profile?: Profile,
): Result {
  const all = perGameSens(report.optimalCm360, dpi);
  const perGameSensOut = games
    ? (Object.fromEntries(games.map((g) => [g, all[g]])) as Partial<Record<GameId, number>>)
    : all;
  return {
    optimalCm360: report.optimalCm360,
    ci90: report.ci90,
    perGameSens: perGameSensOut,
    breakdown: computeBreakdown(trials, report.optimalCm360, profile),
    ...(bounds ? { curve: report.curve, bounds } : {}),
    // The strike lean is the user's REAL taste knob (profile.speedAccuracy), not the hardcoded
    // instrumentWeights.strike (=1). Carry it so the result screen can label the strike rows. Omit it
    // without a profile so old/headless callers stay number-only.
    ...(profile && Number.isFinite(profile.speedAccuracy) ? { speedAccuracy: profile.speedAccuracy } : {}),
    // A4: the measured session-drift readout, copied VERBATIM from the Report. Absent when the
    // extended fit fell back (or for old reports) so the result screen dashes it - never padded.
    ...(report.driftZ !== undefined ? { driftZ: report.driftZ } : {}),
  };
}
