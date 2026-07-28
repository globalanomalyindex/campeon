import { describe, it, expect } from 'vitest';
import { finalizeReport, runSession } from '../../src/optimizer/session-controller';
import { anchorFromReaches, FLICK_MIN_LEVELS, FLICK_MIN_REACHES } from '../../src/anchor/flick-anchor';
import { leadInReaches } from '../../src/instruments/acclimation';
import { makeBo } from '../../src/optimizer/bayesopt';
import { mulberry32 } from '../../src/stats/bootstrap';
import { FakeScene } from '../instruments/fake-scene';
import { counts360, countsBounds } from '../../src/types';
import type { Counts360, Instrument, InstrumentId, Observation, Profile, SearchEngine, TrialContext, TrialResult } from '../../src/types';

// These fixtures use small count totals (15 to 60) because the search is scale free in ln space, and
// keeping the numbers small keeps the fitted peaks in this file comparable to the ones it was written
// against. Nothing here depends on them being physically plausible; tests/convert/
// counts-invariance.test.ts is the test that pins scale freedom as a property.

const bounds: [Counts360, Counts360] = countsBounds(15, 60);

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
    expect(r.optimalCounts).toBeGreaterThan(28);
    expect(r.optimalCounts).toBeLessThan(40);
    expect(r.ci90[0]).toBeLessThanOrEqual(r.optimalCounts);
    expect(r.ci90[1]).toBeGreaterThanOrEqual(r.optimalCounts);
    expect(r.curve.length).toBeGreaterThan(0);
  });

  it('clamps the optimum and CI to the bounds', () => {
    const r = finalizeReport(concave(34, 0.02), bounds, mulberry32(2), { bootstrapIters: 200 });
    expect(r.optimalCounts).toBeGreaterThanOrEqual(15);
    expect(r.optimalCounts).toBeLessThanOrEqual(60);
    expect(r.ci90[0]).toBeGreaterThanOrEqual(15);
    expect(r.ci90[1]).toBeLessThanOrEqual(60);
  });

  describe('peakAtBound (bounds honesty: a clamped vertex is disclosed as a bound)', () => {
    // The defect this pins: a concave fit whose vertex sits OUTSIDE the searched range used to be
    // silently clamped to the edge and reported exactly like an interior optimum, with a clamped
    // "measured" band around it. The flag makes the clamp observable in the data itself, so no
    // rendering layer can mistake an edge for a located peak.
    it('flags the report on whichever side the vertex fell past, and the printed number is the edge', () => {
      // concave(90): every observed cm sits inside [15, 60] but the least-squares vertex is at
      // ln(90), past the high edge. The session concluded "best is beyond the range searched".
      const high = finalizeReport(concave(90, 0.02), bounds, mulberry32(21), { bootstrapIters: 200 });
      expect(high.peakAtBound).toBe('high');
      expect(high.optimalCounts).toBe(bounds[1]); // the number IS the edge; the flag says so
      const low = finalizeReport(concave(8, 0.02), bounds, mulberry32(22), { bootstrapIters: 200 });
      expect(low.peakAtBound).toBe('low');
      expect(low.optimalCounts).toBe(bounds[0]);
    });

    it('an interior vertex carries NO flag: absence means located, and is never fabricated', () => {
      const r = finalizeReport(concave(34, 0.02), bounds, mulberry32(23), { bootstrapIters: 200 });
      expect(r.peakAtBound).toBeUndefined();
    });

    it('the no-peak fallback carries NO flag (its full-bounds CI is already the honesty signal)', () => {
      const flat: Observation[] = [15, 25, 35, 45, 60].map((cm, i) => ({ x: Math.log(cm), y: 0.1 * i }));
      const r = finalizeReport(flat, bounds, mulberry32(24));
      expect(r.peakAtBound).toBeUndefined();
      expect(r.ci90).toEqual([15, 60]);
    });

    it('follows the fit that actually ran: a DETRENDED vertex past the edge is flagged too', () => {
      // Same construction as the A4 drift fixtures below, with the latent peak pushed past the
      // high edge. The extended fit must run (driftZ present) and the flag must reflect ITS vertex,
      // proving the clamp check sits after model selection, on whichever fit produced the number.
      const cms = [18, 22, 26, 30, 35, 40, 46, 52, 58, 30, 29, 32, 31, 28];
      const ks = cms.map((_, k) => k);
      const muK = ks.reduce((s, v) => s + v, 0) / ks.length;
      const sdK = Math.sqrt(ks.reduce((s, v) => s + (v - muK) ** 2, 0) / (ks.length - 1));
      const peakX = Math.log(90);
      const rng = mulberry32(5);
      const obs: Observation[] = cms.map((cm, k) => {
        const x = Math.log(cm);
        const tau = (k - muK) / sdK;
        return { x, tau, y: -2 * (x - peakX) ** 2 + 5 + 0.8 * tau + (rng() * 2 - 1) * 0.02 };
      });
      const ext = finalizeReport(obs, bounds, mulberry32(25), { bootstrapIters: 200, detrendDrift: true });
      expect(ext.driftZ).toBeDefined(); // the extended fit is the one that ran
      expect(ext.peakAtBound).toBe('high');
      expect(ext.optimalCounts).toBe(bounds[1]);
    });
  });

  it('falls back to a full-bounds CI when the curve is not concave (flat data)', () => {
    const flat: Observation[] = [15, 25, 35, 45, 60].map((cm, i) => ({ x: Math.log(cm), y: 0.1 * i }));
    const r = finalizeReport(flat, bounds, mulberry32(3));
    expect(r.ci90).toEqual([15, 60]);
    expect(Number.isFinite(r.optimalCounts)).toBe(true);
  });

  it('widens the CI when a supplied GP peak disagrees with the curve peak', () => {
    const base = finalizeReport(concave(34, 0.02), bounds, mulberry32(4), { bootstrapIters: 200 });
    const widened = finalizeReport(concave(34, 0.02), bounds, mulberry32(4), {
      bootstrapIters: 200,
      gpPeakCounts: 55,
    });
    expect(widened.ci90[1]).toBeGreaterThanOrEqual(55 - 1e-9);
    expect(widened.ci90[1]).toBeGreaterThanOrEqual(base.ci90[1]);
  });

  it('does NOT widen when the GP peak agrees with the curve peak', () => {
    const base = finalizeReport(concave(34, 0.02), bounds, mulberry32(8), { bootstrapIters: 200 });
    const agree = finalizeReport(concave(34, 0.02), bounds, mulberry32(8), {
      bootstrapIters: 200,
      gpPeakCounts: base.optimalCounts, // identical → log-distance 0, below threshold
    });
    expect(agree.ci90).toEqual(base.ci90);
  });

  it('handles empty observations without throwing (honest full-bounds report)', () => {
    const r = finalizeReport([], bounds, mulberry32(1));
    expect(r.ci90).toEqual([15, 60]);
    expect(Number.isFinite(r.optimalCounts)).toBe(true);
    expect(r.curve).toEqual([]);
  });

  it('plumbs per-point noise to the reliability-aware bootstrap: a loud facet widens the CI more at a high-leverage end than at the center', () => {
    // finalizeReport must hand each point's measured Observation.noise straight through to the
    // reliability-aware bootstrap. We hold EVERYTHING constant - same points, same seed, same
    // heteroscedastic shape (exactly one loud facet at noise 6.0, the rest at 0.05, so BOTH inputs take
    // the union path) - and vary ONLY where the loud facet sits. The data carries genuine residual
    // spread (concave with 0.4 noise) so the per-point sd has real residuals to scale. A loud point at a
    // high-leverage END of the sampled range perturbs the peak far more than a loud point in the CENTER,
    // so the end-loud CI must be strictly wider. This is load-bearing for the sd-weighting AND its
    // plumbing: drop the noise plumbing (or strip the sd-scaling in bootstrap.ts) and facet placement
    // stops mattering, collapsing the two widths and failing this.
    // The shared `concave` helper uses curvature -1 across the whole search range, which at
    // noise 0.4 is too weak to locate a peak at all: most resamples come out non-concave, and
    // since those now widen the band instead of being dropped, BOTH variants honestly report
    // the full range and the comparison saturates. So this case gets a sharper, genuinely
    // identifiable peak, which is what makes the placement effect measurable.
    const sharpRng = mulberry32(5);
    const base: Observation[] = [18, 22, 26, 30, 35, 42, 52].map((cm) => {
      const x = Math.log(cm);
      const d = x - Math.log(34);
      return { x, y: -4 * d * d + (sharpRng() * 2 - 1) * 0.4 };
    });
    const endLoud = base.map((o, i) => ({ ...o, noise: i === 6 ? 6.0 : 0.05 }));   // loud at last (end) cm
    const centralLoud = base.map((o, i) => ({ ...o, noise: i === 3 ? 6.0 : 0.05 })); // loud at central cm
    const endR = finalizeReport(endLoud, bounds, mulberry32(909), { bootstrapIters: 400 });
    const centralR = finalizeReport(centralLoud, bounds, mulberry32(909), { bootstrapIters: 400 });
    const endW = endR.ci90[1] - endR.ci90[0];
    const centralW = centralR.ci90[1] - centralR.ci90[0];
    expect(endW).toBeGreaterThan(centralW);
    // Guard the fixture itself: if either band saturates the search bounds the comparison is
    // vacuous, so a future edit that weakens the peak fails here rather than passing silently.
    expect(endW, 'fixture must stay identifiable').toBeLessThan(bounds[1] - bounds[0] - 1);
  });

  it('reports the whole search range when the data cannot locate a peak at all', () => {
    // The honesty direction that matters. A weak curve under real noise sends most resamples
    // non-concave. Those carry no peak estimate, and they used to be dropped from both the
    // numerator AND the denominator, so the band was taken over the surviving minority and
    // came out tight and confident. Keeping them in the denominator means a run that cannot
    // find a peak says so, by widening toward the full range instead of narrowing.
    const weak = concave(34, 0.4); // curvature -1 across [15, 60]: not identifiable at this noise
    const r = finalizeReport(weak, bounds, mulberry32(909), { bootstrapIters: 400 });
    const width = r.ci90[1] - r.ci90[0];
    expect(width).toBeGreaterThan((bounds[1] - bounds[0]) * 0.9);
    // It must still be a real interval inside the searched window, never a fabricated one.
    expect(r.ci90[0]).toBeGreaterThanOrEqual(bounds[0]);
    expect(r.ci90[1]).toBeLessThanOrEqual(bounds[1]);
    expect(r.ci90[0]).toBeLessThan(r.ci90[1]);
  });

  describe('detrendDrift (A4 ANCOVA session-drift adjustment, finalize-only)', () => {
    // Explore sweep then exploitation near cm=30 with an injected linear drift b3·tau (tau = the
    // standardized trial-order index, exactly what trialsToObservations emits). The drift loads onto
    // the x-curve and biases the plain peak; the extended fit partials it out.
    const peakX = Math.log(35);
    const cms = [18, 22, 26, 30, 35, 40, 46, 52, 58, 30, 29, 32, 31, 28];
    const ks = cms.map((_, k) => k);
    const muK = ks.reduce((s, v) => s + v, 0) / ks.length;
    const sdK = Math.sqrt(ks.reduce((s, v) => s + (v - muK) ** 2, 0) / (ks.length - 1));
    const driftObs = (b3: number, noise = 0, seed = 5): Observation[] => {
      const rng = mulberry32(seed);
      return cms.map((cm, k) => {
        const x = Math.log(cm);
        const tau = (k - muK) / sdK;
        return { x, tau, y: -2 * (x - peakX) ** 2 + 5 + b3 * tau + (rng() * 2 - 1) * noise };
      });
    };

    it('recovers a peak closer to truth than the plain fit and reports the drift readout', () => {
      const obs = driftObs(0.8);
      const plain = finalizeReport(obs, bounds, mulberry32(1), { bootstrapIters: 200 });
      const ext = finalizeReport(obs, bounds, mulberry32(1), { bootstrapIters: 200, detrendDrift: true });
      expect(Math.abs(ext.optimalCounts - 35)).toBeLessThan(Math.abs(plain.optimalCounts - 35));
      expect(ext.optimalCounts).toBeCloseTo(35, 1);
      expect(ext.driftZ).toBeCloseTo(0.8, 4);
      expect(plain.driftZ).toBeUndefined(); // drift is opt-in at finalize, never ambient
    });

    it('zero-drift byte-identity: input with NO tau signal takes the plain path unchanged (b3 dropped)', () => {
      const noTau = concave(34, 0.05); // no tau anywhere → the b3 column must be DROPPED, not fit-near-zero
      const plain = finalizeReport(noTau, bounds, mulberry32(4), { bootstrapIters: 200 });
      const ext = finalizeReport(noTau, bounds, mulberry32(4), { bootstrapIters: 200, detrendDrift: true });
      expect(ext).toEqual(plain); // peak, CI and curve all byte-identical
      expect(ext.driftZ).toBeUndefined(); // the drift readout is dashed, never padded
    });

    it('collinear tau/x falls back to the plain path byte-identically and dashes the readout', () => {
      // geometric sweep → x linear in trial order → tau an exact function of x → b3 unidentifiable
      const geo = Array.from({ length: 14 }, (_, k) => 18 * Math.pow(58 / 18, k / 13));
      const rng = mulberry32(9);
      const collinear: Observation[] = geo.map((cm, k) => {
        const x = Math.log(cm);
        const tau = (k - muK) / sdK;
        return { x, tau, y: -2 * (x - peakX) ** 2 + 5 + (rng() * 2 - 1) * 0.05 };
      });
      const plain = finalizeReport(collinear, bounds, mulberry32(6), { bootstrapIters: 200 });
      const ext = finalizeReport(collinear, bounds, mulberry32(6), { bootstrapIters: 200, detrendDrift: true });
      expect(ext).toEqual(plain);
      expect(ext.driftZ).toBeUndefined();
    });

    it('the extended-fit CI is never narrower than the plain-fit CI on the same seed', () => {
      const obs = driftObs(0.8, 0.3, 11); // genuine residual spread for the bootstrap
      const plain = finalizeReport(obs, bounds, mulberry32(31), { bootstrapIters: 400 });
      const ext = finalizeReport(obs, bounds, mulberry32(31), { bootstrapIters: 400, detrendDrift: true });
      expect(ext.ci90[0]).toBeLessThanOrEqual(plain.ci90[0] + 1e-9);
      expect(ext.ci90[1]).toBeGreaterThanOrEqual(plain.ci90[1] - 1e-9);
    });

    it('too few observations (n < 10) fall back to the plain path and dash the readout', () => {
      const obs = driftObs(0.8).slice(0, 9);
      const plain = finalizeReport(obs, bounds, mulberry32(2), { bootstrapIters: 200 });
      const ext = finalizeReport(obs, bounds, mulberry32(2), { bootstrapIters: 200, detrendDrift: true });
      expect(ext).toEqual(plain);
      expect(ext.driftZ).toBeUndefined();
    });
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

const sessionBounds: [Counts360, Counts360] = countsBounds(15, 60);

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
      const x = Math.log(ctx.counts);
      const noise = (ctx.rng() * 2 - 1) * 0.04;
      const score = -(x - c) * (x - c) + noise;
      return Promise.resolve<TrialResult>({ instrument: id, counts: ctx.counts, score, raw: {}, at: 0 });
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

describe('runSession - convergence on synthetic players', () => {
  it('finds a single instrument latent optimum, with a sub-bounds CI containing the estimate', async () => {
    const bo = makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.05 }, acquisition: 'ei' });
    const { report, trials } = await runSession({
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
    expect(report.optimalCounts).toBeGreaterThan(33);
    expect(report.optimalCounts).toBeLessThan(47);
    expect(report.ci90[0]).toBeLessThanOrEqual(report.optimalCounts);
    expect(report.ci90[1]).toBeGreaterThanOrEqual(report.optimalCounts);
    expect(report.ci90[1] - report.ci90[0]).toBeLessThan(45); // tighter than the full bounds
  });

  it('blends two instruments toward an optimum between their peaks', async () => {
    const bo = makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.05 }, acquisition: 'ei' });
    const { report } = await runSession({
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
    expect(report.optimalCounts).toBeGreaterThan(27);
    expect(report.optimalCounts).toBeLessThan(45);
  });

  it('wires the engine posteriorPeak into the final report - CI widens on GP/parabola disagreement', async () => {
    // Stub engine whose posteriorPeak sits far from the parabola peak (~30): the final CI must span
    // it, proving runSession forwards posteriorPeak → finalizeReport (spec §5.3). Load-bearing -
    // remove the wiring and ci90[1] falls back near the bootstrap upper, failing this.
    const SENTINEL = counts360(58);
    const stub: SearchEngine = {
      suggest: (_o, b) => counts360(Math.sqrt(b[0] * b[1])),
      isDone: () => false,
      posteriorPeak: () => SENTINEL,
    };
    const { report } = await runSession({
      profile: profile({ flick: 1 }),
      bounds: sessionBounds,
      engine: stub,
      instruments: instruments({ flick: synthetic('flick', 30) }),
      scene: new FakeScene(),
      schedule: ['flick'],
      maxTrials: 14,
      rng: mulberry32(11),
      bootstrapIters: 200,
    });
    expect(report.optimalCounts).toBeLessThan(45); // parabola peak ~30, far from the sentinel
    expect(report.ci90[1]).toBeGreaterThanOrEqual(SENTINEL - 1e-9);
  });

  it('fits GP hyperparameters at FINALIZE ONLY: posteriorPeakWith is used, suggest stays unfitted', async () => {
    // The engine exposes gpParams + posteriorPeakWith → the controller must fit at finalize and route
    // the cross-check peak through posteriorPeakWith (NOT the plain posteriorPeak). We prove (a) the
    // fitted params reach posteriorPeakWith, (b) every `suggest` call saw the UNFITTED base params, so
    // the lineage is never desynced. Both are load-bearing: drop the wiring and the spies disagree.
    const baseGp = { signalVar: 1, lengthScale: 0.6, noiseVar: 0.1 };
    let peakWithCalls = 0;
    let plainPeakCalls = 0;
    let fittedSeen: typeof baseGp | undefined;
    const suggestParams: (typeof baseGp)[] = [];
    const SENTINEL = counts360(57);
    const engine: SearchEngine = {
      gpParams: baseGp,
      // suggest must always run on the base params (it does not even receive the fitted set; we
      // record the params it would use to prove finalize-fitting never leaks into the lineage).
      suggest: (_o, b) => {
        suggestParams.push(baseGp);
        return counts360(Math.sqrt(b[0] * b[1]));
      },
      isDone: () => false,
      posteriorPeak: () => {
        plainPeakCalls += 1;
        return counts360(30); // if wrongly used, it would AGREE with the parabola and NOT widen
      },
      posteriorPeakWith: (_o, _b, params) => {
        peakWithCalls += 1;
        fittedSeen = params;
        return SENTINEL; // disagrees with the parabola → must widen the CI, proving it was used
      },
    };
    const { report } = await runSession({
      profile: profile({ flick: 1 }),
      bounds: sessionBounds,
      engine,
      instruments: instruments({ flick: synthetic('flick', 30) }),
      scene: new FakeScene(),
      schedule: ['flick'],
      maxTrials: 14,
      rng: mulberry32(11),
      bootstrapIters: 200,
    });
    expect(peakWithCalls).toBe(1);          // exactly one finalize-time fitted cross-check
    expect(plainPeakCalls).toBe(0);         // the unfitted posteriorPeak is bypassed when params exist
    expect(fittedSeen?.signalVar).toBe(baseGp.signalVar); // signalVar pinned to base by the fit
    expect(suggestParams.every((p) => p === baseGp)).toBe(true); // every suggest saw base, not fitted
    expect(report.ci90[1]).toBeGreaterThanOrEqual(SENTINEL - 1e-9); // fitted peak reached the report
  });

  it('detrends session drift at FINALIZE ONLY: the final report carries driftZ, interims never do', async () => {
    // A synthetic player whose score genuinely improves with every trial (within-session practice
    // drift) on top of a latent peak at 40. The final report must fit the extended model (driftZ
    // present, positive); every interim report stays on the plain path (finalize-only invariant).
    const c = Math.log(40);
    let k = 0;
    const drifting: Instrument = {
      id: 'flick',
      run(ctx) {
        const x = Math.log(ctx.counts);
        const noise = (ctx.rng() * 2 - 1) * 0.04;
        const score = -(x - c) * (x - c) + 0.08 * k++ + noise;
        return Promise.resolve<TrialResult>({ instrument: 'flick', counts: ctx.counts, score, raw: {}, at: 0 });
      },
    };
    const interimDrifts: (number | undefined)[] = [];
    const bo = makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.05 }, acquisition: 'ei' });
    const { report } = await runSession({
      profile: profile({ flick: 1 }),
      bounds: sessionBounds,
      engine: bo,
      instruments: instruments({ flick: drifting }),
      scene: new FakeScene(),
      schedule: ['flick'],
      maxTrials: 22,
      rng: mulberry32(123),
      bootstrapIters: 300,
      onTrial: (_t, _trials, interim) => interimDrifts.push(interim.driftZ),
    });
    expect(report.driftZ).toBeDefined();
    expect(report.driftZ as number).toBeGreaterThan(0); // the injected practice trend, in blended σ
    expect(interimDrifts.every((d) => d === undefined)).toBe(true); // finalize-only
  });

  it('stops early once the CI is tight enough', async () => {
    const bo = makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.05 }, acquisition: 'ei' });
    const { trials } = await runSession({
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
    const post = trials.slice(coldStart).map((t) => t.counts);
    const nearPeak = post.filter((c) => c >= 35 && c <= 45).length;
    expect(nearPeak / post.length).toBeGreaterThan(0.7); // EI concentration, far above uniform's ~0.22
    expect(Math.min(...post.map((c) => Math.abs(c - 40)))).toBeLessThan(2); // homed in on the true peak
  });
});

