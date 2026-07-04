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

  // A1: this test previously asserted that scoreSE GROWS WITH ENDPOINT SCATTER at H = 1 - old
  // behavior that baked in the tuned ACC_REF_DEG proxy (σ_θ against a feel-chosen 1° reference).
  // σ_θ is not the score's accuracy factor (the score is speedTerm^w · hitRate^(1−w)), so the
  // corrected accuracy SE is the binomial SE of the hit rate. The fixtures here have H = 1 (plug-in
  // binomial spread honestly 0) AND a constant per-shot TTK (speed spread 0), so the honest output
  // is now NO scoreSE at all - the never-fabricate rule, not a synthetic scatter-based nugget.
  it('emits no scoreSE when both measured spreads are honestly zero (H=1, constant TTK)', () => {
    const tight = analyzeStrike(strikes(300, 0.5, 1), ctx());
    const loose = analyzeStrike(strikes(300, 3, 1), ctx());
    expect(tight.scoreSE).toBeUndefined();
    expect(loose.scoreSE).toBeUndefined();
  });

  it('scoreSE accuracy term equals the plug-in binomial SE of the hit rate (mid H)', () => {
    const n = 8;
    const w = 0.5;
    const r = analyzeStrike(strikes(300, 1, 0.75, n), ctx(w));
    const H = r.raw.hitRate as number;
    expect(H).toBeCloseTo(0.75, 12);
    // relAcc = SE(H)/H with SE(H) = √(H(1−H)/n) - the score's own functional form, no tuned scale.
    const relAcc = Math.sqrt((H * (1 - H)) / n) / H;
    // The fixture TTKs are identical shot-to-shot → the speed SE is 0, so the delta-method SE
    // reduces to score · (1−w) · relAcc exactly.
    expect(r.scoreSE).toBeDefined();
    expect(r.scoreSE as number).toBeCloseTo(r.score * (1 - w) * relAcc, 12);
  });

  it('scoreSE is independent of endpoint scatter (tuned ACC_REF_DEG scale removed)', () => {
    const tight = analyzeStrike(strikes(300, 0.5, 0.75), ctx());
    const loose = analyzeStrike(strikes(300, 3, 0.75), ctx());
    // Same H, same TTK → identical SE; scatter no longer flows into the nugget...
    expect(loose.scoreSE).toBeDefined();
    expect(loose.scoreSE as number).toBeCloseTo(tight.scoreSE as number, 12);
    // ...but σ_θ stays in raw as the diagnostic it already was.
    expect(loose.raw.sigmaTheta as number).toBeGreaterThan(tight.raw.sigmaTheta as number);
  });

  it('H=1 omits the accuracy SE but keeps the measured speed-term SE', () => {
    const n = 8;
    const w = 0.5;
    const shots: StrikeShot[] = [];
    for (let i = 0; i < n; i++) {
      shots.push({ tR: 150 + i * 10, tS: 100, vPeak: 800, endpointError: 0, hit: true });
    }
    const r = analyzeStrike(shots, ctx(w));
    const ttkSec = shots.map((s) => (s.tR + s.tS) / 1000);
    const mean = ttkSec.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(ttkSec.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1));
    const relSpeed = sd / Math.sqrt(n) / mean;
    // At H = 1 the binomial spread is honestly 0 → only the speed term contributes.
    expect(r.scoreSE).toBeDefined();
    expect(r.scoreSE as number).toBeCloseTo(r.score * w * relSpeed, 12);
  });

  it('H=0 keeps the existing guard: score 0, no scoreSE', () => {
    const r = analyzeStrike(strikes(300, 1, 0), ctx(0.5));
    expect(r.score).toBe(0);
    expect(r.scoreSE).toBeUndefined();
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
