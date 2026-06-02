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
