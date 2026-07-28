import type { Counts360, Concordance, Degrees, FacetConcordance, FacetPeak, InstrumentId, Ms, Observation, Profile, TrialResult } from '../types';
import { counts360 } from '../types';
import { mean, sampleStd } from '../scoring/stats';
import { fitPeak } from '../stats/peak-fit';
import { bootstrapCi } from '../stats/bootstrap';

export interface Breakdown {
  /** counts per 360 where the calibrate gain crosses 1 (the bias-zero sensitivity, spec §4.3). */
  biasZeroCounts: Counts360;
  /** Minimum calibrate σ_R observed - the precision floor (skill/hardware), not a recommendation. */
  precisionFloorDeg: Degrees;
  /** Strike time-to-kill at the optimum. */
  ttkMs: Ms;
  /** Strike hit rate at the optimum. */
  hitRate: number;
  /** Track's AFFINE-FUSED contribution at the optimum: the SAME w·(score−mu)/sd quantity the optimizer
   *  fuses (objective.ts), evaluated at the track trial nearest the optimum in ln-space. NOT a raw-score
   *  argmax masquerading as a facet recommendation. NaN when <2 trials / no spread / no profile, exactly
   *  like biasZero/precisionFloor already dash. Optional so OLD saved Results render number-only. */
  trackContribZ?: number;
  /** Flick's AFFINE-FUSED contribution at the optimum - see `trackContribZ`. */
  flickContribZ?: number;
}

const byInstrument = (trials: readonly TrialResult[], id: TrialResult['instrument']) =>
  trials.filter((t) => t.instrument === id);

/** counts per 360 where gain = 1, interpolated in ln-space across the bracketing pair; else nearest-to-1. */
function biasZero(cal: readonly TrialResult[]): Counts360 {
  const pts = cal
    .filter((t) => Number.isFinite(t.raw.gain) && t.counts > 0)
    .map((t) => ({ lx: Math.log(t.counts), g: t.raw.gain, cm: t.counts }))
    .sort((a, b) => a.lx - b.lx);
  if (pts.length === 0) return counts360(NaN);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if ((a.g - 1) === 0) return a.cm;
    // Opposite signs ⇒ a.g and b.g straddle 1, so b.g ≠ a.g and the divisor below is nonzero.
    if ((a.g - 1) * (b.g - 1) < 0) {
      const f = (1 - a.g) / (b.g - a.g); // a.g + f·(b.g−a.g) = 1
      return counts360(Math.exp(a.lx + f * (b.lx - a.lx)));
    }
  }
  // No crossing: report the trial whose gain is closest to 1 (honest nearest estimate).
  return pts.reduce((best, p) => (Math.abs(p.g - 1) < Math.abs(best.g - 1) ? p : best)).cm;
}

/**
 * Track/flick's AFFINE-FUSED contribution at the optimum: the SAME w·(score−mu)/sd quantity objective.ts
 * fuses (mu/sd taken across THIS instrument's own trials, weight from the profile), evaluated at the trial
 * nearest the optimum in ln-space. This is deliberately NOT a standalone raw-score argmax. Returns NaN
 * (→ dash) with <2 trials, no spread (sd not > 0), or no profile - exactly as biasZero/precisionFloor dash.
 */
function fusedContribAt(
  trials: readonly TrialResult[],
  id: InstrumentId,
  optimalCounts: Counts360,
  profile?: Profile,
): number {
  if (!profile) return NaN;
  const w = profile.instrumentWeights[id];
  if (!w) return NaN;
  const own = byInstrument(trials, id);
  const scores = own.map((t) => t.score);
  const sd = sampleStd(scores);
  if (!(sd > 0)) return NaN; // <2 trials / all-equal / NaN-poisoned → no usable signal (mirror objective.ts)
  const mu = mean(scores);
  const lOpt = Math.log(optimalCounts);
  const nearest = own.reduce((best, t) =>
    Math.abs(Math.log(t.counts) - lOpt) < Math.abs(Math.log(best.counts) - lOpt) ? t : best,
  );
  return w * ((nearest.score - mu) / sd);
}

/** Pure breakdown of the one answer into each facet's contribution. Missing data → NaN (no fabrication). */
export function computeBreakdown(
  trials: readonly TrialResult[],
  optimalCounts: Counts360,
  profile?: Profile,
): Breakdown {
  const cal = byInstrument(trials, 'calibrate');
  const str = byInstrument(trials, 'strike');

  const sigmas = cal.map((t) => t.raw.sigmaR).filter((v): v is number => Number.isFinite(v));
  const precisionFloorDeg = sigmas.length ? Math.min(...sigmas) : NaN;

  const lOpt = Math.log(optimalCounts);
  const nearest = str
    .filter((t) => t.counts > 0)
    .reduce<TrialResult | null>(
      (best, t) =>
        best === null || Math.abs(Math.log(t.counts) - lOpt) < Math.abs(Math.log(best.counts) - lOpt)
          ? t
          : best,
      null,
    );

  return {
    biasZeroCounts: biasZero(cal),
    precisionFloorDeg,
    ttkMs: nearest ? (nearest.raw.ttkMs ?? NaN) : NaN,
    hitRate: nearest ? (nearest.raw.hitRate ?? NaN) : NaN,
    trackContribZ: fusedContribAt(trials, 'track', optimalCounts, profile),
    flickContribZ: fusedContribAt(trials, 'flick', optimalCounts, profile),
  };
}

