import { describe, it, expect } from 'vitest';
import { mulberry32, bootstrapCi } from '../../src/stats/bootstrap';
import type { Observation } from '../../src/types';

function dataset(noise: number, rng: () => number): Observation[] {
  const peakX = Math.log(35);
  const obs: Observation[] = [];
  for (const s of [18, 22, 26, 30, 35, 40, 46, 52, 58]) {
    const x = Math.log(s);
    const clean = -2 * (x - peakX) ** 2 + 5;
    obs.push({ x, y: clean + (rng() - 0.5) * noise });
  }
  return obs;
}

describe('bootstrap CI', () => {
  it('90% CI brackets the true optimum (low noise)', () => {
    const [lo, hi] = bootstrapCi(dataset(0.2, mulberry32(1)), 400, mulberry32(99));
    expect(lo).toBeLessThan(35);
    expect(hi).toBeGreaterThan(35);
  });

  it('CI widens as noise grows', () => {
    const tight = bootstrapCi(dataset(0.2, mulberry32(7)), 400, mulberry32(7));
    const loose = bootstrapCi(dataset(2.0, mulberry32(7)), 400, mulberry32(7));
    expect(loose[1] - loose[0]).toBeGreaterThan(tight[1] - tight[0]);
  });
});
