import type { Concordance } from '../types';
import type { CiConcord } from '../optimizer/result';

/**
 * Shared honesty-vetted copy for the two agreement readouts, used by BOTH the result screen and the
 * session's dialed-in panel (a shared module, not an import from result.ts - session-view and
 * result.ts already import from each other's neighborhoods and this copy must have exactly one home).
 *
 * CI-concord copy: the descriptor is a WIDTH bucket only; this copy NEVER asserts a single cause - a
 * wide CI cannot distinguish short-session sampling noise from facet disagreement, so it names BOTH
 * as a possibility list. A tight CI is the only one that earns a confident reading.
 */
export const CONCORD_COPY: Record<CiConcord, string> = {
  tight: 'The four views concur on a sharp answer',
  moderate: 'The four views broadly agree; a few more trials would tighten this band',
  wide: 'This band is wide, which could be short-session sampling noise, the facets disagreeing, or both; more trials would tell them apart',
};

/**
 * A5 thesis copy: the per-facet concordance TIER is a geometric observation over each probe's own
 * measured peak (conservative, spread-floored - see breakdown.ts), so this copy reports agreement or
 * disagreement as an observation and never asserts a cause. `divergent` is shown as honest doubt -
 * the thesis being tested, not assumed.
 */
export const THESIS_COPY: Record<Concordance, string> = {
  concordant: "Each probe's own peak lands on the same answer; the one-number thesis held this session",
  'some-spread': "The probes' own peaks sit near one another without fully agreeing; a session this short cannot separate them further",
  divergent: 'The probes genuinely disagree this session; the blend averages different bests, so read the one number with that in mind',
};

/** No verdict when fewer than two facets could fit their own peak - said plainly, never a hidden pass. */
export const THESIS_INCONCLUSIVE =
  'Too few per-probe fits to test agreement this session; no verdict either way';

/**
 * Bounds honesty copy, shown in PLACE of the measured-CI line when `Result.peakAtBound` is set. The
 * number on screen is then a clamped edge of the searched window: the fit concluded the best
 * sensitivity sits beyond the range that was searched, so the copy must present the edge as a bound
 * on the answer and never as a located optimum. The direction word says which way the evidence
 * points (high = the slow end of the counts-per-360 scale, low = the fast end). The caller interpolates the
 * SAME formatted value it prints as the big number, so the copy and the number can never disagree.
 */
export const BOUNDED_COPY: Record<'low' | 'high', (v: string) => string> = {
  high: (v) =>
    `The fitted curve peaks past the slow edge of the window I searched. Your number reads as at least ${v} counts per 360, a bound this session cannot see past.`,
  low: (v) =>
    `The fitted curve peaks past the fast edge of the window I searched. Your number reads as at most ${v} counts per 360, a bound this session cannot see past.`,
};

/** The lead line above a bounded number: the edge is where the maths stopped, and the lead says so
 *  before the reader can take the big figure as a located answer. */
export const BOUNDED_LEAD = 'Where the search stopped';
