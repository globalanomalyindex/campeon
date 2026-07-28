import { describe, it, expect } from 'vitest';
import { buildResult, ciConcord } from '../../src/optimizer/result';
import { counts360, countsBounds } from '../../src/types';
import type { Counts360, Profile, Report, TrialResult } from '../../src/types';

const report: Report = { optimalCounts: counts360(32), ci90: countsBounds(28, 37), curve: [{ x: Math.log(32), mean: 0.1 }] };
const trials: TrialResult[] = [
  { instrument: 'calibrate', counts: counts360(28), score: 0.5, raw: { gain: 1.1, sigmaR: 0.4 }, at: 0 },
  { instrument: 'calibrate', counts: counts360(37), score: 0.5, raw: { gain: 0.9, sigmaR: 0.35 }, at: 0 },
  { instrument: 'strike', counts: counts360(33), score: 1, raw: { ttkMs: 510, hitRate: 0.86 }, at: 0 },
];
const profile: Profile = { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } };

describe('buildResult', () => {
  it('carries the optimum and the CI', () => {
    const r = buildResult(report, trials);
    expect(r.optimalCounts).toBe(32);
    expect(r.ci90).toEqual([28, 37]);
  });

  it('includes the breakdown', () => {
    const r = buildResult(report, trials);
    expect(r.breakdown.ttkMs).toBe(510);
    expect(r.breakdown.precisionFloorDeg).toBeCloseTo(0.35, 6);
    expect(r.breakdown.biasZeroCounts).toBeGreaterThan(28);
    expect(r.breakdown.biasZeroCounts).toBeLessThan(37);
  });

  it('copies the report curve VERBATIM and stores the search bounds for the plot', () => {
    const r = buildResult(report, trials, countsBounds(15, 60));
    expect(r.curve).toEqual(report.curve); // byte-for-byte, no smoothing/refit
    expect(r.bounds).toEqual([15, 60]);
  });

  it('omits curve/bounds when no bounds are supplied (old/headless callers stay number-only)', () => {
    const r = buildResult(report, trials);
    expect(r.curve).toBeUndefined();
    expect(r.bounds).toBeUndefined();
  });

  it('threads the profile into the breakdown so track/flick fuse their affine contribution', () => {
    const probe = (instrument: 'track' | 'flick', counts: Counts360, score: number): TrialResult => ({
      instrument, counts, score, raw: {}, at: 0,
    });
    const tf = [
      ...trials,
      probe('flick', counts360(22), 0.4), probe('flick', counts360(35), 0.9),
      probe('track', counts360(25), 0.5), probe('track', counts360(40), 0.8),
    ];
    const r = buildResult(report, tf, undefined, profile);
    expect(Number.isFinite(r.breakdown.flickContribZ!)).toBe(true);
    expect(Number.isFinite(r.breakdown.trackContribZ!)).toBe(true);
  });

  it('without a profile the affine contributions stay NaN (old callers stay number-only)', () => {
    const r = buildResult(report, trials);
    expect(Number.isNaN(r.breakdown.trackContribZ!)).toBe(true);
    expect(Number.isNaN(r.breakdown.flickContribZ!)).toBe(true);
  });

  it('plumbs the profile speedAccuracy lean into the Result (the real taste knob)', () => {
    const r = buildResult(report, trials, undefined, { ...profile, speedAccuracy: 0.7 });
    expect(r.speedAccuracy).toBeCloseTo(0.7, 9);
  });

  it('omits speedAccuracy without a profile (old/headless callers stay number-only)', () => {
    const r = buildResult(report, trials);
    expect(r.speedAccuracy).toBeUndefined();
  });

  it('carries the measured session-drift readout (driftZ) verbatim from the Report (A4)', () => {
    const r = buildResult({ ...report, driftZ: 0.42 }, trials);
    expect(r.driftZ).toBe(0.42);
  });

  it('omits driftZ when the Report has none (fell back / old report → dashed, never padded)', () => {
    const r = buildResult(report, trials);
    expect(r.driftZ).toBeUndefined();
  });

  it('carries the peakAtBound disclosure verbatim from the Report (a bound stays a bound)', () => {
    const r = buildResult({ ...report, peakAtBound: 'high' }, trials);
    expect(r.peakAtBound).toBe('high');
    const l = buildResult({ ...report, peakAtBound: 'low' }, trials);
    expect(l.peakAtBound).toBe('low');
  });

  it('omits peakAtBound when the Report has none (old persisted results degrade gracefully)', () => {
    // Absence must mean "no clamp was recorded", never be inferred from the optimum sitting on
    // an edge: an old saved Result cannot have the flag fabricated for it in either direction.
    const r = buildResult(report, trials);
    expect(r.peakAtBound).toBeUndefined();
    const edge = buildResult({ ...report, optimalCounts: counts360(60) }, trials);
    expect(edge.peakAtBound).toBeUndefined();
  });
});

describe('ciConcord', () => {
  // The descriptor is a LOG-SPACE WIDTH-RELATIVE threshold bucket, NOT an invented agreement score:
  // it reads only ln(hi) - ln(lo), so it is scale-invariant (a CI from 30→33 buckets the same as 60→66).
  it('buckets a narrow CI as tight', () => {
    expect(ciConcord(counts360(31), countsBounds(30, 32))).toBe('tight'); // ln width ≈ 0.065
  });
  it('buckets a mid CI as moderate', () => {
    expect(ciConcord(counts360(32), countsBounds(28, 37))).toBe('moderate'); // ln width ≈ 0.279
  });
  it('buckets a broad CI as wide', () => {
    expect(ciConcord(counts360(30), countsBounds(18, 50))).toBe('wide'); // ln width ≈ 1.02
  });
  it('is scale-invariant (width-relative in ln space, not absolute)', () => {
    expect(ciConcord(counts360(31), countsBounds(30, 32))).toBe(ciConcord(counts360(62), countsBounds(60, 64)));
    expect(ciConcord(counts360(32), countsBounds(28, 37))).toBe(ciConcord(counts360(64), countsBounds(56, 74)));
  });
  it('returns undefined for a degenerate/non-finite CI (no fabricated descriptor)', () => {
    expect(ciConcord(counts360(30), countsBounds(NaN, 32))).toBeUndefined();
    expect(ciConcord(counts360(30), countsBounds(0, 32))).toBeUndefined();
    expect(ciConcord(counts360(30), countsBounds(32, 30))).toBeUndefined(); // hi <= lo
  });
});
