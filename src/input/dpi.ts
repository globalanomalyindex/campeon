/** Local to this module, which computes in a unit the tool no longer uses. `Cm360` and `Dpi` left
 *  types.ts with the rest of the physical unit chain; these aliases exist so the module still
 *  compiles until task 5 deletes it, and they are deliberately NOT exported so nothing new can
 *  depend on them. */
type Dpi = number;

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

/**
 * Normalize a raw pointer movement delta by `devicePixelRatio`.
 * Chrome reports `movementX` in device px (no DPR scaling); Firefox reports CSS px.
 * Dividing by DPR makes the two agree. Guards a non-positive ratio (treated as 1).
 * NB: `devicePixelRatio` is unrelated to mouse DPI.
 */
export function normalizeByDpr(movement: number, dpr: number): number {
  return movement / (dpr > 0 ? dpr : 1);
}
