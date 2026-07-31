// The three routes to k, and the gate that decides whether tier two of the result may be shown at
// all.
//
// k is pinned by exactly three routes and no others:
//   1. the lattice estimator returning `scaled(k)` (src/input/lattice.ts), or
//   2. the player naming their game and current in-game sensitivity, which gives true counts per 360
//      as 360 / (yaw * sens) EXACTLY, and therefore measures k by comparison against what the arena
//      counted, or
//   3. a display at plain density: `devicePixelRatio` EXACTLY 1 on a stream the estimator read as a
//      unit lattice, where there is nothing for the browser to have scaled by. A DEDUCTION from a
//      stated premise rather than a measurement, argued in full at the pin below.
// Anything else leaves k unpinned, and an unpinned k costs the absolute numbers but never the ratio:
// the arena is self-consistent in browser counts, so the rendered gain, the searched range and the
// tier-one ratio are all untouched by k. That is why refusing here costs a tier and not the answer.
import { counts360, type Counts360, type GameId } from '../types';
import { countsForSens, sensFor } from '../convert/counts';
import { GAME_YAW, yawFor } from '../convert/yaw-table';
import { CONVENTION_K_MAX, CONVENTION_K_MIN, SPACING_ONE_TOL, type Convention } from './lattice';

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

/** Every route that can pin k, named so no route can be reported as another one. `dpr-one` is the
 *  deduction from a plain-density display and says so: reporting it as `lattice` would claim the
 *  movement stream measured a factor it is definitionally unable to measure. */
export type KSource = 'lattice' | 'typed-sens' | 'dpr-one';

/**
 * k's own spread on the `dpr-one` route, in ln space. NOT zero, and the reason is the whole shape
 * of the route: the deduction fixes the VALUE of k at 1, but the evidence that corroborates it
 * cannot see a scaling smaller than the band `conventionFrom` calls `spacing-one`. Any factor
 * within `SPACING_ONE_TOL` of 1 is classified there and would be pinned as 1 by this route, so that
 * band is exactly the width a scaling could hide in, and it is k's honest spread here.
 *
 * It also covers the other slack the route rests on for free: `LATTICE_PURITY_MIN` is 0.98, so the
 * purity shortfall the lattice route carries as its own spread can never exceed this same 0.02.
 * ln(1.02) is 0.0198, so taking the tolerance directly as a log sd is a hair conservative, which is
 * the only direction an interval may err in this codebase.
 */
export const DPR_ONE_LOG_SD = SPACING_ONE_TOL;

/** Whether k is pinned, and by which of the three routes. `logSd` is k's own relative uncertainty
 *  in ln space, for the caller to widen tier two by: the purity shortfall on the lattice route
 *  (zero only when the lattice is exactly pure), the anchor's spread on the typed route, and the
 *  spacing-one band on the devicePixelRatio route. */
export type KPin =
  | { pinned: true; k: number; source: KSource; logSd: number }
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
 * Pin k from the three routes, or refuse with the reason the caller can act on.
 *
 * The typed route wins when all are available. It is exact arithmetic on a number the player read
 * off the game they came here to change, where the lattice is an inference about how a browser
 * chose to report deltas, and the spec records the typed route as currently the only reliable one.
 * When they disagree, that is a signal about the browser and not a tie to average away.
 *
 * `lattice` is `null` when the acceleration gate was closed and the estimator never ran, which is a
 * different refusal from an estimator that ran and refused, so it gets its own reason.
 *
 * PURE, and `dpr` is a parameter for that reason: `window.devicePixelRatio` is read by the shell
 * that owns the capture (src/input/dpr-watch.ts, wired in src/ui/setup.ts), never in here. Pass
 * null for "not read, or not stable for the whole capture" - a reading taken under one density and
 * used to interpret a stream captured under another is precisely the mistake the route below is
 * built to avoid, and null fails it closed.
 */
