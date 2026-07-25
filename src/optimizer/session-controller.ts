import type {
  ArenaScene,
  Cm360,
  Dpi,
  Instrument,
  InstrumentId,
  Observation,
  Profile,
  Report,
  SearchEngine,
  TrialResult,
} from '../types';
import { fitPeak, fitPeakDrift, type PeakFit } from '../stats/peak-fit';
import { bootstrapCi } from '../stats/bootstrap';
import { mulberry32 } from '../stats/rng';
import { trialsToObservations } from './objective';
import { fitGpParams } from './gp';

/**
 * The order the cold-start levels are presented in.
 *
 * The opening trials lay a grid across the search range, and they used to be handed over
 * in ascending order. That made the correlation between trial index and cm/360 exactly
 * 1.0, so practice was perfectly confounded with the variable under test: a player warms
 * up as a session runs, the later cold-start trials sat at the higher sensitivities, and
 * the warm-up gain was therefore read as evidence for the slow end of the range. The
 * drift adjustment in finalize cannot rescue it either, because its own collinearity
 * guard drops the drift column exactly when the aliasing is worst.
 *
 * This hands back a fixed low-discrepancy permutation instead: level(k) = (k * stride) % n.
 * Any stride coprime with n gives a permutation, so all of them are searched and the one that
 * minimises |corr(k, level)| wins. At the shipped coldStart of 8 that takes the correlation
 * from 1.00 to 0.24.
 *
 * It is deterministic and draws nothing from the session RNG, which the instruments share.
 * Perturbing that stream would change the target geometry a player sees.
 *
 * The schedule cycles instruments, so each instrument only sees every n-th entry. The
 * stride keeps those subsequences spread as well, which matters because the drift
 * adjustment is fitted per instrument.
 */
