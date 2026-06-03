import { describe, it, expect } from 'vitest';
import { trialsToObservations } from '../../src/optimizer/objective';
import { fitPeak } from '../../src/stats/peak-fit';
import type { InstrumentId, Profile, TrialResult } from '../../src/types';

const prof = (weights: Partial<Record<InstrumentId, number>>): Profile => ({
  speedAccuracy: 0.5,
  instrumentWeights: { track: 0, flick: 0, calibrate: 0, strike: 0, ...weights },
});

function trial(instrument: InstrumentId, cm360: number, score: number): TrialResult {
  return { instrument, cm360, score, raw: {}, at: 0 };
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
    expect(fitPeak(obs).optimalCm360).toBeCloseTo(35, 0);
  });

  it('drops instruments with no spread (≤1 trial or all-equal) — no NaN', () => {
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
    const peak = fitPeak(trialsToObservations(trials, prof({ flick: 1, track: 1 }))).optimalCm360;
    expect(peak).toBeGreaterThan(27);
    expect(peak).toBeLessThan(45);
  });
});
