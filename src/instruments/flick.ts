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
import { planAcclimation } from './acclimation';
import {
  conditionThroughput,
  aggregateThroughput,
  aggregateThroughputSE,
  type ConditionThroughput,
} from '../scoring/fitts';
import { mean } from '../scoring/stats';
import { segment, ONSET_COUNTS_PER_SEC } from '../scoring/submovement';
import { missComponents, countTrace, type Frame } from './recording';
import { separation } from '../engine/targets';

const ID: InstrumentId = 'flick';
const AMP_SPLIT: Degrees = 24; // amplitude ≥ this → a ballistic reorientation (the spider's open-loop orient)
const WIDTH_SPLIT: Degrees = 2; // width ≤ this → a precision lock (the raptor's deep-fovea confirm)

/** A grid of (amplitude, width) conditions - low-ID big flicks → high-ID small locks. */
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

/**
 * Pure flick analysis - the spider + raptor faculty. Groups taps by (amplitude, width) condition,
 * scores each with ISO 9241-9 effective throughput, then resolves the dual-fovea TWO-MODE trade:
 *   • ballisticTP - throughput on large-amplitude reorientations (the spider's open-loop orient).
 *   • precisionTP - throughput on small-width locks (the raptor's high-acuity confirm).
 * The score is the HARMONIC MEAN of the two, which peaks at the CROSSOVER of the two curves - the
 * sensitivity that serves big flicks AND fine placement - instead of whichever single mode is fastest.
 * (Pooled mean-of-means throughput is kept as a diagnostic. A fixture with only one mode falls back
 * to that mode, then to the pooled aggregate; a condition with <2 taps still fails honestly.)
 */
export function analyzeFlick(taps: readonly FlickTap[], ctx: TrialContext): TrialResult {
  const byCond = new Map<string, FlickTap[]>();
  for (const t of taps) {
    const k = key({ amplitude: t.amplitude, width: t.width });
    const arr = byCond.get(k) ?? [];
    arr.push(t);
    byCond.set(k, arr);
  }
  const scored: { condition: FittsCondition; ct: ConditionThroughput }[] = [];
  for (const arr of byCond.values()) {
    const condition: FittsCondition = { amplitude: arr[0]!.amplitude, width: arr[0]!.width };
    const fittsTaps: Tap[] = arr.map((t) => ({ mt: t.mt, endpointErrorAlongAxis: t.errAlong }));
    scored.push({ condition, ct: conditionThroughput(fittsTaps, condition) });
  }
  const throughput = aggregateThroughput(scored.map((s) => s.ct)); // pooled (throws on empty → honest)

  const tpOver = (sel: (c: FittsCondition) => boolean): number | null => {
    const xs = scored.filter((s) => sel(s.condition)).map((s) => s.ct.tp);
    return xs.length ? mean(xs) : null;
  };
  const ballisticTP = tpOver((c) => c.amplitude >= AMP_SPLIT);
  const precisionTP = tpOver((c) => c.width <= WIDTH_SPLIT);

  // Two-mode crossover via the harmonic mean - being good at only one mode is penalized by the other.
  const score =
    ballisticTP !== null && precisionTP !== null && ballisticTP > 0 && precisionTP > 0
      ? (2 * ballisticTP * precisionTP) / (ballisticTP + precisionTP)
      : (ballisticTP ?? precisionTP ?? throughput);

  const hitRate = taps.length === 0 ? 0 : taps.filter((t) => t.hit).length / taps.length;
  const nCorrMean = taps.length === 0 ? 0 : taps.reduce((s, t) => s + t.nCorr, 0) / taps.length;
  const mtMean = taps.length === 0 ? 0 : taps.reduce((s, t) => s + t.mt, 0) / taps.length;

  // P1-1 reliability: the measured between-condition spread of the aggregate throughput, mapped onto
  // the SCORE scale. The harmonic-mean score and the pooled throughput share the bits/s scale, so a
  // first-order (delta-method) map is the score-to-throughput ratio. 0 conditions of spread → no SE
  // (the optimizer falls back to the flat nugget); never fabricated.
  const tpSE = aggregateThroughputSE(scored.map((s) => s.ct));
  const scoreSE =
    tpSE > 0 && throughput > 0 && Number.isFinite(score) ? tpSE * (score / throughput) : undefined;

  return {
    instrument: ID,
    counts: ctx.counts,
    score, // bits/s; higher = better. Phase 4 normalizes across the sweep.
    ...(scoreSE !== undefined && scoreSE > 0 ? { scoreSE } : {}),
    raw: {
      throughput,
      ballisticTP: ballisticTP ?? NaN,
      precisionTP: precisionTP ?? NaN,
      hitRate,
      nCorrMean,
      mtMean,
      conditions: scored.length,
    },
    at: 0,
  };
}