export function pinConvention(
  lattice: Convention | null,
  typed: TypedSensRoute | null,
  dpr: number | null,
): KPin {
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
  if (
    lattice !== null
    && lattice.state === 'indeterminate'
    && lattice.reason === 'spacing-one'
    && dpr === 1
  ) {
    // ROUTE THREE, and it is a DEDUCTION resting on a stated premise, not a measurement. Whoever
    // reads this line later is owed both halves: the argument, and the assumption it stands on.
    //
    // THE PREMISE. The only mechanism that can scale a browser movement delta away from a raw
    // mouse count is display density, and display density is exactly what `devicePixelRatio`
    // reports. Granted that, a devicePixelRatio of exactly 1 leaves nothing to scale BY, so k is 1
    // by deduction rather than by inference: the ambiguity the one-sided contract in lattice.ts
    // exists for (a stream scaled by a fraction and re-rounded is a perfect unit lattice) needs a
    // fraction to have come from somewhere, and at density 1 there is nowhere. Without this route
    // the tool refuses the typeable number precisely on the browsers that are behaving correctly,
    // which is backwards.
    //
    // THE THREE WAYS THE PREMISE COULD FAIL, and why each is closed rather than waved past:
    //  - OS pointer acceleration, and the OS pointer-speed multiplier that rides beside it. Both
    //    are applied before the browser sees a count, and both are already gated: `latticeGateOpen`
    //    passes only 'raw' (unadjusted) input, so on an accelerated stream `lattice` is null here
    //    and this branch is unreachable. That gate is REQUIRED again rather than assumed, by the
    //    `lattice !== null` above: an accelerated stream is a different problem, and nothing in
    //    this deduction touches it.
    //  - Browser page zoom, which really does rescale what a page is handed. On every browser that
    //    can open the gate, zoom moves devicePixelRatio with it: Chrome, Edge and Firefox all fold
    //    the zoom level into the ratio, so a zoomed page cannot report 1 on a 1x display. Desktop
    //    Safari is the documented exception, holding devicePixelRatio flat through page zoom, and
    //    Safari cannot reach this branch for an unrelated reason that closes it anyway:
    //    `createPointerLock` reports mode 'raw' only where `onpointerrawupdate` exists, which
    //    Safari does not implement, so the gate above is already shut there.
    //  - Scaling upstream of the browser: a driver multiplier, or a virtual mouse injected by a
    //    remote desktop or a VM. Whatever those do to this browser's counts they do equally to the
    //    game the player is about to type this number into, and k is the factor between THIS
    //    browser's count and THAT game's count. A factor common to both is not k.
    //
    // WHAT THE PREMISE MAY NOT DO. It licenses a pin where the estimator is silent; it never
    // overturns one that spoke. A measured `scaled(k)` at devicePixelRatio 1 contradicts the
    // premise, and the branch above still takes it, because evidence outranks an assumption. For
    // the same reason the stream must CORROBORATE: `spacing-one` and nothing else qualifies. A
    // `no-lattice` stream at density 1 is the premise being contradicted by the data, and the
    // honest answer there is the refusal below.
    //
    // EXACTLY 1. Not rounded, not "close to 1", not a band. At 1.25, 1.5, 2 or 3 the ambiguity is
    // real (a fractional density is exactly how a fraction gets in) and the refusal stands.
    return { pinned: true, k: 1, source: 'dpr-one', logSd: DPR_ONE_LOG_SD };
  }
  // A typed offer we could not use is the most actionable refusal: the player can correct a number.
  // It also covers an anchor with no honest spread, because pinning k off an unknown uncertainty
  // would emit a table carrying a zero-width claim it has not earned.
  if (typed !== null) return { pinned: false, reason: 'typed-sens-implausible' };
  // 'gate-closed' covers both ways the estimator can fail to speak at all: the acceleration gate
  // shut it, or no delta stream existed to read (the typed-only path never runs the turn).
  // A spacing-one stream at a density other than 1 keeps 'lattice-indeterminate' rather than
  // earning a reason of its own: the sentence is still exactly true (the estimator ran and
  // refused), and a reason exists so the caller can act differently, which nothing can here.
  if (lattice === null) return { pinned: false, reason: 'gate-closed' };
  return { pinned: false, reason: 'lattice-indeterminate' };
}

/** The k-gated fields of the `Prescription`. Deliberately carries no ratio and no CI of its own:
 *  tier one is measured in browser counts and k cannot touch it. */
export interface TierTwo {
  perGameSens: Partial<Record<GameId, number>>;
  kSource: KSource;
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
