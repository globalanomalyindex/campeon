import { describe, it, expect } from 'vitest';
import { finalizeReport, runSession } from '../../src/optimizer/session-controller';
import { makeBo } from '../../src/optimizer/bayesopt';
import { mulberry32 } from '../../src/stats/bootstrap';
import { FakeScene } from '../instruments/fake-scene';
import type { Cm360, Instrument, InstrumentId, Observation, Profile, TrialResult } from '../../src/types';

const bounds: [number, number] = [15, 60];

const concave = (peakCm: number, noise = 0): Observation[] => {
  const c = Math.log(peakCm);
  const rng = mulberry32(5);
  return [15, 19, 24, 30, 38, 48, 60].map((cm) => {
    const x = Math.log(cm);
    return { x, y: -(x - c) * (x - c) + (rng() * 2 - 1) * noise };
  });
};

describe('finalizeReport', () => {
  it('reports the curve peak with a CI that contains it', () => {
    const r = finalizeReport(concave(34, 0.02), bounds, mulberry32(1), { bootstrapIters: 200 });
    expect(r.optimalCm360).toBeGreaterThan(28);
    expect(r.optimalCm360).toBeLessThan(40);
    expect(r.ci90[0]).toBeLessThanOrEqual(r.optimalCm360);
    expect(r.ci90[1]).toBeGreaterThanOrEqual(r.optimalCm360);
    expect(r.curve.length).toBeGreaterThan(0);
  });

  it('clamps the optimum and CI to the bounds', () => {
    const r = finalizeReport(concave(34, 0.02), bounds, mulberry32(2), { bootstrapIters: 200 });
    expect(r.optimalCm360).toBeGreaterThanOrEqual(15);
    expect(r.optimalCm360).toBeLessThanOrEqual(60);
    expect(r.ci90[0]).toBeGreaterThanOrEqual(15);
    expect(r.ci90[1]).toBeLessThanOrEqual(60);
  });

  it('falls back to a full-bounds CI when the curve is not concave (flat data)', () => {
    const flat: Observation[] = [15, 25, 35, 45, 60].map((cm, i) => ({ x: Math.log(cm), y: 0.1 * i }));
    const r = finalizeReport(flat, bounds, mulberry32(3));
    expect(r.ci90).toEqual([15, 60]);
    expect(Number.isFinite(r.optimalCm360)).toBe(true);
  });

  it('widens the CI when a supplied GP peak disagrees with the curve peak', () => {
    const base = finalizeReport(concave(34, 0.02), bounds, mulberry32(4), { bootstrapIters: 200 });
    const widened = finalizeReport(concave(34, 0.02), bounds, mulberry32(4), {
      bootstrapIters: 200,
      gpPeakCm360: 55,
    });
    expect(widened.ci90[1]).toBeGreaterThanOrEqual(55 - 1e-9);
    expect(widened.ci90[1]).toBeGreaterThanOrEqual(base.ci90[1]);
  });

  it('does NOT widen when the GP peak agrees with the curve peak', () => {
    const base = finalizeReport(concave(34, 0.02), bounds, mulberry32(8), { bootstrapIters: 200 });
    const agree = finalizeReport(concave(34, 0.02), bounds, mulberry32(8), {
      bootstrapIters: 200,
      gpPeakCm360: base.optimalCm360, // identical → log-distance 0, below threshold
    });
    expect(agree.ci90).toEqual(base.ci90);
  });

  it('handles empty observations without throwing (honest full-bounds report)', () => {
    const r = finalizeReport([], bounds, mulberry32(1));
    expect(r.ci90).toEqual([15, 60]);
    expect(Number.isFinite(r.optimalCm360)).toBe(true);
    expect(r.curve).toEqual([]);
  });

  it('the fallback curve is the observed points as {x, mean}, sorted by x', () => {
    // Convex (a valley) → no interior maximum → fitPeak throws → fallback path. cm order shuffled
    // to also exercise the sort.
    const c = Math.log(30);
    const convex: Observation[] = [45, 15, 35, 60, 25].map((cm) => {
      const x = Math.log(cm);
      return { x, y: (x - c) * (x - c) };
    });
    const r = finalizeReport(convex, bounds, mulberry32(3));
    expect(r.curve.length).toBe(5);
    for (let i = 1; i < r.curve.length; i++) expect(r.curve[i].x).toBeGreaterThan(r.curve[i - 1].x);
  });
});

const sessionBounds: [Cm360, Cm360] = [15, 60];

const profile = (weights: Partial<Record<InstrumentId, number>>): Profile => ({
  speedAccuracy: 0.5,
  instrumentWeights: { track: 0, flick: 0, calibrate: 0, strike: 0, ...weights },
});

