import { describe, it, expect } from 'vitest';
import { reconcile, ANCHOR_Z90, COMBINED_FLOOR_LOG_SD, type Anchor } from '../../src/anchor/reconcile';
import { TURN_PRIOR_LOG_SD, type TurnEstimate } from '../../src/anchor/reference-turn';
import type { FlickAnchor, FlickRefusal } from '../../src/anchor/flick-anchor';
import { counts360 } from '../../src/types';

const turn = (counts: number, logSd: number, agreed = true): TurnEstimate => ({
  counts: counts360(counts),
  spreadPct: (Math.exp(logSd) - 1) * 100,
  logSd,
  agreed,
  passes: 3,
});
const flick = (counts: number, logSd: number): FlickAnchor => ({
  identifiable: true,
  counts: counts360(counts),
  logSd,
  bias: Math.log(0.94),
  adaptRate: 0.6,
});
const refused: FlickRefusal = { identifiable: false, reason: 'no-covariance' };
const w = (logSd: number): number => 1 / (logSd * logSd);
const halfWidth = (a: Anchor): number => Math.log(a.ci90[1] / a.ci90[0]) / 2;
/** A weight a typical agreeing trio carries out of turnFromPasses. Not a floor applied here. */
const TURN_SD = 0.15;

describe('reconcile', () => {
  it('neither route means no anchor, not a guessed one', () => {
    expect(reconcile(null, refused)).toBeNull();
  });

  it('the turn alone reports the spread the passes measured, wide or narrow', () => {
    // No second floor here, deliberately. turnFromPasses already applies the ONE-SIDED shrinkage
    // toward TURN_PRIOR_LOG_SD, so its logSd can only have been pulled UP; flooring again would
    // overwrite a measured spread with a constant and put the one parameter the blind turn exists
    // to remove back on the critical path.
    const wide = TURN_PRIOR_LOG_SD * 2; // 0.30: a visibly sloppy trio, and its spread survives
    const sloppy = reconcile(turn(9000, wide), refused);
    if (sloppy === null) throw new Error('expected an anchor from the turn alone');
    expect(sloppy.sources).toEqual(['turn']);
    expect(sloppy.counts).toBeCloseTo(9000, 6);
    expect(sloppy.disagreementPct).toBeUndefined();
    expect(sloppy.ci90[0]).toBeCloseTo(9000 * Math.exp(-ANCHOR_Z90 * wide), 6);
    expect(sloppy.ci90[1]).toBeCloseTo(9000 * Math.exp(ANCHOR_Z90 * wide), 6);
    expect(halfWidth(sloppy)).toBeGreaterThan(ANCHOR_Z90 * TURN_PRIOR_LOG_SD);

    // And the tightest turnFromPasses can emit: three passes in perfect agreement still carry
    // (0 + TURN_PRIOR_LOG_SD) / 2 out of the one-sided shrinkage, so that is what is reported.
    const tight = TURN_PRIOR_LOG_SD / 2;
    const crisp = reconcile(turn(9000, tight), refused);
    if (crisp === null) throw new Error('expected an anchor from the turn alone');
    expect(halfWidth(crisp)).toBeCloseTo(ANCHOR_Z90 * tight, 9);
  });

  it('the flick alone reports its own measured spread', () => {
    const a = reconcile(null, flick(9200, 0.07));
    if (a === null) throw new Error('expected an anchor from the flick alone');
    expect(a.sources).toEqual(['flick']);
    expect(a.counts).toBeCloseTo(9200, 6);
    expect(a.ci90[1] / a.ci90[0]).toBeCloseTo(Math.exp(2 * ANCHOR_Z90 * 0.07), 6);
  });

  it('two agreeing routes combine by inverse variance in log space', () => {
    const a = reconcile(turn(9000, TURN_SD), flick(9200, 0.06));
    if (a === null) throw new Error('expected a combined anchor');
    expect(a.sources).toEqual(['turn', 'flick']);
    const expected = Math.exp(
      (w(TURN_SD) * Math.log(9000) + w(0.06) * Math.log(9200)) / (w(TURN_SD) + w(0.06)),
    );
    expect(a.counts).toBeCloseTo(expected, 6);
    expect(a.counts).toBeGreaterThan(9100); // leans to the tighter route, as it must
    expect(a.disagreementPct).toBeCloseTo((9200 / 9000 - 1) * 100, 6);
    // Two independent measurements legitimately beat either one, down to the floor and no further.
    expect(halfWidth(a)).toBeLessThan(ANCHOR_Z90 * 0.06);
    expect(halfWidth(a)).toBeGreaterThanOrEqual(ANCHOR_Z90 * COMBINED_FLOOR_LOG_SD - 1e-12);
  });

  it('the combined floor holds even when both routes claim absurd precision', () => {
    // Neither claim is floored on the way in - each estimator owns its own claim - so this is the
    // COMBINED floor doing the whole job: 3.1 percent is the best the pair has ever demonstrated,
    // and the inverse-variance algebra below that number is claiming precision, not measuring it.
    const a = reconcile(turn(9000, 0.001), flick(9000, 0.001));
    if (a === null) throw new Error('expected a combined anchor');
    expect(halfWidth(a)).toBeCloseTo(ANCHOR_Z90 * COMBINED_FLOOR_LOG_SD, 9);
  });

  it('disagreement beyond the combined precision unions the bands, and only ever widens', () => {
    const t = turn(9000, TURN_SD);
    const f = flick(13000, 0.06);
    const a = reconcile(t, f);
    if (a === null) throw new Error('expected a combined anchor');
    const turnLo = 9000 * Math.exp(-ANCHOR_Z90 * TURN_SD);
    const flickHi = 13000 * Math.exp(ANCHOR_Z90 * 0.06);
    expect(a.ci90[0]).toBeLessThanOrEqual(turnLo + 1e-9);
    expect(a.ci90[1]).toBeGreaterThanOrEqual(flickHi - 1e-9);
    expect(a.disagreementPct).toBeCloseTo((13000 / 9000 - 1) * 100, 6);
    // The point estimate is NOT moved. Moving it would need a story about which route is wrong, and
    // the disagreement is itself the measurement of the world-rotation versus screen-offset
    // mismatch, which is the reason both routes exist.
    const expected = Math.exp(
      (w(TURN_SD) * Math.log(9000) + w(0.06) * Math.log(13000)) / (w(TURN_SD) + w(0.06)),
    );
    expect(a.counts).toBeCloseTo(expected, 6);
  });

  it('widen only, as a property across the whole disagreement range', () => {
    const t = turn(9000, 0.12);
    let previousWidth = 0;
    for (const ratio of [1, 1.02, 1.05, 1.1, 1.2, 1.4, 1.8, 2.5]) {
      const a = reconcile(t, flick(9000 * ratio, 0.06));
      if (a === null) throw new Error(`expected an anchor at ratio ${ratio}`);
      const width = Math.log(a.ci90[1] / a.ci90[0]);
      expect(width, `ratio ${ratio}`).toBeGreaterThanOrEqual(previousWidth - 1e-12);
      previousWidth = width;
      expect(a.counts).toBeGreaterThanOrEqual(a.ci90[0]);
      expect(a.counts).toBeLessThanOrEqual(a.ci90[1]);
    }
  });

  it('a systematic shared by both routes moves the number and widens nothing', () => {
    // The limit of the combination, pinned rather than left implicit. Inverse variance narrows only
    // because the two routes' errors are assumed INDEPENDENT, and the disagreement channel can only
    // ever see the differential part: a factor common to both is invisible to it. So a shared
    // systematic lands whole on the point estimate and the interval does not notice. That is why
    // the copy may report a ratio and its spread and may not claim absolute accuracy, and it is
    // also why both routes exist at all - they fail differently, which is the only defence there is.
    const clean = reconcile(turn(9000, 0.12), flick(9200, 0.06));
    const shifted = reconcile(turn(9000 * 1.2, 0.12), flick(9200 * 1.2, 0.06));
    if (clean === null || shifted === null) throw new Error('expected both anchors');
    expect(shifted.counts / clean.counts).toBeCloseTo(1.2, 9);
    expect(halfWidth(shifted)).toBeCloseTo(halfWidth(clean), 9);
    expect(shifted.disagreementPct).toBeCloseTo(clean.disagreementPct!, 9);
  });

  it('a degenerate route is dropped rather than weighted', () => {
    expect(reconcile(turn(0, 0.1), refused)).toBeNull();
    expect(reconcile(turn(9000, Number.NaN), refused)).toBeNull();
    // A spread of exactly zero is a claim of infinite precision, and infinite weight would silence
    // the other route entirely. Dropped, exactly as the flick route's zero is.
    expect(reconcile(turn(9000, 0), refused)).toBeNull();
    const a = reconcile(turn(0, 0.1), flick(9200, 0.07));
    if (a === null) throw new Error('expected the flick to survive alone');
    expect(a.sources).toEqual(['flick']);
  });
});
