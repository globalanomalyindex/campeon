import { describe, it, expect } from 'vitest';
import {
  anchorFromReaches,
  FLICK_MIN_LEVELS,
  FLICK_MIN_REACHES,
  RATE_SSE_DROP_MIN,
  type FirstReach,
} from '../../src/anchor/flick-anchor';
import { counts360 } from '../../src/types';
import { mulberry32 } from '../../src/stats/rng';

const LEVELS = [6300, 7200, 8100, 9000, 9900, 10800, 11700, 12600];
const TRUE_B0 = 9000;
const BIAS = Math.log(0.94);
const gauss = (r: () => number): number => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

/**
 * Build a session's reaches from an explicit per-reach log fraction, so each player below is stated
 * as a formula rather than as a fixture nobody can check.
 */
function session(
  lnFraction: (e0: number, j: number, rng: () => number) => number,
  opts: { trials?: number; perTrial?: number; levels?: number[]; seed?: number } = {},
): FirstReach[] {
  const levels = opts.levels ?? LEVELS;
  const rng = mulberry32(opts.seed ?? 0x5eed);
  const out: FirstReach[] = [];
  for (let t = 0; t < (opts.trials ?? 24); t++) {
    const rendered = levels[t % levels.length]!;
    const e0 = Math.log(TRUE_B0) - Math.log(rendered);
    for (let j = 0; j < (opts.perTrial ?? 12); j++) {
      out.push({ rendered: counts360(rendered), landedFraction: Math.exp(lnFraction(e0, j, rng)), index: j });
    }
  }
  return out;
}

