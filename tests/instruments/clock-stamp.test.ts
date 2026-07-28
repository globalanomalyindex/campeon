import { describe, it, expect } from 'vitest';
import { counts360 } from '../../src/types';
import { flick } from '../../src/instruments/flick';
import { calibrate } from '../../src/instruments/calibrate';
import { strike } from '../../src/instruments/strike';
import { mulberry32 } from '../../src/stats/bootstrap';
import type { TrialContext, TrialResult } from '../../src/types';
import { FakeScene } from './fake-scene';

/**
 * Clock-offset invariance.
 *
 * The arena clock starts at arena construction and never resets, so by the twentieth
 * trial of a session it reads several minutes. Three instruments used to present their
 * FIRST target with `present(0)`, which stamped `presentedAt = 0` while every duration
 * was measured against that running clock. The opening tap of each trial therefore
 * recorded a movement time equal to the whole elapsed session.
 *
 * The damage was not symmetric noise. The error grew as the session went on, so trials
 * run late scored systematically worse than trials run early, which biased the located
 * cm/360 optimum toward whatever the optimiser happened to sample first. The suite
 * missed it because a stub scene also starts at 0, making `present(0)` accidentally
 * correct in every test.
 *
 * The property that actually matters, and the one asserted here: a trial's score must
 * not depend on when in the session it was run. Same script, same result.
 */

const ctx = (): TrialContext => ({
  counts: counts360(34),
  rng: mulberry32(9),
  profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
});

interface Instrument { run(c: TrialContext, s: FakeScene): Promise<TrialResult> }

/** Drive one trial to completion on a scene whose clock already reads `startClock`. */
async function runFrom(instrument: Instrument, startClock: number): Promise<TrialResult> {
  const scene = new FakeScene();
  scene.now = startClock;

  let out: TrialResult | null = null;
  const done = instrument.run(ctx(), scene).then((r) => { out = r; return r; });

  // A fixed script: settle for a few frames, walk the aim onto the target, then fire.
  for (let i = 0; i < 600 && out === null; i++) {
    scene.tick(16);
    scene.tick(16);
    scene.tick(16);
    scene.fire();
    await Promise.resolve();
  }
  return done;
}

const INSTRUMENTS: ReadonlyArray<[string, Instrument]> = [
  ['flick', flick as Instrument],
  ['calibrate', calibrate as Instrument],
  ['strike', strike as Instrument],
];

// Five minutes in, which is a realistic late-session clock for this app.
const MID_SESSION = 300_000;

describe('a trial scores the same wherever it lands in the session', () => {
  for (const [name, instrument] of INSTRUMENTS) {
    it(`${name}: score and raw metrics are invariant to the session clock offset`, async () => {
      const fresh = await runFrom(instrument, 0);
      const late = await runFrom(instrument, MID_SESSION);

      expect(late.score, `${name} score drifted with the clock`).toBeCloseTo(fresh.score, 10);
      expect(Object.keys(late.raw).sort()).toEqual(Object.keys(fresh.raw).sort());
      for (const k of Object.keys(fresh.raw)) {
        expect(late.raw[k], `${name}.raw.${k} drifted with the clock`).toBeCloseTo(fresh.raw[k]!, 6);
      }
    });

    it(`${name}: records no duration anywhere near the session clock`, async () => {
      const late = await runFrom(instrument, MID_SESSION);
      // Every raw metric is a duration, a rate, an error or a count. None of them can
      // legitimately approach five minutes, so a value at that scale is the stamp bug.
      for (const [k, v] of Object.entries(late.raw)) {
        expect(Math.abs(v), `${name}.raw.${k} = ${v} looks like an absolute clock reading`)
          .toBeLessThan(MID_SESSION / 10);
      }
      expect(Number.isFinite(late.score)).toBe(true);
    });
  }
});
