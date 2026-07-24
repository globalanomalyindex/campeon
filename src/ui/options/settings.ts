import type { Cm360 } from '../../types';

export const DEFAULT_BOUNDS: [Cm360, Cm360] = [15, 60];
const LO = 5, HI = 150, MIN_SPAN = 5;

export function normalizeBounds(a: number, b: number): [Cm360, Cm360] {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [...DEFAULT_BOUNDS];
  // Order, then clamp BOTH ends into [LO, HI] - lo is also capped at HI - MIN_SPAN so there is
  // always room below the ceiling for the minimum span (this is what prevents an inverted range
  // when both inputs exceed HI). Then guarantee the span by widening hi up to lo + MIN_SPAN.
  const lo = Math.min(Math.max(LO, Math.min(a, b)), HI - MIN_SPAN);
  let hi = Math.min(HI, Math.max(a, b));
  if (hi - lo < MIN_SPAN) hi = lo + MIN_SPAN;
  return [lo, hi];
}

/** Center the optimizer's search window on a seed cm/360 (the comfortable turn), clamped to sane bounds. */
export function boundsFromSeed(seed: Cm360, factor = 1.7): [Cm360, Cm360] {
  if (!Number.isFinite(seed) || seed <= 0) return [...DEFAULT_BOUNDS];
  return normalizeBounds(seed / factor, seed * factor);
}
