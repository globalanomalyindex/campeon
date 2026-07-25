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
