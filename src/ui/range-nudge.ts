import type { Cm360 } from '../types';

/** Nudge a cm/360 by `step` (may be negative), clamped to [lo, hi]. Never returns below the lower bound,
 *  so the live sensitivity can never go ≤ 0 (which would break degreesPerCount). */
export function nudgeCm360(current: Cm360, step: number, bounds: [Cm360, Cm360]): Cm360 {
  const [lo, hi] = bounds;
  return Math.max(lo, Math.min(hi, current + step));
}
