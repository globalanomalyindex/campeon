import { describe, it, expect } from 'vitest';
import { track } from '../../src/instruments/track';
import { flick } from '../../src/instruments/flick';
import { calibrate } from '../../src/instruments/calibrate';
import { strike } from '../../src/instruments/strike';
import {
  acclimationScale,
  leadInReaches,
  planAcclimation,
  LEAD_MS_MAX,
  LEAD_MS_MIN,
  LEAD_REACHES_MAX,
  LEAD_REACHES_MIN,
} from '../../src/instruments/acclimation';
import { mulberry32 } from '../../src/stats/bootstrap';
import { counts360 } from '../../src/types';
import type { InstrumentId, TrialContext, TrialResult } from '../../src/types';
import { FakeScene } from './fake-scene';

/**
 * The acclimation property (open-measurement-questions §2).
 *
 * Before the lead-in existed, every trial scored the player from their first movement at the
 * new gain, so a trial's score depended on HOW FAR the trial sat from the sensitivity the
 * player arrived with. The search is seeded at the player's own setting, so that placed an
 * artifact minimum exactly there - the output most likely to tell a player they were already
 * right, and the one a sceptic would use to dismiss the tool.
 *
 * The property that matters, asserted end to end here with a simulated ADAPTING player: the
 * same sensitivity, reached from a near neighbour or from far across the range, must score the
 * same within noise. The player model is the standard fast-process gain adaptation: the
 * player's believed gain starts at the arrival sensitivity and its log-error decays
 * geometrically per reach (discrete) or exponentially in time (tracking). A non-adapting
 * player (the decay switched off) keeps the assertions honest: for that player near and far
 * MUST still differ, proving the instruments are not simply blind to the errors we inject.
 */

const CM = counts360(34);
const FAR = CM * 4; // two octaves out - well past the full-budget threshold
const BETA = 0.35; // per-reach retention of the log-gain error (fast-process adaptation)
const TAU_MS = 500; // continuous-tracking decay time constant

const ctx = (rngSeed: number, prevCounts?: number): TrialContext => ({
  counts: CM,
  rng: mulberry32(rngSeed),
  profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
  ...(prevCounts !== undefined ? { prevCounts: counts360(prevCounts) } : {}),
});

/** Deterministic per-reach motor noise keyed on the TARGET OFFSET, so two runs whose scored
 *  targets draw the same offsets get the same noise even when their absolute views differ. */
function offsetNoise(dy: number, dp: number): [number, number] {
  const h1 = Math.sin(dy * 12.9898 + dp * 78.233) * 43758.5453;
  const h2 = Math.sin(dy * 39.3468 + dp * 11.135) * 24634.6345;
  return [((h1 - Math.floor(h1)) - 0.5) * 0.8, ((h2 - Math.floor(h2)) - 0.5) * 0.8];
}

interface DiscreteDrive {
  result: TrialResult;
  /** Every value the instrument consumed from the SHARED ctx.rng, in order. */
  rngLog: number[];
}

/** Drive a discrete instrument with a player whose believed gain arrived at `prev` and whose
 *  log-gain error decays by `beta` per completed reach. beta = 1 → a player who never adapts.
 *
 *  The player lands the first `leadReaches` (unscored) reaches back at the origin, so runs with
 *  DIFFERENT lead-in lengths enter the scored sequence from the identical view state. Without
 *  that, the two runs' views wander differently through the instruments' pitch clamps and the
 *  scored tasks genuinely differ in geometry - a fixture artifact that would mask the property
 *  under test (the internal gain state is the model's `eps`, which decays on every reach). */
