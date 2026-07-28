// The count convention k: how many browser movement deltas one real mouse count arrives as. k does
// NOT cancel out of the sensitivity we tell a player to type (unlike DPI, which cancels everywhere),
// so it is measured or withheld, never assumed.
//
// The estimator is a characteristic function over the observed absolute deltas. For a candidate
// spacing L the modulus of mean(exp(2*pi*i*x/L)) is exactly one when every delta is an integer
// multiple of L and falls off fast otherwise, so the largest L with a near-unit modulus is the
// lattice spacing and therefore k. Over 200 simulated sweeps per case it recovers k of 0.5, 1/3,
// 1.25, 1.5, 2 and 3 at 100 percent, where the integer gcd it replaces refused the fractional ones
// (pinned by 'recovers a non-unit lattice spacing over 200 sweeps per case').
import type { PointerLockMode } from '../types';
import type { AccelVerdict } from './accel-check';

/** Deltas at or below this are no motion at all. Zero is an integer multiple of EVERY spacing, so
 *  counting it lifts every candidate's modulus equally and buys no discrimination at all. */
const ZERO_DELTA_EPS = 1e-9;

/**
 * Modulus a candidate must reach to be called a lattice. Not 1.0: a single corrupt delta in a
 * 120-sample stream costs about 1.1 points of modulus (measured 0.9893 in 'tolerates one off-lattice
 * delta'), and a stream that is genuinely off-lattice reaches only 0.13 to 0.58, so 0.98 separates
 * the two by a wide margin without demanding a perfection real input never has. The shortfall below
 * one is not free: `pinConvention` carries it as k's own spread, because a candidate that leaves two
 * percent of the phase unaccounted for is not an exact pin.
 */
export const LATTICE_PURITY_MIN = 0.98;

/**
 * The band a count convention can plausibly occupy. k is a coordinate convention: raw integers (1),
 * a device-pixel-ratio scaling (0.5 to 3 in practice), or an OS scale factor. A spacing outside this
 * band is not a convention, it is a broken stream, and emitting it would rescale the entire per-game
 * table by an order of magnitude. Out-of-band candidates are therefore never scored at all, so the
 * estimator refuses instead of reporting a pure-but-absurd k (pinned by 'never scores a candidate
 * below the plausible-convention floor').
 */
export const CONVENTION_K_MIN = 0.125;
export const CONVENTION_K_MAX = 8;

/** How many multiples of the fundamental the smallest observed delta may be. A stream whose
 *  smallest event moved 12k and never once moved fewer counts is beyond this estimator; 12 covers
 *  every stream simulated. */
const MAX_FUNDAMENTAL_INDEX = 12;

/** How many of the smallest distinct deltas seed the candidate set. One suffices when every delta is
 *  on the lattice; five gives redundancy so a single corrupt smallest delta cannot remove the
 *  fundamental from the candidate set entirely. */
const CANDIDATE_SEEDS = 5;

/** Distinct absolute deltas the stream must carry before a spacing means anything. See the
 *  near-constant-drag test: distinct quantum indices are bounded by distinct delta values whatever L
 *  is, so a flat stream is perfectly pure at every candidate simultaneously. */
const MIN_DISTINCT_DELTAS = 6;

/**
 * What the delta stream was able to say about k. There is deliberately no `k = 1` result: see
 * `conventionFrom`.
 *
 * - `scaled`: the stream sits on a lattice of spacing k, and `purity` says how completely it does,
 *   which `pinConvention` turns into k's own spread rather than discarding.
 * - `spacing-one`: the stream is a unit lattice, which is exactly what a stream scaled by a fraction
 *   and re-rounded also is. No claim about k either way.
 * - `too-few-samples`: fewer than `LATTICE_MIN_SAMPLES` usable deltas.
 * - `no-lattice`: no plausible spacing was pure enough, so either the stream is genuinely
 *   non-integral or its only pure spacing was outside the convention band.
 */
export type Convention =
  | { state: 'scaled'; k: number; purity: number }
  | {
      state: 'indeterminate';
      reason: 'spacing-one' | 'too-few-samples' | 'no-lattice';
      purity: number;
    };

