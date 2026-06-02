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

/**
 * Normalize a raw pointer movement delta by `devicePixelRatio`.
 * Chrome reports `movementX` in device px (no DPR scaling); Firefox reports CSS px.
 * Dividing by DPR makes the two agree. Guards a non-positive ratio (treated as 1).
 * NB: `devicePixelRatio` is unrelated to mouse DPI.
 */
export function normalizeByDpr(movement: number, dpr: number): number {
  return movement / (dpr > 0 ? dpr : 1);
}