async function driveDiscrete(
  instrument: { run(c: TrialContext, s: FakeScene): Promise<TrialResult> },
  prev: number,
  beta: number,
  prevCounts: number | undefined,
  leadReaches: number,
): Promise<DiscreteDrive> {
  const scene = new FakeScene();
  const rngLog: number[] = [];
  const base = mulberry32(7);
  const c: TrialContext = {
    ...ctx(7, prevCounts),
    rng: () => {
      const v = base();
      rngLog.push(v);
      return v;
    },
  };
  let out: TrialResult | null = null;
  const done = instrument.run(c, scene).then((r) => {
    out = r;
    return r;
  });
  let eps = Math.log(prev / CM); // believed-gain log error: + = arrived from a slower cm/360
  let played = 0;
  for (let guard = 0; guard < 400 && out === null; guard++) {
    if (scene.spawned.length > played) {
      const spec = scene.spawned[scene.spawned.length - 1]!;
      const start: [number, number] = [scene.view_[0], scene.view_[1]];
      const tgt: [number, number] = [spec.yaw ?? 0, spec.pitch ?? 0];
      const dy = tgt[0] - start[0];
      const dp = tgt[1] - start[1];
      const [na, nb] = offsetNoise(dy, dp);
      const rho = Math.exp(eps); // mis-calibrated gain: the reach over/undershoots by this factor
      const land: [number, number] =
        played < leadReaches
          ? [0, 0] // unscored lead-in reach: return to the canonical origin (see docstring)
          : [start[0] + dy * rho + na, start[1] + dp * rho + nb];
      scene.tick(60, [start[0] + (land[0] - start[0]) * 0.5, start[1] + (land[1] - start[1]) * 0.5]);
      scene.tick(60, land);
      scene.fire(land);
      eps *= beta;
      played += 1;
    } else {
      scene.tick(16);
    }
    await Promise.resolve();
  }
  return { result: await done, rngLog };
}

/** Drive track with a pursuit player whose closing gain is wrong by e^eps, eps decaying in time. */
async function driveTrack(prev: number, tauMs: number, prevCounts?: number): Promise<DiscreteDrive> {
  const scene = new FakeScene();
  const rngLog: number[] = [];
  const base = mulberry32(7);
  const c: TrialContext = {
    ...ctx(7, prevCounts),
    rng: () => {
      const v = base();
      rngLog.push(v);
      return v;
    },
  };
  let out: TrialResult | null = null;
  const done = track.run(c, scene).then((r) => {
    out = r;
    return r;
  });
  let eps = Math.log(prev / CM);
  let t = 0;
  let aim: [number, number] = [0, 0];
  const decay = tauMs === Infinity ? 1 : Math.exp(-16 / tauMs);
  for (let i = 0; i < 700 && out === null; i++) {
    t += 16;
    const b: [number, number] = [
      12 * Math.sin(2 * Math.PI * 0.5 * (t / 1000)),
      5 * Math.sin(2 * Math.PI * 0.4 * (t / 1000)),
    ];
    scene.moveTarget(b, 2.5);
    // Per-frame closing of 0.6 of the error, scaled by the believed-gain factor e^eps. At the
    // correct gain that is a well-damped pursuit; at 4x it is an UNSTABLE oscillator (per-frame
    // error factor |1 - 2.4| > 1), which is exactly what a badly mis-calibrated gain feels like.
    const rho = Math.exp(eps);
    aim = [aim[0] + (b[0] - aim[0]) * 0.6 * rho, aim[1] + (b[1] - aim[1]) * 0.6 * rho];
    scene.tick(16, aim);
    eps *= decay;
    await Promise.resolve();
  }
  return { result: await done, rngLog };
}

const relGap = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(a), 1e-9);

/** The lead-in length the instrument will actually discard for this arrival (the plan is pure). */
const leadOf = (id: InstrumentId, prev?: number): number => planAcclimation(ctx(1, prev), id).reaches;

