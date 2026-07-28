import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../../src/stats/rng';
import {
  latticeModulus,
  spacingCandidates,
  latticeSpacing,
  LATTICE_PURITY_MIN,
  CONVENTION_K_MIN,
  CONVENTION_K_MAX,
  conventionFrom,
  LATTICE_MIN_SAMPLES,
} from '../../src/input/lattice';

/** One synthetic hand motion as REAL integer mouse counts: mixed signs, small magnitudes common,
 *  which is the shape a 1000 Hz sample stream actually has. `maxMag` is the largest single-event
 *  jump. Every fixture below is built from this, so a browser scaling is applied ON TOP of a stream
 *  that is honestly integral, which is the only way the collapse cases in task 24 mean anything. */
function handCounts(n: number, rng: () => number, maxMag = 18): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const mag = 1 + Math.floor(Math.pow(rng(), 1.6) * maxMag);
    out.push(rng() < 0.5 ? -mag : mag);
  }
  return out;
}

const scaledBy = (xs: readonly number[], k: number): number[] => xs.map((x) => x * k);
const absOf = (xs: readonly number[]): number[] => xs.map((x) => Math.abs(x));

/** The browser re-rounds to integers after scaling. This is the step that destroys the evidence,
 *  and only when the scaling was fractional or nonlinear: at an integer factor it changes nothing. */
const reRounded = (xs: readonly number[]): number[] => xs.map((x) => Math.round(x));
const meanAbs = (xs: readonly number[]): number =>
  xs.reduce((a, b) => a + Math.abs(b), 0) / xs.length;

describe('lattice kernel', () => {
  it('modulus is one on an exact lattice and far off it otherwise', () => {
    expect(latticeModulus([2, 4, 6, 8, 10, 12], 2)).toBeCloseTo(1, 12);
    // A stream on the 0.5 lattice scored at spacing 1: the half-integer deltas land at phase pi and
    // cancel the integer ones, so the modulus collapses to the parity imbalance (measured 0.200).
    const half = absOf(scaledBy(handCounts(120, mulberry32(0x5eed)), 0.5));
    expect(latticeModulus(half, 0.5)).toBeCloseTo(1, 12);
    expect(latticeModulus(half, 1)).toBeLessThan(0.25);
  });

  it('returns zero rather than NaN for a degenerate spacing or an empty stream', () => {
    // A caller that forgets to guard must get a refusal, never a plausible number.
    expect(latticeModulus([1, 2, 3], 0)).toBe(0);
    expect(latticeModulus([1, 2, 3], -1)).toBe(0);
    expect(latticeModulus([], 1)).toBe(0);
  });

  it('candidates divide the smallest observed deltas, largest first', () => {
    const cands = spacingCandidates(absOf(scaledBy(handCounts(120, mulberry32(0x1234)), 1.25)));
    expect(cands.length).toBeGreaterThan(0);
    for (let i = 1; i < cands.length; i++) expect(cands[i]!).toBeLessThan(cands[i - 1]!);
    expect(cands.some((c) => Math.abs(c - 1.25) < 1e-12)).toBe(true);
    for (const c of cands) {
      expect(c).toBeGreaterThanOrEqual(CONVENTION_K_MIN);
      expect(c).toBeLessThanOrEqual(CONVENTION_K_MAX);
    }
  });

  it('never scores a candidate below the plausible-convention floor', () => {
    // A spacing of 0.05 would mean twenty browser deltas per mouse count, which is not a coordinate
    // convention. Scoring it at all invites a pure-but-absurd k that rescales the per-game table by
    // an order of magnitude, so it is excluded from the candidate set rather than filtered later.
    const cands = spacingCandidates([0.05, 0.1, 0.15, 0.2, 0.25, 0.3]);
    for (const c of cands) expect(c).toBeGreaterThanOrEqual(CONVENTION_K_MIN);
    expect(cands.some((c) => Math.abs(c - 0.05) < 1e-12)).toBe(false);
    expect(cands.some((c) => Math.abs(c - 0.1) < 1e-12)).toBe(false);
  });

  it('takes the LARGEST pure spacing, because every sub-harmonic scores one too', () => {
    const stream = absOf(scaledBy(handCounts(120, mulberry32(0x5eed)), 1.5));
    // 0.75 divides every delta as well, and scores a perfect one. Picking the first pure candidate
    // found in an ascending scan would therefore report k = 0.75 and halve the emitted sensitivity.
    expect(latticeModulus(stream, 0.75)).toBeCloseTo(1, 12);
    const fit = latticeSpacing(stream);
    expect(fit.spacing).toBeCloseTo(1.5, 12);
    expect(fit.purity).toBeCloseTo(1, 12);
  });

  it('refuses a near-constant drag, which is pure at every candidate at once', () => {
    // The count of distinct quantum indices is bounded by the count of distinct deltas whatever L
    // is, so a stream with one delta value carries no information about which candidate is
    // fundamental. Purity zero, not purity one: there is no evidence here, not perfect evidence.
    const fit = latticeSpacing(new Array(120).fill(4));
    expect(fit.spacing).toBeNull();
    expect(fit.purity).toBe(0);
  });

  it('reports the best modulus it reached when nothing is pure', () => {
    const rng = mulberry32(0xf00d);
    const noisy = handCounts(120, rng, 18).map((x) => x + (rng() - 0.5) * 0.6);
    const fit = latticeSpacing(absOf(noisy));
    expect(fit.spacing).toBeNull();
    // Measured 0.216 for this fixture, 0.13 to 0.58 across 200 seeds: an off-lattice stream is
    // nowhere near the floor, which is what earns the floor the right to be as low as 0.98.
    expect(fit.purity).toBeGreaterThan(0.1);
    expect(fit.purity).toBeLessThan(LATTICE_PURITY_MIN);
  });
});

