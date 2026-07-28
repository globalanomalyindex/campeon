import type { Counts360, GameId, Profile, Report, Result, TrialResult } from '../types';
import { computeBreakdown, facetConcordance } from './breakdown';
import { mulberry32 } from '../stats/rng';

export type CiConcord = 'tight' | 'moderate' | 'wide';

/**
 * Bucket the 90% CI into a LOG-SPACE WIDTH-RELATIVE descriptor by thresholds only - NOT an invented
 * agreement score. Reads exactly the CI width in ln(cm/360) space, `ln(hi) - ln(lo)`, which is the same
 * scale the curve is fit on and is scale-invariant (a 30→33 CI buckets identically to a 60→66 one). The
 * descriptor is purely a width bucket; the COPY that renders it must never assert a single cause (a wide
 * CI cannot distinguish short-session sampling noise from facet disagreement). Returns undefined for a
 * degenerate/non-finite CI so no descriptor is fabricated for an unmeasurable bound.
 */
export function ciConcord(_optimal: Counts360, ci90: readonly [Counts360, Counts360]): CiConcord | undefined {
  const [lo, hi] = ci90;
  if (!(lo > 0) || !(hi > 0) || !(hi > lo)) return undefined;
  const w = Math.log(hi) - Math.log(lo); // CI width in ln space (scale-invariant)
  if (w <= 0.18) return 'tight';   // ratio hi/lo ≲ 1.20
  if (w >= 0.55) return 'wide';    // ratio hi/lo ≳ 1.73
  return 'moderate';
}

/**
 * The three-tier prescription. Authored here in phase 1a because `Result.prescription` needs it in
 * the same commit that deletes `Result.perGameSens`; phase 1b owns `buildPrescription` and every
 * field it fills, and phases 3 and 4 fill the k and anchor sides.
 *
 * `ratio` and `ratioCi90` are OPTIONAL. As required fields they blocked tier two whenever k was
 * pinned but the anchor refused, which is a reachable state (a player who typed their game and
 * sensitivity but whose turn passes disagreed). `kLogSd` exists because the typed-sensitivity route
 * inherits the anchor's spread whole, so tier two has to widen rather than borrow tier one's
 * precision.
 */
export interface Prescription {
  /** anchor.counts / report.optimalCounts: the factor to multiply the current in-game sensitivity
   *  by. A ratio of two quantities counted in the same browser units, so k, yaw and any unit
   *  convention cancel exactly - the one claim on the payoff screen that assumes nothing. OPTIONAL
   *  (A5): absent exactly when the anchor refused; a session can still earn tier two without it. */
  ratio?: number;
  /** Conservative 90% band on the ratio: [anchor.lo / counts.hi, anchor.hi / counts.lo]. The
   *  endpoint quotient is wider than an independence-assuming error product on purpose: the
   *  dependence between the two CIs is not measured, and intervals widen, never narrow. Present
   *  exactly when `ratio` is. */
  ratioCi90?: [number, number];
  /** C*, the located optimum in browser counts per 360, copied verbatim from the Report. */
  counts: Counts360;
  countsCi90: [Counts360, Counts360];
  /** ONLY when k is pinned (lattice `scaled(k)` or a typed in-game sensitivity). Absent means
   *  unpinned and tier two is withheld - never a table computed from a guessed k. Computed by
   *  phase 3's tierTwoFrom, the single implementation of tier two (A4). */
  perGameSens?: Partial<Record<GameId, number>>;
  /** Absent exactly when `perGameSens` is: an unpinned k costs the tier, never the answer. */
  kSource?: 'lattice' | 'typed-sens';
  /** k's own uncertainty in ln space, inherited whole from the pin (A5). On the typed-sens route
   *  this is the anchor's reproduction spread landing whole on k, so it is not small; the screen
   *  must WIDEN each per-game row by it rather than borrowing tier one's precision. 0 on the
   *  lattice route as phase 3 currently pins it. Present exactly when `perGameSens` is. */
  kLogSd?: number;
  /** C* / k: the located optimum in the mouse's OWN counts (A6). Present exactly when k is
   *  pinned. Tier three renders THIS as convertible hardware counts; without it the screen keeps
   *  browser counts and must disclose the second unmeasured factor in any centimetre arithmetic. */
  hardwareCounts?: Counts360;
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
  bounds?: [Counts360, Counts360],
  profile?: Profile,
): Result {
  return {
    optimalCounts: report.optimalCounts,
    ci90: report.ci90,
    breakdown: computeBreakdown(trials, report.optimalCounts, profile),
    ...(bounds ? { curve: report.curve, bounds } : {}),
    // The strike lean is the user's REAL taste knob (profile.speedAccuracy), not the hardcoded
    // instrumentWeights.strike (=1). Carry it so the result screen can label the strike rows. Omit it
    // without a profile so old/headless callers stay number-only.
    ...(profile && Number.isFinite(profile.speedAccuracy) ? { speedAccuracy: profile.speedAccuracy } : {}),
    // A4: the measured session-drift readout, copied VERBATIM from the Report. Absent when the
    // extended fit fell back (or for old reports) so the result screen dashes it - never padded.
    ...(report.driftZ !== undefined ? { driftZ: report.driftZ } : {}),
    // Bounds honesty: the clamped-vertex disclosure, copied verbatim. Absent for interior peaks and
    // for old reports; never inferred from the optimum happening to sit on an edge of the window.
    ...(report.peakAtBound !== undefined ? { peakAtBound: report.peakAtBound } : {}),
    // A5: the per-facet peaks + concordance tier - the "one latent cm/360" thesis tested as a claim.
    // Seeded on the trial count (a decoupled stream, like the live-plot interim RNG) so this readout
    // is deterministic and never perturbs the scored sequence. Dropped for tuned results by adoptResult.
    facetConcordance: facetConcordance(trials, mulberry32(0xface ^ trials.length)),
  };
}
