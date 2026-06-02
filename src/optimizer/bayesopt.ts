import type { Cm360, Observation, SearchEngine } from '../types';
import { GP, type GpParams } from './gp';

/** Standard-normal pdf. */
export function normPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

/** erf via Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - poly * Math.exp(-ax * ax));
}

/** Standard-normal cdf. */
export function normCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Expected Improvement for maximization; `best` = incumbent (best posterior mean), `xi` = exploration. */
export function expectedImprovement(mean: number, variance: number, best: number, xi: number): number {
  const sigma = Math.sqrt(Math.max(0, variance));
  if (sigma < 1e-12) return 0;
  const d = mean - best - xi;
  const z = d / sigma;
  return d * normCdf(z) + sigma * normPdf(z);
}

/** Upper Confidence Bound for maximization: μ + κσ. */
export function ucb(mean: number, variance: number, kappa: number): number {
  return mean + kappa * Math.sqrt(Math.max(0, variance));
}

export interface BoConfig {
  gp: GpParams;
  /** Acquisition function (default 'ei'). */
  acquisition?: 'ei' | 'ucb';
  /** EI exploration offset ξ (default 0.01). */
  xi?: number;
  /** UCB width κ (default 2). */
  kappa?: number;
  /** Dense 1-D acquisition grid resolution (default 96). */
  gridSize?: number;
  /** isDone budget (default 20). */
  maxTrials?: number;
}

/**
 * Bayesian-optimization SearchEngine over x = ln(cm/360). Given the observed history it fits a GP
 * and returns the cm/360 maximizing the acquisition over a dense grid. Empty history → domain
 * midpoint (the session controller owns the cold-start design-of-experiments, so BO is never asked
 * to seed from nothing in practice).
 */
export function makeBo(config: BoConfig): SearchEngine {
  const acq = config.acquisition ?? 'ei';
  const xi = config.xi ?? 0.01;
  const kappa = config.kappa ?? 2;
  const gridSize = config.gridSize ?? 96;
  const maxTrials = config.maxTrials ?? 20;

  return {
    suggest(history: Observation[], bounds: [Cm360, Cm360]): Cm360 {
      const loX = Math.log(bounds[0]);
      const hiX = Math.log(bounds[1]);
      if (history.length === 0) return Math.exp((loX + hiX) / 2);
      const gp = new GP(config.gp, history);
      // Incumbent = best posterior mean over the grid (not the raw noisy max).
      let best = -Infinity;
      for (let i = 0; i <= gridSize; i++) {
        const x = loX + ((hiX - loX) * i) / gridSize;
        const m = gp.predict(x).mean;
        if (m > best) best = m;
      }
      let bestX = loX;
      let bestAcq = -Infinity;
      for (let i = 0; i <= gridSize; i++) {
        const x = loX + ((hiX - loX) * i) / gridSize;
        const { mean, variance } = gp.predict(x);
        const a = acq === 'ucb' ? ucb(mean, variance, kappa) : expectedImprovement(mean, variance, best, xi);
        if (a > bestAcq) {
          bestAcq = a;
          bestX = x;
        }
      }
      return Math.exp(bestX);
    },
    isDone(history: Observation[]): boolean {
      return history.length >= maxTrials;
    },
  };
}