describe('runSession - shouldStop / initialTrials', () => {
  const cfg = (extra: Record<string, unknown>) => ({
    profile: profile({ flick: 1 }),
    bounds: sessionBounds,
    engine: makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.05 }, acquisition: 'ei' as const }),
    instruments: instruments({ flick: synthetic('flick', 33) }),
    scene: new FakeScene(),
    schedule: ['flick'] as InstrumentId[],
    maxTrials: 30,
    coldStart: 4,
    rng: mulberry32(5),
    bootstrapIters: 80,
    ...extra,
  });

  it('threads the arrival gain, so the acclimation lead-in can size itself to the change', async () => {
    // The lead-in budget scales with |ln(counts) - ln(prevCounts)|, because the cost of adapting
    // to an unfamiliar gain scales with how far the gain moved. If the controller does not hand
    // over the previous trial's sensitivity, every trial spends the full worst-case budget: safe,
    // since over-acclimating cannot bias a score, but it charges the player time for nothing.
    const seen: Array<number | undefined> = [];
    const spy: Instrument = {
      id: 'flick',
      run: async (ctx) => {
        seen.push(ctx.prevCounts);
        return { instrument: 'flick', counts: ctx.counts, score: 0.5, raw: {}, at: 0 } as TrialResult;
      },
    };
    const { trials } = await runSession(cfg({
      instruments: { flick: spy } as Record<InstrumentId, Instrument>,
      maxTrials: 4,
      coldStart: 4,
    }));
    expect(seen).toHaveLength(4);
    // Trial 0 has no predecessor, so the arrival gain is genuinely unknown and stays absent.
    expect(seen[0]).toBeUndefined();
    // Every later trial receives exactly the sensitivity the previous trial ran at.
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i], `trial ${i} arrival gain`).toBe(trials[i - 1]!.counts);
    }
  });

  it('breaks the loop when shouldStop returns true (checked at the top of each iteration)', async () => {
    let n = 0;
    const { trials } = await runSession(cfg({ shouldStop: () => { n += 1; return n >= 6; } }));
    expect(trials.length).toBe(5); // stops before the 6th trial (the 6th shouldStop check returns true)
  });

  it('resumes from initialTrials and skips cold-start (the seeds are preserved, new trials use suggest)', async () => {
    const seed: TrialResult[] = Array.from({ length: 8 }, (_, i) => (
      { instrument: 'flick', counts: counts360(28 + i), score: 0.5, raw: {}, at: 0 }
    ));
    const stub: SearchEngine = { suggest: () => counts360(30), isDone: () => false };
    const { trials } = await runSession(cfg({ engine: stub, initialTrials: seed, maxTrials: 10, coldStart: 4 }));
    expect(trials.length).toBe(10);          // 8 seeded + 2 new
    expect(trials[0]!.counts).toBe(28);       // seed preserved at the front (proves resume, not a fresh run)
    expect(trials[7]!.counts).toBe(35);       // last seed preserved
    // the 2 NEW trials use the engine's suggest (30), not log-spaced cold-start seeds → cold-start skipped
    expect(trials[8]!.counts).toBe(30);
    expect(trials[9]!.counts).toBe(30);
  });
});

