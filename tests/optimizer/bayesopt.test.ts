import { describe, it, expect } from 'vitest';
import { normPdf, normCdf, expectedImprovement, ucb } from '../../src/optimizer/bayesopt';

describe('normal helpers', () => {
  it('normCdf matches known quantiles', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.6448536)).toBeCloseTo(0.95, 4);
    expect(normCdf(-1.6448536)).toBeCloseTo(0.05, 4);
  });

  it('normPdf integrates to ~1 over a fine grid', () => {
    let area = 0;
    const h = 0.01;
    for (let z = -6; z <= 6; z += h) area += normPdf(z) * h;
    expect(area).toBeCloseTo(1, 3);
  });
});

describe('expectedImprovement (maximization)', () => {
  it('is zero when variance is zero', () => {
    expect(expectedImprovement(5, 0, 1, 0.01)).toBe(0);
  });

  it('rises with the posterior mean at equal uncertainty', () => {
    const lo = expectedImprovement(1, 1, 1, 0.01);
    const hi = expectedImprovement(3, 1, 1, 0.01);
    expect(hi).toBeGreaterThan(lo);
  });

  it('rewards uncertainty at the incumbent (exploration)', () => {
    const certain = expectedImprovement(1, 1e-6, 1, 0);
    const uncertain = expectedImprovement(1, 1, 1, 0);
    expect(uncertain).toBeGreaterThan(certain);
  });
});

describe('ucb', () => {
  it('adds kappa standard deviations to the mean', () => {
    expect(ucb(2, 4, 2)).toBeCloseTo(2 + 2 * 2, 9); // sd = 2
  });
});

import { makeBo } from '../../src/optimizer/bayesopt';
import type { Observation } from '../../src/types';

const bounds: [number, number] = [15, 60];

describe('makeBo', () => {
  // Observations from a concave objective peaked at ln(32).
  const peak = Math.log(32);
  const obs: Observation[] = [12, 18, 26, 32, 40, 52].map((cm) => {
    const x = Math.log(cm);
    return { x, y: -(x - peak) * (x - peak) };
  });

  it('returns the domain midpoint when there is no data', () => {
    const bo = makeBo({ gp: { signalVar: 1, lengthScale: 0.5, noiseVar: 0.2 } });
    const s = bo.suggest([], bounds);
    expect(s).toBeCloseTo(Math.sqrt(15 * 60), 6); // exp((ln15+ln60)/2)
  });

  it('UCB with kappa 0 suggests near the objective peak', () => {
    const bo = makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 1e-3 }, acquisition: 'ucb', kappa: 0 });
    const s = bo.suggest(obs, bounds);
    expect(s).toBeGreaterThan(26);
    expect(s).toBeLessThan(40);
  });

  it('EI proposes a finite cm/360 within bounds', () => {
    const bo = makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 1e-3 }, acquisition: 'ei' });
    const s = bo.suggest(obs, bounds);
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(15);
    expect(s).toBeLessThanOrEqual(60);
  });

  it('the acquisition switch changes the suggestion (EI exploits, UCB explores)', () => {
    const gp = { signalVar: 1, lengthScale: 0.6, noiseVar: 1e-3 } as const;
    const ei = makeBo({ gp, acquisition: 'ei' }).suggest(obs, bounds);
    const ucbWide = makeBo({ gp, acquisition: 'ucb', kappa: 2 }).suggest(obs, bounds);
    // EI sits near the ln(32) peak; high-kappa UCB chases the unexplored high-cm/360 edge.
    expect(Math.abs(ei - ucbWide)).toBeGreaterThan(1);
  });

  it('isDone at the trial budget', () => {
    const bo = makeBo({ gp: { signalVar: 1, lengthScale: 0.5, noiseVar: 0.2 }, maxTrials: 5 });
    expect(bo.isDone(obs.slice(0, 4))).toBe(false);
    expect(bo.isDone([...obs, ...obs])).toBe(true);
  });
});
