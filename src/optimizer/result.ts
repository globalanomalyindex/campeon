import type { Counts360, GameId, Profile, Report, Result, TrialResult } from '../types';
import { counts360 } from '../types';
import { sensRatio } from '../convert/counts';
import { tierTwoFrom, type KPin } from '../input/count-convention';
import { computeBreakdown, facetConcordance } from './breakdown';
import { mulberry32 } from '../stats/rng';

export type CiConcord = 'tight' | 'moderate' | 'wide';

/**
 * Bucket the 90% CI into a LOG-SPACE WIDTH-RELATIVE descriptor by thresholds only - NOT an invented
 * agreement score. Reads exactly the CI width in ln space, `ln(hi) - ln(lo)`, the same scale the
 * curve is fit on, and scale-invariant (an 8000 to 8800 CI buckets identically to a 16000 to 17600
 * one - which is also why the cm-to-counts unit change left the thresholds untouched). The
 * descriptor is purely a width bucket; the COPY that renders it must never assert a single cause (a
 * wide CI cannot distinguish short-session sampling noise from facet disagreement). Returns
 * undefined for a degenerate/non-finite CI so no descriptor is fabricated for an unmeasurable bound.
 */
export function ciConcord(_optimal: Counts360, ci90: readonly [Counts360, Counts360]): CiConcord | undefined {
  const [lo, hi] = ci90;
  if (!(lo > 0) || !(hi > 0) || !(hi > lo)) return undefined;
  const w = Math.log(hi) - Math.log(lo); // CI width in ln space (scale-invariant)
  if (w <= 0.18) return 'tight';   // ratio hi/lo below about 1.20
  if (w >= 0.55) return 'wide';    // ratio hi/lo above about 1.73
  return 'moderate';
}

/**
 * The payoff, shaped by what each claim assumes (spec: "The result screen, ordered by what each
 * claim assumes"). Tier one is `ratio`, present only when an anchor was measurable; tier two is
 * `perGameSens`, present ONLY under a pinned k; tier three is `counts`, restated by the screen
 * with the optional typed-DPI arithmetic. The shape is canonical (plan contract, Decision 1 as
 * amended by A5: ratio/ratioCi90 optional, kLogSd added). `hardwareCounts` goes one field beyond
 * the amended contract and is flagged in this part's hand-offs: A6 requires tier three to render
 * C* / k when k is pinned, and the screen has no other honest access to k.
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
   *  folds it into each per-game row's 90% band in quadrature with `countsCi90` (D3), so the
   *  band carries BOTH the search's precision and the pin's. 0 on the lattice route as phase 3
   *  currently pins it, and the band still renders then, carrying the search term alone.
   *  Present exactly when `perGameSens` is. */
  kLogSd?: number;
  /** C* / k: the located optimum in the mouse's OWN counts (A6). Present exactly when k is
   *  pinned. Tier three renders THIS as convertible hardware counts; without it the screen keeps
   *  browser counts and must disclose the second unmeasured factor in any centimetre arithmetic. */
  hardwareCounts?: Counts360;
}

/** The C0 reading tier one divides by. A structural subset of reconcile.ts's `Anchor` (phase 4),
 *  declared here so this module never imports a file it does not own: phase 4 passes its Anchor
 *  straight in and TypeScript checks it structurally. */
export interface AnchorReading { counts: Counts360; ci90: [Counts360, Counts360]; }

/**
 * Build the payoff tiers, or refuse. Every early return here is a measured-honesty gate, not
 * defensiveness: this function would rather hand the screen nothing than a plausible wrong factor,
 * because the factor is the number a player will actually type into their game.
 */
export function buildPrescription(
  report: Report,
  anchor: AnchorReading | null,
  k?: KPin,
  games?: readonly GameId[],
): Prescription | null {
  // A clamped vertex is a bound with the evidence pointing past it (Report.peakAtBound). A factor
  // OR a per-game table taken against a bound would prescribe the edge of MY search window as if
  // it were the player's best, so the whole prescription refuses and the screen keeps its bound
  // copy instead.
  if (report.peakAtBound !== undefined) return null;
  const cStar = report.optimalCounts;
  const [cLo, cHi] = report.ci90;
  const positive = (v: number): boolean => Number.isFinite(v) && v > 0;
  if (![cStar, cLo, cHi].every(positive) || cHi < cLo) return null;
  // Tier one exists only with an anchor. anchor === null is the honest refusal (turn disagreed,
  // flick refused) and costs the ratio alone; a NON-null anchor with a NaN, non-positive count or
  // inverted interval means the caller has a bug this module must not paper over: refuse the
  // whole prescription outright (pinned by 'refuses degenerate inputs').
  let tierOne: { ratio: number; ratioCi90: [number, number] } | null = null;
  if (anchor !== null) {
    const [aLo, aHi] = anchor.ci90;
    if (![anchor.counts, aLo, aHi].every(positive) || aHi < aLo) return null;
    // sensRatio is the ONE implementation of the tier-one quotient (phase 1a's hand-off): a second
    // open-coded copy of the same division would be a second place for it to drift. The positive
    // checks above already satisfy its own guard, so it cannot throw here.
    tierOne = { ratio: sensRatio(anchor.counts, cStar), ratioCi90: [aLo / cHi, aHi / cLo] };
  }
  // Tier two rides only on a pinned k, and phase 3's tierTwoFrom is its ONLY implementation (A4):
  // a second path to the same number would be a second place for k to go missing. An unpinned
  // KPin costs the tier, never the ratio.
  let tierTwo:
    | { perGameSens: Partial<Record<GameId, number>>; kSource: 'lattice' | 'typed-sens'; kLogSd: number; hardwareCounts: Counts360 }
    | null = null;
  if (k !== undefined && k.pinned) {
    const t = tierTwoFrom(cStar, k, games);
    // hardwareCounts carries the SAME division tierTwoFrom performs, surfaced so tier three can
    // render mouse-own counts when k is pinned (A6) - one k, applied in one commit of arithmetic.
    if (t !== null) tierTwo = { ...t, hardwareCounts: counts360(cStar / k.k) };
  }
  // Neither tier earned: there is nothing to prescribe. The located counts still reach the screen
  // through the Result itself, so refusing here costs the factor and the table and nothing else.
  if (tierOne === null && tierTwo === null) return null;
  return {
    counts: cStar,
    countsCi90: report.ci90,
    ...(tierOne ?? {}),
    ...(tierTwo ?? {}),
  };
}

