import { describe, it, expect } from 'vitest';
import { analyzeFlick, flick, FLICK_CONDITIONS, type FlickTap } from '../../src/instruments/flick';
import type { TrialContext } from '../../src/types';
import { mulberry32 } from '../../src/stats/bootstrap';
import { FakeScene } from './fake-scene';

const ctx = (): TrialContext => ({
  cm360: 34,
  dpi: 800,
  rng: mulberry32(9),
  profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
});

function taps(mt: number, errSd: number, n = 6): FlickTap[] {
  const out: FlickTap[] = [];
  for (let i = 0; i < n; i++) {
    const e = (i % 2 === 0 ? 1 : -1) * errSd;
    out.push({ amplitude: 20, width: 3, mt, errAlong: e, nCorr: 0, hit: Math.abs(e) <= 1.5 });
  }
  return out;
}

/** Taps for one explicit (amplitude, width) condition with controllable speed + spread. */
function cond(amplitude: number, width: number, mt: number, errSd: number, n = 4): FlickTap[] {
  return Array.from({ length: n }, (_, i) => {
    const e = (i % 2 === 0 ? 1 : -1) * errSd;
    return { amplitude, width, mt, errAlong: e, nCorr: 0, hit: Math.abs(e) <= width / 2 };
  });
}

describe('analyzeFlick', () => {
  it('faster taps at equal accuracy yield higher throughput', () => {
    const slow = analyzeFlick(taps(600, 0.6), ctx());
    const fast = analyzeFlick(taps(300, 0.6), ctx());
    expect(fast.raw.throughput).toBeGreaterThan(slow.raw.throughput);
    expect(fast.score).toBeGreaterThan(slow.score);
  });

  it('more endpoint spread lowers throughput', () => {
    const tight = analyzeFlick(taps(400, 0.4), ctx());
    const loose = analyzeFlick(taps(400, 1.2), ctx());
    expect(tight.raw.throughput).toBeGreaterThan(loose.raw.throughput);
  });

  it('reports hit rate and instrument id', () => {
    const r = analyzeFlick(taps(400, 0.4), ctx());
    expect(r.instrument).toBe('flick');
    expect(r.raw.hitRate).toBeCloseTo(1, 6);
    expect(Number.isFinite(r.score)).toBe(true);
  });

  it('throws if a condition has too few taps to estimate spread', () => {
    expect(() => analyzeFlick([{ amplitude: 20, width: 3, mt: 400, errAlong: 0.5, nCorr: 0, hit: true }], ctx()))
      .toThrow();
  });
});

describe('flick — two-mode crossover (spider ballistic orient + raptor dual-fovea)', () => {
  // Ballistic = large amplitude (≥24); precision = small width (≤2). The score is the harmonic mean
  // of the two sub-throughputs, so it peaks at the CROSSOVER — a sensitivity good at both — rather
  // than at whichever single mode happens to be fastest. Numbers derived from the ISO throughput
  // formula by hand: the balanced player's pooled mean is LOWER than the specialist's, but its
  // harmonic mean is HIGHER. That divergence is the whole point.
  const balanced = [...cond(40, 3, 400, 0.5), ...cond(12, 1.5, 400, 0.3)]; // competent at both modes
  const lopsided = [...cond(40, 3, 250, 0.4), ...cond(12, 1.5, 700, 0.9)]; // great flick, poor lock

  it('rewards the balanced player over the specialist — opposite to what pooled throughput does', () => {
    const A = analyzeFlick(balanced, ctx());
    const B = analyzeFlick(lopsided, ctx());
    expect(B.raw.throughput).toBeGreaterThan(A.raw.throughput); // old pooled metric favors the specialist…
    expect(A.score).toBeGreaterThan(B.score); // …the crossover score favors the all-rounder
  });

  it('scores the harmonic mean of the ballistic and precision sub-throughputs', () => {
    const r = analyzeFlick(balanced, ctx());
    const b = r.raw.ballisticTP;
    const p = r.raw.precisionTP;
    expect(Number.isFinite(b)).toBe(true);
    expect(Number.isFinite(p)).toBe(true);
    expect(r.score).toBeCloseTo((2 * b * p) / (b + p), 6);
    expect(r.score).toBeLessThanOrEqual(Math.max(b, p)); // harmonic mean ≤ max of the two
  });
});

describe('FLICK_CONDITIONS', () => {
  it('spans a grid of amplitudes and widths (ID range)', () => {
    expect(FLICK_CONDITIONS.length).toBeGreaterThanOrEqual(4);
  });
});

describe('flick.run', () => {
  it('presents targets, records fires, and resolves a scored result', async () => {
    const scene = new FakeScene();
    const p = flick.run(ctx(), scene);
    const scatter = mulberry32(99); // realistic seeded endpoint spread (deterministic, ±0.8°)
    for (let k = 0; k < 40; k++) {
      const spec = scene.spawned[scene.spawned.length - 1];
      const aim: [number, number] = [
        (spec?.yaw ?? 0) + (scatter() * 2 - 1) * 0.8,
        (spec?.pitch ?? 0) + (scatter() * 2 - 1) * 0.8,
      ];
      scene.tick(120, aim);
      scene.tick(120, aim);
      scene.tick(120, aim);
      scene.fire(aim);
    }
    const r = await p;
    expect(r.instrument).toBe('flick');
    expect(scene.spawned.length).toBeGreaterThan(1);
    expect(Number.isFinite(r.score)).toBe(true);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(20); // realistic throughput, not the inflated zero-spread artifact
    expect(r.raw.conditions).toBe(FLICK_CONDITIONS.length);
  });
});
