import type { ArenaScene, Degrees, InstrumentId, Ms, TargetHandle, TrialContext, TrialResult } from '../types';
import { segment } from '../scoring/submovement';
import { speedTrace, type Frame } from './recording';
import { separation } from '../engine/targets';
import { sampleStd } from '../scoring/stats';

const ID: InstrumentId = 'strike';
const SHOTS = 10;

export interface StrikeShot {
  tR: Ms; // reaction/commit: target onset → movement onset
  tS: Ms; // ballistic strike: onset → fire
  vPeak: number; // peak angular speed (deg/s)
  endpointError: Degrees; // signed scatter about the mean
  hit: boolean;
}

/** Pure strike analysis: TTK operating point + scatter, scored by the speed/accuracy weight. */
export function analyzeStrike(shots: readonly StrikeShot[], ctx: TrialContext): TrialResult {
  if (shots.length === 0) throw new RangeError('analyzeStrike: no shots');
  const tR = shots.reduce((s, x) => s + x.tR, 0) / shots.length;
  const tS = shots.reduce((s, x) => s + x.tS, 0) / shots.length;
  const vPeak = shots.reduce((s, x) => s + x.vPeak, 0) / shots.length;
  const ttkMs = tR + tS;
  const sigmaTheta = sampleStd(shots.map((s) => s.endpointError));
  const hitRate = shots.filter((s) => s.hit).length / shots.length;

  // Speed↔accuracy blend: w = speedAccuracy (1 = pure speed, 0 = pure accuracy).
  const w = Math.max(0, Math.min(1, ctx.profile.speedAccuracy));
  const ttkSec = Math.max(1e-3, ttkMs / 1000);
  const speedTerm = 1 / ttkSec; // strikes per second
  const score = Math.pow(speedTerm, w) * Math.pow(Math.max(0, hitRate), 1 - w);

  return {
    instrument: ID,
    cm360: ctx.cm360,
    score,
    raw: { ttkMs, tR, tS, vPeak, sigmaTheta, hitRate },
    at: 0,
  };
}

export const strike = {
  id: ID,
  run(ctx: TrialContext, scene: ArenaScene): Promise<TrialResult> {
    scene.setSensitivity(ctx.cm360, ctx.dpi);
    const shots: StrikeShot[] = [];
    let handle: TargetHandle | null = null;
    let presentedAt = 0;
    let frames: Frame[] = [];

    const present = (now: Ms): void => {
      // Spawn around where the player is currently looking → always on-screen (the view drifts between
      // trials; an absolute-origin spawn could land off-screen and waste the player's time hunting it).
      const [vYaw, vPitch] = scene.view();
      const yaw = vYaw + (ctx.rng() * 2 - 1) * 20;
      const pitch = Math.max(-80, Math.min(80, vPitch + (ctx.rng() * 2 - 1) * 10));
      handle = scene.spawnTarget({ kind: 'static', yaw, pitch, distance: 20, worldRadius: 0.7 });
      presentedAt = now;
      frames = [];
    };

    return new Promise<TrialResult>((resolve) => {
      const offFrame = scene.onFrame((_dt, now) => {
        if (handle) frames.push({ t: now, aim: scene.view(), target: handle.bearing(), targetRadius: handle.radiusDeg() });
      });
      const offFire = scene.onFire((now) => {
        if (!handle) return;
        const aim = scene.view();
        const tgt = handle.bearing();
        const radial = separation(aim, tgt);
        const tr = speedTrace(frames);
        let onsetTime = presentedAt;
        let vPeak = 0;
        try {
          const seg = segment(tr, { onsetThresh: 20, cueTime: presentedAt });
          onsetTime = seg.onsetTime;
          vPeak = seg.vPeak;
        } catch {
          // no movement detected (instant fire) — reaction = full interval
        }
        shots.push({
          tR: onsetTime - presentedAt,
          tS: now - onsetTime,
          vPeak,
          endpointError: radial,
          hit: radial <= handle.radiusDeg(),
        });
        scene.clearTargets();
        handle = null;
        if (shots.length >= SHOTS) {
          offFrame();
          offFire();
          // Re-center endpointError about its mean so σ_θ is a scatter, not a bias.
          const mean = shots.reduce((s, x) => s + x.endpointError, 0) / shots.length;
          const centered = shots.map((s) => ({ ...s, endpointError: s.endpointError - mean }));
          resolve({ ...analyzeStrike(centered, ctx), at: now });
        } else {
          present(now);
        }
      });
      present(0);
    });
  },
};
