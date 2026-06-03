import { describe, it, expect } from 'vitest';
import { analyzeTrack, track } from '../../src/instruments/track';
import type { Frame } from '../../src/instruments/recording';
import type { TrialContext } from '../../src/types';
import { mulberry32 } from '../../src/stats/bootstrap';
import { FakeScene } from './fake-scene';

const ctx = (): TrialContext => ({
  cm360: 34,
  dpi: 800,
  rng: mulberry32(5),
  profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
});

function tracking(lagFrames: number, jitterAmp = 0): Frame[] {
  const frames: Frame[] = [];
  const N = 240;
  const targetAt = (i: number): [number, number] => [10 * Math.sin(i * 0.05), 3 * Math.sin(i * 0.04)];
  for (let i = 0; i < N; i++) {
    const tgt = targetAt(i);
    const src = targetAt(Math.max(0, i - lagFrames));
    const jit = jitterAmp * Math.sin(i * 1.9);
    frames.push({ t: i * 16, aim: [src[0] + jit, src[1]], target: tgt, targetRadius: 2.5 });
  }
  return frames;
}

describe('analyzeTrack', () => {
  it('a near-perfect tracker beats a laggy tracker', () => {
    const good = analyzeTrack({ frames: tracking(0), fires: [] }, ctx());
    const laggy = analyzeTrack({ frames: tracking(6), fires: [] }, ctx());
    expect(good.raw.tot).toBeGreaterThan(laggy.raw.tot);
    expect(good.score).toBeGreaterThan(laggy.score);
  });

  it('flags reactive lag with a negative predictive index', () => {
    const laggy = analyzeTrack({ frames: tracking(8), fires: [] }, ctx());
    expect(laggy.raw.pi).toBeLessThan(0);
  });

  it('MEASURES the player\'s own tracking latency (scales with true lag; not a fixed constant)', () => {
    // The dragonfly forward model leads by its OWN measured latency. campeón must recover one per
    // player, not the old hard-coded 0.15 s. Properties derived from the fixture, not the code:
    const synced = analyzeTrack({ frames: tracking(0), fires: [] }, ctx());
    const mid = analyzeTrack({ frames: tracking(6), fires: [] }, ctx()); // 6 frames × 16 ms ≈ 96 ms
    const slow = analyzeTrack({ frames: tracking(10), fires: [] }, ctx());
    expect(synced.raw.latencySec).toBeLessThan(0.03); // a perfectly synced tracker reads ~0
    expect(mid.raw.latencySec).toBeGreaterThan(synced.raw.latencySec);
    expect(slow.raw.latencySec).toBeGreaterThan(mid.raw.latencySec); // monotone in true lag
    // …and the lag-6 estimate is nearer the true 96 ms than the old fixed 150 ms.
    expect(Math.abs(mid.raw.latencySec - 0.096)).toBeLessThan(Math.abs(mid.raw.latencySec - 0.15));
  });

  it('lag-compensates the predictive error: tremor survives, pure latency does not', () => {
    // After removing the player's measured latency, a pure-latency tracker's residual collapses to a
    // small floor; adding tremor at the SAME latency inflates it sharply. So jitter (sensitivity-
    // dependent) must dominate the residual, not the latency. (Derived from first principles.)
    const cleanLaggy = analyzeTrack({ frames: tracking(6, 0), fires: [] }, ctx());
    const jittery = analyzeTrack({ frames: tracking(6, 1.2), fires: [] }, ctx());
    expect(jittery.raw.predErr).toBeGreaterThan(2 * cleanLaggy.raw.predErr);
  });

  it('a jittery (over-sensitive) tracker has higher jitter than a smooth one', () => {
    const smooth = analyzeTrack({ frames: tracking(0, 0), fires: [] }, ctx());
    const jittery = analyzeTrack({ frames: tracking(0, 1.5), fires: [] }, ctx());
    expect(jittery.raw.jitter).toBeGreaterThan(smooth.raw.jitter);
    expect(smooth.score).toBeGreaterThan(jittery.score);
  });

  it('reports instrument id and finite score', () => {
    const r = analyzeTrack({ frames: tracking(2), fires: [] }, ctx());
    expect(r.instrument).toBe('track');
    expect(Number.isFinite(r.score)).toBe(true);
    expect(r.cm360).toBe(34);
  });
});

describe('track.run', () => {
  it('drives a moving target for the trial duration and resolves a scored result', async () => {
    const scene = new FakeScene();
    const p = track.run(ctx(), scene);
    for (let i = 0; i < 400; i++) {
      const b: [number, number] = [10 * Math.sin(i * 0.05), 3 * Math.sin(i * 0.04)];
      scene.moveTarget(b, 2.5);
      scene.tick(16, b);
    }
    const r = await p;
    expect(r.instrument).toBe('track');
    expect(scene.spawned.some((s) => s.kind === 'moving')).toBe(true);
    expect(scene.cleared).toBeGreaterThan(0);
    expect(Number.isFinite(r.score)).toBe(true);
    expect(r.at).toBeGreaterThan(0);
  });
});
