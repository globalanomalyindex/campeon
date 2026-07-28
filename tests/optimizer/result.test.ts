import { describe, it, expect } from 'vitest';
import { buildResult, ciConcord } from '../../src/optimizer/result';
import { counts360, type Counts360, type Profile, type Report, type TrialResult } from '../../src/types';

const c = counts360;
const ci = (lo: number, hi: number): [Counts360, Counts360] => [c(lo), c(hi)];

const report: Report = { optimalCounts: c(8000), ci90: ci(7000, 9200), curve: [{ x: Math.log(8000), mean: 0.1 }] };
const trials: TrialResult[] = [
  { instrument: 'calibrate', counts: c(7000), score: 0.5, raw: { gain: 1.1, sigmaR: 0.4 }, at: 0 },
  { instrument: 'calibrate', counts: c(9200), score: 0.5, raw: { gain: 0.9, sigmaR: 0.35 }, at: 0 },
  { instrument: 'strike', counts: c(8200), score: 1, raw: { ttkMs: 510, hitRate: 0.86 }, at: 0 },
];
const profile: Profile = { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } };

describe('buildResult', () => {
  it('carries the optimum + CI in counts per 360', () => {
    const r = buildResult(report, trials);
    expect(r.optimalCounts).toBe(8000);
    expect(r.ci90).toEqual([7000, 9200]);
  });

  it('includes the breakdown', () => {
    const r = buildResult(report, trials);
    expect(r.breakdown.ttkMs).toBe(510);
    expect(r.breakdown.precisionFloorDeg).toBeCloseTo(0.35, 6);
    expect(r.breakdown.biasZeroCounts).toBeGreaterThan(7000);
    expect(r.breakdown.biasZeroCounts).toBeLessThan(9200);
  });

  it('copies the report curve VERBATIM and stores the search bounds for the plot', () => {
    const r = buildResult(report, trials, { bounds: ci(4000, 16000) });
    expect(r.curve).toEqual(report.curve); // byte-for-byte, no smoothing/refit
    expect(r.bounds).toEqual([4000, 16000]);
  });

  it('omits curve/bounds when no bounds are supplied (old/headless callers stay number-only)', () => {
    const r = buildResult(report, trials);
    expect(r.curve).toBeUndefined();
    expect(r.bounds).toBeUndefined();
  });

  it('threads the profile into the breakdown so track/flick fuse their affine contribution', () => {
    const probe = (instrument: 'track' | 'flick', counts: number, score: number): TrialResult => ({
      instrument, counts: c(counts), score, raw: {}, at: 0,
    });
    const tf = [
      ...trials,
      probe('flick', 5500, 0.4), probe('flick', 8800, 0.9),
      probe('track', 6300, 0.5), probe('track', 10000, 0.8),
    ];
    const r = buildResult(report, tf, { profile });
    expect(Number.isFinite(r.breakdown.flickContribZ!)).toBe(true);
    expect(Number.isFinite(r.breakdown.trackContribZ!)).toBe(true);
  });

  it('without a profile the affine contributions stay NaN (old callers stay number-only)', () => {
    const r = buildResult(report, trials);
    expect(Number.isNaN(r.breakdown.trackContribZ!)).toBe(true);
    expect(Number.isNaN(r.breakdown.flickContribZ!)).toBe(true);
  });

  it('plumbs the profile speedAccuracy lean into the Result (the real taste knob)', () => {
    const r = buildResult(report, trials, { profile: { ...profile, speedAccuracy: 0.7 } });
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

  it('omits driftZ when the Report has none (fell back / old report, dashed, never padded)', () => {
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
    const edge = buildResult({ ...report, optimalCounts: c(16000) }, trials);
    expect(edge.peakAtBound).toBeUndefined();
  });
});

describe('ciConcord', () => {
  // The descriptor is a LOG-SPACE WIDTH-RELATIVE threshold bucket, NOT an invented agreement
  // score: it reads only ln(hi) - ln(lo), so it survived the cm-to-counts unit change untouched.
  it('buckets a narrow CI as tight', () => {
    expect(ciConcord(c(3100), ci(3000, 3200))).toBe('tight'); // ln width about 0.065
  });
  it('buckets a mid CI as moderate', () => {
    expect(ciConcord(c(8000), ci(7000, 9200))).toBe('moderate'); // ln width about 0.273
  });
  it('buckets a broad CI as wide', () => {
    expect(ciConcord(c(8000), ci(4500, 12500))).toBe('wide'); // ln width about 1.02
  });
  it('is scale-invariant (width-relative in ln space, not absolute)', () => {
    expect(ciConcord(c(3100), ci(3000, 3200))).toBe(ciConcord(c(6200), ci(6000, 6400)));
    expect(ciConcord(c(8000), ci(7000, 9200))).toBe(ciConcord(c(16000), ci(14000, 18400)));
  });
  it('returns undefined for a degenerate/non-finite CI (no fabricated descriptor)', () => {
    expect(ciConcord(c(8000), [c(NaN), c(9200)])).toBeUndefined();
    expect(ciConcord(c(8000), [c(0), c(9200)])).toBeUndefined();
    expect(ciConcord(c(8000), [c(9200), c(8000)])).toBeUndefined(); // hi <= lo
  });
});
