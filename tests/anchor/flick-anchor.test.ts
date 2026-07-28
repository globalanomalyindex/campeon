import { describe, it, expect } from 'vitest';
import {
  anchorFromReaches,
  ADAPT_RATE_MAX,
  ADAPT_RATE_MIN,
  FLICK_FLOOR_LOG_SD,
  FLICK_MIN_LEVELS,
  FLICK_MIN_REACHES,
  type FirstReach,
} from '../../src/anchor/flick-anchor';
import { counts360 } from '../../src/types';
import { mulberry32 } from '../../src/stats/rng';

const TRUE_B0 = 9000;
const TRUE_BIAS = Math.log(0.94); // a 6 percent deliberate undershoot, the cheap correction
const TRUE_RATE = 0.6;
const LEVELS = [6300, 7200, 8100, 9000, 9900, 10800, 11700, 12600]; // the searched band, 2x wide
const TRIALS = 24; // past the 22-trial plateau
const PER_TRIAL = 12;

const gauss = (r: () => number): number => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

/** An adapting player with a stable belief, a persistent undershoot, and flick noise. */
function simulate(opts: { rate?: number; noise?: number; seed?: number; trials?: number; levels?: number[] } = {}): FirstReach[] {
  const rate = opts.rate ?? TRUE_RATE;
  const noise = opts.noise ?? 0.08;
  const levels = opts.levels ?? LEVELS;
  const rng = mulberry32(opts.seed ?? 0xa11c);
  const out: FirstReach[] = [];
  for (let t = 0; t < (opts.trials ?? TRIALS); t++) {
    const rendered = levels[t % levels.length]!;
    const e0 = Math.log(TRUE_B0) - Math.log(rendered);
    for (let j = 0; j < PER_TRIAL; j++) {
      const lnF = e0 * Math.pow(rate, j) + TRUE_BIAS + noise * gauss(rng);
      out.push({ rendered: counts360(rendered), landedFraction: Math.exp(lnF), index: j });
    }
  }
  return out;
}

describe('anchorFromReaches', () => {
  it('recovers a known adapting player from every reach of every trial', () => {
    const a = anchorFromReaches(simulate());
    if (a.identifiable !== true) throw new Error(`expected identifiable, got refusal: ${a.reason}`);
    expect(a.counts / TRUE_B0).toBeGreaterThan(0.94);
    expect(a.counts / TRUE_B0).toBeLessThan(1.06);
    expect(a.adaptRate).toBeGreaterThan(TRUE_RATE - 0.15);
    expect(a.adaptRate).toBeLessThan(TRUE_RATE + 0.15);
    expect(a.bias).toBeGreaterThan(TRUE_BIAS - 0.06);
    expect(a.bias).toBeLessThan(TRUE_BIAS + 0.06);
    // The interval covers the truth, and never claims better than the 4.6 percent the estimator
    // has actually demonstrated across simulated sessions.
    expect(a.logSd).toBeGreaterThanOrEqual(FLICK_FLOOR_LOG_SD);
    expect(Math.abs(Math.log(a.counts / TRUE_B0))).toBeLessThan(3 * a.logSd);
  });

  it('is deterministic: the same reaches twice give the identical object', () => {
    expect(anchorFromReaches(simulate())).toEqual(anchorFromReaches(simulate()));
  });

  it('the reach ordinal is load-bearing, and flattening it collapses the design', () => {
    // With every ordinal 0 the adaptation column is all ones, identical to the intercept, so belief
    // and bias are the same column. Two of three parameters is not the estimator; it refuses.
    const flat = simulate().map((r) => ({ ...r, index: 0 }));
    expect(anchorFromReaches(flat)).toEqual({ identifiable: false, reason: 'too-few-reaches' });
  });

  it('using only the opening reach of each trial is not enough data to speak', () => {
    // 13.7 percent MAE against 4.6 for every reach: the first-reach-only estimator was measured and
    // rejected. The refusal floor makes reintroducing it impossible by accident rather than by memo.
    const openersOnly = simulate().filter((r) => r.index === 0);
    expect(openersOnly.length).toBeLessThan(FLICK_MIN_REACHES);
    expect(anchorFromReaches(openersOnly)).toEqual({ identifiable: false, reason: 'too-few-reaches' });
  });

  it('the constants are the ones the comments justify', () => {
    expect(FLICK_MIN_REACHES).toBe(40);
    expect(FLICK_MIN_LEVELS).toBe(6);
    expect(ADAPT_RATE_MIN).toBe(0.05);
    expect(ADAPT_RATE_MAX).toBe(0.95);
    expect(FLICK_FLOOR_LOG_SD).toBeCloseTo(0.058, 12);
  });
});