export type RatioFraming = 'directional' | 'confirmed' | 'indistinct';

/** Everything the ratio interval allows must sit within this of no change (in |ln|) before the
 *  screen may read it as "already at your best". 0.05 sits just above the anchor's simulated
 *  accuracy floor (about 4% MAE across the spec's Monte Carlo conditions), so the confirmed claim
 *  never outruns the instrument's own resolution; below that floor, "move by 3%" would be noise
 *  dressed as an instruction. */
export const CONFIRMED_MAX_ABS_LN = 0.05;

/**
 * Which sentence the ratio has earned. 'directional': the interval excludes 1, a change is
 * distinguishable from none, the multiply instruction leads. 'confirmed': the interval contains 1
 * AND is confined within CONFIRMED_MAX_ABS_LN of it - the best outcome the instrument can report,
 * phrased by the screen as what the interval supports and no more (see F33: the copy must not
 * claim the session "had every chance", which is a claim about the design, not a measurement).
 * 'indistinct': the interval contains 1 but is not confined, so the screen drops the change
 * framing rather than report a change it cannot distinguish from none (spec, error-path list,
 * final item). Callers pass a buildPrescription vetted interval; this classifier never repairs one.
 */
export function ratioFraming(ratioCi90: readonly [number, number]): RatioFraming {
  const [lo, hi] = ratioCi90;
  if (lo > 1 || hi < 1) return 'directional';
  return Math.max(Math.abs(Math.log(lo)), Math.abs(Math.log(hi))) <= CONFIRMED_MAX_ABS_LN
    ? 'confirmed'
    : 'indistinct';
}

export interface BuildResultOpts {
  /** Restrict tier two's table (default: every yaw-table game). */
  games?: readonly GameId[];
  /** Search bounds, persisted with the verbatim curve so the plot survives a reload. */
  bounds?: [Counts360, Counts360];
  profile?: Profile;
  /** The reconciled C0 reading (phase 2's turn, phase 4's reconciliation). null or omitted means
   *  no anchor this session; the ratio fields are then omitted, never padded. */
  anchor?: AnchorReading | null;
  /** Phase 3's pin, straight off the draft (SessionDraft.kPin). Absent or unpinned costs tier
   *  two, never tier one. */
  k?: KPin;
}

/**
 * Assemble the player-facing Result: the located optimum in counts per 360 + CI, the breakdown of
 * how each facet contributed, and (when `bounds` is supplied) the Report's fitted `curve` copied
 * VERBATIM with the bounds persisted, so the result screen can redraw the convergence plot with a
 * correct x-axis after a localStorage reload (strictly downstream of scoring - NO smoothing, NO
 * refit). `profile` is the SAME profile the optimizer fused with; omitting it leaves the affine
 * contributions NaN (rendered as a dash) and the lean absent, so old/headless callers stay
 * number-only.
 *
 * The per-game table no longer lives on the Result: it is tier two of the Prescription and exists
 * only under a pinned k (buildPrescription). Computing it from counts alone would need exactly the
 * k = 1 guess the lattice's one-sided contract forbids.
 */
export function buildResult(
  report: Report,
  trials: readonly TrialResult[],
  opts: BuildResultOpts = {},
): Result {
  const { bounds, profile } = opts;
  const prescription = buildPrescription(report, opts.anchor ?? null, opts.k, opts.games);
  return {
    optimalCounts: report.optimalCounts,
    ci90: report.ci90,
    breakdown: computeBreakdown(trials, report.optimalCounts, profile),
    // The payoff tiers. null when nothing was earned (no anchor AND no pinned k) or the vertex
    // clamped: the screen then leads with the located counts and says why the factor is
    // withheld, never a padded ratio.
    ...(prescription ? { prescription } : {}),
    ...(bounds ? { curve: report.curve, bounds } : {}),
    // The strike lean is the user's REAL taste knob (profile.speedAccuracy), not the hardcoded
    // instrumentWeights.strike (=1). Carry it so the result screen can label the strike rows. Omit
    // it without a profile so old/headless callers stay number-only.
    ...(profile && Number.isFinite(profile.speedAccuracy) ? { speedAccuracy: profile.speedAccuracy } : {}),
    // A4: the measured session-drift readout, copied VERBATIM from the Report. Absent when the
    // extended fit fell back (or for old reports) so the result screen dashes it - never padded.
    ...(report.driftZ !== undefined ? { driftZ: report.driftZ } : {}),
    // Bounds honesty: the clamped-vertex disclosure, copied verbatim. Absent for interior peaks and
    // for old reports; never inferred from the optimum happening to sit on an edge.
    ...(report.peakAtBound !== undefined ? { peakAtBound: report.peakAtBound } : {}),
    // A5: the per-facet peaks + concordance tier. Seeded on the trial count (a decoupled stream)
    // so this readout is deterministic and never perturbs the scored sequence.
    facetConcordance: facetConcordance(trials, mulberry32(0xface ^ trials.length)),
  };
}
