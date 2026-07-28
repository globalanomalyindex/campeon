import { describe, it, expect } from 'vitest';
import { fitQuadratic, fitPeak, fitDrift, fitPeakDrift, DRIFT_MIN_OBS } from '../../src/stats/peak-fit';
import type { Observation } from '../../src/types';

describe('parabolic peak fit', () => {
  // y = -2 (x - ln35)^2 + 5  → peak at x = ln(35)
  const peakX = Math.log(35);
  const obs: Observation[] = [];
  for (const s of [18, 24, 30, 35, 42, 50, 58]) {
    const x = Math.log(s);
    obs.push({ x, y: -2 * (x - peakX) ** 2 + 5 });
  }

  it('recovers quadratic coefficients (β2 < 0)', () => {
    const { b2 } = fitQuadratic(obs);
    expect(b2).toBeLessThan(0);
  });

  it('recovers the optimal cm/360 ≈ 35', () => {
    expect(fitPeak(obs).optimalCounts).toBeCloseTo(35, 1);
  });

  it('returns a curve for plotting', () => {
    expect(fitPeak(obs).curve.length).toBeGreaterThan(10);
  });

  it('throws when the fit is convex (no interior peak)', () => {
    // monotonically increasing data → convex/linear fit, b2 ≥ 0
    const monotone = [10, 20, 30, 40, 50].map((s) => ({ x: Math.log(s), y: s }));
    expect(() => fitPeak(monotone)).toThrow(/not concave/);
  });
});

describe('ANCOVA drift fit (A4)', () => {
  // A realistic session shape: an explore sweep followed by exploitation near cm=30, with a linear
  // within-session drift b3·tau injected on top of the true curve (peak at 35). tau is the
  // standardized trial-order index - exactly what trialsToObservations emits. Late (high-tau) trials
  // concentrate near 30, so the drift loads onto the x-curve and biases the PLAIN quadratic peak;
  // the extended fit partials it out and recovers the truth.
  const peakX = Math.log(35);
  const cms = [18, 22, 26, 30, 35, 40, 46, 52, 58, 30, 29, 32, 31, 28];
  const ks = cms.map((_, k) => k);
  const muK = ks.reduce((s, v) => s + v, 0) / ks.length;
  const sdK = Math.sqrt(ks.reduce((s, v) => s + (v - muK) ** 2, 0) / (ks.length - 1));
  const drifted = (b3: number): Observation[] =>
    cms.map((cm, k) => {
      const x = Math.log(cm);
      const tau = (k - muK) / sdK;
      return { x, tau, y: -2 * (x - peakX) ** 2 + 5 + b3 * tau };
    });

  it('recovers the true peak and the injected drift coefficient exactly (noise-free)', () => {
    const fit = fitPeakDrift(drifted(0.8));
    expect(fit).not.toBeNull();
    expect(fit!.optimalCounts).toBeCloseTo(35, 3);
    expect(fit!.driftZ).toBeCloseTo(0.8, 6);
  });

  it('the extended peak is closer to truth than the plain fit under injected drift (bias removed)', () => {
    const obs = drifted(0.8);
    const plain = fitPeak(obs).optimalCounts;
    const ext = fitPeakDrift(obs)!.optimalCounts;
    expect(Math.abs(plain - 35)).toBeGreaterThan(1); // the drift genuinely biases the plain peak
    expect(Math.abs(ext - 35)).toBeLessThan(Math.abs(plain - 35));
  });

  it('returns a detrended curve (tau partialled out at its zero mean), same sampling as fitPeak', () => {
    const fit = fitPeakDrift(drifted(0.8))!;
    expect(fit.curve.length).toBeGreaterThan(10);
    // the detrended curve must peak at the detrended optimum, not at the drift-biased one
    const top = fit.curve.reduce((a, b) => (b.mean > a.mean ? b : a));
    expect(Math.exp(top.x)).toBeCloseTo(35, 0);
  });

  it('falls back (null - b3 column DROPPED) when n < DRIFT_MIN_OBS', () => {
    expect(fitPeakDrift(drifted(0.8).slice(0, DRIFT_MIN_OBS - 1))).toBeNull();
    expect(fitDrift(drifted(0.8).slice(0, DRIFT_MIN_OBS - 1))).toBeNull();
  });

  it('falls back when any observation lacks tau (no tau signal → plain quadratic path)', () => {
    const obs = drifted(0.8);
    const { tau: _t, ...noTau } = obs[3]!;
    expect(fitPeakDrift([...obs.slice(0, 3), noTau, ...obs.slice(4)])).toBeNull();
  });

  it('falls back when tau is constant (zero spread → unidentifiable)', () => {
    expect(fitPeakDrift(drifted(0.8).map((o) => ({ ...o, tau: 0 })))).toBeNull();
  });

  it('falls back when tau is collinear with the quadratic design (heavy-exploitation degeneracy)', () => {
    // A geometric cm sweep makes x LINEAR in the trial index, so tau is an exact function of x:
    // R² of tau on [1, x, x²] is 1 and b3 is unidentifiable. Reporting it would be dishonest -
    // the conditioning check (not just the n threshold) must drop the b3 column.
    const geo = Array.from({ length: 14 }, (_, k) => 18 * Math.pow(58 / 18, k / 13));
    const collinear: Observation[] = geo.map((cm, k) => {
      const x = Math.log(cm);
      const tau = (k - muK) / sdK;
      return { x, tau, y: -2 * (x - peakX) ** 2 + 5 + 0.5 * tau };
    });
    expect(fitPeakDrift(collinear)).toBeNull();
  });

  it('falls back when the DETRENDED fit is not concave (no interior peak to report)', () => {
    // convex-in-x y (a valley, plus a little drift) → extended b2 > 0 → no honest detrended peak
    const convex: Observation[] = cms.map((cm, k) => {
      const x = Math.log(cm);
      const tau = (k - muK) / sdK;
      return { x, tau, y: 2 * (x - peakX) ** 2 + 0.1 * tau };
    });
    expect(fitPeakDrift(convex)).toBeNull();
  });
});
