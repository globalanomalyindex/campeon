// The blind reference turn: three reproductions of a full 360 by feel, combined into one counts
// estimate that carries its own weight. Pure - the view (src/ui/calibrate/turn-view.ts) feeds it
// pass magnitudes and renders its verdicts. Replaces the spin's single tap-when-green pass, which
// computed its dial from a fixed provisional turn distance (30 cm at 800 DPI, 9450 counts) and so
// measured its own constant.
import { counts360, type Counts360 } from '../types';
import { mean, sampleStd } from '../scoring/stats';

export interface TurnEstimate {
  /** Counts per full 360: the geometric mean of the kept passes. Geometric because reproduction
   *  error is multiplicative (a sloppy pass overshoots by a factor, not by a fixed count) and the
   *  optimizer searches ln space, so this is the mean in the space the estimate is used in. */
  counts: Counts360;
  /** Relative spread of the kept passes, (max - min) / mean, as a percentage. A CONSISTENCY
   *  indicator, never a CI, and the spec requires it shown to the player: the view renders it in
   *  the fourth-pass offer, the setup screen renders it on agreement and on the spread block. */
  spreadPct: number;
  /** The weight this estimate carries into phase 4's reconciliation, AND the number the turn-alone
   *  ci90 is built from there, which is why the regularization below is one-sided. An implausibly
   *  tight trio is pulled up toward TURN_PRIOR_LOG_SD (three samples make a terrible variance
   *  estimate; simulation showed the shrunk self-measured weight matches oracle weighting to
   *  within a tenth of a percent, spec 2026-07-25, "what the simulations established"). A trio
   *  wider than the prior keeps its measured sd untouched: intervals widen, never narrow. */
  logSd: number;
  /** True when the kept passes landed within TURN_AGREE_SPREAD_PCT of each other. False is not a
   *  failure: the view offers a fourth pass, and only a still-disagreeing fourth blocks. */
  agreed: boolean;
  /** How many passes the estimate actually rests on, after any outlier drop, so a downstream
   *  reader never mistakes a rescued 3-of-4 for a clean 3-of-3. */
  passes: number;
}

/** Prior log-space sd of a blind full-turn reproduction. Anchors the one-sided shrinkage below;
 *  simulation put honest reproduction spreads at roughly 5 to 15 percent, and exp(0.15) - 1 is
 *  16 percent, just above the top of that band. */
export const TURN_PRIOR_LOG_SD = 0.15;

const MIN_PASSES = 3;

/** Kept passes agree when their relative spread is at or below this. A chosen operating point, not
 *  a measured bound: tighter routes honest sessions to the fourth pass routinely, looser averages
 *  passes the player visibly fumbled. 15 keeps the fourth pass for genuine disagreement. */
export const TURN_AGREE_SPREAD_PCT = 15;

/** A pass is an outlier when its log distance from the median pass exceeds this (a 15 percent
 *  factor). Applied only from the fourth pass on: with exactly three, the outlier and the spread
 *  are indistinguishable (pinned by "flags disagreement beyond the threshold" in
 *  tests/anchor/reference-turn.test.ts), so three disagreeing passes earn an offer, not a rescue. */
const REJECT_LOG = Math.log(1.15);

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Combine blind full-turn passes into one estimate, or refuse.
 * - Under three passes: null. Two passes cannot even hint at their own spread.
 * - Any non-finite or non-positive pass: null, never filtered. A zero-count pass is a recording
 *   fault, and silently dropping it would fabricate agreement out of a broken series.
 * - From four passes on, a single pass far from the median log is dropped (the fourth pass exists
 *   to expose exactly that pass), but never below three survivors.
 */
export function turnFromPasses(passCounts: readonly number[]): TurnEstimate | null {
  if (passCounts.length < MIN_PASSES) return null;
  for (const c of passCounts) if (!Number.isFinite(c) || c <= 0) return null;

  const logs = passCounts.map((c) => Math.log(c));
  let kept = logs;
  if (logs.length > MIN_PASSES) {
    const med = median(logs);
    const survivors = logs.filter((l) => Math.abs(l - med) <= REJECT_LOG);
    if (survivors.length >= MIN_PASSES) kept = survivors;
  }

  const counts = counts360(Math.exp(mean(kept)));
  const linear = kept.map((l) => Math.exp(l));
  const spreadPct = ((Math.max(...linear) - Math.min(...linear)) / mean(linear)) * 100;
  // One-sided shrinkage toward the prior. An implausibly TIGHT trio is pulled up to
  // (sd + prior) / 2, because three samples make a terrible variance estimate and simulation
  // matched oracle weighting there. A trio WIDER than the prior keeps its measured sd: phase 4's
  // reconcile builds the turn-alone ci90 straight from this number, so the two-sided average
  // would report a genuine 0.30 as 0.225, an interval 25 percent tighter than measured (pinned by
  // 'never narrows a spread wider than the prior'). The canon permits widening only.
  const sd = sampleStd(kept);
  const logSd = Math.max(sd, (sd + TURN_PRIOR_LOG_SD) / 2);
  return { counts, spreadPct, logSd, agreed: spreadPct <= TURN_AGREE_SPREAD_PCT, passes: kept.length };
}
