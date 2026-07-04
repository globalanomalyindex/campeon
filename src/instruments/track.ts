import type { ArenaScene, Degrees, InstrumentId, TrialContext, TrialResult } from '../types';
import { KalmanCV } from '../scoring/kalman';
import { timeOnTarget, TrialRecorder, type Frame, type Recording } from './recording';
import { separation } from '../engine/targets';

const ID: InstrumentId = 'track';
const DURATION_MS = 6000;
const FC_HZ = 4; // jitter cutoff: task motion below, tremor above
const MAX_LEAD_SEC = 0.3; // clamp band for the measured tracking latency (a sane human range)

// DESIGNED scalarization (disclosed, A3): the track score folds four MEASURED but unit-
// incommensurate components - tot (fraction on target), predErr (deg), jitter (deg/s),
// slipRms (deg/s) - into one preference number with these three weights. The weights are
// design choices tuned by feel, NOT measured quantities: they carry no uncertainty claim
// and no CI may ever be attached to them. What IS measured is each component, and (below)
// the block-to-block spread of the whole composite.
const W_PRED = 0.02;
const W_JITTER = 0.01;
const W_SLIP = 0.01;

// A3 batch-means blocking: target up to BLOCK_TARGET_K disjoint contiguous time blocks
// (spec target 4..6), each at least MIN_BLOCK_FRAMES frames (~0.5 s at 60 Hz) so a per-block
// composite is not itself dominated by estimator noise; every term additionally needs
// MIN_TERM_SAMPLES real samples in every block or we emit nothing.
const BLOCK_TARGET_K = 6;
const MIN_BLOCK_FRAMES = 30;
const MIN_TERM_SAMPLES = 8;

function rms(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x * x;
  return Math.sqrt(s / xs.length);
}

const mean = (xs: readonly number[]): number =>
  xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;

/**
 * Continuous lag (in samples) of the peak aim↔target cross-correlation, fused across BOTH the yaw
 * and pitch axes; >0 = aim trails. Each axis contributes its own zero-mean covariance, and we sum
 * those covariance functions into ONE cov(lag) = yawCov(lag) + pitchCov(lag) before any peak-find.
 *
 * Two reasons for one summed function rather than two refined peaks:
 *   • Covariance is inherently amplitude-weighted, so a low-SNR axis (e.g. a small/noisy yaw weave)
 *     contributes little and a clean high-amplitude axis dominates - the estimate stays stable.
 *   • Averaging two INDEPENDENTLY-refined per-axis peaks would reinject each axis's own noise; the
 *     player has a single tracking latency, so we recover it from the combined evidence at once.
 *
 * Zero-mean covariance (not a raw dot product) so a constant offset cannot tip the peak, then
 * parabolic sub-sample refinement of that single peak - a smooth target's latency lives between
 * frames, so quantizing it to whole frames would inject a parity artifact into the residual.
 */
export function bestLag(
  aimYaw: readonly number[],
  tgtYaw: readonly number[],
  aimPitch: readonly number[],
  tgtPitch: readonly number[],
  maxLag: number,
): number {
  const maY = mean(aimYaw);
  const mtY = mean(tgtYaw);
  const maP = mean(aimPitch);
  const mtP = mean(tgtPitch);
  // Per-axis zero-mean covariance at a given lag, with that axis's own overlap normalization.
  const axisCov = (
    aim: readonly number[],
    tgt: readonly number[],
    ma: number,
    mt: number,
    lag: number,
  ): number => {
    let c = 0;
    let n = 0;
    for (let i = 0; i < aim.length; i++) {
      const j = i - lag;
      if (j < 0 || j >= tgt.length) continue;
      c += (aim[i]! - ma) * (tgt[j]! - mt);
      n += 1;
    }
    return n > 0 ? c / n : -Infinity;
  };
  // The single combined covariance function: sum the two axes BEFORE peak-finding.
  const cov = (lag: number): number => {
    const cy = axisCov(aimYaw, tgtYaw, maY, mtY, lag);
    const cp = axisCov(aimPitch, tgtPitch, maP, mtP, lag);
    if (!Number.isFinite(cy) || !Number.isFinite(cp)) return -Infinity;
    return cy + cp;
  };
  let best = 0;
  let bestScore = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const score = cov(lag);
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  // Parabolic interpolation of the (cov₋₁, cov₀, cov₊₁) peak → sub-sample lag.
  const cm = cov(best - 1);
  const cp = cov(best + 1);
  const denom = cm - 2 * bestScore + cp;
  if (denom < 0 && Number.isFinite(cm) && Number.isFinite(cp)) {
    const delta = (0.5 * (cm - cp)) / denom;
    if (Number.isFinite(delta) && Math.abs(delta) <= 1) return best + delta;
  }
  return best;
}

