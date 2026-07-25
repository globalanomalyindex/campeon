import type { ArenaScene, Degrees, InstrumentId, Ms, Shot, TargetHandle, TrialContext, TrialResult } from '../types';
import { planAcclimation } from './acclimation';
import { decompose, ewmaBias, calibrationCost, DEFAULT_WEIGHTS } from '../scoring/bias-variance';
import { missComponents } from './recording';
import { sampleStd } from '../scoring/stats';

const ID: InstrumentId = 'calibrate';
const SHOTS = 12;
const T_REF: Ms = 500;

export interface CalibrateShot {
  errAlong: Degrees;
  errCross: Degrees;
  required: Degrees;
  mt: Ms;
}

/** Pure calibration analysis: bias/variance decomposition + EWMA + calibration cost. */
export function analyzeCalibrate(shots: readonly CalibrateShot[], ctx: TrialContext): TrialResult {
  const asShots = shots.map((s): Shot => ({ error: [s.errAlong, s.errCross], required: s.required }));
  const d = decompose(asShots);
  const ewma = ewmaBias(asShots, 0.15);
  const meanMt = shots.length === 0 ? T_REF : shots.reduce((s, x) => s + x.mt, 0) / shots.length;
  const cost = calibrationCost(d, meanMt, T_REF);
  const biasMag = Math.hypot(d.bias[0], d.bias[1]);
  const score = 1 / (1 + cost); // (0,1], higher = better. Phase 4 finds where gain crosses 1.

  // P1-1 reliability: the SE of the (multi-shot) calibration cost, mapped through score = 1/(1+cost)
  // (so dScore = dCost/(1+cost)²). The spatial cost terms are functions of the per-shot squared-error
  // magnitude ‖e‖²; its sampling SE is sampleStd(‖e_i‖²)/√n. We weight it by the larger spatial weight
  // (a conservative, never-narrowing bound on the cost's sampling SE). 0 spread → no SE (flat-nugget
  // fallback); never fabricated.
  const errSq = shots.map((s) => s.errAlong * s.errAlong + s.errCross * s.errCross);
  const n = shots.length;
  const costSE = n >= 2 ? Math.max(DEFAULT_WEIGHTS.wb, DEFAULT_WEIGHTS.wv) * (sampleStd(errSq) / Math.sqrt(n)) : 0;
  const scoreSE = costSE > 0 ? costSE / ((1 + cost) * (1 + cost)) : undefined;

  return {
    instrument: ID,
    cm360: ctx.cm360,
    score,
    ...(scoreSE !== undefined && scoreSE > 0 ? { scoreSE } : {}),
    raw: {
      biasRadial: d.bias[0],
      biasCross: d.bias[1],
      biasMag,
      gain: d.gain,
      sigmaR: d.sigmaR,
      mse: d.mse,
      ewmaRadial: ewma[0],
      cost,
    },
    at: 0,
  };
}

export const calibrate = {
  id: ID,
  run(ctx: TrialContext, scene: ArenaScene): Promise<TrialResult> {
    scene.setSensitivity(ctx.cm360, ctx.dpi);
    // Unscored acclimation lead-in (see acclimation.ts): the first `lead` shots are real reaches
    // at the new gain, discarded before scoring. Their geometry draws from the plan's PRIVATE rng
    // so the scored spawns consume exactly the ctx.rng draws they consumed before the lead-in.
    const plan = planAcclimation(ctx, ID);
    let lead = plan.reaches;
    const shots: CalibrateShot[] = [];
    let handle: TargetHandle | null = null;
    let presentedAt = 0;
    let presentAim: [Degrees, Degrees] = [0, 0];

    const present = (now: Ms): void => {
      presentAim = scene.view();
      const rng = lead > 0 ? plan.rng : ctx.rng;
      // Spawn around the current view → always on-screen (the reach is the offset, not an absolute bearing).
      const yaw = presentAim[0] + (rng() * 2 - 1) * 18;
      const pitch = Math.max(-80, Math.min(80, presentAim[1] + (rng() * 2 - 1) * 9));
      handle = scene.spawnTarget({ kind: 'static', yaw, pitch, distance: 20, worldRadius: 0.6 });
      presentedAt = now;
    };

    return new Promise<TrialResult>((resolve) => {
      // A one-shot frame subscription, purely to learn the arena clock before the first
      // target goes up. Stamping presentedAt with 0 made the opening shot's mt absorb the
      // whole elapsed session, and calibrationCost squares meanMt, so a single inflated mt
      // drove this instrument's score to nearly zero. See the note in flick.ts.
      let offOpen: (() => void) | null = null;
      offOpen = scene.onFrame((_dt, now) => {
        offOpen?.();
        offOpen = null;
        present(now);
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
        const m = missComponents(presentAim, tgt, aim);
        shots.push({
          errAlong: m.radial,
          errCross: m.tangential,
          required: m.reach || 1,
          mt: now - presentedAt,
        });
        scene.clearTargets();
        handle = null;
        if (shots.length >= SHOTS) {
          offOpen?.();
          offFire();
          const r = analyzeCalibrate(shots, ctx);
          // Disclose the discarded lead-in (protocol parameter, not a measurement).
          resolve({ ...r, raw: { ...r.raw, leadInShots: plan.reaches }, at: now });
        } else {
          present(now);
        }
      });
    });
  },
};
