import { describe, it, expect } from 'vitest';
import { makeEvolution, vertexInfoScreen } from '../../src/optimizer/evolution';
import { mulberry32 } from '../../src/stats/rng';
import type { Observation, SearchEngine } from '../../src/types';

const bounds: [number, number] = [15, 60];
const loX = Math.log(bounds[0]);
const hiX = Math.log(bounds[1]);

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

// ── the design criterion ───────────────────────────────────────────────
//
// campeón reports the VERTEX of a quadratic fit, and the variance of a fitted vertex divides by the
// spread of the design. So the question the offspring screen has to answer is not "which mutation is
// fittest" but "which mutation most sharpens the number I am going to report". These pin that.

describe('vertexInfoScreen - local c-optimality for the reported vertex', () => {
  const v = Math.log(30);
  /** A design laid symmetrically about the estimate, in ln space. */
  const symmetric = (ds: number[]): Observation[] => ds.map((d) => ({ x: v + d, y: -(d * d) }));

  it('a trial AT the current estimate carries no information about where that estimate is', () => {
    // This is the whole bug in one assertion. dy/dv = -2a(x - v) vanishes at the vertex, so a trial
    // there constrains the level and the curvature and says nothing about the location. The expected
    // -improvement screen this replaces preferred exactly these trials, because the parent was the
    // posterior-mean maximum and no candidate could improve on it.
    const s = vertexInfoScreen(symmetric([-0.6, -0.4, -0.2, 0.2, 0.4, 0.6]), v)!;
    expect(s).not.toBeNull();
    expect(Math.abs(s.gain(v))).toBeLessThan(1e-12);
  });

  it('values a trial more the further it sits from the estimate', () => {
    const s = vertexInfoScreen(symmetric([-0.6, -0.4, -0.2, 0.2, 0.4, 0.6]), v)!;
    const gains = [0.05, 0.1, 0.2, 0.35, 0.6].map((d) => s.gain(v + d));
    for (let i = 1; i < gains.length; i++) expect(gains[i]).toBeGreaterThan(gains[i - 1]);
    // A design symmetric about the estimate has no side to favour, so neither does the criterion.
    expect(s.gain(v + 0.3)).toBeCloseTo(s.gain(v - 0.3), 12);
  });

  it('favours the side of the estimate the design has not covered', () => {
    // Mass piled below the estimate: the informative trial is the one above it. This is the term that
    // matters most in practice, because the cold-start grid is symmetric about the middle of the
    // player's declared range and almost never about the player's actual optimum.
    const skewed = [-0.7, -0.6, -0.5, -0.4, -0.3, -0.2, 0.1].map((d) => ({ x: v + d, y: 0 }));
    const s = vertexInfoScreen(skewed, v)!;
    expect(s.gain(v + 0.5)).toBeGreaterThan(s.gain(v - 0.5));
  });

  it('reads the design and the estimate only, never the scores', () => {
    // A screen that read y could be steered by one lucky trial. This one cannot: the same design
    // yields the same ranking whatever the scores did.
    const ds = [-0.6, -0.35, -0.1, 0.15, 0.4, 0.65];
    const a = vertexInfoScreen(ds.map((d) => ({ x: v + d, y: -(d * d) })), v)!;
    const noise = mulberry32(4);
    const b = vertexInfoScreen(ds.map((d) => ({ x: v + d, y: 40 * noise() - 20 })), v)!;
    for (const d of [-0.5, -0.2, 0, 0.2, 0.5]) expect(b.gain(v + d)).toBe(a.gain(v + d));
  });

  it('declines to score a design that cannot support a quadratic at all', () => {
    expect(vertexInfoScreen([], v)).toBeNull();
    expect(vertexInfoScreen(symmetric([-0.3, 0.3]), v)).toBeNull(); // 2 points, 3 parameters
    // Three points that are really one: a singular information matrix, not a thin one.
    expect(vertexInfoScreen([0, 0, 0].map((d) => ({ x: v + d, y: 0 })), v)).toBeNull();
  });
});

/** The 8 log-spaced cold-start levels, laid out exactly as `runSession` does, scored on a concave
 *  landscape peaked at `trueCm`. This is the design the engine is always handed in production. */
function coldStartDesign(trueCm: number, seed: number): Observation[] {
  const noise = mulberry32(seed * 977);
  const xStar = Math.log(trueCm);
  return Array.from({ length: 8 }, (_, k) => {
    const x = loX + ((k + 0.5) / 8) * (hiX - loX);
    return { x, y: -1.2 * (x - xStar) ** 2 + (noise() * 2 - 1) * 0.3 };
  }).sort((a, b) => a.x - b.x);
}

/**
 * Reconstruct the offspring the engine spawns on its FIRST generation. At that point σ is still σ0 and
 * the private mutation stream is untouched, so a Box-Muller replica of the engine's own `gauss()` over
 * `mulberry32(seed)` reproduces the candidate set exactly. Every test below checks the reconstruction
 * against the returned suggestion before drawing any conclusion from it.
 */