/** Indirection seam over the lag estimator so tests can assert it runs EXACTLY ONCE per analysis
 *  (the A3 block SE must reuse the single whole-trial L, never re-estimate it on short blocks). */
export const lagEstimator = { bestLag };

/**
 * A3: MEASURED within-trial standard error of the composite track score via batch means.
 *
 * The trial's frames are split into k disjoint contiguous time blocks and the SAME designed
 * composite (tot - W_PRED*rms(pred) - W_JITTER*rms(jit) - W_SLIP*rms(slip)) is computed per block;
 * scoreSE = sd(blockScores)/sqrt(k). Every whole-trial estimator is held FIXED across blocks: the
 * latency L (so `predResidAt` is the whole-trial lag-compensated residual, merely partitioned),
 * the Kalman target-velocity track behind `slip`, and the jitter low-pass state. Re-estimating any
 * of them on a short block would inject that ESTIMATOR's own small-sample noise into the block
 * spread and report it as player variability - fabricated signal.
 *
 * Known bias, disclosed: batch means over an AUTOCORRELATED series underestimates the long-run
 * variance (positive correlation leaks across block boundaries), so this SE is biased LOW. That
 * bias is bounded downstream: objective.ts clamps the mapped per-point nugget to at least
 * floorFrac*noiseVar, so an underestimated SE can never claim more trust than that floor allows.
 *
 * Never fabricate: emits undefined (flat-nugget fallback) when the trial is too short for >= 2
 * adequate blocks, when any block lacks real samples of a term, or when the block spread is 0.
 */
function batchMeansScoreSE(
  frames: readonly Frame[],
  predResidAt: readonly (number | null)[],
  jitterResid: readonly number[], // entry i-1 belongs to frame i
  slip: readonly number[], // entry i-1 belongs to frame i
): number | undefined {
  const n = frames.length;
  const k = Math.min(BLOCK_TARGET_K, Math.floor(n / MIN_BLOCK_FRAMES));
  if (k < 2) return undefined;
  const blockScores: number[] = [];
  for (let b = 0; b < k; b++) {
    const lo = Math.floor((b * n) / k);
    const hi = Math.floor(((b + 1) * n) / k);
    const pred: number[] = [];
    const jit: number[] = [];
    const sl: number[] = [];
    for (let i = lo; i < hi; i++) {
      const p = predResidAt[i];
      if (p !== null && p !== undefined) pred.push(p);
      if (i >= 1) {
        jit.push(jitterResid[i - 1]!);
        sl.push(slip[i - 1]!);
      }
    }
    if (pred.length < MIN_TERM_SAMPLES || jit.length < MIN_TERM_SAMPLES) return undefined;
    const tot = timeOnTarget(frames.slice(lo, hi));
    blockScores.push(tot - W_PRED * rms(pred) - W_JITTER * rms(jit) - W_SLIP * rms(sl));
  }
  const mu = mean(blockScores);
  let sq = 0;
  for (const s of blockScores) sq += (s - mu) * (s - mu);
  const sd = Math.sqrt(sq / (k - 1)); // sample sd over the k block replicates
  const se = sd / Math.sqrt(k);
  return Number.isFinite(se) && se > 0 ? se : undefined;
}

