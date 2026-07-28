import { counts360 } from '../types';
import type { Counts360 } from '../types';

/** Nudge a count total by `step` (may be negative), clamped to [lo, hi]. Never returns below the lower bound,
 *  so the live sensitivity can never go ≤ 0 (which would break degreesPerCount). */
export function nudgeCounts(current: Counts360, step: number, bounds: [Counts360, Counts360]): Counts360 {
  const [lo, hi] = bounds;
  return counts360(Math.max(lo, Math.min(hi, current + step)));
}
