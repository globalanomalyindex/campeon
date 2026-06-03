import type { ArenaScene, Degrees, InstrumentId, TrialContext, TrialResult } from '../types';
import { KalmanCV } from '../scoring/kalman';
import { timeOnTarget, TrialRecorder, type Recording } from './recording';
import { separation } from '../engine/targets';

const ID: InstrumentId = 'track';
const DURATION_MS = 6000;
const FC_HZ = 4; // jitter cutoff: task motion below, tremor above
const MAX_LEAD_SEC = 0.3; // clamp band for the measured tracking latency (a sane human range)

function rms(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x * x;
  return Math.sqrt(s / xs.length);
}

/**
 * Continuous lag (in samples) of the peak aim↔target cross-correlation along an axis; >0 = aim
 * trails. Zero-mean covariance (not a raw dot product) so a constant offset cannot tip the peak,
 * then parabolic sub-sample refinement of that peak — a smooth target's latency lives between
 * frames, so quantizing it to whole frames would inject a parity artifact into the residual.
 */
function bestLag(aim: readonly number[], target: readonly number[], maxLag: number): number {
  const ma = aim.length ? aim.reduce((s, v) => s + v, 0) / aim.length : 0;
  const mt = target.length ? target.reduce((s, v) => s + v, 0) / target.length : 0;
  const cov = (lag: number): number => {
    let c = 0;
    let n = 0;
    for (let i = 0; i < aim.length; i++) {
      const j = i - lag;
      if (j < 0 || j >= target.length) continue;
      c += (aim[i]! - ma) * (target[j]! - mt);
      n += 1;
    }
    return n > 0 ? c / n : -Infinity;
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
 * Pure tracking analysis over a recorded trial — the dragonfly + falcon faculty.
 *
 * A constant-velocity Kalman filter smooths the TARGET's state; its velocity estimate drives `slip`
 * — the relative angular velocity the player failed to null, the falcon VOR/OKR gaze-stabilization
 * analog. The player's tracking quality is then measured against the target directly:
 *   • latencySec — the player's OWN reaction latency L, recovered as the aim↔target cross-correlation
 *     lag in seconds. This is the dragonfly forward model's latency-calibrated lead horizon, measured
 *     per player rather than assumed (the old code hard-coded 150 ms for everyone).
 *   • predErr — the LAG-COMPENSATED predictive residual: aim(t) against the target position the
 *     player is actually tracking, L away. Removing pure latency isolates the sensitivity-dependent
 *     error (tremor + gain over/undershoot) — exactly what the cm/360 sweep is meant to move.
 *   • jitter — high-frequency aim-speed residual (tremor above FC_HZ, amplified by high sensitivity).
 *
 * NOTE the Kalman *innovation* (ν = z − Hx̂⁻) is the filter's one-step prediction error about the
 * TARGET — a function of the target's motion and the filter, NOT of the player — so it is deliberately
 * not the score. The player-dependent quantity is the lag-compensated residual above.
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
    if (i > 0) {
      dts.push(dt);
      const aimVel = separation(frames[i - 1]!.aim, f.aim) / dt;
      const kfTgtVel = Math.hypot(kfYaw.vel, kfPitch.vel); // smoothed target angular speed (deg/s)
      aimSpeeds.push(aimVel);
      slip.push(aimVel - kfTgtVel); // un-nulled relative angular velocity (falcon gaze stabilization)
    }
  }

  // The player's tracking latency L: lag of the peak aim↔target cross-correlation, in seconds.
  const lag = bestLag(aimYaw, tgtYaw, Math.min(20, frames.length - 1));
  const pi = -lag;
  const latencySec = clamp(lag * (dts.length ? median(dts) : 0.016), 0, MAX_LEAD_SEC);

  // Lag-compensated predictive residual: aim(t) vs the target the player is actually tracking,
  // `lag` frames away (interpolated, since lag is sub-sample). Pure latency cancels; the
  // sensitivity-dependent tremor + gain over/undershoot remain.
  const predResid: number[] = [];
  for (let i = 0; i < frames.length; i++) {
    const t = sampleAt(tgt, i - lag);
    if (t) predResid.push(separation(aim[i]!, t));
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

  // Within-trial score (higher = better); Phase 4 normalizes across the cm/360 sweep.
  const score = tot - 0.02 * predErr - 0.01 * jitter - 0.01 * slipRms;

  return {
    instrument: ID,
    cm360: ctx.cm360,
    score,
    raw: { tot, predErr, pi, jitter, slip: slipRms, latencySec },
    at: frames.length > 0 ? frames[frames.length - 1]!.t : 0,
  };
}

export const track = {
  id: ID,
  run(ctx: TrialContext, scene: ArenaScene): Promise<TrialResult> {
    scene.setSensitivity(ctx.cm360, ctx.dpi);
    const seed = Math.floor(ctx.rng() * 1e9);
    const handle = scene.spawnTarget({
      kind: 'moving',
      yaw: 0,
      pitch: 0,
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