describe('the flick anchor refuses rather than returning a plausible wrong number', () => {
  it('no signal at all: it refuses instead of answering with 28 percent error', () => {
    // The measured failure it exists to prevent: with landedFraction independent of the rendered
    // gain the estimator returned 28 percent mean absolute error and a minus 43 to plus 61 percent
    // range, confidently. The number it would produce here is not a worse estimate, it is not an
    // estimate. Do not replace this refusal with a wide interval: a wide interval on a number with
    // no signal still puts a number on the screen.
    const noSignal = session((_e0, _j, rng) => BIAS + 0.12 * gauss(rng));
    expect(anchorFromReaches(noSignal)).toEqual({ identifiable: false, reason: 'no-covariance' });
  });

  it('a covariance with the wrong sign refuses, because it is evidence of something else', () => {
    // One-sided by design. A positive slope on ln(rendered) cannot come from a belief mismatch, so
    // fitting it would produce a confident answer about a mechanism that is not the one modelled.
    const flipped = session((e0, j, rng) => -e0 * Math.pow(0.6, j) + BIAS + 0.05 * gauss(rng));
    expect(anchorFromReaches(flipped)).toEqual({ identifiable: false, reason: 'no-covariance' });
  });

  it('no stable belief: the flat rate profile refuses, where the argmin alone would answer', () => {
    // This player re-anchors on whatever was just rendered, so the belief error is gone by the
    // second reach of the trial and every later reach is pure motor bias. Simulation put them at
    // 12.7 percent while the estimator STILL ANSWERED, which is why this is a refusal and not a
    // warning. Truth here is rate = 0, but the fit does NOT reliably land there: on this exact
    // fixture the profiled argmin is 0.075, above ADAPT_RATE_MIN, because the profile is nearly
    // flat (SSE 0.749588 at the argmin against 0.756545 at zero, a 0.9 percent drop the noise
    // swamps) and where the profile is flat the argmin is noise. The signature is the flatness
    // itself: the drop over the boundary is far below RATE_SSE_DROP_MIN, so the rate, and with it
    // the anchor, is not determined by the data.
    const unstable = session((e0, j, rng) => (j === 0 ? e0 : 0) + BIAS + 0.05 * gauss(rng));
    expect(anchorFromReaches(unstable)).toEqual({ identifiable: false, reason: 'adapt-rate-at-bound' });
  });

  it('no adaptation at all: the rate pins at its upper bound and it refuses', () => {
    // The mirror case. With the belief error constant across the trial, the intercept and the
    // asymptote are the same column: belief and bias are one number and the fit cannot say which.
    // Here the profile only improves toward the singular design at rate 1, so the argmin IS the top
    // of the grid and the drop over that boundary is exactly zero.
    const rigid = session((e0, _j, rng) => e0 + BIAS + 0.05 * gauss(rng));
    expect(anchorFromReaches(rigid)).toEqual({ identifiable: false, reason: 'adapt-rate-at-bound' });
  });

  it('the guard is calibrated: it refuses the re-anchoring player AND answers the stable one', () => {
    // Measure the threshold, never choose it. The old signature, the argmin position against
    // ADAPT_RATE_MIN, refused on 33 of 40 seeds of the re-anchoring player and answered on 7. A
    // guard that leaks 7 confident wrong answers in 40 sessions is not a guard, and one that
    // refuses on everything deletes the estimator, so both rates are pinned here on seeds disjoint
    // from the 200-per-player calibration set behind RATE_SSE_DROP_MIN. Measured on these seeds:
    // 40 of 40 refusals, 40 of 40 answers. If this test fails after a threshold change, rerun the
    // calibration in src/anchor/flick-anchor.ts's constant comment before touching either number.
    let refusals = 0;
    let answers = 0;
    for (let s = 0; s < 40; s++) {
      const unstable = session((e0, j, rng) => (j === 0 ? e0 : 0) + BIAS + 0.05 * gauss(rng), {
        seed: 0xbeef + s,
      });
      const u = anchorFromReaches(unstable);
      if (u.identifiable === false && u.reason === 'adapt-rate-at-bound') refusals += 1;
      const healthy = session((e0, j, rng) => e0 * Math.pow(0.6, j) + BIAS + 0.05 * gauss(rng), {
        seed: 0xbeef + s,
      });
      if (anchorFromReaches(healthy).identifiable === true) answers += 1;
    }
    expect(refusals).toBe(40);
    expect(answers).toBe(40);
  });

  it('the identifiability floor is the calibrated one', () => {
    expect(RATE_SSE_DROP_MIN).toBe(0.05);
  });

  it('too few reaches, and too few distinct gains, are the same refusal', () => {
    const short = session((e0, j, rng) => e0 * Math.pow(0.6, j) + BIAS + 0.05 * gauss(rng), {
      trials: 3,
      perTrial: 4,
    });
    expect(short.length).toBeLessThan(FLICK_MIN_REACHES);
    expect(anchorFromReaches(short)).toEqual({ identifiable: false, reason: 'too-few-reaches' });

    const narrow = session((e0, j, rng) => e0 * Math.pow(0.6, j) + BIAS + 0.05 * gauss(rng), {
      levels: [8600, 9000, 9400],
    });
    expect(new Set(narrow.map((r) => r.rendered)).size).toBeLessThan(FLICK_MIN_LEVELS);
    expect(anchorFromReaches(narrow)).toEqual({ identifiable: false, reason: 'too-few-reaches' });
  });

  it('a reach with a non-positive landed fraction is discarded, not logged', () => {
    // ln is undefined at or below zero. A reach that travelled backwards is not a small reach.
    const ok = session((e0, j, rng) => e0 * Math.pow(0.6, j) + BIAS + 0.05 * gauss(rng));
    const poisoned = [
      ...ok,
      { rendered: counts360(9000), landedFraction: 0, index: 4 },
      { rendered: counts360(9000), landedFraction: -0.3, index: 5 },
    ];
    expect(anchorFromReaches(poisoned)).toEqual(anchorFromReaches(ok));
  });

  it('an empty session refuses', () => {
    expect(anchorFromReaches([])).toEqual({ identifiable: false, reason: 'too-few-reaches' });
  });
});