describe('the acclimation property: same sensitivity, same score, whatever it was approached from', () => {
  const DISCRETE: ReadonlyArray<[InstrumentId, { run(c: TrialContext, s: FakeScene): Promise<TrialResult> }]> = [
    ['flick', flick],
    ['calibrate', calibrate],
    ['strike', strike],
  ];

  for (const [name, instrument] of DISCRETE) {
    it(`${name}: an adapting player scores the same arriving from near or from far`, async () => {
      const near = await driveDiscrete(instrument, CM, BETA, CM, leadOf(name, CM));
      const far = await driveDiscrete(instrument, FAR, BETA, FAR, leadOf(name, FAR));
      // Teeth: a player who NEVER adapts must still score materially worse from far - the
      // instrument is not blind to the gain errors this model injects.
      const stuckFar = await driveDiscrete(instrument, FAR, 1, FAR, leadOf(name, FAR));
      const stuckGap = relGap(near.result.score, stuckFar.result.score);
      const adaptGap = relGap(near.result.score, far.result.score);
      expect(stuckGap, `${name}: the fixture must be able to see a mis-calibrated gain`).toBeGreaterThan(0.15);
      expect(adaptGap, `${name}: score still depends on the approach distance`).toBeLessThan(0.05);
      expect(adaptGap).toBeLessThan(stuckGap / 5);
    });

    it(`${name}: the lead-in never touches the shared rng stream (scored geometry is approach-invariant)`, async () => {
      const near = await driveDiscrete(instrument, CM, BETA, CM, leadOf(name, CM));
      const far = await driveDiscrete(instrument, FAR, BETA, FAR, leadOf(name, FAR));
      const unknown = await driveDiscrete(instrument, FAR, BETA, undefined, leadOf(name));
      // The values consumed from ctx.rng - which fully determine the scored presentation - are
      // identical whatever the arrival gain, and whether it is known at all.
      expect(far.rngLog).toEqual(near.rngLog);
      expect(unknown.rngLog).toEqual(near.rngLog);
    });
  }

  it('track: an adapting player scores the same arriving from near or from far', async () => {
    const near = await driveTrack(CM, TAU_MS, CM);
    const far = await driveTrack(FAR, TAU_MS, FAR);
    const stuckFar = await driveTrack(FAR, Infinity, FAR);
    const stuckGap = relGap(near.result.score, stuckFar.result.score);
    const adaptGap = relGap(near.result.score, far.result.score);
    expect(stuckGap, 'track: the fixture must be able to see a mis-calibrated gain').toBeGreaterThan(0.15);
    expect(adaptGap, 'track: score still depends on the approach distance').toBeLessThan(0.05);
    expect(adaptGap).toBeLessThan(stuckGap / 5);
  });

  it('track: the moving-target seed is the first shared draw, whatever the arrival gain', async () => {
    const near = await driveTrack(CM, TAU_MS, CM);
    const far = await driveTrack(FAR, TAU_MS, FAR);
    const unknown = await driveTrack(FAR, TAU_MS, undefined);
    expect(near.rngLog.length).toBe(1); // the one motion-seed draw - the lead-in adds none
    expect(far.rngLog).toEqual(near.rngLog);
    expect(unknown.rngLog).toEqual(near.rngLog);
  });

  it('a trial is deterministic: the same context twice yields the identical result', async () => {
    const a = await driveDiscrete(calibrate, FAR, BETA, FAR, leadOf('calibrate', FAR));
    const b = await driveDiscrete(calibrate, FAR, BETA, FAR, leadOf('calibrate', FAR));
    expect(b.result.score).toBe(a.result.score);
    expect(b.result.raw).toEqual(a.result.raw);
  });
});

