// The two routes to k, and the gate that decides whether tier two of the result may be shown at all.
//
// k is pinned by exactly two routes and no others:
//   1. the lattice estimator returning `scaled(k)` (src/input/lattice.ts), or
//   2. the player naming their game and current in-game sensitivity, which gives true counts per 360
//      as 360 / (yaw * sens) EXACTLY, and therefore measures k by comparison against what the arena
//      counted.
// Anything else leaves k unpinned, and an unpinned k costs the absolute numbers but never the ratio:
// the arena is self-consistent in browser counts, so the rendered gain, the searched range and the
// tier-one ratio are all untouched by k. That is why refusing here costs a tier and not the answer.
import { counts360, type Counts360, type GameId } from '../types';
import { countsForSens, sensFor } from '../convert/counts';
import { GAME_YAW, yawFor } from '../convert/yaw-table';
import { CONVENTION_K_MAX, CONVENTION_K_MIN, type Convention } from './lattice';

/** The player's offer: the game they just closed and the sensitivity they had in it, plus the arena's
 *  own count for the turn they reproduced. */
export interface TypedSensRoute {
  game: GameId;
  /** Their current in-game sensitivity, as typed. */
  sens: number;
  /** The arena's count for one 360, in browser deltas: the anchor. */
  arenaCounts: Counts360;
  /**
   * The anchor's own log sd. k inherits it EXACTLY, because the comparison assumes the blind turn
   * reproduced the 360 their current setting produces, so the player's reproduction error lands
   * whole on k. This is the number that must widen the per-game table, and a route with no honest
   * spread here is refused rather than pinned at zero.
   */
  anchorLogSd: number;
}

/** Whether k is pinned, and by which of the two routes. `logSd` is k's own relative uncertainty in
 *  ln space, for the caller to widen tier two by: the purity shortfall on the lattice route (zero
 *  only when the lattice is exactly pure), and the anchor's spread on the typed route. */
export type KPin =
  | { pinned: true; k: number; source: 'lattice' | 'typed-sens'; logSd: number }
  | { pinned: false; reason: 'gate-closed' | 'lattice-indeterminate' | 'typed-sens-implausible' };

/**
 * k measured by comparing the arena's browser-delta count for a 360 against the exact count the
 * player's own setting implies. Returns null rather than a number whenever the comparison cannot be
 * trusted: a non-invertible sensitivity, an arena count that is not a measurement, or a k outside
 * the convention band. That last case is the realistic one: a decimal-point slip in the typed
 * sensitivity puts k a factor of ten out, and emitting it would rescale every number in the per-game
 * table by ten (pinned by 'refuses an out-of-band k instead of rescaling the table').
 */
export function kFromTypedSens(arenaCounts: Counts360, game: GameId, sens: number): number | null {
  if (!Number.isFinite(arenaCounts) || !(arenaCounts > 0)) return null;
  if (!Number.isFinite(sens) || !(sens > 0)) return null;
  const trueCounts = countsForSens(sens, yawFor(game));
  if (!Number.isFinite(trueCounts) || !(trueCounts > 0)) return null;
  const k = arenaCounts / trueCounts;
  if (!Number.isFinite(k) || k < CONVENTION_K_MIN || k > CONVENTION_K_MAX) return null;
  return k;
}

/** The typed route as a pin, or null when the route cannot carry one. Kept separate so the anchor
 *  spread check sits next to the k check and neither can be forgotten. */
function typedPin(typed: TypedSensRoute): KPin | null {
  const k = kFromTypedSens(typed.arenaCounts, typed.game, typed.sens);
  if (k === null) return null;
  if (!Number.isFinite(typed.anchorLogSd) || typed.anchorLogSd < 0) return null;
  return { pinned: true, k, source: 'typed-sens', logSd: typed.anchorLogSd };
}

/**
 * Pin k from the two routes, or refuse with the reason the caller can act on.
 *
 * The typed route wins when both are available. It is exact arithmetic on a number the player read
 * off the game they came here to change, where the lattice is an inference about how a browser
 * chose to report deltas, and the spec records the typed route as currently the only reliable one.
 * When the two disagree, that is a signal about the browser and not a tie to average away.
 *
 * `lattice` is `null` when the acceleration gate was closed and the estimator never ran, which is a
 * different refusal from an estimator that ran and refused, so it gets its own reason.
 */
