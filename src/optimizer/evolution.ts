import type { Cm360, Observation, SearchEngine } from '../types';
import { GP, type GpParams } from './gp';
import { expectedImprovement } from './bayesopt';
import { mulberry32 } from '../stats/rng';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export interface EvolutionConfig {
  gp: GpParams;
  /** Offspring spawned per generation; the surrogate screens which one is worth actually playing (default 6). */
  lambda?: number;
  /** Initial mutation step σ in ln(cm/360) space (default 0.3 - a sane spread; ln[15,60] spans ≈1.39). */
  sigma0?: number;
  /** σ clamp [min, max] so a generation neither freezes nor scatters across the whole range (default [0.04, 0.9]). */
  sigmaBounds?: [number, number];
  /** EI exploration offset ξ for offspring screening (default 0.01). */
  xi?: number;
  /** Dense grid resolution for the incumbent (posterior-mean argmax) (default 96). */
  gridSize?: number;
  /** Seed for the deterministic mutation RNG (default 0x5eed). */
  seed?: number;
  /** Budget for `isDone` only - the session controller owns stopping in practice (default 24). */
  maxTrials?: number;
}

/**
 * Evolution-strategy SearchEngine over x = ln(cm/360) - a surrogate-assisted (1+λ)-ES.
 *
 * The search IS the evolution the predators themselves underwent: it keeps a single lineage and, each
 * generation, mutates the **incumbent** (the fittest sensitivity so far) by a Gaussian step σ to spawn
 * λ offspring, then plays the most promising one. Selection is elitist - the fittest sensitivity always
 * survives as the next parent - and the step size self-adapts by Rechenberg's **1/5 success rule**
 * (offspring keep beating the parent → widen the search; they stop → narrow in and refine). Over
 * generations the lineage climbs to the optimum: the most-evolved sensitivity for this player.
 *
 * Distinct from Bayesian optimization (which maximizes an acquisition GLOBALLY and may jump anywhere):
 * here every proposal is a LOCAL mutation of the current best - that is what makes it genuinely
 * evolutionary rather than evolution-flavored search. The Gaussian-process surrogate is the lineage's
 * memory of the fitness landscape: it supplies a denoised fitness for selection (so a lucky-noise trial
 * cannot win) and screens the λ offspring so the player's scarce trials are not wasted on bad mutations.
 *
 * Stateful across `suggest` calls - σ and the success window persist, because generations are a
 * sequence, not independent draws. The controller's cold-start seeds are Generation 0 (the initial
 * gene pool); the first `suggest` selects the fittest of them as the founding parent.
 */
export function makeEvolution(config: EvolutionConfig): SearchEngine {
  const lambda = config.lambda ?? 6;
  const sigma0 = config.sigma0 ?? 0.3;
  const [sigMin, sigMax] = config.sigmaBounds ?? [0.04, 0.9];
  const xi = config.xi ?? 0.01;
  const gridSize = config.gridSize ?? 96;
  const maxTrials = config.maxTrials ?? 24;
  const rng = mulberry32(config.seed ?? 0x5eed);

  // Evolutionary state - one lineage across generations.
  let sigma = sigma0;
  let lastChildX: number | null = null; // the offspring proposed last generation, awaiting its verdict
  let lastParentMean = -Infinity; // the parent's denoised fitness when that offspring was spawned
  let winEvals = 0; // generations in the current 1/5-rule adaptation window
  let winSucc = 0; // of those, how many improved on the parent

  /** Standard normal via Box–Muller from the engine's own seeded stream (deterministic mutation). */
  const gauss = (): number => {
    const u = Math.max(1e-12, rng());
    const v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  /** The incumbent: the sensitivity of highest denoised (GP posterior-mean) fitness - elitist parent. */
  const incumbent = (gp: GP, loX: number, hiX: number): { x: number; mean: number } => {
    let bestX = loX;
    let best = -Infinity;
    for (let i = 0; i <= gridSize; i++) {
      const x = loX + ((hiX - loX) * i) / gridSize;
      const m = gp.predict(x).mean;
      if (m > best) {
        best = m;
        bestX = x;
      }
    }
    return { x: bestX, mean: best };
  };

  return {
    suggest(history: Observation[], bounds: [Cm360, Cm360]): Cm360 {
      const loX = Math.log(bounds[0]);
      const hiX = Math.log(bounds[1]);
      if (history.length === 0) return Math.exp((loX + hiX) / 2);
      const gp = new GP(config.gp, history);
      const parent = incumbent(gp, loX, hiX);

      // 1/5 success rule: did last generation's offspring (now scored) beat its parent's fitness?
      if (lastChildX !== null) {
        winEvals += 1;
        if (gp.predict(lastChildX).mean > lastParentMean + 1e-9) winSucc += 1;
        if (winEvals >= lambda) {
          sigma = clamp(winSucc / winEvals > 0.2 ? sigma * 1.5 : sigma / 1.5, sigMin, sigMax);
          winEvals = 0;
          winSucc = 0;
        }
      }

      // Spawn λ offspring by Gaussian mutation around the parent; the surrogate (EI) picks which single
      // mutation is worth the player's next trial.
      let chosen = clamp(parent.x + sigma * gauss(), loX, hiX);
      let bestAcq = -Infinity;
      for (let k = 0; k < lambda; k++) {
        const x = clamp(parent.x + sigma * gauss(), loX, hiX);
        const { mean, variance } = gp.predict(x);
        const a = expectedImprovement(mean, variance, parent.mean, xi);
        if (a > bestAcq) {
          bestAcq = a;
          chosen = x;
        }
      }

      lastChildX = chosen;
      lastParentMean = parent.mean;
      return Math.exp(chosen);
    },
    isDone(history: Observation[]): boolean {
      return history.length >= maxTrials;
    },
    /** GP posterior-mean argmax - the most-evolved sensitivity; also the controller's CI cross-check. */
    posteriorPeak(history: Observation[], bounds: [Cm360, Cm360]): Cm360 {
      const loX = Math.log(bounds[0]);
      const hiX = Math.log(bounds[1]);
      if (history.length === 0) return Math.exp((loX + hiX) / 2);
      const gp = new GP(config.gp, history);
      return Math.exp(incumbent(gp, loX, hiX).x);
    },
  };
}
