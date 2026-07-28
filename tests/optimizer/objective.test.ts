import { describe, it, expect } from 'vitest';
import { trialsToObservations } from '../../src/optimizer/objective';
import { fitPeak } from '../../src/stats/peak-fit';
import { sampleStd } from '../../src/scoring/stats';
import { counts360 } from '../../src/types';
import type { InstrumentId, Profile, TrialResult } from '../../src/types';

const prof = (weights: Partial<Record<InstrumentId, number>>): Profile => ({
  speedAccuracy: 0.5,
  instrumentWeights: { track: 0, flick: 0, calibrate: 0, strike: 0, ...weights },
});

function trial(instrument: InstrumentId, counts: number, score: number, scoreSE?: number): TrialResult {
  return { instrument, counts: counts360(counts), score, raw: {}, at: 0, ...(scoreSE !== undefined ? { scoreSE } : {}) };
}

describe('trialsToObservations', () => {
  it('recovers a single instrument peak through z-scoring (affine-invariant)', () => {
    const peak = Math.log(35);
    const trials = [16, 22, 28, 35, 44, 55].map((cm) => {
      const x = Math.log(cm);
      return trial('flick', cm, -(x - peak) * (x - peak) * 5 + 3); // arbitrary scale + offset
    });
    const obs = trialsToObservations(trials, prof({ flick: 1 }));
    expect(obs.length).toBe(6);
    expect(fitPeak(obs).optimalCounts).toBeCloseTo(35, 0);
  });

  it('drops instruments with no spread (≤1 trial or all-equal) - no NaN', () => {
    const trials = [trial('flick', 30, 5), trial('track', 25, 9), trial('track', 40, 9)];
    const obs = trialsToObservations(trials, prof({ flick: 1, track: 1 }));
    expect(obs).toEqual([]);
  });

  it('drops an instrument whose scores contain NaN (never emits a NaN observation)', () => {
    const trials = [trial('flick', 20, Number.NaN), trial('flick', 35, 5), trial('flick', 50, 8)];
    const obs = trialsToObservations(trials, prof({ flick: 1 }));
    expect(obs).toEqual([]); // a NaN score poisons mu/sd → the whole instrument is dropped
    for (const o of obs) expect(Number.isNaN(o.y)).toBe(false);
  });

  it('skips weight-0 instruments', () => {
    const trials = [trial('strike', 20, 1), trial('strike', 50, 9)];
    expect(trialsToObservations(trials, prof({ strike: 0 }))).toEqual([]);
    expect(trialsToObservations(trials, prof({ strike: 1 })).length).toBe(2);
  });

  it('leaves Observation.noise undefined when no trial carries a scoreSE (flat path byte-identical)', () => {
    const trials = [trial('flick', 20, 1), trial('flick', 35, 5), trial('flick', 50, 8)];
    const obs = trialsToObservations(trials, prof({ flick: 1 }));
    expect(obs.length).toBe(3);
    for (const o of obs) expect(o.noise).toBeUndefined();
  });

  it('sets Observation.noise = (w·scoreSE/sd)^2 (clamped) when scoreSE is finite > 0', () => {
    const scores = [1, 5, 8];
    const se = 0.5;
    const w = 2;
    const noiseVar = 0.1;
    const trials = [
      trial('flick', 20, scores[0], se),
      trial('flick', 35, scores[1], se),
      trial('flick', 50, scores[2], se),
    ];
    const obs = trialsToObservations(trials, prof({ flick: w }), { noiseVar });
    const sd = sampleStd(scores);
    const expected = (w * se) / sd;
    const expectedNoise = Math.min(
      Math.max(expected * expected, 0.25 * noiseVar),
      4.0 * noiseVar,
    );
    for (const o of obs) {
      expect(o.noise).toBeDefined();
      expect(o.noise as number).toBeCloseTo(expectedNoise, 9);
    }
  });

  it('floors the nugget so a lucky-quiet trial cannot become an interpolating spike', () => {
    const scores = [1, 5, 8];
    const noiseVar = 0.1;
    // A near-zero SE would map to ~0 noise; the floor (0.25·noiseVar) protects against it.
    const trials = [
      trial('flick', 20, scores[0], 1e-6),
      trial('flick', 35, scores[1], 1e-6),
      trial('flick', 50, scores[2], 1e-6),
    ];
    const obs = trialsToObservations(trials, prof({ flick: 1 }), { noiseVar, floorFrac: 0.25 });
    for (const o of obs) expect(o.noise as number).toBeCloseTo(0.25 * noiseVar, 9);
  });

  it('ceils the nugget so a disastrously-noisy trial is not silenced', () => {
    const scores = [1, 5, 8];
    const noiseVar = 0.1;
    const trials = [
      trial('flick', 20, scores[0], 1e6),
      trial('flick', 35, scores[1], 1e6),
      trial('flick', 50, scores[2], 1e6),
    ];
    const obs = trialsToObservations(trials, prof({ flick: 1 }), { noiseVar, ceilFrac: 4.0 });
    for (const o of obs) expect(o.noise as number).toBeCloseTo(4.0 * noiseVar, 9);
  });

  it('ignores a non-finite or non-positive scoreSE (leaves noise undefined)', () => {
    const trials = [
      trial('flick', 20, 1, 0),
      trial('flick', 35, 5, Number.NaN),
      trial('flick', 50, 8, -1),
    ];
    const obs = trialsToObservations(trials, prof({ flick: 1 }), { noiseVar: 0.1 });
    for (const o of obs) expect(o.noise).toBeUndefined();
  });

  it('does not move the scored y-values when a nugget is attached (reliability ≠ rescaling)', () => {
    const scores = [1, 5, 8];
    const bare = trialsToObservations(
      [trial('flick', 20, scores[0]), trial('flick', 35, scores[1]), trial('flick', 50, scores[2])],
      prof({ flick: 1 }),
    );
    const withSe = trialsToObservations(
      [
        trial('flick', 20, scores[0], 0.4),
        trial('flick', 35, scores[1], 0.4),
        trial('flick', 50, scores[2], 0.4),
      ],
      prof({ flick: 1 }),
    );
    expect(withSe.map((o) => o.y)).toEqual(bare.map((o) => o.y));
    expect(withSe.map((o) => o.x)).toEqual(bare.map((o) => o.x));
  });

  describe('tau - standardized within-instrument trial order (A4 drift covariate)', () => {
    it('sets tau as the per-instrument standardized order index (mean 0, unit sample sd)', () => {
      const trials = [trial('flick', 20, 1), trial('flick', 35, 5), trial('flick', 50, 8)];
      const obs = trialsToObservations(trials, prof({ flick: 1 }));
      // order indices 0,1,2 → mean 1, sample sd 1 → tau = -1, 0, +1 (obs sorted by x = input order here)
      expect(obs.map((o) => o.tau)).toEqual([-1, 0, 1]);
    });

    it('standardizes tau PER INSTRUMENT, consistent with the per-instrument z-scoring', () => {
      // Interleaved schedule: each instrument gets its own 0..n-1 order index, standardized over its
      // own trials - "trial k of track" and "trial k of flick" carry the same tau.
      const trials = [
        trial('flick', 20, 1), trial('track', 22, 2),
        trial('flick', 35, 5), trial('track', 38, 6),
        trial('flick', 50, 8), trial('track', 55, 9),
      ];
      const obs = trialsToObservations(trials, prof({ flick: 1, track: 1 }));
      const flickTaus = obs.filter((_, i) => [0, 2, 4].includes(i)).map((o) => o.tau);
      const trackTaus = obs.filter((_, i) => [1, 3, 5].includes(i)).map((o) => o.tau);
      expect(flickTaus).toEqual([-1, 0, 1]);
      expect(trackTaus).toEqual([-1, 0, 1]);
    });

    it('keeps tau attached to the right point through the x-sort', () => {
      // input NOT in cm order: the sort by x must not shuffle tau off its trial
      const trials = [trial('flick', 50, 8), trial('flick', 20, 1), trial('flick', 35, 5)];
      const obs = trialsToObservations(trials, prof({ flick: 1 }));
      expect(obs.map((o) => [Math.round(Math.exp(o.x)), o.tau])).toEqual([
        [20, 0], // second trial run (order index 1 → tau 0)
        [35, 1], // third trial run (order index 2 → tau +1)
        [50, -1], // first trial run (order index 0 → tau -1)
      ]);
    });

    it('does not move x/y/noise when tau is attached (drift enters as a covariate, never a rescale)', () => {
      const scores = [1, 5, 8];
      const trials = [
        trial('flick', 20, scores[0], 0.4), trial('flick', 35, scores[1], 0.4), trial('flick', 50, scores[2], 0.4),
      ];
      const obs = trialsToObservations(trials, prof({ flick: 1 }), { noiseVar: 0.1 });
      const mu = (1 + 5 + 8) / 3;
      const sd = sampleStd(scores);
      // x, y and the nugget stay EXACTLY the pre-tau affine mapping - tau is additive information only
      expect(obs.map((o) => o.x)).toEqual([20, 35, 50].map((cm) => Math.log(cm)));
      expect(obs.map((o) => o.y)).toEqual(scores.map((s) => (s - mu) / sd));
      const expectedNoise = Math.min(Math.max((0.4 / sd) ** 2, 0.25 * 0.1), 4.0 * 0.1);
      for (const o of obs) expect(o.noise as number).toBeCloseTo(expectedNoise, 12);
      for (const o of obs) expect(Number.isFinite(o.tau as number)).toBe(true);
    });
  });

  it('blends two instruments toward a peak between their individual peaks', () => {
    const mk = (id: InstrumentId, cm: number, peakCm: number): TrialResult => {
      const x = Math.log(cm);
      const c = Math.log(peakCm);
      return trial(id, cm, -(x - c) * (x - c));
    };
    const sweep = [16, 22, 30, 40, 52];
    const trials = [
      ...sweep.map((cm) => mk('flick', cm, 24)),
      ...sweep.map((cm) => mk('track', cm, 48)),
    ];
    const peak = fitPeak(trialsToObservations(trials, prof({ flick: 1, track: 1 }))).optimalCounts;
    expect(peak).toBeGreaterThan(27);
    expect(peak).toBeLessThan(45);
  });
});
