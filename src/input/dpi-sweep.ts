// Effective DPI measured from a horizontal sweep across a known reference width (a wallet card).
// Net horizontal travel is the reference width, so the accumulator sums signed dx.
//
// This number is NOT the player's hardware DPI, and saying so is not a hedge, it is the mechanism.
// The samples are RAW browser counts: pointer lock passes movementX through untouched, so each one
// is a hardware count times the browser's own count convention k (src/input/count-convention.ts),
// which nothing here pins. What comes out below is therefore dpi times k, which is why every name
// in this file says "measured DPI" and none of them claims a hardware setting.
//
// It is still exactly the right number to carry, because the blind turn counts in the SAME units
// and so carries the SAME k, and k cancels the moment the two are divided. That division lives in
// src/anchor/plausibility.ts, with the algebra written out at the line that performs it, and is
// pinned by tests/anchor/plausibility.test.ts "the count convention cancels, so a scaled browser
// reads the same centimetres".
import { isValidDpi } from './dpi';
import type { AimSample, Dpi } from '../types';

/** Standard wallet-card width: ISO/IEC 7810 ID-1 long edge (85.60 mm). Used as the sweep anchor. */
export const CARD_WIDTH_CM = 8.56;

/** Measured DPI from `horizontalCounts` (raw browser counts, so dpi times k) swept across
 *  `referenceWidthCm`. NaN if width <= 0. */
export function dpiFromSweep(horizontalCounts: number, referenceWidthCm: number): Dpi {
  if (!(referenceWidthCm > 0)) return NaN;
  return horizontalCounts / (referenceWidthCm / 2.54); // counts per inch
}

/** Accumulates one sweep pass: net horizontal counts (signed dx sum, reported as magnitude).
 *  Signed and not path length, unlike the turn's accumulator: the card's width is the NET
 *  displacement between its two edges, so a wobble out and back is travel that crossed no new
 *  card and summing |dx| would inflate the measured DPI by however much the hand shook. */
export class SweepAccumulator {
  private sum = 0;
  add(sample: AimSample): void { this.sum += sample.dx; }
  total(): number { return Math.abs(this.sum); }
  reset(): void { this.sum = 0; }
}

/** Tuning for the multi-pass DPI combiner. All thresholds are RELATIVE (fractions). */
export interface DpiPassesOpts {
  /** n>=3: drop a pass whose DPI deviates from the median by more than this fraction. */
  rejectFrac?: number;
  /** Surviving passes are "agreed" when their relative spread is at or below this fraction. */
  agreeFrac?: number;
  /** n=2: the two passes are "agreed" when their relative divergence is at or below this fraction. */
  twoPassFrac?: number;
}

/** Result of combining multiple slow sweep passes into one committed DPI. */
export interface DpiPassesResult {
  /** The committed measured DPI (NaN if no usable pass). */
  dpi: Dpi;
  /**
   * Relative spread of the surviving passes, as a percentage. This is a CONSISTENCY INDICATOR
   * ONLY (how tightly the passes agreed) - it is NEVER a confidence interval on the DPI.
   */
  spreadPct: number;
  /** True when the passes agreed tightly enough to commit without a gentle redo. */
  agreed: boolean;
}

const DEFAULT_REJECT_FRAC = 0.15;
const DEFAULT_AGREE_FRAC = 0.06;
const DEFAULT_TWO_PASS_FRAC = 0.08;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  const mid = n >> 1;
  return n % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

/** Relative spread (max-min)/mean of a set of DPIs, as a percentage; 0 for <2 values. */
function spreadPctOf(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  if (!(m > 0)) return 0;
  return ((Math.max(...xs) - Math.min(...xs)) / m) * 100;
}

/**
 * Combine the slow-pass counts from one or more sweep passes into a single committed DPI, with
 * outlier rejection and a CONSISTENCY indicator. Never narrows or claims a measured CI: `spreadPct`
 * only describes how tightly the passes agreed.
 *
 * - n >= 3: per-pass DPI via `dpiFromSweep`, take the median, drop survivors beyond `rejectFrac` of
 *   the median, return the surviving mean. `agreed` when the surviving spread is within `agreeFrac`.
 * - n === 2: the mean of the two pass DPIs; `agreed=false` when they diverge beyond `twoPassFrac`.
 * - n === 1: degenerate single-pass fallback (= `dpiFromSweep`), `agreed=true`, `spreadPct=0`.
 */
export function dpiFromPasses(
  slowCountsPerPass: number[],
  refWidthCm: number,
  opts: DpiPassesOpts = {},
): DpiPassesResult {
  const rejectFrac = opts.rejectFrac ?? DEFAULT_REJECT_FRAC;
  const agreeFrac = opts.agreeFrac ?? DEFAULT_AGREE_FRAC;
  const twoPassFrac = opts.twoPassFrac ?? DEFAULT_TWO_PASS_FRAC;

  const n = slowCountsPerPass.length;
  if (n === 0) return { dpi: NaN, spreadPct: 0, agreed: false };

  const dpis = slowCountsPerPass.map((c) => dpiFromSweep(c, refWidthCm));

  if (n === 1) return { dpi: dpis[0]!, spreadPct: 0, agreed: true };

  if (n === 2) {
    const m = mean(dpis);
    const diverge = m > 0 ? Math.abs(dpis[0]! - dpis[1]!) / m : Infinity;
    return { dpi: m, spreadPct: spreadPctOf(dpis), agreed: diverge <= twoPassFrac };
  }

  // n >= 3: median-anchored outlier rejection.
  const med = median(dpis);
  const survivors = med > 0 ? dpis.filter((d) => Math.abs(d - med) / med <= rejectFrac) : [];
  const kept = survivors.length ? survivors : dpis; // never reject everything
  const spreadPct = spreadPctOf(kept);
  return { dpi: mean(kept), spreadPct, agreed: spreadPct <= agreeFrac * 100 };
}

/** True when a measured DPI is plausible (delegates to the shared DPI bounds). */
export function isPlausibleSweepDpi(dpi: number): boolean { return isValidDpi(dpi); }