export function pinConvention(lattice: Convention | null, typed: TypedSensRoute | null): KPin {
  if (typed !== null) {
    const pin = typedPin(typed);
    if (pin !== null) return pin;
  }
  if (lattice !== null && lattice.state === 'scaled') {
    // k's spread on this route is the purity shortfall, not zero. `latticeSpacing` accepts a
    // candidate at LATTICE_PURITY_MIN (0.98) rather than at 1.0, and its candidate set is seed / n
    // for n up to 12, so a stream that leaves part of the phase unaccounted for could also be a
    // harmonic mis-pick. Claiming logSd 0 there is a zero-width uncertainty the evidence has not
    // earned. The Math.max floors float noise above one at zero rather than emitting a negative sd
    // (pinned by 'carries an impure lattice shortfall as k spread rather than claiming zero').
    return {
      pinned: true,
      k: lattice.k,
      source: 'lattice',
      logSd: Math.max(0, 1 - lattice.purity),
    };
  }
  // A typed offer we could not use is the most actionable refusal: the player can correct a number.
  // It also covers an anchor with no honest spread, because pinning k off an unknown uncertainty
  // would emit a table carrying a zero-width claim it has not earned.
  if (typed !== null) return { pinned: false, reason: 'typed-sens-implausible' };
  // 'gate-closed' covers both ways the estimator can fail to speak at all: the acceleration gate
  // shut it, or no delta stream existed to read (the typed-only path never runs the turn).
  if (lattice === null) return { pinned: false, reason: 'gate-closed' };
  return { pinned: false, reason: 'lattice-indeterminate' };
}

/** The k-gated fields of the `Prescription`. Deliberately carries no ratio and no CI of its own:
 *  tier one is measured in browser counts and k cannot touch it. */
export interface TierTwo {
  perGameSens: Partial<Record<GameId, number>>;
  kSource: 'lattice' | 'typed-sens';
  /** The pinned convention itself, echoed so the caller never re-derives it. Tier three renders
   *  hardware counts as C* / k, and a `Result` reloaded from storage has no draft left to ask. */
  k: number;
  /**
   * k's relative uncertainty in ln space, from the pin. The per-game interval must widen by it,
   * never narrow: on the typed route this is the anchor's reproduction error landing whole on k, so
   * it is not small. One number covers every game, because k is a single multiplicative factor
   * common to all of them, so the RELATIVE band it implies is identical per game and a per-game
   * band would be the same number written eight times (hand-off H3 carries the arithmetic the
   * result screen renders it with).
   */
  kLogSd: number;
}

/**
 * The per-game table at the located optimum, or null when it may not be shown.
 *
 * `counts` is C*, the located optimum in BROWSER deltas, which is the unit the whole arena and the
 * whole search run in. Dividing by k converts it to real mouse counts, which is the only place in
 * the tool where k appears at all. Callers pass C* undivided: dividing before the call would apply k
 * twice.
 *
 * Returns null whenever k is unpinned. Not an empty table and not a table of dashes: absent. A
 * per-game sensitivity computed with an unpinned k is wrong by exactly the factor we failed to
 * measure, and it is the number a player types into their game (pinned by 'withholds the table
 * entirely when k is unpinned').
 */
export function tierTwoFrom(
  counts: Counts360,
  pin: KPin,
  games?: readonly GameId[],
): TierTwo | null {
  if (!pin.pinned) return null;
  if (!Number.isFinite(counts) || !(counts > 0)) return null;
  if (!Number.isFinite(pin.k) || !(pin.k > 0)) return null;
  const trueCounts = counts360(counts / pin.k);
  const ids = games ?? GAME_YAW.map((g) => g.id);
  const perGameSens: Partial<Record<GameId, number>> = {};
  for (const id of ids) perGameSens[id] = sensFor(trueCounts, yawFor(id));
  return { perGameSens, kSource: pin.source, k: pin.k, kLogSd: pin.logSd };
}