describe('runSession - live callbacks', () => {
  const base = () => ({
    profile: profile({ flick: 1 }),
    bounds: sessionBounds,
    engine: makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.05 }, acquisition: 'ei' as const }),
    instruments: instruments({ flick: synthetic('flick', 33) }),
    scene: new FakeScene(),
    schedule: ['flick'] as InstrumentId[],
    maxTrials: 6,
    rng: mulberry32(5),
    bootstrapIters: 80,
  });

  it('fires onTrialStart before and onTrial after each trial with a finite interim estimate', async () => {
    const starts: number[] = [];
    const afters: number[] = [];
    await runSession({
      ...base(),
      onTrialStart: (_id, i) => starts.push(i),
      onTrial: (_t, trials, interim) => {
        afters.push(trials.length);
        expect(Number.isFinite(interim.optimalCounts)).toBe(true);
      },
    });
    expect(starts).toEqual([0, 1, 2, 3, 4, 5]);
    expect(afters).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('the trial sequence is identical whether or not onTrial is set (interim uses its own RNG)', async () => {
    const a = await runSession({ ...base(), rng: mulberry32(5) });
    const b = await runSession({ ...base(), rng: mulberry32(5), onTrial: () => {} });
    expect(b.trials.map((t) => t.counts)).toEqual(a.trials.map((t) => t.counts));
  });
});