describe('the lead-in budget adapts to the size of the gain change, and is disclosed', () => {
  it('acclimationScale: 0 at no change, linear in octaves, saturating at two, full when unknown', () => {
    expect(acclimationScale(ctx(1, CM))).toBe(0);
    expect(acclimationScale(ctx(1, CM * 2))).toBeCloseTo(0.5, 12); // one octave
    expect(acclimationScale(ctx(1, CM / 2))).toBeCloseTo(0.5, 12); // symmetric in direction
    expect(acclimationScale(ctx(1, CM * 4))).toBeCloseTo(1, 12); // two octaves = saturation
    expect(acclimationScale(ctx(1, CM * 8))).toBe(1); // capped beyond
    expect(acclimationScale(ctx(1, CM * Math.SQRT2))).toBeCloseTo(0.25, 12); // half an octave
    expect(acclimationScale(ctx(1))).toBe(1); // unknown arrival = far jump
    expect(acclimationScale(ctx(1, 0))).toBe(1); // degenerate arrival = far jump
  });

  it('planAcclimation interpolates the budget on that scale', () => {
    expect(planAcclimation(ctx(1, CM), 'flick').reaches).toBe(LEAD_REACHES_MIN);
    expect(planAcclimation(ctx(1, FAR), 'flick').reaches).toBe(LEAD_REACHES_MAX);
    expect(planAcclimation(ctx(1), 'flick').reaches).toBe(LEAD_REACHES_MAX);
    expect(planAcclimation(ctx(1, CM * 2), 'flick').reaches).toBe(3); // one octave = three reaches
    expect(planAcclimation(ctx(1, CM * Math.SQRT2), 'flick').reaches).toBe(2);
    expect(planAcclimation(ctx(1, CM), 'track').ms).toBe(LEAD_MS_MIN);
    expect(planAcclimation(ctx(1), 'track').ms).toBe(LEAD_MS_MAX);
    expect(planAcclimation(ctx(1, CM * 2), 'track').ms).toBe(
      Math.round(LEAD_MS_MIN + (LEAD_MS_MAX - LEAD_MS_MIN) * 0.5),
    );
  });

  it('the private lead-in rng is deterministic and is not the shared stream', () => {
    const a = planAcclimation(ctx(1, FAR), 'calibrate');
    const b = planAcclimation(ctx(2, FAR), 'calibrate'); // different SESSION stream, same trial identity
    const seqA = [a.rng(), a.rng(), a.rng()];
    const seqB = [b.rng(), b.rng(), b.rng()];
    expect(seqB).toEqual(seqA); // private geometry does not depend on the session stream
    const shared = mulberry32(1);
    expect(seqA).not.toEqual([shared(), shared(), shared()]);
  });

  it('each instrument discloses how much it discarded in raw (self-describing export)', async () => {
    const farFlick = (await driveDiscrete(flick, FAR, BETA, FAR, leadOf('flick', FAR))).result;
    const nearFlick = (await driveDiscrete(flick, CM, BETA, CM, leadOf('flick', CM))).result;
    expect(farFlick.raw.leadInTaps).toBe(LEAD_REACHES_MAX);
    expect(nearFlick.raw.leadInTaps).toBe(LEAD_REACHES_MIN);
    const farCal = (await driveDiscrete(calibrate, FAR, BETA, FAR, leadOf('calibrate', FAR))).result;
    expect(farCal.raw.leadInShots).toBe(LEAD_REACHES_MAX);
    const farStrike = (await driveDiscrete(strike, FAR, BETA, FAR, leadOf('strike', FAR))).result;
    expect(farStrike.raw.leadInShots).toBe(LEAD_REACHES_MAX);
    const farTrack = (await driveTrack(FAR, TAU_MS, FAR)).result;
    expect(farTrack.raw.leadInMs).toBe(LEAD_MS_MAX);
    const nearTrack = (await driveTrack(CM, TAU_MS, CM)).result;
    expect(nearTrack.raw.leadInMs).toBe(LEAD_MS_MIN);
  });
});

describe('the lead-in budget is a pure query, because the observational channel needs it', () => {
  it('leadInReaches agrees with the plan for every arrival', () => {
    for (const prev of [CM, CM * 2, CM * Math.SQRT2, CM / 4, FAR, undefined]) {
      const c = ctx(1, prev);
      expect(leadInReaches(c), `arrival ${String(prev)}`).toBe(planAcclimation(c, 'flick').reaches);
    }
    expect(leadInReaches(ctx(1, CM))).toBe(LEAD_REACHES_MIN);
    expect(leadInReaches(ctx(1))).toBe(LEAD_REACHES_MAX);
  });

  it('it does not depend on the instrument, because the reversal it serves does not', () => {
    // The observational channel labels reach ORDINALS, and the ordinal of the first reach at a new
    // gain is 0 whichever instrument is presenting it. A signature that took an InstrumentId would
    // invite a per-instrument budget that the adaptation literature does not support.
    const c = ctx(1, FAR);
    expect(leadInReaches(c)).toBe(planAcclimation(c, 'strike').reaches);
    expect(leadInReaches(c)).toBe(planAcclimation(c, 'calibrate').reaches);
  });
});
