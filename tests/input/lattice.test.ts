import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../../src/stats/rng';
import {
  latticeModulus,
  spacingCandidates,
  latticeSpacing,
  LATTICE_PURITY_MIN,
  CONVENTION_K_MIN,
  CONVENTION_K_MAX,
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