/** A deterministic synthetic player whose score peaks (in ln cm/360) at `peakCm`. */
function synthetic(id: InstrumentId, peakCm: number): Instrument {
  const c = Math.log(peakCm);
  return {
    id,
    run(ctx) {
      const x = Math.log(ctx.cm360);
      const noise = (ctx.rng() * 2 - 1) * 0.04;
      const score = -(x - c) * (x - c) + noise;
      return Promise.resolve<TrialResult>({ instrument: id, cm360: ctx.cm360, score, raw: {}, at: 0 });
    },
  };
}

function instruments(map: Partial<Record<InstrumentId, Instrument>>): Record<InstrumentId, Instrument> {
  return {
    track: map.track ?? synthetic('track', 30),
    flick: map.flick ?? synthetic('flick', 30),
    calibrate: map.calibrate ?? synthetic('calibrate', 30),
    strike: map.strike ?? synthetic('strike', 30),
  };
}

describe('runSession — convergence on synthetic players', () => {
  it('finds a single instrument latent optimum, with a sub-bounds CI containing the estimate', async () => {
    const bo = makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.05 }, acquisition: 'ei' });
    const { report, trials } = await runSession({
      dpi: 800,
      profile: profile({ flick: 1 }),
      bounds: sessionBounds,
      engine: bo,
      instruments: instruments({ flick: synthetic('flick', 40) }),
      scene: new FakeScene(),
      schedule: ['flick'],
      maxTrials: 22,
      rng: mulberry32(123),
      bootstrapIters: 300,
    });
    expect(trials.length).toBe(22);
    expect(report.optimalCm360).toBeGreaterThan(33);
    expect(report.optimalCm360).toBeLessThan(47);
    expect(report.ci90[0]).toBeLessThanOrEqual(report.optimalCm360);
    expect(report.ci90[1]).toBeGreaterThanOrEqual(report.optimalCm360);
    expect(report.ci90[1] - report.ci90[0]).toBeLessThan(45); // tighter than the full bounds
  });

  it('blends two instruments toward an optimum between their peaks', async () => {
    const bo = makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.05 }, acquisition: 'ei' });
    const { report } = await runSession({
      dpi: 800,
      profile: profile({ flick: 1, track: 1 }),
      bounds: sessionBounds,
      engine: bo,
      instruments: instruments({ flick: synthetic('flick', 24), track: synthetic('track', 48) }),
      scene: new FakeScene(),
      schedule: ['flick', 'track'],
      maxTrials: 24,
      rng: mulberry32(7),
      bootstrapIters: 300,
    });
    expect(report.optimalCm360).toBeGreaterThan(27);
    expect(report.optimalCm360).toBeLessThan(45);
  });

  it('stops early once the CI is tight enough', async () => {
    const bo = makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.05 }, acquisition: 'ei' });
    const { trials } = await runSession({
      dpi: 800,
      profile: profile({ flick: 1 }),
      bounds: sessionBounds,
      engine: bo,
      instruments: instruments({ flick: synthetic('flick', 33) }),
      scene: new FakeScene(),
      schedule: ['flick'],
      maxTrials: 40,
      rng: mulberry32(99),
      minTrials: 8,
      ciStopWidth: 35,
      bootstrapIters: 200,
    });
    expect(trials.length).toBeLessThan(40);
    expect(trials.length).toBeGreaterThanOrEqual(8);
  });

  it('the BO engine is load-bearing: post-cold-start trials concentrate at the latent optimum', async () => {
    // A correct EI engine exploits the peak; a broken/uniform `suggest` would scatter (~22% of
    // samples in [35,45] over [15,60]). This is what distinguishes BO refinement from the
    // cold-start seeds alone (which a global quadratic could already fit).
    const coldStart = 4;
    const bo = makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.05 }, acquisition: 'ei' });
    const { trials } = await runSession({
      dpi: 800,
      profile: profile({ flick: 1 }),
      bounds: sessionBounds,
      engine: bo,
      instruments: instruments({ flick: synthetic('flick', 40) }),
      scene: new FakeScene(),
      schedule: ['flick'],
      maxTrials: 22,
      rng: mulberry32(123),
      coldStart,
      bootstrapIters: 100,
    });
    const post = trials.slice(coldStart).map((t) => t.cm360);
    const nearPeak = post.filter((c) => c >= 35 && c <= 45).length;
    expect(nearPeak / post.length).toBeGreaterThan(0.7); // EI concentration, far above uniform's ~0.22
    expect(Math.min(...post.map((c) => Math.abs(c - 40)))).toBeLessThan(2); // homed in on the true peak
  });
});