/**
 * Per-frame share of a reach's primary displacement. The same trace phase 4's reach-observer test
 * drives, and it is chosen rather than smooth on purpose: the shares sum to exactly 1.00 at index 6
 * and then correct, so segment() finds a strict local minimum at precisely the sample whose aim is
 * the primary submovement's full extent. A monotone ramp has no trough and the observer would drop
 * the reach, which is the correct behaviour and would make this fixture measure nothing.
 */
const FRACTIONS = [0, 0.06, 0.26, 0.44, 0.18, 0.04, 0.02, 0.12, 0.05, 0.01] as const;

/**
 * A scripted player that presents targets on the scene exactly as the discrete instruments do
 * (spawn one, reach, clear it, spawn the next) and whose OPEN-LOOP reach lands the fraction of the
 * way its belief implies, adapting within the trial.
 *
 * ln f = (ln B0 - ln C_r) * rate^j + bias, which is the model src/anchor/flick-anchor.ts fits. The
 * target sits 30 degrees away, so the along-axis miss at the trough is 30 * (f - 1) and the reach
 * amplitude is 30: landedFraction is f exactly, with no tolerance to tune. Direction alternates so
 * the scene's yaw does not walk away across hundreds of reaches.
 *
 * It is NOT one of the shipped drills. It exercises the scene protocol the drills use and nothing
 * about their scoring, which is covered by their own suites.
 */
