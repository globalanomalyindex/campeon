import type { Ms } from '../types';

export interface VelSample {
  t: Ms;
  speed: number; // |angular velocity|, deg/s
}

export interface SubmovementSeg {
  tD: Ms; // detection latency: cueTime → movement onset
  tO: Ms; // primary orient: onset → first trough after the primary peak
  tC: Ms; // confirm: first trough → end of trace
  nCorr: number; // corrective sub-movements (local maxima after the first trough, above onsetThresh)
  vPeak: number; // peak speed of the primary orient
  onsetTime: Ms; // absolute time of movement onset
}

export interface SegmentOptions {
  cueTime?: Ms; // default 0
  onsetThresh?: number; // deg/s, movement-onset threshold; also the floor for counting corrections
}

/**
 * Segment an angular-speed trace into detect / orient / confirm stages.
 * Onset = first sample crossing `onsetThresh`. Primary peak = first local maximum after onset.
 * First trough = first local minimum after that peak. Corrective sub-movements = local maxima
 * after the first trough whose speed exceeds `onsetThresh`.
 * Throws if the trace never crosses the onset threshold (no movement to segment).
 */
export function segment(trace: readonly VelSample[], opts: SegmentOptions = {}): SubmovementSeg {
  const cueTime = opts.cueTime ?? 0;
  const onsetThresh = opts.onsetThresh ?? 30;

  let onsetIdx = -1;
  for (let i = 0; i < trace.length; i++) {
    if (trace[i]!.speed >= onsetThresh) {
      onsetIdx = i;
      break;
    }
  }
  if (onsetIdx === -1) {
    throw new RangeError('segment: trace never crosses the onset threshold');
  }
  const onsetTime = trace[onsetIdx]!.t;

  // Primary peak: first strict local maximum at or after onset.
  let peakIdx = onsetIdx;
  for (let i = onsetIdx + 1; i < trace.length - 1; i++) {
    if (trace[i]!.speed > trace[i - 1]!.speed && trace[i]!.speed > trace[i + 1]!.speed) {
      peakIdx = i;
      break;
    }
  }
  const vPeak = trace[peakIdx]!.speed;

  // First strict trough after the primary peak (strict local minimum).
  let troughIdx = trace.length - 1;
  for (let i = peakIdx + 1; i < trace.length - 1; i++) {
    if (trace[i]!.speed < trace[i - 1]!.speed && trace[i]!.speed < trace[i + 1]!.speed) {
      troughIdx = i;
      break;
    }
  }

  // Corrective sub-movements: local maxima after the trough exceeding the onset floor.
  let nCorr = 0;
  for (let i = troughIdx + 1; i < trace.length - 1; i++) {
    const s = trace[i]!.speed;
    if (s > trace[i - 1]!.speed && s >= trace[i + 1]!.speed && s > onsetThresh) {
      nCorr += 1;
    }
  }

  const troughTime = trace[troughIdx]!.t;
  const endTime = trace[trace.length - 1]!.t;
  return {
    tD: onsetTime - cueTime,
    tO: troughTime - onsetTime,
    tC: endTime - troughTime,
    nCorr,
    vPeak,
    onsetTime,
  };
}
