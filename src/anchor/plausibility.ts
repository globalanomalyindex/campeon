// The card's second job, and the reason it was worth bringing back.
//
// The blind turn measures the anchor in counts, and counts are the tool's own unit: self-consistent,
// but with nothing outside the browser to check them against. A measured DPI supplies exactly that,
// because counts and a DPI make a DISTANCE, and a human 360 lives in a band. So the card buys a free,
// automatic cross-check on the anchor: no validation session, no second instrument, nothing the
// player has to perform twice.
//
// What it must never do is repair anything. Nothing here corrects, clamps or re-fits the turn: it
// reports a verdict, the copy explains it, and the player decides whether to keep the reading or run
// the turn again. An instrument that quietly fixes its own number is the thing this codebase refuses
// to be, and it is the exact defect the deleted spin shipped.
import { isValidDpi } from '../input/dpi';
import type { Counts360, Dpi } from '../types';

/**
 * The band a full 360 of real mouse travel falls in, in centimetres. A chosen operating band, not a
 * measured bound: high-sensitivity players sit near 15, the low-sensitivity tail runs past 60, and 80
 * leaves the tail room rather than calling it a fault.
 *
 * Which fixes the honest scope of this check, and the scope is narrow. A band 5.3 times wide only
 * catches errors of roughly a factor of two, and only from a starting point far enough from the middle
 * for the doubling to leave the band: a sweep that covered half the card, a turn cut in half, a
 * decimal slip. A card swept along its short edge (ID-1 is 53.98 mm the other way, a factor of 1.59)
 * is caught from a middling anchor upward and missed from a fast one. A 5 percent error is invisible
 * to it. That is why a reading inside the band is reported as "not contradicted" and never as
 * "confirmed", and why the flag is offered to the player rather than acted on.
 */
export const HUMAN_MIN_CM360 = 15;
export const HUMAN_MAX_CM360 = 80;

/**
 * Centimetres of mouse travel for one full 360, from the turn's count total and the sweep's measured
 * DPI. NaN when either side is unusable, so a caller can never divide a fabricated number.
 *
 * The division below looks like a bug to anyone who has not worked it out, so: `dpi` is NOT the
 * player's hardware DPI. The sweep runs on RAW browser counts, so what it measured is dpi times k,
 * the browser's count convention, which nothing has pinned. `counts` came from the same browser
 * through the same pointer lock, so it carries the same k. The division cancels it:
 *
 *     cm = 2.54 * countsTrue / dpiTrue
 *        = 2.54 * (counts / k) / (dpi / k)
 *        = 2.54 * counts / dpi
 *
 * The centimetres are therefore correct with k unmeasured, which is the whole reason the card can
 * check the turn without either instrument knowing its own convention. Pinned by
 * tests/anchor/plausibility.test.ts "the count convention cancels, so a scaled browser reads the
 * same centimetres".
 */
export function cm360From(counts: Counts360, dpi: Dpi): number {
  if (!Number.isFinite(counts) || !(counts > 0)) return NaN;
  if (!isValidDpi(dpi)) return NaN;
  return (counts * 2.54) / dpi;
}

/** 'unmeasured' = no card sweep to check against, or a turn that is not a measurement. It is the
 *  ABSENCE of a check, never a passing one, and never a fault: the guided path runs without a sweep
 *  whenever the player skips it. */
export type TurnVerdict = 'unmeasured' | 'short' | 'human' | 'long';

export interface TurnPlausibility {
  /** The physical distance the pair implies, or NaN when the verdict is 'unmeasured'. Shown to the
   *  player in the flag copy, because a reading they can see is one they can argue with. */
  cm360: number;
  verdict: TurnVerdict;
}

/** Where the turn lands against the human band, given the card. Pure. */
export function turnPlausibility(counts: Counts360, dpi: Dpi): TurnPlausibility {
  const cm360 = cm360From(counts, dpi);
  if (!Number.isFinite(cm360)) return { cm360: NaN, verdict: 'unmeasured' };
  if (cm360 < HUMAN_MIN_CM360) return { cm360, verdict: 'short' };
  if (cm360 > HUMAN_MAX_CM360) return { cm360, verdict: 'long' };
  return { cm360, verdict: 'human' };
}

/**
 * The predicate: true when the card CONTRADICTS the turn.
 *
 * Named for the flag rather than for a pass, because that is what makes the default safe. No sweep,
 * or a sweep that did not measure cleanly, returns false: there is nothing to contradict the turn
 * with, and a missing check must not read as a failed one. Nothing downstream may treat a `true`
 * here as licence to adjust the anchor.
 */
export function cardContradictsTurn(counts: Counts360, dpi: Dpi): boolean {
  const { verdict } = turnPlausibility(counts, dpi);
  return verdict === 'short' || verdict === 'long';
}