// ── A5: facet concordance - testing the one latent counts per 360 thesis as a claim ──────────────
// The optimizer FUSES the four facets into one number. That fusion ASSUMES they are four views of one
// latent constant; it never TESTS it. This readout does: it fits each facet's OWN concave peak from its
// OWN trials (the same peak-fit machinery, on the affine per-instrument z-score, so the subset fit is
// peak-meaningful), then reports how well they agree - or honestly, that they do not. It is a READOUT
// only: it reads the finalized trials and writes NOTHING into the scored stream or the fused CI (the
// GP-disagree + ciConcord channels already own the honest widening). Copy built on `tier` states a
// geometric observation ("the views concur" / "the views spread"), never a cause.

const CONCORDANCE_INSTRUMENTS: readonly InstrumentId[] = ['track', 'flick', 'calibrate', 'strike'];
/** A facet needs at least this many of its own trials before its solo peak is attempted at all. */
const MIN_FACET_OBS = 4;
/** Reduced bootstrap iters for a facet's spread - a rough spread, deliberately not a reported 90% CI. */
const FACET_SPREAD_ITERS = 300;
/** Floor on a facet's ln-space spread. A ~6-point quadratic bootstrap systematically UNDER-states its
 *  own uncertainty, which would bias a heterogeneity statistic toward FALSE disagreement; flooring the
 *  spread (and requiring a clear separation below) keeps small-sample optimism from faking a split. */
const MIN_FACET_SPREAD_LN = 0.08;
/** Max standardized pairwise peak separation to still call the views concordant. */
const CONCORD_Z = 1.5;
/** Separation beyond this (in combined floored spreads) is required before we call the facets divergent
 *  - a conservative >3σ bar so the small-sample spread bias cannot manufacture a disagreement. */
const DIVERGE_Z = 3.0;

/** A facet's OWN observations: its trials z-scored against themselves (the SAME per-instrument affine
 *  standardization objective.ts uses; weight is affine and irrelevant to the vertex, so it is omitted).
 *  Empty when the facet has no usable spread - then it simply cannot be fit. */
function facetObservations(trials: readonly TrialResult[], id: InstrumentId): Observation[] {
  const own = trials.filter((t) => t.instrument === id && Number.isFinite(t.score) && t.counts > 0);
  const scores = own.map((t) => t.score);
  const sd = sampleStd(scores);
  if (!(sd > 0)) return [];
  const mu = mean(scores);
  return own.map((t) => ({ x: Math.log(t.counts), y: (t.score - mu) / sd })).sort((a, b) => a.x - b.x);
}

/** Fit one facet's own peak + a floored bootstrap spread, or dash it (peak/spread undefined) when its
 *  trials cannot honestly support one: too few points, a non-concave fit, or a bootstrap that will not
 *  converge. strike is always flagged `laneConditioned` (taste-conditioned, excluded from the tier). */
function fitFacet(trials: readonly TrialResult[], id: InstrumentId, rng: () => number): FacetPeak {
  const laneConditioned = id === 'strike';
  const obs = facetObservations(trials, id);
  if (obs.length < MIN_FACET_OBS) return { instrument: id, laneConditioned };
  let peakCounts: number;
  try {
    peakCounts = fitPeak(obs).optimalCounts; // throws when the facet's own curve is non-concave
  } catch {
    return { instrument: id, laneConditioned };
  }
  let band: [number, number];
  try {
    band = bootstrapCi(obs, FACET_SPREAD_ITERS, rng); // throws when every resample is non-concave
  } catch {
    return { instrument: id, laneConditioned }; // too unstable to trust the peak either - dash it
  }
  const spreadLn = Math.max((Math.log(band[1]) - Math.log(band[0])) / 2, MIN_FACET_SPREAD_LN);
  if (!(peakCounts > 0) || !Number.isFinite(spreadLn)) return { instrument: id, laneConditioned };
  return { instrument: id, peakCounts: counts360(peakCounts), spreadLn, laneConditioned };
}

/**
 * The concordance readout: per-facet peaks + a conservative agreement tier over the fittable NON-strike
 * facets. The tier is undefined (inconclusive) when fewer than two of them are fittable - the thesis is
 * reported as tested-and-holds, tested-and-fails, or not-yet-testable, never assumed. `rng` is a
 * deterministic seeded stream (the caller derives one from the trial count) so the readout is stable.
 */
export function facetConcordance(trials: readonly TrialResult[], rng: () => number): FacetConcordance {
  const facets = CONCORDANCE_INSTRUMENTS.map((id) => fitFacet(trials, id, rng));
  const included = facets.filter(
    (f): f is FacetPeak & { peakCounts: number; spreadLn: number } =>
      !f.laneConditioned && f.peakCounts !== undefined && f.spreadLn !== undefined,
  );
  if (included.length < 2) return { facets }; // inconclusive - cannot compare fewer than two views
  let zMax = 0;
  for (let i = 0; i < included.length; i++) {
    for (let j = i + 1; j < included.length; j++) {
      const sep = Math.abs(Math.log(included[i].peakCounts) - Math.log(included[j].peakCounts));
      const comb = Math.hypot(included[i].spreadLn, included[j].spreadLn) || MIN_FACET_SPREAD_LN;
      zMax = Math.max(zMax, sep / comb);
    }
  }
  const tier: Concordance = zMax <= CONCORD_Z ? 'concordant' : zMax <= DIVERGE_Z ? 'some-spread' : 'divergent';
  return { facets, tier };
}