/** Bilinearly interpolate a [yaw,pitch] series at a fractional index; null if out of range. */
function sampleAt(series: readonly [Degrees, Degrees][], idx: number): [Degrees, Degrees] | null {
  if (idx < 0 || idx > series.length - 1) return null;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const a = series[lo]!;
  if (lo === hi) return a;
  const b = series[hi]!;
  const f = idx - lo;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Pure tracking analysis over a recorded trial - the dragonfly + falcon faculty.
 *
 * A constant-velocity Kalman filter smooths the TARGET's state; its velocity estimate drives `slip`
 * - the relative angular velocity the player failed to null, the falcon VOR/OKR gaze-stabilization
 * analog. The player's tracking quality is then measured against the target directly:
 *   • latencySec - the player's OWN reaction latency L, recovered as the aim↔target cross-correlation
 *     lag in seconds. This is the dragonfly forward model's latency-calibrated lead horizon, measured
 *     per player rather than assumed (the old code hard-coded 150 ms for everyone).
 *   • predErr - the LAG-COMPENSATED predictive residual: aim(t) against the target position the
 *     player is actually tracking, L away. Removing pure latency isolates the sensitivity-dependent
 *     error (tremor + gain over/undershoot) - exactly what the cm/360 sweep is meant to move.
 *   • jitter - high-frequency aim-speed residual (tremor above FC_HZ, amplified by high sensitivity).
 *
 * NOTE the Kalman *innovation* (ν = z − Hx̂⁻) is the filter's one-step prediction error about the
 * TARGET - a function of the target's motion and the filter, NOT of the player - so it is deliberately
 * not the score. The lag-compensated residual is the player-dependent MEASURED component; the score
 * itself is a designed composite OF such measured components (tot, predErr, jitter, slipRms) folded
 * together by the feel-tuned W_* weights above - a scalarization choice, not itself a measurement.
 *
 * A3: the trial also carries a MEASURED `scoreSE` - the batch-means SE of that same composite over
 * disjoint time blocks (see batchMeansScoreSE) - or none at all when the trial cannot support one.
 */
export function analyzeTrack(rec: Recording, ctx: TrialContext): TrialResult {
  const frames = rec.frames.filter((f) => f.target !== null);
  const tot = timeOnTarget(frames);

  const kfYaw = new KalmanCV({ q: 50, r: 1 });
  const kfPitch = new KalmanCV({ q: 50, r: 1 });
  const aim: [Degrees, Degrees][] = [];
  const tgt: [Degrees, Degrees][] = [];
  const aimYaw: number[] = [];
  const tgtYaw: number[] = [];
  const aimPitch: number[] = [];
  const tgtPitch: number[] = [];
  const aimSpeeds: number[] = [];
  const slip: number[] = [];
  const dts: number[] = [];

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!;
    const target = f.target!;
    const dt = i === 0 ? 0.016 : Math.max(1e-3, (f.t - frames[i - 1]!.t) / 1000);
    kfYaw.predict(dt);
    kfYaw.update(target[0]);
    kfPitch.predict(dt);
    kfPitch.update(target[1]);
    aim.push(f.aim);
    tgt.push(target);
    aimYaw.push(f.aim[0]);
    tgtYaw.push(target[0]);
    aimPitch.push(f.aim[1]);
    tgtPitch.push(target[1]);
    if (i > 0) {
      dts.push(dt);
      const aimVel = separation(frames[i - 1]!.aim, f.aim) / dt;
      const kfTgtVel = Math.hypot(kfYaw.vel, kfPitch.vel); // smoothed target angular speed (deg/s)
      aimSpeeds.push(aimVel);
      slip.push(aimVel - kfTgtVel); // un-nulled relative angular velocity (falcon gaze stabilization)
    }
  }

  // The player's tracking latency L: lag of the peak aim↔target cross-correlation, in seconds.
  // Fused across yaw AND pitch via a single combined (amplitude-weighted) covariance so the weave's
  // ±5° pitch reinforces the estimate and a low-SNR axis cannot dominate it.
  const lag = lagEstimator.bestLag(aimYaw, tgtYaw, aimPitch, tgtPitch, Math.min(20, frames.length - 1));
  const pi = -lag;
  const latencySec = clamp(lag * (dts.length ? median(dts) : 0.016), 0, MAX_LEAD_SEC);

  // Lag-compensated predictive residual: aim(t) vs the target the player is actually tracking,
  // `lag` frames away (interpolated, since lag is sub-sample). Pure latency cancels; the
  // sensitivity-dependent tremor + gain over/undershoot remain. Kept frame-ALIGNED (null where the
  // shifted sample falls outside the recording) so the A3 block SE can partition the SAME residual
  // series - computed once, under the one whole-trial L - instead of recomputing it per block.
  const predResidAt: (number | null)[] = [];
  const predResid: number[] = [];
  for (let i = 0; i < frames.length; i++) {
    const t = sampleAt(tgt, i - lag);
    if (t) {
      const d = separation(aim[i]!, t);
      predResidAt.push(d);
      predResid.push(d);
    } else {
      predResidAt.push(null);
    }
  }
  const predErr = rms(predResid);

  const jitterResid: number[] = [];
  let lp = aimSpeeds[0] ?? 0;
  const alpha = Math.min(1, (2 * Math.PI * FC_HZ) / 60);
  for (const v of aimSpeeds) {
    lp = lp + alpha * (v - lp);
    jitterResid.push(v - lp);
  }
  const jitter = rms(jitterResid);
  const slipRms = rms(slip);

  // Within-trial score (higher = better); Phase 4 normalizes across the cm/360 sweep. This is the
  // DESIGNED W_* scalarization disclosed at the top of the file, over measured components.
  const score = tot - W_PRED * predErr - W_JITTER * jitter - W_SLIP * slipRms;

  // A3: measured batch-means SE of that same composite (undefined -> flat-nugget fallback).
  const scoreSE = batchMeansScoreSE(frames, predResidAt, jitterResid, slip);

  return {
    instrument: ID,
    cm360: ctx.cm360,
    score,
    ...(scoreSE !== undefined && scoreSE > 0 ? { scoreSE } : {}),
    raw: { tot, predErr, pi, jitter, slip: slipRms, latencySec },
    at: frames.length > 0 ? frames[frames.length - 1]!.t : 0,
  };
}