describe('conventionFrom', () => {
  it('recovers a non-unit lattice spacing over 200 sweeps per case', () => {
    // 1/3 and 1.25 are the cases that motivated replacing the integer gcd: the gcd refused every
    // one of them, this recovers all of them exactly.
    for (const k of [0.5, 1 / 3, 1.25, 1.5, 2, 3]) {
      let scaledRuns = 0;
      for (let r = 0; r < 200; r++) {
        const c = conventionFrom(scaledBy(handCounts(120, mulberry32(0x5eed + r)), k));
        if (c.state !== 'scaled') continue;
        expect(c.k).toBeCloseTo(k, 10);
        expect(c.purity).toBeGreaterThanOrEqual(LATTICE_PURITY_MIN);
        scaledRuns++;
      }
      expect(scaledRuns).toBe(200);
    }
  });

  it('tolerates one off-lattice delta without losing the fundamental', () => {
    // Five candidate seeds exist for exactly this: one corrupt smallest delta must not be able to
    // take the fundamental out of the candidate set. Measured purity 0.9893, above the 0.98 floor.
    const dirty = scaledBy(handCounts(120, mulberry32(0x1234)), 1.25);
    dirty[0] = 0.37;
    const c = conventionFrom(dirty);
    expect(c.state).toBe('scaled');
    if (c.state === 'scaled') expect(c.k).toBeCloseTo(1.25, 10);
  });

  it('reads both axis components as one lattice', () => {
    // A browser that scales movementX scales movementY by the same factor, so dx and dy are samples
    // of ONE lattice and the caller may interleave them. That doubles the sample count for free.
    const source = handCounts(120, mulberry32(0x2222));
    const interleaved: number[] = [];
    for (const v of source) interleaved.push(v * 1.5, Math.round(v * 0.4) * 1.5);
    const c = conventionFrom(interleaved);
    expect(c.state).toBe('scaled');
    if (c.state === 'scaled') expect(c.k).toBeCloseTo(1.5, 10);
  });

  it('refuses below the sample floor rather than reading a short stream', () => {
    const sixty = scaledBy(handCounts(60, mulberry32(0x777)), 0.5);
    expect(conventionFrom(sixty).state).toBe('scaled');
    const short = conventionFrom(sixty.slice(0, LATTICE_MIN_SAMPLES - 1));
    expect(short).toEqual({ state: 'indeterminate', reason: 'too-few-samples', purity: 0 });
  });

  it('does not let zeros or non-finite deltas count toward the sample floor', () => {
    // A zero is a multiple of every spacing, so padding the floor with zeros would let a 59-sample
    // stream pass a 60-sample gate on samples that carry no information whatsoever.
    const short = scaledBy(handCounts(60, mulberry32(0x777)), 0.5).slice(0, 59);
    expect(conventionFrom([...short, 0, 0, 0, 0, 0]).state).toBe('indeterminate');
    expect(conventionFrom([...short, NaN, Infinity, -Infinity]).state).toBe('indeterminate');
    expect(conventionFrom([...short, 0, NaN]).state).toBe('indeterminate');
  });

  it('refuses a stream with no lattice at all, and says how close it got', () => {
    const rng = mulberry32(0xf00d);
    const noisy = handCounts(120, rng, 18).map((x) => x + (rng() - 0.5) * 0.6);
    const c = conventionFrom(noisy);
    expect(c).toMatchObject({ state: 'indeterminate', reason: 'no-lattice' });
    expect(c.purity).toBeGreaterThan(0.1);
    expect(c.purity).toBeLessThan(LATTICE_PURITY_MIN);
  });

  it('has a sample floor of 60', () => {
    expect(LATTICE_MIN_SAMPLES).toBe(60);
  });
});

