import type { ArenaScene, Degrees, InstrumentId, TrialContext, TrialResult } from '../types';
import { KalmanCV } from '../scoring/kalman';
import { timeOnTarget, TrialRecorder, type Recording } from './recording';
import { separation } from '../engine/targets';

const ID: InstrumentId = 'track';
const DURATION_MS = 6000;
const LEAD_SEC = 0.15; // ~150 ms feed-forward lead (dragonfly/falcon latency band)
const FC_HZ = 4; // jitter cutoff: task motion below, tremor above

function rms(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x * x;
  return Math.sqrt(s / xs.length);
}

/** Lag (in samples) of peak cross-correlation between aim and target along an axis. >0 = aim trails. */
function bestLag(aim: readonly number[], target: readonly number[], maxLag: number): number {
  let best = 0;
  let bestScore = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let dot = 0;
    let n = 0;
    for (let i = 0; i < aim.length; i++) {
      const j = i - lag;
      if (j < 0 || j >= target.length) continue;
      dot += aim[i]! * target[j]!;
      n += 1;
    }
    if (n > 0) {
      const score = dot / n;
      if (score > bestScore) {
        bestScore = score;
        best = lag;
      }
    }
  }
  return best;
}

/** Pure tracking analysis over a recorded trial. */
export function analyzeTrack(rec: Recording, ctx: TrialContext): TrialResult {
  const frames = rec.frames.filter((f) => f.target !== null);
  const tot = timeOnTarget(frames);

  const kfYaw = new KalmanCV({ q: 50, r: 1 });
  const kfPitch = new KalmanCV({ q: 50, r: 1 });
  const leadErr: number[] = [];
  const aimYaw: number[] = [];
  const tgtYaw: number[] = [];
  const aimSpeeds: number[] = [];
  const slip: number[] = [];

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!;
    const tgt = f.target!;
    const dt = i === 0 ? 0.016 : Math.max(1e-3, (f.t - frames[i - 1]!.t) / 1000);
    kfYaw.predict(dt);
    kfYaw.update(tgt[0]);
    kfPitch.predict(dt);
    kfPitch.update(tgt[1]);
    const lead: [Degrees, Degrees] = [kfYaw.lead(LEAD_SEC), kfPitch.lead(LEAD_SEC)];
    leadErr.push(separation(f.aim, lead));
    aimYaw.push(f.aim[0]);
    tgtYaw.push(tgt[0]);
    if (i > 0) {
      const pf = frames[i - 1]!;
      const aimVel = separation(pf.aim, f.aim) / dt;
      const tgtVel = separation(pf.target!, tgt) / dt;
      aimSpeeds.push(aimVel);
      slip.push(aimVel - tgtVel);
    }
  }

  const lag = bestLag(aimYaw, tgtYaw, Math.min(20, frames.length - 1));
  const pi = -lag;

  const jitterResid: number[] = [];
  let lp = aimSpeeds[0] ?? 0;
  const alpha = Math.min(1, (2 * Math.PI * FC_HZ) / 60);
  for (const v of aimSpeeds) {
    lp = lp + alpha * (v - lp);
    jitterResid.push(v - lp);
  }
  const jitter = rms(jitterResid);
  const eLead = rms(leadErr);
  const slipRms = rms(slip);

  // Within-trial score (higher = better); Phase 4 normalizes across the cm/360 sweep.
  const score = tot - 0.02 * eLead - 0.01 * jitter - 0.01 * slipRms;

  return {
    instrument: ID,
    cm360: ctx.cm360,
    score,
    raw: { tot, eLead, pi, jitter, slip: slipRms, leadSec: LEAD_SEC },
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