const REPS = 3; // repetitions per condition

export const flick = {
  id: ID,
  run(ctx: TrialContext, scene: ArenaScene): Promise<TrialResult> {
    scene.setSensitivity(ctx.counts);
    // Randomized presentation order (deterministic from ctx.rng).
    const order: FittsCondition[] = [];
    for (let r = 0; r < REPS; r++) for (const c of FLICK_CONDITIONS) order.push(c);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.rng() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }

    // Unscored acclimation lead-in (see acclimation.ts): the first `lead` taps are real reaches
    // at the new gain, discarded before any tap is recorded. Their geometry draws from the plan's
    // PRIVATE rng so the scored presentation (the shuffle above + per-target directions below)
    // consumes exactly the ctx.rng draws it consumed before the lead-in existed.
    const plan = planAcclimation(ctx, ID);
    let lead = plan.reaches;

    const taps: FlickTap[] = [];
    let idx = 0;
    let handle: TargetHandle | null = null;
    let presentedAt = 0;
    let presentAim: [Degrees, Degrees] = [0, 0]; // aim at present time - the start of the reach
    let reachFrames: Frame[] = [];

    return new Promise<TrialResult>((resolve) => {
      const present = (now: Ms): void => {
        const leading = lead > 0;
        // Lead-in taps cycle the real condition grid so the practice spans the amplitudes the
        // scored taps will use; a scored tap always takes the next slot of the shuffled order.
        const c = leading ? FLICK_CONDITIONS[(plan.reaches - lead) % FLICK_CONDITIONS.length]! : order[idx]!;
        const view = scene.view();
        presentAim = view;
        const dir = (leading ? plan.rng : ctx.rng)() * Math.PI * 2;
        const yaw = view[0] + c.amplitude * Math.cos(dir);
        const pitch = Math.max(-40, Math.min(40, view[1] + c.amplitude * Math.sin(dir)));
        const worldRadius = 20 * Math.tan((c.width / 2) * (Math.PI / 180)); // W = angular diameter at d=20
        handle = scene.spawnTarget({ kind: 'static', yaw, pitch, distance: 20, worldRadius });
        presentedAt = now;
        reachFrames = [];
      };

      // The first stimulus is presented on the first frame, not eagerly, so presentedAt
      // carries the real arena clock. The clock runs from arena construction and never
      // resets, so stamping the first target with 0 made the opening tap of every trial
      // absorb the entire elapsed session. That error GREW as the session went on, so it
      // biased the located optimum toward whatever was measured early rather than adding
      // symmetric noise. Regression: tests/instruments/clock-stamp.test.ts.
      let opened = false;
      const offFrame = scene.onFrame((_dt, now) => {
        if (!opened) { opened = true; present(now); return; }
        if (handle) {
          reachFrames.push({ t: now, aim: scene.view(), target: handle.bearing(), targetRadius: handle.radiusDeg() });
        }
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
        const c = order[idx]!;
        const aim = scene.view();
        const tgt = handle.bearing();
        const radial = separation(aim, tgt);
        // ISO 9241-9 along-axis endpoint error: the miss (landing - target) PROJECTED onto the
        // start->target unit axis, + = overshoot. (The old proxy signed the TOTAL radial miss by
        // yaw order, so on near-vertical reaches the sign tracked the horizontal wobble - inflating
        // We and cancelling real bias out of Ae.)
        const errAlong = missComponents(presentAim, tgt, aim).radial;
        let nCorr = 0;
        try {
          nCorr = segment(countTrace(reachFrames, ctx.counts), { onsetThresh: ONSET_COUNTS_PER_SEC }).nCorr;
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
          const r = analyzeFlick(taps, ctx);
          // Disclose the discarded lead-in (protocol parameter, not a measurement).
          resolve({ ...r, raw: { ...r.raw, leadInTaps: plan.reaches }, at: now });
        } else {
          present(now);
        }
      });

    });
  },
};
