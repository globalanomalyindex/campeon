import type { ArenaScene, Degrees, InstrumentId, Ms, TargetHandle, TrialContext, TrialResult } from '../types';
import { planAcclimation } from './acclimation';
import { segment, ONSET_COUNTS_PER_SEC } from '../scoring/submovement';
import { countTrace, type Frame } from './recording';
import { separation } from '../engine/targets';
import { sampleStd } from '../scoring/stats';

const ID: InstrumentId = 'strike';
const SHOTS = 10;

export interface StrikeShot {
  tR: Ms; // reaction/commit: target onset → movement onset
  tS: Ms; // ballistic strike: onset → fire
  vPeak: number; // peak speed of the primary orient, counts/s (a raw diagnostic, not scored)
  endpointError: Degrees; // signed scatter about the mean
  hit: boolean;
}

/** Pure strike analysis: TTK operating point + scatter, scored by the speed/accuracy weight. */
export function analyzeStrike(shots: readonly StrikeShot[], ctx: TrialContext): TrialResult {
  if (shots.length === 0) throw new RangeError('analyzeStrike: no shots');
  const n = shots.length;
  const tR = shots.reduce((s, x) => s + x.tR, 0) / n;
  const tS = shots.reduce((s, x) => s + x.tS, 0) / n;
  const vPeak = shots.reduce((s, x) => s + x.vPeak, 0) / n;
  const ttkMs = tR + tS;
  const sigmaTheta = sampleStd(shots.map((s) => s.endpointError));
  const hitRate = shots.filter((s) => s.hit).length / n;

  // Speed↔accuracy blend: w = speedAccuracy (1 = pure speed, 0 = pure accuracy).
  const w = Math.max(0, Math.min(1, ctx.profile.speedAccuracy));
  const ttkSec = Math.max(1e-3, ttkMs / 1000);
  const speedTerm = 1 / ttkSec; // strikes per second
  const score = Math.pow(speedTerm, w) * Math.pow(Math.max(0, hitRate), 1 - w);

  // P1-1 reliability: combine the measured speed SE and the measured accuracy SE into a score SE via
  // the delta method. score = speedTerm^w · hitRate^(1−w), so each factor contributes its RELATIVE
  // SE with its exponent as the weight, and the two add in quadrature.
  //  - Speed term: d(ttk)/ttk from the measured per-shot TTK spread.
  //  - Accuracy term: the score's accuracy factor is the hit rate H, a binomial proportion over n
  //    shots, so its relative SE follows mechanically from the score's own functional form:
  //    SE(H)/H with SE(H) = √(H(1−H)/n). Plain plug-in estimator on purpose - a Wilson/Jeffreys
  //    prior would smuggle an unmeasured scale back into the nugget. σ_θ (endpoint scatter) is NOT
  //    the score's accuracy factor; it stays in `raw` as a diagnostic only.
  //  Edges follow the never-fabricate rules: H = 0 → score is 0 and the guard below already emits
  //  no SE; H = 1 → the plug-in spread is honestly 0, so no accuracy SE is emitted. H = 1 sessions
  //  therefore emit fewer nuggets - only the measured speed term remains, or no scoreSE at all when
  //  the TTK spread is also 0 (those observations fall back to the flat nugget).
  const ttkSE = sampleStd(shots.map((s) => (s.tR + s.tS) / 1000)) / Math.sqrt(n); // SE of TTK (s)
  const relSpeed = ttkSE / ttkSec; // d(speedTerm)/speedTerm = d(ttk)/ttk
  const relAcc = hitRate > 0 && hitRate < 1 ? Math.sqrt((hitRate * (1 - hitRate)) / n) / hitRate : 0;
  const relScore = Math.hypot(w * relSpeed, (1 - w) * relAcc);
  const scoreSE = Number.isFinite(score) && score > 0 && relScore > 0 ? score * relScore : undefined;

  return {
    instrument: ID,
    counts: ctx.counts,
    score,
    ...(scoreSE !== undefined && scoreSE > 0 ? { scoreSE } : {}),
    raw: { ttkMs, tR, tS, vPeak, sigmaTheta, hitRate },
    at: 0,
  };
}

export const strike = {
  id: ID,
  run(ctx: TrialContext, scene: ArenaScene): Promise<TrialResult> {
    scene.setSensitivity(ctx.counts);
    // Unscored acclimation lead-in (see acclimation.ts): the first `lead` shots are real reaches
    // at the new gain, discarded before scoring. Their geometry draws from the plan's PRIVATE rng
    // so the scored spawns consume exactly the ctx.rng draws they consumed before the lead-in.
    const plan = planAcclimation(ctx, ID);
    let lead = plan.reaches;
    const shots: StrikeShot[] = [];
    let handle: TargetHandle | null = null;
    let presentedAt = 0;
    let frames: Frame[] = [];

    const present = (now: Ms): void => {
      // Spawn around where the player is currently looking → always on-screen (the view drifts between
      // trials; an absolute-origin spawn could land off-screen and waste the player's time hunting it).
      const [vYaw, vPitch] = scene.view();
      const rng = lead > 0 ? plan.rng : ctx.rng;
      const yaw = vYaw + (rng() * 2 - 1) * 20;
      const pitch = Math.max(-80, Math.min(80, vPitch + (rng() * 2 - 1) * 10));
      handle = scene.spawnTarget({ kind: 'static', yaw, pitch, distance: 20, worldRadius: 0.7 });
      presentedAt = now;
      frames = [];
    };

    return new Promise<TrialResult>((resolve) => {
      // Present on the first frame so presentedAt carries the real arena clock. Stamping
      // it 0 made tR (onsetTime - presentedAt) absorb the whole elapsed session on the
      // opening shot of every trial. See the note in flick.ts.
      let opened = false;
      const offFrame = scene.onFrame((_dt, now) => {
        if (!opened) { opened = true; present(now); return; }
        if (handle) frames.push({ t: now, aim: scene.view(), target: handle.bearing(), targetRadius: handle.radiusDeg() });
      });
      const offFire = scene.onFire((now) => {
        if (!handle) return;
        if (lead > 0) {
          // An acclimation reach: consume it and re-present without recording anything.
          lead -= 1;
          scene.clearTargets();
          handle = null;
          present(now);
          return;
        }
        const aim = scene.view();
        const tgt = handle.bearing();
        const radial = separation(aim, tgt);
        const tr = countTrace(frames, ctx.counts);
        let onsetTime = presentedAt;
        let vPeak = 0;
        try {
          const seg = segment(tr, { onsetThresh: ONSET_COUNTS_PER_SEC, cueTime: presentedAt });
          onsetTime = seg.onsetTime;
          vPeak = seg.vPeak;
        } catch {
          // no movement detected (instant fire) - reaction = full interval
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
          const r = analyzeStrike(centered, ctx);
          // Disclose the discarded lead-in (protocol parameter, not a measurement).
          resolve({ ...r, raw: { ...r.raw, leadInShots: plan.reaches }, at: now });
        } else {
          present(now);
        }
      });
    });
  },
};
