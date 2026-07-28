// Counts per 360 is the tool's own unit, so nothing here takes a DPI, a centimetre, or the 2.54 that
// used to sit in convert/cm360.ts. DPI cancels out of every number the tool reports: sens is
// 914.4 / (dpi * yaw * cm360) and cm360 is counts * 2.54 / dpi, so sens is 360 / (yaw * counts) and
// the DPI is gone. It survived only in a printed label, which is why the card was deleted rather
// than replaced. Verified numerically as well as algebraically, in tests/convert/counts.test.ts
// "agrees with the retired cm form at the same physical setting".
import { counts360 } from '../types';
import type { Counts360, Degrees } from '../types';

/** Every entry point guards the same way: an invalid gain must fail loudly at the validity core
 *  rather than propagate Infinity or NaN into the view rotation, a search bound, or an emitted
 *  sensitivity. Callers never see a plausible wrong number from this module. */
function positive(name: string, ...values: readonly number[]): void {
  for (const v of values) {
    if (!Number.isFinite(v) || !(v > 0)) {
      throw new RangeError(`${name}: arguments must be finite and positive (got ${values.join(', ')})`);
    }
  }
}

/** Degrees of view rotation per mouse count, so one full 360 spans exactly `counts` counts. */
export function degreesPerCount(counts: Counts360): Degrees {
  positive('degreesPerCount', counts);
  return 360 / counts;
}

/** In-game sensitivity that puts one 360 at `counts`, for a game whose yaw is `yaw` degrees per
 *  count at sens 1. The DPI-free form of the retired `914.4 / (dpi * yaw * cm360)`.
 *
 *  A warning for callers, which is the whole reason tier two is gated: `counts` here must be TRUE
 *  hardware counts. Handing it the browser's own movement deltas emits a sensitivity that is wrong
 *  by the unmeasured convention factor k, and wrong silently, because the number looks ordinary. */
export function sensFor(counts: Counts360, yaw: number): number {
  positive('sensFor', counts, yaw);
  return 360 / (yaw * counts);
}

/** True counts per 360 for a player who names their game and their current in-game sensitivity.
 *  Exact rather than estimated: it is the game's own definition inverted, which is why the typed
 *  route is a first-class offer and not a fallback. */
export function countsForSens(sens: number, yaw: number): Counts360 {
  positive('countsForSens', sens, yaw);
  return counts360(360 / (yaw * sens));
}

/** Same 360 distance, different game. A ratio of yaw constants, so the count total, the count
 *  convention and any unit cancel exactly. */
export function crossGame(sens: number, yawFrom: number, yawTo: number): number {
  positive('crossGame', sens, yawFrom, yawTo);
  return (sens * yawFrom) / yawTo;
}

/** The tier-one number: what to multiply the player's current in-game sensitivity by.
 *
 *  Sensitivity runs inverse to counts per 360, so the multiplier is anchor / optimum. Both sides are
 *  counts measured by the same arena, so the browser's count convention k, the game yaw and the unit
 *  itself cancel exactly, which is the one claim on the result screen that assumes nothing. Named
 *  here so the quotient has one home and one guard: `positive` refuses a zero or a NaN on either
 *  side rather than handing a screen an Infinity as a multiply factor. The cancellation itself is
 *  pinned through the shipped composition rather than through this function, by
 *  tests/convert/counts-invariance.test.ts, because a test that does its own division would pin the
 *  formula and not the pipeline. */
export function sensRatio(anchor: Counts360, optimum: Counts360): number {
  positive('sensRatio', anchor, optimum);
  return anchor / optimum;
}
