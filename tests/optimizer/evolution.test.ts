import { describe, it, expect } from 'vitest';
import { makeEvolution } from '../../src/optimizer/evolution';
import { mulberry32 } from '../../src/stats/rng';
import type { Observation, SearchEngine } from '../../src/types';

const bounds: [number, number] = [15, 60];

/** Simulate the generational loop: seed a Gen-0 gene pool, then suggest → play(fitness) → select, N times. */
function evolve(
  engine: SearchEngine,
  fitness: (cm: number, gen: number) => number,
  seeds: number[],
  generations: number,
): { suggested: number[]; history: Observation[] } {
  const history: Observation[] = seeds.map((cm) => ({ x: Math.log(cm), y: fitness(cm, 0) }));
  const suggested: number[] = [];
  for (let g = 1; g <= generations; g++) {
    const cm = engine.suggest(history, bounds);
    suggested.push(cm);
    history.push({ x: Math.log(cm), y: fitness(cm, g) });
  }
  return { suggested, history };
}

const cfg = { gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.05 }, sigma0: 0.3 } as const;
const seeds = [18, 24, 31, 40, 50];

describe('makeEvolution - surrogate-assisted (1+λ) evolution strategy', () => {
  it('evolves toward an interior fitness peak over generations', () => {
    // Concave fitness peaked at cm=35 (in ln-space), with a little deterministic noise per generation.
    const xStar = Math.log(35);
    const noise = mulberry32(3);
    const fit = (cm: number) => -((Math.log(cm) - xStar) ** 2) + (noise() * 2 - 1) * 0.03;
    const eng = makeEvolution({ ...cfg, seed: 7 });
    const { suggested, history } = evolve(eng, fit, seeds, 16);
    const peak = eng.posteriorPeak!(history, bounds);
    expect(peak).toBeGreaterThan(30);
    expect(peak).toBeLessThan(41); // most-evolved sensitivity lands on the true optimum
    const lateMean = suggested.slice(-6).reduce((a, b) => a + b, 0) / 6;
    expect(lateMean).toBeGreaterThan(28);
    expect(lateMean).toBeLessThan(43); // the lineage concentrates around the peak, not scattering
  });

  it('climbs a monotonic landscape - selection is directional, not random sampling', () => {
    // Fitness rises with sensitivity (optimum at the upper bound). A genuine selection+mutation loop
    // must MARCH upward; random sampling would stay centered. (Distinguishes ES from a blind sweep.)
    const fit = (cm: number) => Math.log(cm); // strictly increasing in cm
    const eng = makeEvolution({ ...cfg, seed: 11 });
    const { suggested, history } = evolve(eng, fit, seeds, 14);
    expect(eng.posteriorPeak!(history, bounds)).toBeGreaterThan(48); // climbed into the high region
    // The lineage settles well ABOVE the seed pool's center (~32) - selection marched up the gradient
    // rather than sampling around where it started (a blind sweep would stay centered).
    const lateMean = suggested.slice(-5).reduce((a, b) => a + b, 0) / 5;
    expect(lateMean).toBeGreaterThan(45);
  });

  it('selection is elitist - the incumbent is the fittest sensitivity seen', () => {
    // A history whose clear best sits low (cm≈20): the parent/incumbent must be there.
    const xBest = Math.log(20);
    const history: Observation[] = [16, 20, 26, 34, 45, 58].map((cm) => ({
      x: Math.log(cm),
      y: -((Math.log(cm) - xBest) ** 2),
    }));
    const eng = makeEvolution({ ...cfg, seed: 5 });
    expect(eng.posteriorPeak!(history, bounds)).toBeLessThan(26);
  });

  it('mutates stochastically and stays in bounds (genuine variation, clamped offspring)', () => {
    const fit = (cm: number) => -((Math.log(cm) - Math.log(33)) ** 2);
    const a = evolve(makeEvolution({ ...cfg, seed: 1 }), fit, seeds, 10).suggested;
    const b = evolve(makeEvolution({ ...cfg, seed: 2 }), fit, seeds, 10).suggested;
    for (const cm of [...a, ...b]) {
      expect(cm).toBeGreaterThanOrEqual(bounds[0]);
      expect(cm).toBeLessThanOrEqual(bounds[1]);
    }
    expect(a).not.toEqual(b); // different seeds → different mutations: real stochastic variation
    expect(new Set(a).size).toBeGreaterThan(1); // not collapsed to a single point
  });

  it('implements the SearchEngine contract (isDone at the trial budget)', () => {
    const eng = makeEvolution({ ...cfg, maxTrials: 12 });
    expect(eng.isDone(new Array(11).fill({ x: 0, y: 0 }))).toBe(false);
    expect(eng.isDone(new Array(12).fill({ x: 0, y: 0 }))).toBe(true);
    expect(typeof eng.suggest).toBe('function');
    expect(typeof eng.posteriorPeak).toBe('function');
  });
});
