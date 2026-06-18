import type { InstrumentId, Observation, Profile, TrialResult } from '../types';
import { mean, sampleStd } from '../scoring/stats';

/**
 * Blend raw per-trial scores into Bayesian-opt observations (x = ln cm/360, y = blended score).
 * Each instrument is z-scored across its own trials, so heterogeneous score scales (bits/s, (0,1],
 * strikes/s) become comparable; the z-score is affine, so it never moves an instrument's own peak.
 * Each contribution is weighted by the player's profile and emitted as one observation per trial.
 * This is the spec's "normalize terms across the sweep."
 *
 * Honesty: an instrument with no usable spread (≤1 trial, all-equal scores → sampleStd 0, or a NaN
 * score that poisons mu/sd) contributes nothing rather than a fabricated or NaN value; weight-0 (or
 * missing) instruments are skipped. Weights are assumed ≥ 0 (a negative weight would invert an
 * instrument's contribution). Note z-scoring gives every instrument equal variance regardless of how
 * many times it was sampled, so a sparsely-sampled instrument can transiently over-contribute
 * mid-sweep; that washes out once the controller fits the report on a dense, balanced sweep.
 *
 * P1-1 heteroscedastic nugget: when a trial carries a finite, positive measured `scoreSE`, the affine
 * z-score maps it into a per-point GP noise term: noise = clamp((w·scoreSE/sd)², floorFrac·noiseVar,
 * ceilFrac·noiseVar). The w² (here folded into squaring w·scoreSE/sd) keeps the map affine-consistent
 * under non-unit weights, matching y = w·(score−mu)/sd. The floor stops a lucky-quiet trial from
 * becoming an interpolating spike; the ceiling stops a disastrous-but-honest trial from being
 * silenced. A missing/zero/NaN scoreSE leaves `noise` undefined, so existing flat-path observations
 * (and their y/x values) stay byte-identical - reliability enters ONLY via the nugget, never by
 * rescaling y, so no instrument's own optimum can move.
 */
export interface ObjectiveOptions {
  /** Default GP nugget σ_n² the per-point noise is clamped against (default 0.1, matching the GP). */
  noiseVar?: number;
  /** Floor as a fraction of noiseVar (default 0.25): the smallest honest per-point noise. */
  floorFrac?: number;
  /** Ceiling as a fraction of noiseVar (default 4.0): the largest honest per-point noise. */
  ceilFrac?: number;
}

export function trialsToObservations(
  trials: readonly TrialResult[],
  profile: Profile,
  opts: ObjectiveOptions = {},
): Observation[] {
  const noiseVar = opts.noiseVar ?? 0.1;
  const floorFrac = opts.floorFrac ?? 0.25;
  const ceilFrac = opts.ceilFrac ?? 4.0;
  const floor = floorFrac * noiseVar;
  const ceil = ceilFrac * noiseVar;

  const byId = new Map<InstrumentId, number[]>();
  for (const t of trials) {
    const arr = byId.get(t.instrument) ?? [];
    arr.push(t.score);
    byId.set(t.instrument, arr);
  }
  const stats = new Map<InstrumentId, { mu: number; sd: number }>();
  for (const [id, scores] of byId) stats.set(id, { mu: mean(scores), sd: sampleStd(scores) });

  const out: Observation[] = [];
  for (const t of trials) {
    const w = profile.instrumentWeights[t.instrument];
    if (!w) continue; // weight 0 or missing → no contribution
    const s = stats.get(t.instrument);
    if (!s || !(s.sd > 0)) continue; // no spread / NaN → no usable signal (never fabricate one)
    const obs: Observation = { x: Math.log(t.cm360), y: w * ((t.score - s.mu) / s.sd) };
    if (t.scoreSE !== undefined && Number.isFinite(t.scoreSE) && t.scoreSE > 0) {
      const stdSE = (w * t.scoreSE) / s.sd; // standardized SE on the affine y scale
      obs.noise = Math.min(Math.max(stdSE * stdSE, floor), ceil);
    }
    out.push(obs);
  }
  return out.sort((a, b) => a.x - b.x);
}
