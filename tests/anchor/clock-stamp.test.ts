import { describe, it, expect } from 'vitest';
import { PRIMARY_TROUGH_DROP, ReachObserver, type ObservedReach } from '../../src/anchor/reach-observer';
import { anchorFromReaches, type FirstReach } from '../../src/anchor/flick-anchor';
import { reconcile } from '../../src/anchor/reconcile';
import type { TurnEstimate } from '../../src/anchor/reference-turn';
import { countTrace, type Frame } from '../../src/instruments/recording';
import { ONSET_COUNTS_PER_SEC, segment } from '../../src/scoring/submovement';
import { mulberry32 } from '../../src/stats/rng';
import { counts360 } from '../../src/types';
import type { Counts360, Ms, TargetHandle } from '../../src/types';
import { FakeScene } from '../instruments/fake-scene';

/**
 * Clock-offset invariance for the anchor, following tests/instruments/clock-stamp.test.ts.
 *
 * The arena clock starts at arena construction and never resets, so by the twentieth trial it reads
 * several minutes. Three instruments once stamped their first target at 0 while measuring durations
 * against that running clock, and the damage was asymmetric: late trials scored worse than early
 * ones, which biased the located optimum toward whatever the optimiser sampled first. The suite
 * missed it because a stub scene also starts at 0.
 *
 * The anchor is the new consumer of that clock. It stamps every frame with it and then locates the
 * landing frame by EXACT equality against SubmovementSeg.troughTime. Nothing it reports may depend
 * on where the clock started, so the same session is driven from four origins and every reading is
 * compared. One origin is deliberately FRACTIONAL, because that is where the frame deltas countTrace
 * divides by can differ in their last bit from run to run.
 *
 * Note what is NOT asserted: that last-bit difference in the deltas is real, so the speed trace is
 * not identical across origins. The assertions are on the OUTPUTS, which are built from the aim
 * samples and carry no timestamp at all.
 *
 * THE TICK SEQUENCE IS SEEDED AND IRREGULAR, AND THAT IS LOAD BEARING. Do not simplify it back.
 *
 * The first version of this fixture ticked a uniform 16 ms, and with it this file could not fail.
 * Breaking the landing lookup on purpose, by recomputing the stamp as `seg.onsetTime + seg.tO`
 * instead of reading `seg.troughTime`, still passed every test here. Two structural reasons:
 *
 *   1. 16 is a power of two, so a uniform 16 ms clock stamps only exactly representable values and
 *      every difference between two of them is exact. requestAnimationFrame does not tick 16.
 *   2. `tO` is defined as `troughTime - onsetTime`, so the recomputation is `a + (b - a)`. Whenever
 *      the two stamps are within a factor of two of each other that subtraction is exact by
 *      Sterbenz's lemma, and the readdition then returns `b` on the nose. A reach here lasts about
 *      80 ms, so a clock that already reads 300,000 puts every onset far inside a factor of two of
 *      its own trough: the OFFSET runs are exactly where the readdition cannot fail. It can fail
 *      only near the origin, where the opening reach's onset (about 47 ms) is less than half its
 *      trough (about 126 ms) and the subtraction has to round.
 *
 * So the broken lookup is caught by the run at zero, not by the run at 987.6543, which is the
 * reverse of the guess this test was commissioned on, and catching it needs a clock whose stamps
 * are not dyadic. Hence the seed: TICK_SEED is the smallest seed for which the opening reach's own
 * onset and trough pair fails the readdition under the nominal and jitter below. With it the broken
 * lookup drops that one reach from the base run alone, the base and offset readings stop matching,
 * and every test in this file fails. Picking a seed rather than trusting chance is deliberate: only
 * about one pair in a hundred misses, and only a session's opening reach is even eligible for the
 * miss, so a fixture that merely hoped would need hundreds of reaches and would still flake.
 *
 * 'the fixture's own clock still kills the readdition' asserts that eligibility directly. Restoring
 * a uniform tick, or retuning the amplitudes until the seed goes stale, therefore fails loudly here
 * instead of quietly emptying every other assertion in the file.
 */