function reachingPlayer(opts: {
  scene: FakeScene;
  id: InstrumentId;
  believed: number;
  peak: number;
  perTrial: number;
  rate?: number;
  bias?: number;
  noise?: number;
  seed?: number;
}): Instrument {
  const rate = opts.rate ?? 0.6;
  const bias = opts.bias ?? Math.log(0.94); // the cheap correction: a persistent 6 percent undershoot
  const noise = opts.noise ?? 0;
  const rng = mulberry32(opts.seed ?? 0xb01d);
  const gauss = (): number => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  return {
    id: opts.id,
    run(ctx) {
      const scene = opts.scene;
      const e0 = Math.log(opts.believed) - Math.log(ctx.counts);
      for (let j = 0; j < opts.perTrial; j++) {
        const dir = j % 2 === 0 ? 1 : -1;
        const start = scene.view()[0];
        scene.spawnTarget({ kind: 'static', yaw: start + dir * 30, pitch: 0, distance: 20, worldRadius: 0.6 });
        const f = Math.exp(e0 * Math.pow(rate, j) + bias + noise * gauss());
        let yaw = start;
        for (const share of FRACTIONS) {
          scene.tick(16, [yaw, 0]);
          yaw += share * dir * 30 * f;
        }
        scene.clearTargets();
        scene.tick(16, [yaw, 0]); // the target is gone, so the observer closes the reach
      }
      const d = Math.log(ctx.counts) - Math.log(opts.peak);
      return Promise.resolve<TrialResult>({
        instrument: opts.id,
        counts: ctx.counts,
        score: -d * d + (ctx.rng() * 2 - 1) * 0.02,
        raw: {},
        at: 0,
      });
    },
  };
}

