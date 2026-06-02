import type { Degrees, Ms, Tap, FittsCondition } from '../types';

/** Effective-width multiplier √(2πe) (ISO 9241-9): We = WE_CONST · SD(endpoint error). */
export const WE_CONST = Math.sqrt(2 * Math.PI * Math.E); // ≈ 4.1327

function mean(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample standard deviation (N−1 denominator). Returns 0 for ≤1 element. */
export function sampleStd(xs: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  let ss = 0;
  for (const x of xs) ss += (x - m) * (x - m);
  return Math.sqrt(ss / (n - 1));
}

export interface ConditionThroughput {
  ae: Degrees; // effective amplitude = nominal A + mean signed along-axis error
  we: Degrees; // effective width = WE_CONST · SD(along-axis error)
  ide: number; // index of difficulty (bits) = log2(Ae/We + 1)
  mtMean: Ms;
  tp: number; // throughput (bits/s) = IDe / (MT_mean in seconds)
}

/**
 * Effective-throughput for one (amplitude, width) condition.
 * Throws on <2 taps or zero endpoint spread (We = 0 → undefined IDe): a degenerate
 * condition is a measurement failure, not a TP of Infinity.
 */
export function conditionThroughput(taps: readonly Tap[], condition: FittsCondition): ConditionThroughput {
  if (taps.length < 2) {
    throw new RangeError(`conditionThroughput: need ≥2 taps, got ${taps.length}`);
  }
  const errs = taps.map((t) => t.endpointErrorAlongAxis);
  const mts = taps.map((t) => t.mt);
  const we = WE_CONST * sampleStd(errs);
  if (!(we > 0)) {
    throw new RangeError('conditionThroughput: zero endpoint spread (We = 0)');
  }
  const ae = condition.amplitude + mean(errs);
  const ide = Math.log2(ae / we + 1);
  const mtMean = mean(mts);
  const tp = ide / (mtMean / 1000);
  return { ae, we, ide, mtMean, tp };
}

/** Mean-of-means aggregate throughput across conditions (ISO 9241-9). */
export function aggregateThroughput(conditions: readonly ConditionThroughput[]): number {
  if (conditions.length === 0) {
    throw new RangeError('aggregateThroughput: no conditions');
  }
  return mean(conditions.map((c) => c.tp));
}
