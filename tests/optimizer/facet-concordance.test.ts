import { describe, it, expect } from 'vitest';
import { facetConcordance } from '../../src/optimizer/breakdown';
import { buildResult } from '../../src/optimizer/result';
import { adoptResult } from '../../src/ui/range-adopt';
import { mulberry32 } from '../../src/stats/rng';
import { counts360, countsBounds } from '../../src/types';
import type { InstrumentId, Report, TrialResult } from '../../src/types';

// Six sensitivities spanning a realistic bound; enough for a facet's own concave fit.
const CMS = [16, 21, 27, 34, 44, 57];

/** An inverted-U facet peaked (in ln space) at `peak`: score = -(ln cm - ln peak)^2, plus an optional
 *  tiny alternating wobble so the residual bootstrap has something to chew on. */
function facet(id: InstrumentId, peak: number, wobble = 0): TrialResult[] {
  return CMS.map((cm, i) => ({
    instrument: id,
    counts: counts360(cm),
    at: i,
    score: -Math.pow(Math.log(cm) - Math.log(peak), 2) + (i % 2 ? wobble : -wobble),
    raw: {},
  }));
}

/** A convex (U-shaped) facet: no interior maximum, so its own peak cannot be fit (must dash). */
function convexFacet(id: InstrumentId): TrialResult[] {
  return CMS.map((cm, i) => ({
    instrument: id,
    counts: counts360(cm),
    at: i,
    score: Math.pow(Math.log(cm) - Math.log(30), 2), // opens upward → b2 > 0 → not concave
    raw: {},
  }));
}

describe('facetConcordance - testing the "one latent cm/360" thesis as a claim, not an assumption', () => {
  it('reports CONCORDANT when the non-strike facets peak together', () => {
    const trials = [...facet('track', 30, 0.02), ...facet('flick', 31, 0.02), ...facet('calibrate', 29, 0.02)];
    expect(facetConcordance(trials, mulberry32(7)).tier).toBe('concordant');
  });

  it('reports DIVERGENT only when a non-strike facet is CLEARLY separated (conservative threshold)', () => {
    const trials = [...facet('track', 24, 0.02), ...facet('flick', 25, 0.02), ...facet('calibrate', 52, 0.02)];
    expect(facetConcordance(trials, mulberry32(7)).tier).toBe('divergent');
  });

  it('EXCLUDES the taste-conditioned strike facet from the tier decision', () => {
    // track/flick/calibrate all agree at ~30; strike peaks far off at 90 but must NOT flip the tier.
    const trials = [
      ...facet('track', 30, 0.02), ...facet('flick', 30, 0.02),
      ...facet('calibrate', 30, 0.02), ...facet('strike', 90, 0.02),
    ];
    const c = facetConcordance(trials, mulberry32(7));
    expect(c.tier).toBe('concordant');
    expect(c.facets.find((f) => f.instrument === 'strike')!.laneConditioned).toBe(true);
  });

  it('is INCONCLUSIVE (undefined tier) with fewer than two fittable non-strike facets', () => {
    const trials = [...facet('track', 30, 0.02), ...facet('flick', 30, 0.02).slice(0, 2)]; // flick too few pts
    expect(facetConcordance(trials, mulberry32(7)).tier).toBeUndefined();
  });

  it('dashes a facet whose own trials cannot support a concave peak (never fabricates one)', () => {
    const trials = [...convexFacet('track'), ...facet('flick', 30, 0.02), ...facet('calibrate', 30, 0.02)];
    const track = facetConcordance(trials, mulberry32(7)).facets.find((f) => f.instrument === 'track')!;
    expect(track.peakCounts).toBeUndefined();
    expect(track.spreadLn).toBeUndefined();
  });

  it('is deterministic under a seeded RNG', () => {
    const trials = [...facet('track', 30, 0.03), ...facet('flick', 33, 0.03), ...facet('calibrate', 28, 0.03)];
    const a = facetConcordance(trials, mulberry32(99));
    const b = facetConcordance(trials, mulberry32(99));
    expect(a).toEqual(b);
  });
});

describe('facet concordance wiring: measured Results carry it, tuned Results drop it', () => {
  const report: Report = { optimalCounts: counts360(30), ci90: countsBounds(28, 32), curve: [{ x: Math.log(20), mean: -0.1 }], driftZ: 0.12 };
  const trials = [...facet('track', 30, 0.02), ...facet('flick', 31, 0.02), ...facet('calibrate', 29, 0.02)];
  const profile = { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } };

  it('buildResult attaches a concordance readout (four facets, a tier over the fittable ones)', () => {
    const r = buildResult(report, trials, countsBounds(15, 60), profile);
    expect(r.facetConcordance).toBeDefined();
    expect(r.facetConcordance!.facets).toHaveLength(4);
    expect(r.facetConcordance!.tier).toBe('concordant');
  });

  it('adoptResult (tuned by feel) DROPS the measured concordance AND the drift readout - self-describing export', () => {
    const measured = buildResult(report, trials, countsBounds(15, 60), profile);
    expect(measured.driftZ).toBeDefined();
    const tuned = adoptResult(measured, counts360(42));
    expect(tuned.tuned).toBe(true);
    expect(tuned.facetConcordance).toBeUndefined();
    expect(tuned.driftZ).toBeUndefined();
  });
});