export const track = {
  id: ID,
  run(ctx: TrialContext, scene: ArenaScene): Promise<TrialResult> {
    scene.setSensitivity(ctx.cm360, ctx.dpi);
    const seed = Math.floor(ctx.rng() * 1e9);
    // Centre the weaving prey on where the player is currently looking → it starts on-screen and the
    // ±12°/±5° weave keeps it there. The view drifts between trials, so the old absolute origin
    // (yaw:0,pitch:0) could spawn the prey off-screen and the early frames would record the player
    // HUNTING for it, not tracking it - corrupting the dragonfly/falcon reading.
    const [vYaw, vPitch] = scene.view();
    const handle = scene.spawnTarget({
      kind: 'moving',
      yaw: vYaw,
      pitch: Math.max(-80, Math.min(80, vPitch)),
      distance: 20,
      worldRadius: 0.6,
      motion: { yawAmp: 12, pitchAmp: 5, baseFreq: 0.5, seed },
    });
    const rec = new TrialRecorder(scene, () => handle);
    return new Promise<TrialResult>((resolve) => {
      let elapsed = 0;
      const offFrame = scene.onFrame((dt) => {
        elapsed += dt;
        if (elapsed >= DURATION_MS) {
          offFrame();
          rec.stop();
          scene.clearTargets();
          resolve(analyzeTrack(rec.recording(), ctx));
        }
      });
    });
  },
};