describe('conventionFrom is ONE-SIDED (the collapse tests)', () => {
  // READ THIS BEFORE CHANGING ANY TEST IN THIS BLOCK.
  //
  // Returning `{ state: 'scaled', k: 1 }` for a unit lattice looks tidier, reads better on the
  // result screen, and shows the per-game table to far more players. It is also a silent
  // factor-of-two error in the sensitivity we tell a player to type, and there is no test anywhere
  // downstream that can catch it, because the number stays entirely plausible.
  //
  // The reason: a stream that was scaled by a FRACTION and then re-rounded to integers IS a perfect
  // unit lattice. Measured on these fixtures over 200 sweeps per case, k = 0.5, k = 1.25, k = 1.5
  // and a nonlinear acceleration curve all read spacing 1 at purity 1.000 in 200 of 200 runs. And
  // the collapse is undetectable by any other statistic on the stream: a genuine unit stream against
  // a halved-then-rounded one gives a mean-delta ratio of 0.974 here, and the spec's two other
  // candidate separators do no better (odd fraction 0.515 against 0.546, ones fraction 0.053 against
  // 0.059).
  //
  // What the collapse is NOT, and this matters as much: it is not every scaling. Pure INTEGER
  // scaling survives the rounding untouched, because multiplying integers by 2 leaves integers and
  // the re-rounding is a literal no-op, so k = 2 and k = 3 are still read exactly ('an integer
  // scaling survives the rounding and is still read exactly', 200 of 200 at each factor). The
  // collapse is specific to scaling that is fractional or nonlinear: division, a fractional ratio,
  // and acceleration. A comment claiming that all scaling collapses would mislead in the opposite
  // direction and invite deleting an estimator that works on the commonest devicePixelRatio there
  // is.
  //
  // So spacing one is not evidence of k = 1. It is the absence of evidence about k, and the honest
  // return is `indeterminate` with reason `spacing-one`. The cost of refusing is one tier of the
  // result screen. The cost of guessing is a wrong number the player types into their game.

  it('reads a genuine integer stream as indeterminate, never as k = 1', () => {
    for (let r = 0; r < 200; r++) {
      const c = conventionFrom(handCounts(120, mulberry32(0x5eed + r)));
      expect(c).toMatchObject({ state: 'indeterminate', reason: 'spacing-one' });
    }
  });

  it('reads a halved-then-rounded stream as indeterminate, and cannot tell it from the genuine one', () => {
    // Matched fixtures: the halved stream comes from twice the hand motion, so both land on the same
    // delta distribution. This is the pair that would silently double the emitted sensitivity.
    const genuine = handCounts(120, mulberry32(0xc0de), 18);
    const halved = reRounded(scaledBy(handCounts(120, mulberry32(0xbeef), 36), 0.5));
    expect(conventionFrom(genuine)).toMatchObject({ state: 'indeterminate', reason: 'spacing-one' });
    expect(conventionFrom(halved)).toMatchObject({ state: 'indeterminate', reason: 'spacing-one' });
    // And the two streams look the same from outside: measured mean-delta ratio 0.974.
    expect(meanAbs(halved) / meanAbs(genuine)).toBeCloseTo(1, 1);
  });

  it('reads a 1.5-scaled-then-rounded stream as indeterminate', () => {
    const stream = reRounded(scaledBy(handCounts(120, mulberry32(0xc0de), 12), 1.5));
    expect(conventionFrom(stream)).toMatchObject({ state: 'indeterminate', reason: 'spacing-one' });
  });

  it('reads an accelerated-then-rounded stream as indeterminate across 200 sweeps', () => {
    // This is why the estimator is hard-gated on the acceleration check in task 25: an accelerated
    // delta is still an integer after rounding, so acceleration is completely invisible here. The
    // lattice provably cannot substitute for the accel gate, and this test is the proof.
    for (let r = 0; r < 200; r++) {
      const accelerated = reRounded(
        handCounts(120, mulberry32(0x5eed + r)).map((x) => Math.sign(x) * Math.pow(Math.abs(x), 1.2)),
      );
      expect(conventionFrom(accelerated)).toMatchObject({
        state: 'indeterminate',
        reason: 'spacing-one',
      });
    }
  });

  it('an integer scaling survives the rounding and is still read exactly', () => {
    // The one family that does NOT collapse, and it is the commonest scaling of all: a browser that
    // multiplies raw counts by a devicePixelRatio of 2. Multiplying integers by an integer leaves
    // integers, so the re-rounding changes nothing and the stream really is on the spacing-2
    // lattice. Recorded as a test so the block comment above cannot be read as "every scaling
    // collapses", which would justify deleting an estimator that works here 200 times out of 200.
    for (const k of [2, 3]) {
      for (let r = 0; r < 200; r++) {
        const stream = reRounded(scaledBy(handCounts(120, mulberry32(0x5eed + r)), k));
        const c = conventionFrom(stream);
        expect(c.state).toBe('scaled');
        if (c.state === 'scaled') expect(c.k).toBeCloseTo(k, 10);
      }
    }
  });

  it('never returns a scaled convention with k within two percent of one', () => {
    const streams: number[][] = [
      handCounts(240, mulberry32(0xa1)),
      reRounded(scaledBy(handCounts(240, mulberry32(0xa2), 36), 0.5)),
      reRounded(scaledBy(handCounts(240, mulberry32(0xa3), 12), 1.5)),
      reRounded(scaledBy(handCounts(240, mulberry32(0xa4), 18), 1.01)),
      reRounded(handCounts(240, mulberry32(0xa5)).map((x) => Math.sign(x) * Math.pow(Math.abs(x), 1.2))),
    ];
    for (const s of streams) {
      const c = conventionFrom(s);
      if (c.state === 'scaled') expect(Math.abs(c.k - 1)).toBeGreaterThan(0.02);
    }
  });
});
