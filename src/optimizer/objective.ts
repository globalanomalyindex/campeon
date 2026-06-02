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
 */
export function trialsToObservations(trials: readonly TrialResult[], profile: Profile): Observation[] {
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
    out.push({ x: Math.log(t.cm360), y: w * ((t.score - s.mu) / s.sd) });
  }
  return out.sort((a, b) => a.x - b.x);
}
