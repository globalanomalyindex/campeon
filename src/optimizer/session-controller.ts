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
import { fitPeak } from '../stats/peak-fit';
import { bootstrapCi } from '../stats/bootstrap';
import { mulberry32 } from '../stats/rng';
import { trialsToObservations } from './objective';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export interface FinalizeOptions {
  /** Bootstrap resamples for the CI (default 400). */
  bootstrapIters?: number;
  /** If set, widen the CI when the GP peak and the curve peak disagree (spec §5.3). */
  gpPeakCm360?: number;
  /** Log-space disagreement threshold for the GP/curve widen (default 0.15 ≈ 16% relative). */
  disagreeLogThreshold?: number;
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

  let fit: ReturnType<typeof fitPeak>;
  try {
    fit = fitPeak([...obs]);
  } catch (err) {
    // Expected: "not concave" (no interior peak) or "singular matrix" (degenerate design) → the
    // data cannot locate a peak, so report honestly. Anything else is a real bug - re-throw it.
    if (!(err instanceof Error) || !/not concave|singular/.test(err.message)) throw err;
    return fallbackReport(obs, lo, hi);
  }

  const peak = clamp(fit.optimalCm360, lo, hi);
  let ci: [Cm360, Cm360];
  try {
    const raw = bootstrapCi([...obs], iters, rng);
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
  return { optimalCm360: peak, ci90: ci, curve: fit.curve };
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
  const seedAt = (k: number): Cm360 => Math.exp(loX + ((k + 0.5) / coldStart) * (hiX - loX));

  const trials: TrialResult[] = [];
  while (trials.length < config.maxTrials) {
    const obs = trialsToObservations(trials, profile);
    const cm360 =
      trials.length < coldStart ? seedAt(trials.length) : clamp(engine.suggest(obs, bounds), lo, hi);
    const id = schedule[trials.length % schedule.length];
    config.onTrialStart?.(id, trials.length, cm360);
    const result = await config.instruments[id].run(
      { cm360, dpi: config.dpi, rng, profile },
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
        const ci = bootstrapCi([...trialsToObservations(trials, profile)], iters, rng);
        if (Math.abs(ci[1] - ci[0]) <= config.ciStopWidth) break;
      } catch {
        // not yet concave-fittable → keep gathering
      }
    }
  }

  // Final report: cross-check the parabola peak against the surrogate's posterior-mean argmax so the
  // CI widens honestly when the global quadratic and the flexible GP disagree (spec §5.3).
  const finalObs = trialsToObservations(trials, profile);
  const gpPeak = engine.posteriorPeak?.(finalObs, bounds);
  const report = finalizeReport(finalObs, bounds, rng, {
    bootstrapIters: iters,
    ...(gpPeak !== undefined ? { gpPeakCm360: gpPeak } : {}),
  });
  return { report, trials };
}
