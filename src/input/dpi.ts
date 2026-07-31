// The band a measured DPI has to fall in to be worth committing, and the parse in front of it.
//
// What did NOT come back with the card: `normalizeByDpr`, which divided every pointer delta by
// devicePixelRatio. Its own comment said Chrome reports device pixels and Firefox CSS pixels and
// that dividing reconciles them, but dividing two streams that differ by a factor BY that same
// factor cannot reconcile them: it made one browser right and left the other wrong by DPR, and it
// halved every delta on a DPR 2 display, which destroys the integer lattice the count convention
// probe reads. Pointer lock hands the deltas over untouched now, and that is correct. Pinned by
// tests/input/pointer-lock.test.ts "carries movementX and movementY through unchanged".
import type { Dpi } from '../types';

/** Plausible mouse DPI bounds (CPI). Below ~100 or above ~32000 is almost certainly a typo. */
export const MIN_DPI = 100;
export const MAX_DPI = 32000;

/** Parse a user-entered DPI value. Returns NaN for unparseable input (caller validates). */
export function parseDpi(input: string | number): Dpi {
  return typeof input === 'number' ? input : Number.parseFloat(input.trim());
}

/** True when `dpi` is finite and within the supported range. */
export function isValidDpi(dpi: number): boolean {
  return Number.isFinite(dpi) && dpi >= MIN_DPI && dpi <= MAX_DPI;
}