function firstOffspring(seed: number, parentX: number, lambda: number, sigma: number): number[] {
  const rng = mulberry32(seed);
  const gauss = (): number => {
    const u = Math.max(1e-12, rng());
    const w = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w);
  };
  return Array.from({ length: lambda }, () =>
    Math.min(hiX, Math.max(loX, parentX + sigma * gauss())),
  );
}

describe('makeEvolution - the offspring screen selects for information, not proximity', () => {
  const LAMBDA = 6;
  const SIGMA0 = 0.3;

  it('does not systematically play the offspring closest to the parent', () => {
    // Rank 1 is the offspring nearest the parent, rank λ the farthest. Measured on this exact setup,
    // the expected-improvement screen this replaces scored a mean rank of 1.32 out of 6: it took the
    // nearest offspring almost every generation, with a realised step of 0.072 in ln space against a
    // nominal σ of 0.3 (which is E[min |Z|] over 6 draws, the signature of a minimum-distance rule).
    // A screen that selects for information has to sit above the middle of the ranking.
    let rankSum = 0;
    let stepSum = 0;
    let n = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const history = coldStartDesign(30, seed);
      const eng = makeEvolution({ ...cfg, seed, lambda: LAMBDA, sigma0: SIGMA0 });
      const parentX = Math.log(eng.posteriorPeak!(history, bounds)); // stateless, perturbs nothing
      const cands = firstOffspring(seed, parentX, LAMBDA, SIGMA0);
      const chosen = Math.log(eng.suggest(history, bounds));
      let pick = 0;
      for (let k = 1; k < cands.length; k++) {
        if (Math.abs(cands[k] - chosen) < Math.abs(cands[pick] - chosen)) pick = k;
      }
      expect(Math.abs(cands[pick] - chosen)).toBeLessThan(1e-9); // the replica really is the engine's
      const d = Math.abs(cands[pick] - parentX);
      rankSum += 1 + cands.filter((x) => Math.abs(x - parentX) < d).length;
      stepSum += d;
      n += 1;
    }
    expect(rankSum / n).toBeGreaterThan((1 + LAMBDA) / 2);
    // And the realised step is a real fraction of the nominal σ rather than a rounding of it.
    expect(stepSum / n).toBeGreaterThan(SIGMA0);
  });

  it('cannot be made worse by a bigger screening budget', () => {
    // The λ offspring are drawn from one stream, so the candidate set at λ+1 CONTAINS the set at λ:
    // taking a maximum over a superset can only hold or improve. That is what a screening budget is
    // for. The screen this replaces did the opposite, and measurably: its realised step fell from
    // 0.165 at λ=2 to 0.040 at λ=16, so paying for more candidates bought a less informative trial.
    for (let seed = 1; seed <= 12; seed++) {
      const history = coldStartDesign(seed % 3 === 0 ? 22 : seed % 3 === 1 ? 30 : 44, seed);
      let prev = -Infinity;
      for (const lambda of [1, 2, 3, 4, 6, 9, 14]) {
        const eng = makeEvolution({ ...cfg, seed, lambda, sigma0: SIGMA0 });
        const parentX = Math.log(eng.posteriorPeak!(history, bounds));
        const screen = vertexInfoScreen(history, parentX)!;
        const gain = screen.gain(Math.log(eng.suggest(history, bounds)));
        expect(gain).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = gain;
      }
    }
  });

  it('the step self-adapts to whether the located optimum is still moving', () => {
    // Under an information-seeking screen the offspring is chosen to be informative rather than fit,
    // so a success rule that asks "did it beat the parent's fitness" can never fire and decays σ on a
    // fixed schedule while calling itself adaptive. The signal is movement of the located optimum
    // instead, and `moveFrac` is the bar it has to clear. Same landscape, same seed, same draws: only
    // the bar differs, so if σ were on a schedule these two would be identical.
    const run = (moveFrac: number): number[] => {
      const history = coldStartDesign(30, 5);
      const eng = makeEvolution({ ...cfg, seed: 5, lambda: LAMBDA, sigma0: SIGMA0, moveFrac });
      const steps: number[] = [];
      for (let gen = 0; gen < 20; gen++) {
        const parentX = Math.log(eng.posteriorPeak!(history, bounds));
        const x = Math.log(eng.suggest(history, bounds));
        steps.push(Math.abs(x - parentX));
        history.push({ x, y: -1.2 * (x - Math.log(30)) ** 2 });
      }
      return steps;
    };
    const late = (s: number[]): number => s.slice(-6).reduce((a, b) => a + b, 0) / 6;
    const generous = run(0); // any movement at all counts as progress → keep reaching
    const strict = run(50); // nothing could ever clear this bar → narrow in and refine
    expect(late(generous)).toBeGreaterThan(late(strict));
    // On a landscape whose optimum never moves, the default bar anneals the step down.
    const settled = run(0.25);
    expect(late(settled)).toBeLessThan(settled.slice(0, 6).reduce((a, b) => a + b, 0) / 6);
  });
});
