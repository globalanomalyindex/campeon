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
    // A concave dataset carrying GENUINE residual spread (residual sd ~0.4): the parabola does NOT
    // pass through the points, so there are real residuals for the per-point sd to scale. A
    // zero-residual fixture would leave the sd-weighting nothing to amplify, making the WIDENS test
    // pass from a band-count artifact rather than from the reliability mechanism (see the END-vs-CENTRAL
    // test below). We attach per-point Observation.noise to make it heteroscedastic and assert the CI
    // reacts to WHERE the loud facet lives.
    const noisy = (seed: number): Observation[] => {
      const peakX = Math.log(35);
      const rng = mulberry32(seed);
      return [18, 22, 26, 30, 35, 40, 46, 52, 58].map((s) => {
        const x = Math.log(s);
        const fit = -2 * (x - peakX) ** 2 + 5;
        return { x, y: fit + (rng() - 0.5) * 0.8 }; // ~uniform residual on (-0.4, 0.4)
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
      const obs = noisy(1).map((o, i) => ({ ...o, noise: i === 4 ? 4.0 : 0.05 }));
      const a = bootstrapCi(obs.map((o) => ({ ...o })), 400, mulberry32(77));
      const b = bootstrapCi(obs.map((o) => ({ ...o })), 400, mulberry32(77));
      expect(a).toEqual(b);
    });

    it('a loud facet at a HIGH-LEVERAGE end widens the CI more than the same loud facet CENTRAL', () => {
      // Load-bearing for the sd-scaling itself, NOT for the band-count artifact. Both inputs are
      // heteroscedastic (one loud facet at noise 6.0, the rest at 0.05) so BOTH take the 2-band union
      // path - the band count is held constant. The ONLY difference is WHERE the loud facet sits. The
      // peak estimate is far more sensitive to a loud point at a high-leverage END of the sampled range
      // than to a loud point in the CENTER, so the reliability-aware rescale-to-target-sd must make the
      // end-loud CI strictly wider. If the sd-weighting in bootstrap.ts is stripped (raw residual draws),
      // facet placement becomes irrelevant and the two widths collapse to byte-identical - failing this.
      const base = noisy(1);
      const endLoud = bootstrapCi(
        base.map((o, i) => ({ ...o, noise: i === 8 ? 6.0 : 0.05 })), // loud at the last (end) sample
        600,
        mulberry32(99),
      );
      const centralLoud = bootstrapCi(
        base.map((o, i) => ({ ...o, noise: i === 4 ? 6.0 : 0.05 })), // loud at the central sample
        600,
        mulberry32(99),
      );
      const endW = endLoud[1] - endLoud[0];
      const centralW = centralLoud[1] - centralLoud[0];
      expect(endW).toBeGreaterThan(centralW);
    });

    it('never narrows below the conservative (pooled) bound', () => {
      // Heteroscedastic facets that genuinely disagree must not produce a CI tighter than
      // the uniformly-pooled bound on the same residuals/seed.
      const obs = noisy(1).map((o, i) => ({ ...o, noise: i % 2 === 0 ? 5.0 : 0.05 }));
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
