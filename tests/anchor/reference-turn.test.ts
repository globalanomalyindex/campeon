import { describe, it, expect } from 'vitest';
import { turnFromPasses, TURN_PRIOR_LOG_SD, TURN_AGREE_SPREAD_PCT } from '../../src/anchor/reference-turn';

describe('turnFromPasses: refusals', () => {
  it('returns null under three passes, never a number', () => {
    expect(turnFromPasses([])).toBeNull();
    expect(turnFromPasses([8000])).toBeNull();
    expect(turnFromPasses([8000, 8100])).toBeNull();
  });

  it('returns null on any non-finite or non-positive pass instead of filtering it out', () => {
    // Filtering would fabricate agreement out of a broken recording; the estimator refuses instead.
    expect(turnFromPasses([8000, 0, 8100])).toBeNull();
    expect(turnFromPasses([8000, -50, 8100])).toBeNull();
    expect(turnFromPasses([8000, Number.NaN, 8100])).toBeNull();
    expect(turnFromPasses([8000, Number.POSITIVE_INFINITY, 8100])).toBeNull();
  });
});

describe('turnFromPasses: the estimate', () => {
  it('identical passes: exact counts, zero spread, agreed, and the weight lifted to half the prior', () => {
    const est = turnFromPasses([8000, 8000, 8000])!;
    expect(est).not.toBeNull();
    expect(est.counts).toBeCloseTo(8000, 6);
    expect(est.spreadPct).toBeCloseTo(0, 9);
    // Zero self-measured sd still lands at half the prior: the shrinkage is one-sided, so a lucky
    // triple is pulled UP toward the prior rather than earning a zero-width weight.
    expect(est.logSd).toBeCloseTo(TURN_PRIOR_LOG_SD / 2, 12);
    expect(est.agreed).toBe(true);
    expect(est.passes).toBe(3);
  });

  it('combines in log space: the counts are the geometric mean, not the arithmetic one', () => {
    // Reproduction error is multiplicative and the optimizer searches ln space, so an arithmetic
    // mean here (9333) would bias the seed high on every asymmetric triple.
    const est = turnFromPasses([4000, 8000, 16000])!;
    expect(est.counts).toBeCloseTo(8000, 6);
  });

  it('pulls an over-confident spread up toward the prior, halfway', () => {
    // Log sd exactly 0.1 by construction, below the 0.15 prior: three samples make a terrible
    // variance estimate, so an implausibly tight trio is regularized up to (0.1 + prior) / 2.
    const passes = [9, 9.1, 9.2].map((l) => Math.exp(l));
    expect(turnFromPasses(passes)!.logSd).toBeCloseTo((0.1 + TURN_PRIOR_LOG_SD) / 2, 9);
  });

  it('never narrows a spread wider than the prior: the measured sd stands', () => {
    // Log sd exactly 0.3 by construction. Two-sided shrinkage would report (0.3 + 0.15) / 2 =
    // 0.225, a spread 25 percent tighter than measured. reconcile builds the turn-alone ci90
    // straight from this number, so narrowing here IS interval-narrowing, and the canon says
    // intervals widen, never narrow. Do not "restore the symmetric average" for elegance.
    const passes = [9, 9.3, 9.6].map((l) => Math.exp(l));
    const est = turnFromPasses(passes)!;
    expect(est.logSd).toBeCloseTo(0.3, 9);
    expect(est.logSd).toBeGreaterThan((0.3 + TURN_PRIOR_LOG_SD) / 2); // the two-sided value is the defect
  });

  it('flags disagreement beyond the threshold but still reports the spread honestly', () => {
    const est = turnFromPasses([8000, 8000, 10000])!;
    expect(est.agreed).toBe(false);
    expect(est.spreadPct).toBeGreaterThan(TURN_AGREE_SPREAD_PCT);
    // No outlier drop at exactly three: the outlier and the spread are indistinguishable, and two
    // sloppy passes voting out the honest one would manufacture agreement.
    expect(est.passes).toBe(3);
  });
});

describe('turnFromPasses: the fourth pass', () => {
  it('a fourth pass isolates the odd one out, and passes says the estimate rests on three', () => {
    const est = turnFromPasses([8000, 8000, 10000, 8100])!;
    expect(est.agreed).toBe(true);
    expect(est.passes).toBe(3);
    const expected = Math.exp((Math.log(8000) + Math.log(8000) + Math.log(8100)) / 3);
    expect(est.counts).toBeCloseTo(expected, 6);
  });

  it('a fourth pass that cannot isolate one outlier keeps all passes and stays disagreed', () => {
    // Two passes sit beyond the reject distance from the median, so dropping them would leave
    // fewer than three survivors: the drop is skipped, the spread stands, and the view blocks
    // rather than averages.
    const est = turnFromPasses([8000, 9500, 11000, 6500])!;
    expect(est.agreed).toBe(false);
    expect(est.passes).toBe(4);
  });
});
