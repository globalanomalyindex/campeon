import { describe, it, expect } from 'vitest';
import { analyzeStrike, strike, type StrikeShot } from '../../src/instruments/strike';
import type { TrialContext } from '../../src/types';
import { mulberry32 } from '../../src/stats/bootstrap';
import { FakeScene } from './fake-scene';

const ctx = (sa = 0.5): TrialContext => ({
  cm360: 34,
  dpi: 800,
  rng: mulberry32(13),
  profile: { speedAccuracy: sa, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
});

function strikes(ttk: number, scatter: number, hitRate: number, n = 8): StrikeShot[] {
  const out: StrikeShot[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      tR: ttk * 0.6,
      tS: ttk * 0.4,
      vPeak: 800,
      endpointError: (i % 2 === 0 ? 1 : -1) * scatter,
      hit: i / n < hitRate,
    });
  }
  return out;
}

describe('analyzeStrike', () => {
  it('faster TTK at equal accuracy scores higher (speed-leaning profile)', () => {
    const slow = analyzeStrike(strikes(500, 1, 1), ctx(0.8));
    const fast = analyzeStrike(strikes(250, 1, 1), ctx(0.8));
    expect(fast.raw.ttkMs).toBeLessThan(slow.raw.ttkMs);
    expect(fast.score).toBeGreaterThan(slow.score);
  });

  it('with an accuracy-leaning profile, hit rate dominates', () => {
    const accurateSlow = analyzeStrike(strikes(500, 0.5, 1), ctx(0.0));
    const sloppyFast = analyzeStrike(strikes(250, 3, 0.4), ctx(0.0));
    expect(accurateSlow.score).toBeGreaterThan(sloppyFast.score);
  });

  it('reports scatter (σ_θ), hit rate, and instrument id', () => {
    const r = analyzeStrike(strikes(300, 2, 0.75), ctx());
    expect(r.instrument).toBe('strike');
    expect(r.raw.sigmaTheta).toBeGreaterThan(0);
    expect(r.raw.hitRate).toBeCloseTo(0.75, 6);
    expect(Number.isFinite(r.score)).toBe(true);
  });
});

describe('strike.run', () => {
  it('drives fast shots and resolves a scored result', async () => {
    const scene = new FakeScene();
    const p = strike.run(ctx(), scene);
    for (let i = 0; i < 20; i++) {
      const spec = scene.spawned[scene.spawned.length - 1];
      const aim: [number, number] = [spec?.yaw ?? 0, spec?.pitch ?? 0];
      scene.tick(60, [0, 0]);
      scene.tick(60, aim);
      scene.fire(aim);
    }
    const r = await p;
    expect(r.instrument).toBe('strike');
    expect(Number.isFinite(r.raw.ttkMs)).toBe(true);
    expect(Number.isFinite(r.score)).toBe(true);
  });
});
