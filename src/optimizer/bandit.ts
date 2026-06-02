import type { Cm360, Observation, SearchEngine } from '../types';

export interface BanditConfig {
  /** Discretized cm/360 arms. */
  arms: Cm360[];
  /** isDone budget (default arms.length × 3). */
  maxPulls?: number;
}

/** Index of the arm whose ln(cm/360) is nearest to x. */
function nearestArm(x: number, armX: number[]): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < armX.length; i++) {
    const d = Math.abs(armX[i] - x);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * UCB1 bandit fallback ("simple mode") over discretized cm/360 arms: x̄_i + √(2 ln t / n_i).
 * Reconstructs per-arm counts/means from the observation history (each observation is mapped to its
 * nearest arm), plays every unplayed arm first, then exploits with the UCB1 bonus.
 */
export function makeUcb1Bandit(config: BanditConfig): SearchEngine {
  const arms = config.arms;
  const armX = arms.map((a) => Math.log(a));
  const maxPulls = config.maxPulls ?? arms.length * 3;

  return {
    suggest(history: Observation[]): Cm360 {
      const n = arms.map(() => 0);
      const sum = arms.map(() => 0);
      for (const o of history) {
        const k = nearestArm(o.x, armX);
        n[k] += 1;
        sum[k] += o.y;
      }
      for (let i = 0; i < arms.length; i++) if (n[i] === 0) return arms[i];
      const t = history.length;
      let bestI = 0;
      let bestU = -Infinity;
      for (let i = 0; i < arms.length; i++) {
        const u = sum[i] / n[i] + Math.sqrt((2 * Math.log(t)) / n[i]);
        if (u > bestU) {
          bestU = u;
          bestI = i;
        }
      }
      return arms[bestI];
    },
    isDone(history: Observation[]): boolean {
      return history.length >= maxPulls;
    },
  };
}