/**
 * |mean of exp(2*pi*i*x/spacing)| over `absDeltas`. Exactly one when every delta is an integer
 * multiple of `spacing`. Returns 0 for a non-positive spacing or an empty stream rather than NaN, so
 * an unguarded caller gets a refusal and not a number that looks like a reading.
 */
export function latticeModulus(absDeltas: readonly number[], spacing: number): number {
  if (!(spacing > 0) || absDeltas.length === 0) return 0;
  const w = (2 * Math.PI) / spacing;
  let re = 0;
  let im = 0;
  for (const x of absDeltas) {
    const theta = w * x;
    re += Math.cos(theta);
    im += Math.sin(theta);
  }
  return Math.hypot(re, im) / absDeltas.length;
}

/** Ascending distinct absolute deltas, deduped at a relative 1e-9 so float noise in a scaled stream
 *  does not present one physical value as two. */
function distinctAscending(absDeltas: readonly number[]): number[] {
  const out: number[] = [];
  for (const x of [...absDeltas].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last === undefined || x - last > 1e-9 * Math.max(1, x)) out.push(x);
  }
  return out;
}

/**
 * Candidate spacings, largest first. The fundamental divides every delta, so it divides the smallest
 * one: the candidates are `seed / n`, an exact finite set that needs no grid.
 *
 * A grid was the first attempt and it fails in both directions. The modulus at L = 1.251 has already
 * dropped to roughly 0.99 for deltas up to 50, so a grid fine enough to land on the peak is enormous
 * while a coarse one cannot resolve 1.25 from 1.2 at all. Capping the set at the smallest delta also
 * makes the classic spurious-large-L artifact impossible: an L far above the data puts every phase
 * near zero and reads as a perfect lattice.
 */
export function spacingCandidates(absDeltas: readonly number[]): number[] {
  const seeds = distinctAscending(absDeltas).slice(0, CANDIDATE_SEEDS);
  const out: number[] = [];
  for (const seed of seeds) {
    for (let n = 1; n <= MAX_FUNDAMENTAL_INDEX; n++) {
      const c = seed / n;
      if (!(c >= CONVENTION_K_MIN) || c > CONVENTION_K_MAX) continue;
      if (!out.some((e) => Math.abs(e - c) <= 1e-9 * Math.max(1, c))) out.push(c);
    }
  }
  return out.sort((a, b) => b - a);
}

export interface LatticeFit {
  /** The largest in-band candidate that cleared `LATTICE_PURITY_MIN`, or null when none did. */
  spacing: number | null;
  /** The modulus AT `spacing`, or the best any candidate reached when none cleared. It says how
   *  completely the spacing divides the stream, and it is not a confidence claim about k on its own:
   *  `pinConvention` is the one place that turns its shortfall below one into k's spread. */
  purity: number;
}

/**
 * The largest spacing the stream is a lattice on. Largest, because multiples of L are also multiples
 * of L/2 and of L/3, so every sub-harmonic scores a perfect one and only the largest is the
 * fundamental. An ascending scan would return L/12 and shrink the emitted sensitivity twelvefold.
 */
export function latticeSpacing(absDeltas: readonly number[]): LatticeFit {
  if (distinctAscending(absDeltas).length < MIN_DISTINCT_DELTAS) return { spacing: null, purity: 0 };
  let best = 0;
  for (const c of spacingCandidates(absDeltas)) {
    const p = latticeModulus(absDeltas, c);
    if (p > best) best = p;
    if (p >= LATTICE_PURITY_MIN) return { spacing: c, purity: p };
  }
  return { spacing: null, purity: best };
}

/** Finite, non-zero absolute deltas: the only samples that carry lattice information. Exported
 *  because both `conventionFrom` and its gated wrapper must count the SAME survivors as the sample
 *  floor does, and a second copy of this filter would drift from the first. */
export function usableAbsDeltas(rawDeltas: readonly number[]): number[] {
  const out: number[] = [];
  for (const d of rawDeltas) {
    const a = Math.abs(d);
    if (Number.isFinite(a) && a > ZERO_DELTA_EPS) out.push(a);
  }
  return out;
}

/** Minimum usable (finite, non-zero) deltas before the estimator will speak at all. Below this the
 *  modulus of a short stream is high by chance: the candidate set is small and every candidate has
 *  few phases to disagree with. */