const FRACTIONS = [0, 0.06, 0.26, 0.44, 0.18, 0.04, 0.02, 0.12, 0.05, 0.01] as const;
const LEVELS = [6300, 7200, 8100, 9000, 9900, 10800, 11700, 12600];
const TRIALS = 24;
const REACHES_PER_TRIAL = 4;
const LEAD_IN = 2;
const BELIEF = 9000;
const RATE = 0.6; // per-reach retention of the log belief error, so the fit is identifiable
const AMPLITUDE = 30;

const TICK_SEED = 386;
const TICK_MS = 16.7; // nominal 60 Hz frame, and not a power of two
const TICK_JITTER_MS = 2.2;

/**
 * The irregular frame clock, reseeded per run so every origin sees the same deltas.
 *
 * The jitter is bounded well inside the shape of the reach above rather than left free. The
 * per-frame speeds are the FRACTIONS divided by their own delta, the tightest ratio between
 * neighbouring fractions is 1.7 (0.26 then 0.44), and the widest ratio two deltas can have here is
 * 18.9 over 14.5, which is 1.30. No draw can therefore reorder the primary peak or the trough, and
 * the reach reads the same landed fraction at every origin. A wilder clock, or a dropped frame at
 * double the nominal, would move the trough for some reaches and some origins and the invariance
 * assertions would then be failing on the fixture rather than on the code.
 */
function frameDeltas(seed: number): () => Ms {
  const rnd = mulberry32(seed);
  return () => TICK_MS + TICK_JITTER_MS * (2 * rnd() - 1);
}

/** One reach's frames, kept beside the gain its trial rendered, for the seed guard below. */
interface ReachFrames {
  rendered: Counts360;
  frames: Frame[];
}

interface AnchorRun {
  observed: ObservedReach[];
  reaches: FirstReach[];
  discarded: number;
  reachFrames: ReachFrames[];
}

/** Drive a whole session's reaches on a scene whose clock already reads `startClock`. */
function runFrom(startClock: number): AnchorRun {
  const scene = new FakeScene();
  scene.now = startClock;
  const tick = frameDeltas(TICK_SEED);
  let handle: TargetHandle | null = null;
  let rendered = counts360(LEVELS[0]!);
  const obs = new ReachObserver(scene, () => handle);

  // A second listener on the same frame stream, buffering each reach's stamps. It is not a second
  // copy of the observer and reads nothing: it exists so the seed guard can ask the segmenter which
  // two stamps this fixture actually hands the landing lookup, without reaching into private state.
  const reachFrames: ReachFrames[] = [];
  let open: Frame[] = [];
  let openId: string | null = null;
  const closeFrames = (): void => {
    if (open.length > 0) reachFrames.push({ rendered, frames: open });
    open = [];
  };
  scene.onFrame((_dt, now) => {
    const tgt = handle;
    if (tgt === null) {
      closeFrames();
      openId = null;
      return;
    }
    if (tgt.id !== openId) {
      closeFrames();
      openId = tgt.id;
    }
    open.push({ t: now, aim: scene.view(), target: tgt.bearing(), targetRadius: tgt.radiusDeg() });
  });

  for (let t = 0; t < TRIALS; t++) {
    rendered = counts360(LEVELS[t % LEVELS.length]!);
    obs.beginTrial(rendered, LEAD_IN);
    const e0 = Math.log(BELIEF / rendered);
    for (let r = 0; r < REACHES_PER_TRIAL; r++) {
      // The believed gain decays geometrically toward the rendered one, reach by reach.
      const primary = AMPLITUDE * Math.exp(e0 * Math.pow(RATE, r));
      handle = scene.spawnTarget({ kind: 'static', yaw: AMPLITUDE, pitch: 0, distance: 20, worldRadius: 0.6 });
      let yaw = 0;
      for (const share of FRACTIONS) {
        scene.tick(tick(), [yaw, 0]);
        yaw += share * primary;
      }
      handle = null;
      scene.tick(tick(), [yaw, 0]); // closes the reach
      scene.tick(tick(), [0, 0]); // back to the origin with no target: discarded, not a reach
    }
  }
  obs.stop();
  closeFrames();
  return { observed: [...obs.observed()], reaches: obs.reaches(), discarded: obs.discardedByScoring(), reachFrames };
}

