import { counts360, countsBounds } from '../../types';
import type { Counts360 } from '../../types';

/**
 * The default search window, in counts per 360.
 *
 * The retired window was 15 to 60 cm with a hard clamp of 5 to 150 cm. Those are 4724 to 18898 and
 * 1575 to 47244 counts at 800 DPI, which is where the audience is, and they are rounded to the
 * nearest hundred here so the numbers read as the tool's own unit rather than as a converted
 * centimetre. It is only a default: calibration replaces it with a window seeded from what it
 * measured, and `boundsFromSeed` is what does that.
 */
export const DEFAULT_BOUNDS: [Counts360, Counts360] = countsBounds(4800, 19200);
/** The hard clamp on a search window, in counts per 360. Exported because the options screen's
 *  number inputs must advertise the SAME limits the code enforces: the unit swap left those two
 *  attributes at the retired centimetre range of 5 to 150, so the control rejected every value it
 *  displayed. Pinned by tests/ui/options/options.test.ts "gives the window inputs the same limits
 *  the code clamps to". */
export const COUNT_LO = 1600, COUNT_HI = 47200;
const LO = COUNT_LO, HI = COUNT_HI, MIN_SPAN = 1600;

export function normalizeBounds(a: number, b: number): [Counts360, Counts360] {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [...DEFAULT_BOUNDS];
  // Order, then clamp BOTH ends into [LO, HI] - lo is also capped at HI - MIN_SPAN so there is
  // always room below the ceiling for the minimum span (this is what prevents an inverted range
  // when both inputs exceed HI). Then guarantee the span by widening hi up to lo + MIN_SPAN.
  const lo = Math.min(Math.max(LO, Math.min(a, b)), HI - MIN_SPAN);
  let hi = Math.min(HI, Math.max(a, b));
  if (hi - lo < MIN_SPAN) hi = lo + MIN_SPAN;
  return countsBounds(lo, hi);
}

/** Center the optimizer's search window on a seed count total (the anchor), clamped to sane bounds. */
export function boundsFromSeed(seed: Counts360, factor = 1.7): [Counts360, Counts360] {
  if (!Number.isFinite(seed) || seed <= 0) return [...DEFAULT_BOUNDS];
  return normalizeBounds(seed / factor, seed * factor);
}

/** A count total for the arena to open at, given a window. The geometric midpoint, because the
 *  search itself is log-spaced: the arithmetic mean of 4800 and 19200 sits a full octave off centre. */
export const midOf = (bounds: readonly [Counts360, Counts360]): Counts360 =>
  counts360(Math.sqrt(bounds[0] * bounds[1]));