export const LATTICE_MIN_SAMPLES = 60;

/** Half-width of the band around unity that reads as `spacing-one`. Within two percent of 1 a
 *  stream cannot be distinguished from an integer stream that was rescaled by a fraction and
 *  re-rounded (the simulated collapse read 1.00 to 1.01), and no real coordinate convention lives
 *  there. */
const SPACING_ONE_TOL = 0.02;

/**
 * The count convention read off a raw movement-delta stream. `rawDeltas` may interleave the x and y
 * components of every sample, because a browser that scales one scales the other identically. It
 * carries no timestamps: the estimator is a function of the delta multiset alone, which is why there
 * is no clock-offset test for it to pass.
 *
 * ONE-SIDED BY CONSTRUCTION. A spacing of one is reported as `indeterminate` with reason
 * `spacing-one`, never as `k = 1`, because a stream that was scaled by a FRACTION and then
 * re-rounded to integers is a perfect unit lattice and no statistic separates it from a genuine one.
 * Reporting k = 1 there would be a silent factor-of-two error in the emitted sensitivity. See the
 * collapse tests in tests/input/lattice.test.ts, which exist to stop exactly that "tidy-up".
 *
 * The collapse is narrower than one-sidedness makes it sound, and the narrowness is why this
 * estimator is worth shipping: an INTEGER scaling survives rounding untouched, so a browser that
 * multiplies raw counts by a devicePixelRatio of 2 is reported correctly as `scaled(2)`. Division, a
 * fractional ratio and acceleration are the cases that hide, and they hide completely.
 *
 * `purity` on an indeterminate result describes the stream, not our confidence in a k: on
 * `spacing-one` it is the modulus at spacing 1 (usually exactly one, which is the whole problem), on
 * `no-lattice` it is the best any candidate reached, and on `too-few-samples` it is zero because
 * nothing was measured.
 */
export function conventionFrom(rawDeltas: readonly number[]): Convention {
  const abs = usableAbsDeltas(rawDeltas);
  if (abs.length < LATTICE_MIN_SAMPLES) {
    return { state: 'indeterminate', reason: 'too-few-samples', purity: 0 };
  }
  const fit = latticeSpacing(abs);
  if (fit.spacing === null) {
    return { state: 'indeterminate', reason: 'no-lattice', purity: fit.purity };
  }
  if (Math.abs(fit.spacing - 1) <= SPACING_ONE_TOL) {
    return { state: 'indeterminate', reason: 'spacing-one', purity: fit.purity };
  }
  return { state: 'scaled', k: fit.spacing, purity: fit.purity };
}

/** What the input layer knows about the stream's provenance. `accel` is null when no cross-check
 *  pass was run, which is the normal case on raw input: the turn machine only runs its deliberately
 *  fast pass on os-adjusted browsers, where the mode alone already closes this gate. The field
 *  exists so a future raw-mode probe (a driver curve does not care about unadjustedMovement) can
 *  close it without a signature change. */
export interface LatticeGate {
  mode: PointerLockMode | null;
  accel: AccelVerdict | null;
}

/**
 * Whether the estimator is entitled to run. Fails closed, and the reason is a proof rather than a
 * precaution: an accelerated delta is still an integer after rounding, so acceleration is invisible
 * to the lattice ('reads an accelerated-then-rounded stream as indeterminate across 200 sweeps').
 * The lattice therefore cannot substitute for the acceleration check, and without raw input there is
 * nothing left to catch an accelerated stream before it becomes a confident k.
 */
export function latticeGateOpen(gate: LatticeGate): boolean {
  if (gate.mode !== 'raw') return false;
  return gate.accel === null || gate.accel.accelerated === false;
}

/**
 * `conventionFrom` behind the acceleration gate. Returns null when the gate is closed, which is a
 * DIFFERENT fact from `indeterminate`: indeterminate means the estimator ran and refused, so more
 * data could still pin k, while null means it was never entitled to run on this browser. The result
 * screen needs the distinction to choose between "keep going" and "type your sensitivity instead".
 */
export function conventionFromGated(
  rawDeltas: readonly number[],
  gate: LatticeGate,
): Convention | null {
  if (!latticeGateOpen(gate)) return null;
  return conventionFrom(rawDeltas);
}
