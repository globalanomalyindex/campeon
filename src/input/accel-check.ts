import type { AimSample } from '../types';

/** Total path-length magnitude (in normalized counts) across a swipe's samples. */
export function accumulateMagnitude(samples: readonly AimSample[]): number {
  let sum = 0;
  for (const sample of samples) sum += Math.hypot(sample.dx, sample.dy);
  return sum;
}

export interface AccelVerdict {
  /** True when OS pointer acceleration appears to be ON — measurement must be blocked. */
  accelerated: boolean;
  /** Relative difference |fast − slow| / slow. */
  ratio: number;
}

/**
 * Compare a slow vs fast same-distance swipe. Default tolerance 0.10 (10%).
 * accel OFF → totals match → ratio ≈ 0 → not accelerated.
 */
export function accelVerdict(slowTotal: number, fastTotal: number, tol = 0.1): AccelVerdict {
  const ratio = slowTotal > 0 ? Math.abs(fastTotal - slowTotal) / slowTotal : 0;
  return { accelerated: ratio > tol, ratio };
}

/** Accumulates the count magnitude for one swipe phase. */
export class AccelMeter {
  private sum = 0;
  add(sample: AimSample): void {
    this.sum += Math.hypot(sample.dx, sample.dy);
  }
  total(): number {
    return this.sum;
  }
  reset(): void {
    this.sum = 0;
  }
}
