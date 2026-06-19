import { describe, it, expect } from 'vitest';
import { buildResult, ciConcord } from '../../src/optimizer/result';
import { sensFor } from '../../src/convert/cm360';
import { yawFor } from '../../src/convert/yaw-table';
import type { Profile, Report, TrialResult } from '../../src/types';

const report: Report = { optimalCm360: 32, ci90: [28, 37], curve: [{ x: Math.log(32), mean: 0.1 }] };
const trials: TrialResult[] = [
  { instrument: 'calibrate', cm360: 28, score: 0.5, raw: { gain: 1.1, sigmaR: 0.4 }, at: 0 },
  { instrument: 'calibrate', cm360: 37, score: 0.5, raw: { gain: 0.9, sigmaR: 0.35 }, at: 0 },
  { instrument: 'strike', cm360: 33, score: 1, raw: { ttkMs: 510, hitRate: 0.86 }, at: 0 },
];
const profile: Profile = { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } };

describe('buildResult', () => {
  it('carries the optimum + CI and computes native per-game sensitivities at the optimum', () => {
    const r = buildResult(report, trials, 800);
    expect(r.optimalCm360).toBe(32);
    expect(r.ci90).toEqual([28, 37]);
    expect(r.perGameSens.cs2).toBeCloseTo(sensFor(32, 800, yawFor('cs2')), 9);
    expect(r.perGameSens.valorant).toBeCloseTo(sensFor(32, 800, yawFor('valorant')), 9);
  });

  it('includes the breakdown', () => {
    const r = buildResult(report, trials, 800);
    expect(r.breakdown.ttkMs).toBe(510);
    expect(r.breakdown.precisionFloorDeg).toBeCloseTo(0.35, 6);
    expect(r.breakdown.biasZeroCm360).toBeGreaterThan(28);
    expect(r.breakdown.biasZeroCm360).toBeLessThan(37);
  });

  it('can restrict per-game output to a subset', () => {
    const r = buildResult(report, trials, 800, ['cs2', 'valorant']);
    expect(Object.keys(r.perGameSens).sort()).toEqual(['cs2', 'valorant']);
  });

  it('copies the report curve VERBATIM and stores the search bounds for the plot', () => {
    const r = buildResult(report, trials, 800, undefined, [15, 60]);
    expect(r.curve).toEqual(report.curve); // byte-for-byte, no smoothing/refit
    expect(r.bounds).toEqual([15, 60]);
  });

  it('omits curve/bounds when no bounds are supplied (old/headless callers stay number-only)', () => {
    const r = buildResult(report, trials, 800);
    expect(r.curve).toBeUndefined();
    expect(r.bounds).toBeUndefined();
  });

  it('threads the profile into the breakdown so track/flick fuse their affine contribution', () => {
    const probe = (instrument: 'track' | 'flick', cm360: number, score: number): TrialResult => ({
      instrument, cm360, score, raw: {}, at: 0,
    });
    const tf = [
      ...trials,
      probe('flick', 22, 0.4), probe('flick', 35, 0.9),
      probe('track', 25, 0.5), probe('track', 40, 0.8),
    ];
    const r = buildResult(report, tf, 800, undefined, undefined, profile);
    expect(Number.isFinite(r.breakdown.flickContribZ!)).toBe(true);
    expect(Number.isFinite(r.breakdown.trackContribZ!)).toBe(true);
  });

  it('without a profile the affine contributions stay NaN (old callers stay number-only)', () => {
    const r = buildResult(report, trials, 800);
    expect(Number.isNaN(r.breakdown.trackContribZ!)).toBe(true);
    expect(Number.isNaN(r.breakdown.flickContribZ!)).toBe(true);
  });

  it('plumbs the profile speedAccuracy lean into the Result (the real taste knob)', () => {
    const r = buildResult(report, trials, 800, undefined, undefined, { ...profile, speedAccuracy: 0.7 });
    expect(r.speedAccuracy).toBeCloseTo(0.7, 9);
  });

  it('omits speedAccuracy without a profile (old/headless callers stay number-only)', () => {
    const r = buildResult(report, trials, 800);
    expect(r.speedAccuracy).toBeUndefined();
  });
});

describe('ciConcord', () => {
  // The descriptor is a LOG-SPACE WIDTH-RELATIVE threshold bucket, NOT an invented agreement score:
  // it reads only ln(hi) - ln(lo), so it is scale-invariant (a CI from 30→33 buckets the same as 60→66).
  it('buckets a narrow CI as tight', () => {
    expect(ciConcord(31, [30, 32])).toBe('tight'); // ln width ≈ 0.065
  });
  it('buckets a mid CI as moderate', () => {
    expect(ciConcord(32, [28, 37])).toBe('moderate'); // ln width ≈ 0.279
  });
  it('buckets a broad CI as wide', () => {
    expect(ciConcord(30, [18, 50])).toBe('wide'); // ln width ≈ 1.02
  });
  it('is scale-invariant (width-relative in ln space, not absolute)', () => {
    expect(ciConcord(31, [30, 32])).toBe(ciConcord(62, [60, 64]));
    expect(ciConcord(32, [28, 37])).toBe(ciConcord(64, [56, 74]));
  });
  it('returns undefined for a degenerate/non-finite CI (no fabricated descriptor)', () => {
    expect(ciConcord(30, [NaN, 32])).toBeUndefined();
    expect(ciConcord(30, [0, 32])).toBeUndefined();
    expect(ciConcord(30, [32, 30])).toBeUndefined(); // hi <= lo
  });
});
