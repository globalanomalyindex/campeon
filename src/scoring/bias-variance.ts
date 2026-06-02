import type { Degrees, Ms, Shot } from '../types';

export interface Decomposition {
  /** Mean signed error [radial, tangential] (degrees). */
  bias: [Degrees, Degrees];
  /** Gain bias = mean(required + e_radial) / mean(required). >1 overshoot, <1 undershoot. */
  gain: number;
  /** De-biased RMS spread sqrt(mean‖e − b‖²) — the precision floor. */
  sigmaR: Degrees;
  /** |b|² + σ_R² (equals mean‖e‖²). */
  mse: number;
}

/** Bias/variance decomposition of a burst of shots (errors in task-local [radial, tangential]). */
export function decompose(shots: readonly Shot[]): Decomposition {
  const n = shots.length;
  if (n === 0) throw new RangeError('decompose: no shots');
  let bx = 0;
  let by = 0;
  let reqSum = 0;
  let impSum = 0;
  for (const s of shots) {
    bx += s.error[0];
    by += s.error[1];
    reqSum += s.required;
    impSum += s.required + s.error[0];
  }
  bx /= n;
  by /= n;
  let varSum = 0;
  for (const s of shots) {
    const dx = s.error[0] - bx;
    const dy = s.error[1] - by;
    varSum += dx * dx + dy * dy;
  }
  const sigmaR = Math.sqrt(varSum / n);
  const gain = reqSum > 0 ? impSum / reqSum : NaN;
  const mse = bx * bx + by * by + sigmaR * sigmaR;
  return { bias: [bx, by], gain, sigmaR, mse };
}

/** Live-training EWMA bias estimate: b̂ₜ = (1−α)·b̂ₜ₋₁ + α·eₜ. */
export function ewmaBias(
  shots: readonly Shot[],
  alpha: number,
  init: [Degrees, Degrees] = [0, 0],
): [Degrees, Degrees] {
  let bx = init[0];
  let by = init[1];
  for (const s of shots) {
    bx = (1 - alpha) * bx + alpha * s.error[0];
    by = (1 - alpha) * by + alpha * s.error[1];
  }
  return [bx, by];
}

export interface CalibrationWeights {
  wb: number;
  wv: number;
  wt: number;
}

const DEFAULT_WEIGHTS: CalibrationWeights = { wb: 0.6, wv: 0.3, wt: 0.1 };

/** Composite calibration cost C(s) = w_b·|b|² + w_v·σ_R² + w_t·(meanMt/tRef)². Lower = better. */
export function calibrationCost(
  d: Decomposition,
  meanMt: Ms,
  tRef: Ms,
  w: CalibrationWeights = DEFAULT_WEIGHTS,
): number {
  const biasSq = d.bias[0] * d.bias[0] + d.bias[1] * d.bias[1];
  const tRatio = meanMt / tRef;
  return w.wb * biasSq + w.wv * d.sigmaR * d.sigmaR + w.wt * tRatio * tRatio;
}
