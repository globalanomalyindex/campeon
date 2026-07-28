import { describe, it, expect } from 'vitest';
import { computeBreakdown } from '../../src/optimizer/breakdown';
import { trialsToObservations } from '../../src/optimizer/objective';
import { counts360 } from '../../src/types';
import type { Counts360, InstrumentId, Profile, TrialResult } from '../../src/types';

const cal = (counts: Counts360, gain: number, sigmaR: number): TrialResult => ({
  instrument: 'calibrate', counts, score: 0.5,
  raw: { gain, sigmaR, biasMag: 0, mse: 0 }, at: 0,
});
const str = (counts: Counts360, ttkMs: number, hitRate: number): TrialResult => ({
  instrument: 'strike', counts, score: 1, raw: { ttkMs, hitRate }, at: 0,
});
const probe = (instrument: InstrumentId, counts: Counts360, score: number): TrialResult => ({
  instrument, counts, score, raw: {}, at: 0,
});
const prof = (weights: Partial<Record<InstrumentId, number>>): Profile => ({
  speedAccuracy: 0.5,
  instrumentWeights: { track: 0, flick: 0, calibrate: 0, strike: 0, ...weights },
});

describe('computeBreakdown', () => {
  it('interpolates the bias-zero cm/360 where gain crosses 1 (in ln space)', () => {
    // gain 1.2 at 20, 0.8 at 40 → crosses 1 at the ln midpoint = the geometric mean √(20·40) ≈ 28.284
    const b = computeBreakdown([cal(counts360(20), 1.2, 0.5), cal(counts360(40), 0.8, 0.4)], counts360(30));
    expect(b.biasZeroCounts).toBeCloseTo(Math.sqrt(20 * 40), 4); // pins the ln-space formula (load-bearing)
  });

  it('precisionFloorDeg is the minimum calibrate sigmaR', () => {
    const b = computeBreakdown([cal(counts360(20), 1.2, 0.5), cal(counts360(40), 0.8, 0.31), cal(counts360(30), 1.0, 0.42)], counts360(30));
    expect(b.precisionFloorDeg).toBeCloseTo(0.31, 6);
  });

  it('ttk/hitRate come from the strike trial nearest the optimum', () => {
    const b = computeBreakdown([str(counts360(20), 700, 0.6), str(counts360(45), 520, 0.9), cal(counts360(30), 1.0, 0.4)], counts360(44));
    expect(b.ttkMs).toBe(520);
    expect(b.hitRate).toBe(0.9);
  });

  it('falls back to NaN for absent instruments (no fabrication)', () => {
    const b = computeBreakdown([str(counts360(30), 500, 0.8)], counts360(30));
    expect(Number.isNaN(b.biasZeroCounts)).toBe(true);
    expect(Number.isNaN(b.precisionFloorDeg)).toBe(true);
    expect(b.ttkMs).toBe(500);
  });

  it('no gain bracket (all overshoot) → nearest-to-1 gain trial counts, not interpolation', () => {
    const b = computeBreakdown([cal(counts360(20), 1.4, 0.5), cal(counts360(30), 1.1, 0.4)], counts360(25));
    expect(b.biasZeroCounts).toBe(30); // gain 1.1 is closest to 1
  });

  it('track/flick contributions are the AFFINE-FUSED z-score objective.ts emits (nearest the optimum)', () => {
    // The facet position must be the same w·(score−mu)/sd quantity the optimizer fuses - NOT a raw argmax.
    const trials = [
      probe('flick', counts360(22), 0.4), probe('flick', counts360(35), 0.9), probe('flick', counts360(50), 0.3),
      probe('track', counts360(25), 0.5), probe('track', counts360(40), 0.8),
    ];
    const profile = prof({ flick: 1, track: 1 });
    const optimum = counts360(36); // nearest flick trial = 35, nearest track trial = 40
    const b = computeBreakdown(trials, optimum, profile);
    // Reconstruct the exact fused y the optimizer would emit for the nearest-the-optimum trial.
    const obs = trialsToObservations(trials, profile);
    const yAt = (cm: number) => obs.find((o) => Math.abs(Math.exp(o.x) - cm) < 1e-9)!.y;
    expect(b.trackContribZ).toBeCloseTo(yAt(40), 12);
    expect(b.flickContribZ).toBeCloseTo(yAt(35), 12);
  });

  it('track/flick contributions are NaN with <2 trials / no spread (no fabricated facet recommendation)', () => {
    const b = computeBreakdown(
      [probe('flick', counts360(30), 0.7), probe('track', counts360(25), 0.5), probe('track', counts360(40), 0.5)],
      counts360(30),
      prof({ flick: 1, track: 1 }),
    );
    expect(Number.isNaN(b.flickContribZ)).toBe(true); // 1 flick trial → no spread
    expect(Number.isNaN(b.trackContribZ)).toBe(true); // 2 equal track scores → sd 0
  });

  it('track/flick contributions are NaN when no profile is supplied (old callers stay number-only)', () => {
    const b = computeBreakdown([probe('flick', counts360(22), 0.4), probe('flick', counts360(35), 0.9)], counts360(30));
    expect(Number.isNaN(b.trackContribZ)).toBe(true);
    expect(Number.isNaN(b.flickContribZ)).toBe(true);
  });
});
