import type { Counts360 } from '../types';
import { counts360 } from '../types';
import type { TurnEstimate } from './reference-turn';
import type { FlickAnchor, FlickRefusal } from './flick-anchor';

/** The 95th percentile of the standard normal: half of a two-sided 90 percent band. */
export const ANCHOR_Z90 = 1.6448536269514722;

/**
 * The floor on the combined log sd.
 *
 * Two independent measurements of the same latent quantity legitimately beat either one, and
 * simulation measured the pair at 3.1 to 4.2 percent against 4.3 for the flick alone and 4.8 to 15.0
 * for the turn alone. 3.1 percent is the best the pair has demonstrated, and 0.031 / 0.7979 is
 * 0.0389 in log units. Below that the inverse-variance algebra is claiming precision the pair has
 * never shown, so the floor holds. It can only widen.
 *
 * This is also the ONLY floor in the anchor path that this file applies. Each route floors its own
 * claim where that claim is made (turnFromPasses' one-sided shrinkage, FLICK_FLOOR_LOG_SD), and a
 * second floor here would overwrite a measured spread with a constant. A floor belongs on what is
 * published, not on what was measured.
 */
export const COMBINED_FLOOR_LOG_SD = 0.0389;

/**
 * How far apart the two routes may sit before their combination stops being a combination. One
 * combined standard deviation of the difference, at the same 90 percent level the interval reports,
 * so the threshold is the routes' own measured precision rather than a taste parameter.
 */
export const DISAGREE_Z = ANCHOR_Z90;

export interface Anchor {
  counts: Counts360;
  ci90: [Counts360, Counts360];
  sources: ReadonlyArray<'turn' | 'flick'>;
  /** The measured gap between the two routes, in percent. Present only when both routes spoke. */
  disagreementPct?: number;
}

interface Route {
  lnC: number;
  logSd: number;
}

const band = (lnC: number, logSd: number): [Counts360, Counts360] => [
  counts360(Math.exp(lnC - ANCHOR_Z90 * logSd)),
  counts360(Math.exp(lnC + ANCHOR_Z90 * logSd)),
];

/**
 * The turn as a weightable route, or null when it cannot be weighted at all.
 *
 * Its log sd is taken as measured, NOT floored at TURN_PRIOR_LOG_SD. Three blind passes estimate
 * their own spread, which is what removed the one unmeasurable parameter from the critical path, and
 * `turnFromPasses` has already applied the one-sided shrinkage that stops a lucky trio claiming what
 * three samples cannot: `max(sampleStd, (sampleStd + TURN_PRIOR_LOG_SD) / 2)`, which only ever pulls
 * an over-confident trio UP. Flooring again here would have made the floor win for every session
 * whose passes agreed, so the measured spread would never have reached the combination.
 * A spread of exactly zero is still dropped: it would carry infinite weight and silence the flick.
 * Regression: tests/anchor/reconcile.test.ts ('the turn alone reports the spread the passes
 * measured, wide or narrow').
 */
function turnRoute(turn: TurnEstimate | null): Route | null {
  if (turn === null) return null;
  if (!(turn.counts > 0) || !(turn.logSd > 0) || !Number.isFinite(turn.logSd)) return null;
  return { lnC: Math.log(turn.counts), logSd: turn.logSd };
}

/** The flick as a weightable route. A refusal is absence, never a wide guess. */
function flickRoute(flick: FlickAnchor | FlickRefusal): Route | null {
  if (flick.identifiable !== true) return null;
  if (!(flick.counts > 0) || !(flick.logSd > 0) || !Number.isFinite(flick.logSd)) return null;
  return { lnC: Math.log(flick.counts), logSd: flick.logSd };
}

/**
 * Combine the two anchor routes.
 *
 * Log space, because both routes are ratios and their errors are multiplicative: an inverse-variance
 * combination of counts would weight the slow end of the range more heavily than the fast end for no
 * reason. Weights are each route's OWN measured spread, which is what made the combination match
 * oracle weighting in simulation.
 *
 * The narrowing below is legitimate only because the two routes' errors are INDEPENDENT, and that
 * assumption is worth stating because it is not free: a systematic shared by both lands whole on the
 * point estimate and widens nothing, since the disagreement channel can only see the differential
 * part. What makes the assumption defensible is that the routes fail differently - the blind turn
 * makes no visual-angle judgement and the flick does - and what makes it honest is that the shared
 * mode is pinned as a known limit rather than left for a reader to discover.
 * Regression: tests/anchor/reconcile.test.ts ('a systematic shared by both routes moves the number
 * and widens nothing').
 *
 * Beyond their combined precision the two routes are not measuring the same thing, and the honest
 * response is a widen-only union rather than an average dressed as agreement. The point estimate is
 * NOT moved, because moving it needs a story about which route is wrong and there is none: the blind
 * turn involves no visual-angle judgement and the flick does, so their disagreement measures whether
 * the player's internal model maps world rotation or screen offset to hand travel. That is a finding,
 * not an embarrassment, and it is what `disagreementPct` reports.
 */
export function reconcile(turn: TurnEstimate | null, flick: FlickAnchor | FlickRefusal): Anchor | null {
  const t = turnRoute(turn);
  const f = flickRoute(flick);
  if (t === null && f === null) return null;
  if (t === null || f === null) {
    const only = t ?? f!;
    return {
      counts: counts360(Math.exp(only.lnC)),
      ci90: band(only.lnC, only.logSd),
      sources: [t !== null ? 'turn' : 'flick'],
    };
  }

  const wT = 1 / (t.logSd * t.logSd);
  const wF = 1 / (f.logSd * f.logSd);
  const lnC = (wT * t.lnC + wF * f.lnC) / (wT + wF);
  const combined = Math.max(COMBINED_FLOOR_LOG_SD, Math.sqrt(1 / (wT + wF)));
  let ci = band(lnC, combined);

  const gap = Math.abs(t.lnC - f.lnC);
  if (gap > DISAGREE_Z * Math.hypot(t.logSd, f.logSd)) {
    const tb = band(t.lnC, t.logSd);
    const fb = band(f.lnC, f.logSd);
    ci = [
      counts360(Math.min(ci[0], tb[0], fb[0])),
      counts360(Math.max(ci[1], tb[1], fb[1])),
    ];
  }

  return {
    counts: counts360(Math.exp(lnC)),
    ci90: ci,
    sources: ['turn', 'flick'],
    disagreementPct: (Math.exp(gap) - 1) * 100,
  };
}
