import type { ArenaScene, Degrees, InstrumentId, Ms, Shot, TargetHandle, TrialContext, TrialResult } from '../types';
import { decompose, ewmaBias, calibrationCost } from '../scoring/bias-variance';
import { missComponents } from './recording';

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

  return {
    instrument: ID,
    cm360: ctx.cm360,
    score: 1 / (1 + cost), // (0,1], higher = better. Phase 4 finds where gain crosses 1.
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
    const shots: CalibrateShot[] = [];
    let handle: TargetHandle | null = null;
    let presentedAt = 0;
    let presentAim: [Degrees, Degrees] = [0, 0];

    const present = (now: Ms): void => {
      presentAim = scene.view();
      // Spawn around the current view → always on-screen (the reach is the offset, not an absolute bearing).
      const yaw = presentAim[0] + (ctx.rng() * 2 - 1) * 18;
      const pitch = Math.max(-80, Math.min(80, presentAim[1] + (ctx.rng() * 2 - 1) * 9));
      handle = scene.spawnTarget({ kind: 'static', yaw, pitch, distance: 20, worldRadius: 0.6 });
      presentedAt = now;
    };

    return new Promise<TrialResult>((resolve) => {
      const offFire = scene.onFire((now) => {
        if (!handle) return;
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
          offFire();
          resolve({ ...analyzeCalibrate(shots, ctx), at: now });
        } else {
          present(now);
        }
      });
      present(0);
    });
  },
};
