import type {
  ArenaScene,
  Degrees,
  FittsCondition,
  InstrumentId,
  Ms,
  Tap,
  TargetHandle,
  TrialContext,
  TrialResult,
} from '../types';
import { conditionThroughput, aggregateThroughput, type ConditionThroughput } from '../scoring/fitts';
import { segment } from '../scoring/submovement';
import { speedTrace, type Frame } from './recording';
import { separation } from '../engine/targets';

const ID: InstrumentId = 'flick';

/** A grid of (amplitude, width) conditions — low-ID big flicks → high-ID small locks. */
export const FLICK_CONDITIONS: FittsCondition[] = [
  { amplitude: 12, width: 3 },
  { amplitude: 12, width: 1.5 },
  { amplitude: 28, width: 3 },
  { amplitude: 28, width: 1.5 },
  { amplitude: 40, width: 2.2 },
];

export interface FlickTap {
  amplitude: Degrees;
  width: Degrees;
  mt: Ms;
  errAlong: Degrees;
  nCorr: number;
  hit: boolean;
}

function key(c: FittsCondition): string {
  return `${c.amplitude}|${c.width}`;
}

/** Pure flick analysis: group taps by condition → effective throughput + correction/hit stats. */
export function analyzeFlick(taps: readonly FlickTap[], ctx: TrialContext): TrialResult {
  const byCond = new Map<string, FlickTap[]>();
  for (const t of taps) {
    const k = key({ amplitude: t.amplitude, width: t.width });
    const arr = byCond.get(k) ?? [];
    arr.push(t);
    byCond.set(k, arr);
  }
  const perCondition: ConditionThroughput[] = [];
  for (const arr of byCond.values()) {
    const condition: FittsCondition = { amplitude: arr[0]!.amplitude, width: arr[0]!.width };
    const fittsTaps: Tap[] = arr.map((t) => ({ mt: t.mt, endpointErrorAlongAxis: t.errAlong }));
    perCondition.push(conditionThroughput(fittsTaps, condition));
  }
  const throughput = aggregateThroughput(perCondition);
  const hitRate = taps.length === 0 ? 0 : taps.filter((t) => t.hit).length / taps.length;
  const nCorrMean = taps.length === 0 ? 0 : taps.reduce((s, t) => s + t.nCorr, 0) / taps.length;
  const mtMean = taps.length === 0 ? 0 : taps.reduce((s, t) => s + t.mt, 0) / taps.length;

  return {
    instrument: ID,
    cm360: ctx.cm360,
    score: throughput, // bits/s; higher = better. Phase 4 normalizes across the sweep.
    raw: { throughput, hitRate, nCorrMean, mtMean, conditions: perCondition.length },
    at: 0,
  };
}

const REPS = 3; // repetitions per condition

export const flick = {
  id: ID,
  run(ctx: TrialContext, scene: ArenaScene): Promise<TrialResult> {
    scene.setSensitivity(ctx.cm360, ctx.dpi);
    // Randomized presentation order (deterministic from ctx.rng).
    const order: FittsCondition[] = [];
    for (let r = 0; r < REPS; r++) for (const c of FLICK_CONDITIONS) order.push(c);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.rng() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }

    const taps: FlickTap[] = [];
    let idx = 0;
    let handle: TargetHandle | null = null;
    let presentedAt = 0;
    let reachFrames: Frame[] = [];

    return new Promise<TrialResult>((resolve) => {
      const present = (now: Ms): void => {
        const c = order[idx]!;
        const view = scene.view();
        const dir = ctx.rng() * Math.PI * 2;
        const yaw = view[0] + c.amplitude * Math.cos(dir);
        const pitch = Math.max(-40, Math.min(40, view[1] + c.amplitude * Math.sin(dir)));
        const worldRadius = 20 * Math.tan((c.width / 2) * (Math.PI / 180)); // W = angular diameter at d=20
        handle = scene.spawnTarget({ kind: 'static', yaw, pitch, distance: 20, worldRadius });
        presentedAt = now;
        reachFrames = [];
      };

      const offFrame = scene.onFrame((_dt, now) => {
        if (handle) {
          reachFrames.push({ t: now, aim: scene.view(), target: handle.bearing(), targetRadius: handle.radiusDeg() });
        }
      });

      const offFire = scene.onFire((now) => {
        if (!handle) return;
        const c = order[idx]!;
        const aim = scene.view();
        const tgt = handle.bearing();
        const radial = separation(aim, tgt);
        // Sequential flick: the endpoint error along the approach axis is the signed radial miss.
        const errAlong = radial * (aim[0] >= tgt[0] ? 1 : -1);
        let nCorr = 0;
        try {
          nCorr = segment(speedTrace(reachFrames), { onsetThresh: 20 }).nCorr;
        } catch {
          nCorr = 0; // no movement detected → no corrections
        }
        taps.push({
          amplitude: c.amplitude,
          width: c.width,
          mt: now - presentedAt,
          errAlong,
          nCorr,
          hit: radial <= handle.radiusDeg(),
        });
        scene.clearTargets();
        handle = null;
        idx += 1;
        if (idx >= order.length) {
          offFrame();
          offFire();
          resolve({ ...analyzeFlick(taps, ctx), at: now });
        } else {
          present(now);
        }
      });

      present(0);
    });
  },
};