export function coldStartOrder(n: number): readonly number[] {
  if (n <= 2) return Array.from({ length: Math.max(0, n) }, (_, i) => i);
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

  // |Pearson correlation| between a position and the level that stride presents there.
  // Both sequences are permutations of 0..n-1, so they share the mean (n - 1) / 2.
  const correlation = (stride: number): number => {
    const mid = (n - 1) / 2;
    let num = 0, dk = 0, dl = 0;
    for (let k = 0; k < n; k++) {
      const a = k - mid;
      const b = ((k * stride) % n) - mid;
      num += a * b; dk += a * a; dl += b * b;
    }
    return dk === 0 || dl === 0 ? 0 : Math.abs(num / Math.sqrt(dk * dl));
  };

  // Every stride coprime with n produces a permutation, so search them all and take the one
  // that decorrelates position from level best. A golden-ratio stride is the usual
  // low-discrepancy choice and it is good but not optimal: at n = 5 it lands on 0.5, which is
  // half the confound back. Ties go to the smaller stride, so the result is deterministic.
  let best = 1;
  let bestCorr = Infinity;
  for (let stride = 1; stride < n; stride++) {
    if (gcd(stride, n) !== 1) continue;
    const c = correlation(stride);
    if (c < bestCorr - 1e-12) { bestCorr = c; best = stride; }
  }
  return Array.from({ length: n }, (_, k) => (k * best) % n);
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export interface FinalizeOptions {
  /** Bootstrap resamples for the CI (default 400). */
  bootstrapIters?: number;
  /** If set, widen the CI when the GP peak and the curve peak disagree (spec §5.3). */
  gpPeakCm360?: number;
  /** Log-space disagreement threshold for the GP/curve widen (default 0.15 ≈ 16% relative). */
  disagreeLogThreshold?: number;
  /** A4: fit the extended ANCOVA model y = b0 + b1·x + b2·x² + b3·τ and report the peak of the
   *  DETRENDED quadratic, disclosing b3 as `Report.driftZ`. Opt-in and set by `runSession` at
   *  FINALIZE ONLY (never for interim/early-stop reports, which would perturb the deterministic
   *  mid-session RNG stream). When any honesty guard falls back (n < 10, no tau signal, τ collinear
   *  with the quadratic design, singular/non-concave extended fit) the b3 column is DROPPED and this
   *  is byte-identical to the plain report - driftZ absent, readout dashed, never padded. */
  detrendDrift?: boolean;
}

/**
 * Honest fallback when no peak can be located: the best-observed cm/360 plus the FULL-bounds CI.
 * Seeded at the geometric midpoint (log-space, matching the optimizer's ln domain); any real
 * observation beats the −Infinity seed (blended z-scores are routinely negative).
 */
function fallbackReport(obs: readonly Observation[], lo: Cm360, hi: Cm360): Report {
  let best = { x: Math.log(Math.sqrt(lo * hi)), y: -Infinity };
  for (const o of obs) if (o.y > best.y) best = o;
  return {
    optimalCm360: clamp(Math.exp(best.x), lo, hi),
    ci90: [lo, hi],
    curve: [...obs].map((o) => ({ x: o.x, mean: o.y })).sort((a, b) => a.x - b.x),
  };
}

/**
 * Observations → Report. Fits the parabolic performance curve, bootstraps the 90% CI, clamps to
 * bounds. When no peak can be located - too few points (<3), a non-concave fit, or a singular
 * /degenerate design - it honestly reports the best-observed cm/360 with the FULL bounds as the CI;
 * a wide CI is the honesty signal, never hidden. Unexpected errors are re-thrown, not masked. If a
 * GP peak is supplied and disagrees with the curve peak, the CI is widened to span both (spec §5.3).
 */
export function finalizeReport(
  obs: readonly Observation[],
  bounds: [Cm360, Cm360],
  rng: () => number,
  opts: FinalizeOptions = {},
): Report {
  const [lo, hi] = bounds;
  const iters = opts.bootstrapIters ?? 400;
  if (obs.length < 3) return fallbackReport(obs, lo, hi); // a quadratic fit needs ≥3 points

  // A4 (finalize-only, opt-in): the guarded extended ANCOVA fit. Non-null ONLY when every honesty
  // guard passes (see FinalizeOptions.detrendDrift); null falls through to the plain path with the
  // b3 column dropped, so a no-tau-signal input is byte-identical to a drift-unaware call.
  const drifted = opts.detrendDrift === true ? fitPeakDrift([...obs]) : null;
  let fit: PeakFit;
  if (drifted !== null) {
    fit = drifted;
  } else {
    try {
      fit = fitPeak([...obs]);
    } catch (err) {
      // Expected: "not concave" (no interior peak) or "singular matrix" (degenerate design) → the
      // data cannot locate a peak, so report honestly. Anything else is a real bug - re-throw it.
      if (!(err instanceof Error) || !/not concave|singular/.test(err.message)) throw err;
      return fallbackReport(obs, lo, hi);
    }
  }

  const peak = clamp(fit.optimalCm360, lo, hi);
  // Bounds honesty: when the vertex of whichever fit RAN (plain or detrended) falls outside the
  // searched range, the clamp above turns "the best is beyond the range I searched" into a number
  // sitting exactly on the edge, indistinguishable from a measured interior optimum. Record which
  // side it fell past so every downstream layer can present the edge as a bound. The check sits
  // after model selection on purpose: it must describe the fit that produced the number.
  const atBound: 'low' | 'high' | undefined =
    fit.optimalCm360 < lo ? 'low' : fit.optimalCm360 > hi ? 'high' : undefined;
  let ci: [Cm360, Cm360];
  try {
    // The obs carry their per-point `noise` (the P1-1 heteroscedastic nugget) all the way through, so
    // bootstrapCi resamples residuals reliability-aware (P1-3): a loud facet widens the CI, a quiet
    // facet is not contaminated, and the band can only ever widen past the conservative pooled bound.
    // With detrendDrift the bootstrap ALSO resamples extended-fit residuals and refits the extended
    // model, unioned with the plain band on the same seeded draws (widen-only; it runs the SAME
    // guarded fitDrift, so peak and CI can never disagree on which model ran).
    const raw = bootstrapCi([...obs], iters, rng, opts.detrendDrift === true ? { drift: true } : {});
    ci = [clamp(Math.min(raw[0], raw[1]), lo, hi), clamp(Math.max(raw[0], raw[1]), lo, hi)];
  } catch {
    ci = [lo, hi]; // bootstrap could not bound it → honest wide range
  }
  if (opts.gpPeakCm360 !== undefined) {
    const gp = clamp(opts.gpPeakCm360, lo, hi);
    const thresh = opts.disagreeLogThreshold ?? 0.15;
    if (Math.abs(Math.log(gp) - Math.log(peak)) > thresh) {
      ci = [Math.min(ci[0], gp, peak), Math.max(ci[1], gp, peak)];
    }
  }
  // driftZ is the measured b3 the detrend REMOVED from the number - practice or fatigue, the data
  // cannot say which. Present only when the extended fit actually ran; never padded on fallback.
  return {
    optimalCm360: peak,
    ci90: ci,
    curve: fit.curve,
    ...(drifted !== null ? { driftZ: drifted.driftZ } : {}),
    ...(atBound !== undefined ? { peakAtBound: atBound } : {}),
  };
}

export interface SessionConfig {
  dpi: Dpi;
  profile: Profile;
  bounds: [Cm360, Cm360];
  engine: SearchEngine;
  instruments: Record<InstrumentId, Instrument>;
  scene: ArenaScene;
  /** Cycled one-per-trial; e.g. ['track','flick','calibrate','strike']. */
  schedule: InstrumentId[];
  maxTrials: number;
  /** Shared RNG stream - consumed by the instruments AND the early-stop/final bootstraps, so
   *  changing `ciStopWidth` or `bootstrapIters` perturbs the (still deterministic) noise sequence
   *  later trials see. Fine for an offline session; just don't expect identical early trials when
   *  only the stop criterion differs. */
  rng: () => number;
  /** Log-spaced design-of-experiments seeds run before the engine is consulted
   *  (default max(4, 2×schedule.length) - each scheduled instrument needs ≥2 trials
   *  before its z-score has any spread). */
  coldStart?: number;
  /** Earliest trial index at which CI early-stop is allowed (default 8). */
  minTrials?: number;
  /** Stop early once the 90% CI (in cm/360) is narrower than this. */
  ciStopWidth?: Cm360;
  /** Bootstrap resamples for early-stop checks and the final report (default 400). */
  bootstrapIters?: number;
  /** Fired before each trial's instrument runs - for a live "now: +flick" HUD. */
  onTrialStart?: (id: InstrumentId, index: number, cm360: Cm360) => void;
  /** Fired after each trial with the trial, all trials so far, and a cheap interim Report - for the
   *  live convergence view. The interim bootstrap uses its OWN seeded RNG, so setting this never
   *  perturbs the (deterministic) instrument-noise stream. */
  onTrial?: (trial: TrialResult, trials: readonly TrialResult[], interim: Report) => void;
  /** Bootstrap resamples for the per-trial interim report (default 120; cheaper than the final). */
  interimBootstrapIters?: number;
  /** Pre-existing trials to resume from. When supplied, the loop starts with these (a copy) and
   *  cold-start seeds only run if fewer than `coldStart` are present - so a converged session can be
   *  continued ("keep refining") without re-seeding. */
  initialTrials?: readonly TrialResult[];
  /** Checked once at the top of each iteration; returning true breaks the loop and finalizes from the
   *  trials gathered so far (a user "lock it in", or teardown). */
  shouldStop?: () => boolean;
}

export interface SessionOutcome {
  report: Report;
  trials: TrialResult[];
}

/**
 * Run a full Bayesian-optimization session: cold-start log-spaced seeds → suggest cm/360 → run the
 * next scheduled instrument → append → rebuild the blended objective → (optionally) stop early on a
 * tight CI → finalize a Report. Cold-start is the controller's job (not the engine's) because the
 * blended objective is undefined until each instrument has ≥2 trials.
 */
export async function runSession(config: SessionConfig): Promise<SessionOutcome> {
  const { engine, schedule, bounds, profile, rng } = config;
  if (schedule.length === 0) throw new Error('runSession: schedule must list at least one instrument');
  const [lo, hi] = bounds;
  const loX = Math.log(lo);
  const hiX = Math.log(hi);
  const coldStart = config.coldStart ?? Math.max(4, 2 * schedule.length);
  const minTrials = config.minTrials ?? 8;
  const iters = config.bootstrapIters ?? 400;
  const levelAt = (k: number): Cm360 => Math.exp(loX + ((k + 0.5) / coldStart) * (hiX - loX));
  const orderedLevel = coldStartOrder(coldStart);
  const seedAt = (k: number): Cm360 => levelAt(orderedLevel[k] ?? k);

  const trials: TrialResult[] = config.initialTrials ? [...config.initialTrials] : [];
  while (trials.length < config.maxTrials) {
    if (config.shouldStop?.()) break;
    const obs = trialsToObservations(trials, profile);
    const cm360 =
      trials.length < coldStart ? seedAt(trials.length) : clamp(engine.suggest(obs, bounds), lo, hi);
    const id = schedule[trials.length % schedule.length];
    config.onTrialStart?.(id, trials.length, cm360);
    // The gain the player arrives at this trial holding. The acclimation lead-in sizes itself
    // from |ln(cm360) - ln(prevCm360)|, because the cost of adapting scales with how far the
    // gain moved. Without this every trial spends the full worst-case budget, which is safe
    // (over-acclimating cannot bias a score) but charges the player time it does not need. On
    // the first trial there is no previous trial, so the honest answer is unknown and the
    // planner spends the full budget.
    const prev = trials.length > 0 ? trials[trials.length - 1]!.cm360 : undefined;
    const result = await config.instruments[id].run(
      { cm360, dpi: config.dpi, rng, profile, ...(prev !== undefined ? { prevCm360: prev } : {}) },
      config.scene,
    );
    trials.push(result);

    if (config.onTrial) {
      const interim = finalizeReport(
        trialsToObservations(trials, profile),
        bounds,
        mulberry32(0x5eed ^ trials.length), // own stream - does NOT touch the instrument RNG
        { bootstrapIters: config.interimBootstrapIters ?? 120 },
      );
      config.onTrial(result, trials, interim);
    }

    if (config.ciStopWidth !== undefined && trials.length >= minTrials) {
      try {
        // Its own stream, like the interim report above. Passing the shared instrument RNG
        // here meant every stop check burned a few hundred draws, so the target geometry a
        // player saw later in the session depended on how many stop checks had run.
        const ci = bootstrapCi(
          [...trialsToObservations(trials, profile)],
          iters,
          mulberry32(0x570b ^ trials.length),
        );
        if (Math.abs(ci[1] - ci[0]) <= config.ciStopWidth) break;
      } catch {
        // not yet concave-fittable → keep gathering
      }
    }
  }

  // Final report: cross-check the parabola peak against the surrogate's posterior-mean argmax so the
  // CI widens honestly when the global quadratic and the flexible GP disagree (spec §5.3). At FINALIZE
  // ONLY (never inside evolution.suggest, which would desync the stateful lineage) we first sharpen
  // the GP hyperparameters by exact marginal likelihood (P1-2). The fit only ever sharpens this
  // cross-check peak; it never rescales y and never replaces the conservative CI, so it can only
  // WIDEN the honest CI. When the engine exposes no GP params we keep the unfitted posteriorPeak.
  const finalObs = trialsToObservations(trials, profile);
  let gpPeak: Cm360 | undefined;
  if (engine.gpParams !== undefined && engine.posteriorPeakWith !== undefined) {
    const fitted = fitGpParams(finalObs, engine.gpParams, bounds);
    gpPeak = engine.posteriorPeakWith(finalObs, bounds, fitted);
  } else {
    gpPeak = engine.posteriorPeak?.(finalObs, bounds);
  }
  const report = finalizeReport(finalObs, bounds, rng, {
    bootstrapIters: iters,
    // A4: detrend within-session drift (practice or fatigue) at FINALIZE ONLY - interim/early-stop
    // reports above never set this, so the deterministic mid-session RNG stream is untouched and the
    // trial sequence is byte-identical with or without the drift feature.
    detrendDrift: true,
    ...(gpPeak !== undefined ? { gpPeakCm360: gpPeak } : {}),
  });
  return { report, trials };
}