/**
 * What a landing lookup keyed on `onsetTime + tO` would do with this reach: find the stamp, miss it
 * by an ulp and drop the reach, or find no reach to read at all. The segmenter's options are the
 * observer's own (src/anchor/reach-observer.ts primaryTroughTime), so the two stamps are the ones
 * the observer really uses.
 */
function readdition(r: ReachFrames): 'exact' | 'misses' | 'unreadable' {
  try {
    const seg = segment(countTrace(r.frames, r.rendered), {
      onsetThresh: ONSET_COUNTS_PER_SEC,
      troughDrop: PRIMARY_TROUGH_DROP,
    });
    if (seg.tC <= 0) return 'unreadable';
    return seg.onsetTime + seg.tO === seg.troughTime ? 'exact' : 'misses';
  } catch {
    return 'unreadable';
  }
}

const TURN: TurnEstimate = {
  counts: counts360(9200),
  spreadPct: 4.1,
  logSd: 0.09,
  agreed: true,
  passes: 3,
};

// Five minutes in; a late-session clock; and a fractional origin no frame interval divides.
const OFFSETS = [300_000, 1_234_567, 987.6543];

describe('the anchor reads the same session wherever the arena clock started', () => {
  const base = runFrom(0);

  it('the session it is built on is readable at all, so the test cannot pass vacuously', () => {
    expect(base.reaches).toHaveLength(TRIALS * REACHES_PER_TRIAL);
    expect(base.discarded).toBe(TRIALS * LEAD_IN);
    expect(base.observed.slice(0, REACHES_PER_TRIAL).map((r) => r.index)).toEqual([0, 1, 2, 3]);
    const a = anchorFromReaches(base.reaches);
    if (a.identifiable !== true) throw new Error(`expected identifiable, got refusal: ${a.reason}`);
    expect(a.counts / BELIEF).toBeGreaterThan(0.97);
    expect(a.counts / BELIEF).toBeLessThan(1.03);
  });

  it("the fixture's own clock still kills the readdition, so the seed cannot go stale", () => {
    const verdicts = base.reachFrames.map(readdition);
    expect(verdicts).toHaveLength(TRIALS * REACHES_PER_TRIAL);
    // Every reach is readable, so a dropped reach below is a dropped stamp and never a dead fixture.
    expect(verdicts).not.toContain('unreadable');
    // And at least one of them would be lost by a lookup that recomputed the stamp. See the seed
    // note at the top of this file: without this, every assertion below passes on a broken lookup.
    expect(verdicts).toContain('misses');
  });

  for (const offset of OFFSETS) {
    it(`every reach reads identically at a clock offset of ${offset}`, () => {
      const late = runFrom(offset);
      expect(late.observed).toEqual(base.observed);
      expect(late.reaches).toEqual(base.reaches);
      expect(late.discarded).toBe(base.discarded);
      // The teeth for the exact-equality frame lookup: a missed stamp drops the reach silently, so
      // a lost reach shows up here as a length change rather than as a wrong number.
      expect(late.reaches).toHaveLength(base.reaches.length);
    });

    it(`the anchor and the reconciliation are identical at a clock offset of ${offset}`, () => {
      const late = runFrom(offset);
      expect(anchorFromReaches(late.reaches)).toEqual(anchorFromReaches(base.reaches));
      expect(reconcile(TURN, anchorFromReaches(late.reaches))).toEqual(
        reconcile(TURN, anchorFromReaches(base.reaches)),
      );
    });
  }
});
