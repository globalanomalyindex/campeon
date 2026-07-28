import type { Ms } from '../types';

/**
 * One sample of the aim's speed in COUNT SPACE: mouse counts per second, not degrees per second.
 *
 * The unit is the whole point. The onset threshold used to be fixed in deg/s, and the variable under
 * test is exactly how many degrees one count buys. So the same hand movement crossed the threshold
 * late (or never) at the slow end of the searched band and single-frame jitter crossed it at the fast
 * end: the measured onset latency and the corrective count moved WITH the sensitivity being scored.
 * A threshold that is a function of its own axis cannot separate the player from the setting. Counts
 * are what the hand emits, so a count-space threshold is a property of the player.
 * Regression: tests/instruments/recording.test.ts ('the same hand emission reads the same count
 * trace at any rendered gain').
 */
export interface CountSample {
  t: Ms;
  countsPerSec: number;
}

/**
 * Movement-onset floor in counts per second.
 *
 * This is a unit change, not a retune: 600 counts/s is the 20 deg/s both instruments passed
 * explicitly, evaluated at about 10,700 counts per 360 - the gain the shipped seed renders. It is
 * also 10 counts inside one 60 Hz frame, which is a defensible floor for "the hand has started
 * moving" independent of any gain.
 */
export const ONSET_COUNTS_PER_SEC = 600;

export interface SubmovementSeg {
  tD: Ms; // detection latency: cueTime → movement onset
  tO: Ms; // primary orient: onset → first qualifying trough after the primary peak
  tC: Ms; // confirm: trough → end of trace. 0 means no trough closed inside the trace.
  nCorr: number; // corrective sub-movements (local maxima after the trough, above onsetThresh)
  vPeak: number; // peak speed of the primary orient, counts/s
  onsetTime: Ms; // absolute time of movement onset
  /** Absolute time of the trough that ended the primary orient. Exposed so a consumer can find the
   *  frame it names by EXACT clock equality: recomputing it as `onsetTime + tO` is a float addition
   *  and is not guaranteed to reproduce the sample's own `t`, so a frame lookup keyed on that sum
   *  can miss and silently fall back to the wrong aim. Read by src/anchor/reach-observer.ts, and
   *  pinned against a fractional clock origin by tests/anchor/clock-stamp.test.ts. */
  troughTime: Ms;
}

export interface SegmentOptions {
  cueTime?: Ms; // default 0
  /** Movement-onset threshold in COUNTS PER SECOND; also the floor for counting corrections. */
  onsetThresh?: number;
  /**
   * A strict local minimum only ends the primary orient once speed has fallen to at most this
   * FRACTION of the running maximum since onset. Default Infinity means any strict local minimum
   * ends it, which is the rule the scored instruments were tuned against and which must stay
   * byte-identical. The anchor passes 0.5, because on an unsmoothed 60 Hz difference trace a single
   * jittery frame inside the acceleration ramp IS a strict local minimum, and taking it as the end
   * of the primary orient truncates the open-loop extent and therefore biases the landed fraction,
   * and so C0, LOW. Regression: tests/scoring/submovement.test.ts ('troughDrop 0.5 walks past the
   * jitter to the real end of the primary orient').
   */
  troughDrop?: number;
}

/**
 * Segment a count-space speed trace into detect / orient / confirm stages.
 * Onset = first sample crossing `onsetThresh`. Primary peak = first strict local maximum after onset.
 * Trough = first strict local minimum after that peak that also satisfies `troughDrop`. Corrective
 * sub-movements = local maxima after the trough whose speed exceeds `onsetThresh`.
 * Throws if the trace never crosses the onset threshold (no movement to segment).
 */
export function segment(trace: readonly CountSample[], opts: SegmentOptions = {}): SubmovementSeg {
  const cueTime = opts.cueTime ?? 0;
  const onsetThresh = opts.onsetThresh ?? ONSET_COUNTS_PER_SEC;
  const troughDrop = opts.troughDrop ?? Infinity;

  let onsetIdx = -1;
  for (let i = 0; i < trace.length; i++) {
    if (trace[i]!.countsPerSec >= onsetThresh) {
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
    const s = trace[i]!.countsPerSec;
    if (s > trace[i - 1]!.countsPerSec && s > trace[i + 1]!.countsPerSec) {
      peakIdx = i;
      break;
    }
  }
  const vPeak = trace[peakIdx]!.countsPerSec;

  // First strict trough after the primary peak that has dropped far enough to be believable.
  // The ceiling comes from the RUNNING maximum since onset, never from vPeak: vPeak is the FIRST
  // local maximum, and the jitter frame that fabricates a trough fabricates a peak at the same
  // time, so pinning the ceiling to vPeak would pin it to the jitter too.
  let runMax = 0;
  for (let i = onsetIdx; i <= peakIdx; i++) runMax = Math.max(runMax, trace[i]!.countsPerSec);
  let troughIdx = trace.length - 1;
  for (let i = peakIdx + 1; i < trace.length - 1; i++) {
    const s = trace[i]!.countsPerSec;
    // Infinity is spelled out rather than multiplied: with an onsetThresh of 0 a flat trace can
    // reach here with runMax 0, and 0 * Infinity is NaN, which would make every comparison false
    // and silently report "no trough" on a trace that has one.
    const ceil = Number.isFinite(troughDrop) ? runMax * troughDrop : Infinity;
    if (s < trace[i - 1]!.countsPerSec && s < trace[i + 1]!.countsPerSec && s <= ceil) {
      troughIdx = i;
      break;
    }
    runMax = Math.max(runMax, s);
  }

  // Corrective sub-movements: local maxima after the trough exceeding the onset floor.
  let nCorr = 0;
  for (let i = troughIdx + 1; i < trace.length - 1; i++) {
    const s = trace[i]!.countsPerSec;
    if (s > trace[i - 1]!.countsPerSec && s >= trace[i + 1]!.countsPerSec && s > onsetThresh) {
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
    troughTime,
  };
}
