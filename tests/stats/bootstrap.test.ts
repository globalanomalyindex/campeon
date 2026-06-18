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

  it('mulberry32 is deterministic for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('CI widens as noise grows', () => {
    // each mulberry32(7) is an independent closure - reused seed only for reproducibility
    const tight = bootstrapCi(dataset(0.2, mulberry32(7)), 400, mulberry32(7));
    const loose = bootstrapCi(dataset(2.0, mulberry32(7)), 400, mulberry32(7));
    expect(loose[1] - loose[0]).toBeGreaterThan(tight[1] - tight[0]);
  });

  describe('reliability-aware (heteroscedastic)', () => {
    // A clean concave dataset. We will attach per-point Observation.noise to make it
    // heteroscedastic and assert the CI reacts to WHERE the noise lives.
    const clean = (): Observation[] => {
      const peakX = Math.log(35);
      return [18, 22, 26, 30, 35, 40, 46, 52, 58].map((s) => {
        const x = Math.log(s);
        return { x, y: -2 * (x - peakX) ** 2 + 5 };
      });
    };

    it('homoscedastic input reproduces the old pooled CI exactly (no silent regression)', () => {
      // Same residuals, same seed. Flat (undefined) noise and a uniform constant noise on
      // every point must both yield the byte-identical CI the pooled bag produced before.
      const base = dataset(0.6, mulberry32(11));
      const flat = bootstrapCi([...base], 400, mulberry32(31));

      const uniform = base.map((o) => ({ ...o, noise: 0.1 }));
      const uniformCi = bootstrapCi(uniform, 400, mulberry32(31));

      expect(uniformCi).toEqual(flat);
    });

    it('is deterministic under the seeded RNG with heteroscedastic noise', () => {
      const obs = clean().map((o, i) => ({ ...o, noise: i === 4 ? 4.0 : 0.05 }));
      const a = bootstrapCi(obs.map((o) => ({ ...o })), 400, mulberry32(77));
      const b = bootstrapCi(obs.map((o) => ({ ...o })), 400, mulberry32(77));
      expect(a).toEqual(b);
    });

    it('a high-noise point WIDENS the CI; a quiet point does not', () => {
      const quietCi = bootstrapCi(
        clean().map((o) => ({ ...o, noise: 0.05 })),
        600,
        mulberry32(123),
      );
      // Inject one loud facet at the peak-adjacent sample; everything else stays quiet.
      const loudCi = bootstrapCi(
        clean().map((o, i) => ({ ...o, noise: i === 5 ? 6.0 : 0.05 })),
        600,
        mulberry32(123),
      );
      const quietW = quietCi[1] - quietCi[0];
      const loudW = loudCi[1] - loudCi[0];
      expect(loudW).toBeGreaterThan(quietW);
    });

    it('never narrows below the conservative (pooled) bound', () => {
      // Heteroscedastic facets that genuinely disagree must not produce a CI tighter than
      // the uniformly-pooled bound on the same residuals/seed.
      const obs = clean().map((o, i) => ({ ...o, noise: i % 2 === 0 ? 5.0 : 0.05 }));
      const pooled = bootstrapCi(
        obs.map(({ x, y }) => ({ x, y })), // strip noise → pooled bag
        500,
        mulberry32(321),
      );
      const hetero = bootstrapCi(
        obs.map((o) => ({ ...o })),
        500,
        mulberry32(321),
      );
      expect(hetero[0]).toBeLessThanOrEqual(pooled[0] + 1e-9);
      expect(hetero[1]).toBeGreaterThanOrEqual(pooled[1] - 1e-9);
    });
  });
});