const COUNT_BOUNDS: [Counts360, Counts360] = [counts360(3000), counts360(12000)];

describe('runSession - the anchor observational channel', () => {
  const B0 = 9000; // the counts per 360 the scripted player's hands believe in
  const PEAK = 6000; // where its score peaks, which is not where its belief sits
  const PER_TRIAL = 12;
  const MAX_TRIALS = 24;

  /** One session against the scripted player, plus the ctx each trial actually received. */
  const play = async (): Promise<{
    outcome: Awaited<ReturnType<typeof runSession>>;
    ctxs: TrialContext[];
  }> => {
    const scene = new FakeScene();
    const player = reachingPlayer({ scene, id: 'flick', believed: B0, peak: PEAK, perTrial: PER_TRIAL, noise: 0.03 });
    const ctxs: TrialContext[] = [];
    const spy: Instrument = {
      id: 'flick',
      run: (c, s) => {
        ctxs.push(c);
        return player.run(c, s);
      },
    };
    const outcome = await runSession({
      profile: profile({ flick: 1 }),
      bounds: COUNT_BOUNDS,
      engine: makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.05 }, acquisition: 'ei' }),
      instruments: instruments({ flick: spy }),
      scene,
      schedule: ['flick'],
      maxTrials: MAX_TRIALS,
      coldStart: 8,
      rng: mulberry32(4242),
      bootstrapIters: 200,
    });
    return { outcome, ctxs };
  };

  it('reads every reach of every trial exactly once', async () => {
    const { outcome } = await play();
    // Exactly once is also the assertion that ONE observer was constructed for the run. Building it
    // inside the loop would subscribe a second listener to the same frame stream and double this.
    expect(outcome.reaches).toHaveLength(MAX_TRIALS * PER_TRIAL);
    expect(outcome.reaches.every((r) => Number.isFinite(r.landedFraction) && r.landedFraction > 0)).toBe(true);
  });

  it('numbers reaches from 0 within each trial, which is what carries the adaptation term', async () => {
    const { outcome } = await play();
    const expected = Array.from({ length: PER_TRIAL }, (_, j) => j);
    expect(outcome.reaches.slice(0, PER_TRIAL).map((r) => r.index)).toEqual(expected);
    expect(outcome.reaches.slice(PER_TRIAL, PER_TRIAL * 2).map((r) => r.index)).toEqual(expected);
  });

  it('opens the trial before the instrument spawns, so the FIRST trial is not silently lost', async () => {
    // beginTrial sequenced after run() would leave `rendered` null for the whole first trial and
    // drop its reaches with no error anywhere. The first trial's gain appearing among the rendered
    // gains is the only external evidence the call is ordered right.
    const { outcome, ctxs } = await play();
    const rendered = new Set(outcome.reaches.map((r) => r.rendered));
    expect(rendered.has(ctxs[0]!.counts)).toBe(true);
    expect(rendered.size).toBeGreaterThanOrEqual(FLICK_MIN_LEVELS);
  });

  it('discloses how many of the reaches it read were reaches the scorer discarded', async () => {
    const { outcome, ctxs } = await play();
    // Computed from the same pure query the controller hands the observer, over the same ctx
    // objects the instruments received, and capped by how many reaches the trial actually contained.
    const expected = ctxs.reduce((n, c) => n + Math.min(leadInReaches(c), PER_TRIAL), 0);
    expect(outcome.leadInDiscarded).toBe(expected);
    expect(outcome.leadInDiscarded).toBeGreaterThan(0);
    expect(outcome.leadInDiscarded).toBeLessThan(outcome.reaches.length);
  });

  it('the reaches it carries out recover the belief the player was scripted with', async () => {
    const { outcome } = await play();
    expect(outcome.reaches.length).toBeGreaterThanOrEqual(FLICK_MIN_REACHES);
    const a = anchorFromReaches(outcome.reaches);
    if (a.identifiable !== true) throw new Error(`expected identifiable, got refusal: ${a.reason}`);
    // 8 percent, against the 4.6 percent mean absolute error the estimator demonstrated across
    // simulated sessions. This is one session, so the window is wider than the claim; it is not a
    // licence to loosen it further. If this fails, print `a` and check adaptRate first: a rate
    // pinned at a bound means the searched band collapsed, not that the estimator broke.
    expect(Math.abs(a.counts / B0 - 1)).toBeLessThan(0.08);
    // And the belief is NOT the optimum. If these two were the same number the whole test would
    // pass on an estimator that just echoed the located counts back.
    expect(Math.abs(a.counts / outcome.report.optimalCounts - 1)).toBeGreaterThan(0.2);
  });

  it('a scene that presents nothing yields no reaches and an honest refusal, never a guess', async () => {
    // The synthetic instruments above never touch the scene. That is a real deployment state (a
    // headless or scripted run), and the whole point of carrying reaches out rather than an anchor
    // is that the caller sees the emptiness and the estimator refuses on it.
    const outcome = await runSession({
      profile: profile({ flick: 1 }),
      bounds: COUNT_BOUNDS,
      engine: makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.05 }, acquisition: 'ei' }),
      instruments: instruments({ flick: synthetic('flick', PEAK) }),
      scene: new FakeScene(),
      schedule: ['flick'],
      maxTrials: 10,
      rng: mulberry32(5),
      bootstrapIters: 80,
    });
    expect(outcome.reaches).toEqual([]);
    expect(outcome.leadInDiscarded).toBe(0);
    expect(anchorFromReaches(outcome.reaches)).toEqual({ identifiable: false, reason: 'too-few-reaches' });
  });

  it('is deterministic: the same seeds twice give the identical reaches', async () => {
    const a = await play();
    const b = await play();
    expect(b.outcome.reaches).toEqual(a.outcome.reaches);
    expect(b.outcome.trials.map((t) => t.counts)).toEqual(a.outcome.trials.map((t) => t.counts));
  });
});
