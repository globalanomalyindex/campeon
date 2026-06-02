import { describe, it, expect } from 'vitest';
import { analyzeCalibrate, calibrate, type CalibrateShot } from '../../src/instruments/calibrate';
import type { TrialContext } from '../../src/types';
import { mulberry32 } from '../../src/stats/bootstrap';
import { FakeScene } from './fake-scene';

const ctx = (): TrialContext => ({
  cm360: 34,
  dpi: 800,
  rng: mulberry32(11),
  profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
});

function shots(biasRadial: number, spread: number, n = 8): CalibrateShot[] {
  const out: CalibrateShot[] = [];
  for (let i = 0; i < n; i++) {
    const s = (i % 2 === 0 ? 1 : -1) * spread;
    out.push({ errAlong: biasRadial + s, errCross: 0, required: 15, mt: 500 });
  }
  return out;
}

describe('analyzeCalibrate', () => {
  it('recovers a systematic overshoot as gain > 1', () => {
    const r = analyzeCalibrate(shots(3, 0.5), ctx());
    expect(r.raw.gain).toBeGreaterThan(1);
    expect(r.raw.biasRadial).toBeCloseTo(3, 1);
  });

  it('undershoot reads as gain < 1', () => {
    const r = analyzeCalibrate(shots(-3, 0.5), ctx());
    expect(r.raw.gain).toBeLessThan(1);
  });

  it('lower bias + spread scores higher', () => {
    const clean = analyzeCalibrate(shots(0.2, 0.3), ctx());
    const messy = analyzeCalibrate(shots(3, 1.5), ctx());
    expect(clean.score).toBeGreaterThan(messy.score);
    expect(clean.instrument).toBe('calibrate');
  });

  it('score is in (0, 1] and finite', () => {
    const r = analyzeCalibrate(shots(1, 1), ctx());
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });
});

describe('calibrate.run', () => {
  it('fires a burst and resolves a scored result', async () => {
    const scene = new FakeScene();
    const p = calibrate.run(ctx(), scene);
    for (let i = 0; i < 30; i++) {
      const spec = scene.spawned[scene.spawned.length - 1];
      const aim: [number, number] = [(spec?.yaw ?? 0) + 1, spec?.pitch ?? 0]; // small consistent overshoot
      scene.tick(200, aim);
      scene.fire(aim);
    }
    const r = await p;
    expect(r.instrument).toBe('calibrate');
    expect(Number.isFinite(r.raw.gain)).toBe(true);
    expect(Number.isFinite(r.score)).toBe(true);
  });
});
