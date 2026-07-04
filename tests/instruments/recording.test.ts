import { describe, it, expect } from 'vitest';
import { TrialRecorder, speedTrace, timeOnTarget, missComponents } from '../../src/instruments/recording';
import { FakeScene } from './fake-scene';

describe('TrialRecorder', () => {
  it('buffers frames with the active target bearing + radius, and fire snapshots', () => {
    const scene = new FakeScene();
    const target = scene.spawnTarget({ kind: 'static', yaw: 10, pitch: 0, worldRadius: 0.6 });
    const rec = new TrialRecorder(scene, () => target);
    scene.tick(16, [0, 0]);
    scene.moveTarget([10, 0], 2);
    scene.tick(16, [5, 0]);
    scene.fire([10, 0]);
    const r = rec.recording();
    expect(r.frames).toHaveLength(2);
    expect(r.frames[1].aim).toEqual([5, 0]);
    expect(r.frames[1].target).toEqual([10, 0]);
    expect(r.fires).toHaveLength(1);
    expect(r.fires[0].aim).toEqual([10, 0]);
    rec.stop();
    scene.tick(16);
    expect(rec.recording().frames).toHaveLength(2);
  });
});

describe('speedTrace', () => {
  it('is angular speed (deg/s) between consecutive frames', () => {
    const trace = speedTrace([
      { t: 0, aim: [0, 0], target: null, targetRadius: null },
      { t: 100, aim: [9, 0], target: null, targetRadius: null },
    ]);
    expect(trace).toHaveLength(1);
    expect(trace[0].speed).toBeCloseTo(90, 4);
  });
});

describe('timeOnTarget', () => {
  it('is the fraction of frames whose aim is within the target radius', () => {
    const frames = [
      { t: 0, aim: [0, 0] as [number, number], target: [3, 0] as [number, number], targetRadius: 2 },
      { t: 16, aim: [2.5, 0] as [number, number], target: [3, 0] as [number, number], targetRadius: 2 },
      { t: 32, aim: [3, 0] as [number, number], target: [3, 0] as [number, number], targetRadius: 2 },
    ];
    expect(timeOnTarget(frames)).toBeCloseTo(2 / 3, 6);
  });
});

describe('missComponents', () => {
  it('pure overshoot → positive radial, ~zero tangential', () => {
    const m = missComponents([0, 0], [10, 0], [12, 0]);
    expect(m.radial).toBeCloseTo(2, 6);
    expect(m.tangential).toBeCloseTo(0, 6);
    expect(m.reach).toBeCloseTo(10, 6);
  });
  it('pure undershoot → negative radial', () => {
    expect(missComponents([0, 0], [10, 0], [7, 0]).radial).toBeCloseTo(-3, 6);
  });
  it('lateral miss → tangential, ~zero radial', () => {
    const m = missComponents([0, 0], [10, 0], [10, 3]);
    expect(m.radial).toBeCloseTo(0, 6);
    expect(Math.abs(m.tangential)).toBeCloseTo(3, 6);
  });
  it('reach is the planar approach amplitude', () => {
    expect(missComponents([0, 0], [3, 4], [3, 4]).reach).toBeCloseTo(5, 6);
  });
});

describe('missComponents - ±180 yaw seam (arena angles arrive wrapped)', () => {
  // The real arena wraps view yaw to [-180, 180) (applyLook) and target bearings are
  // atan2-normalized (bearingOf), so the reach and the miss can straddle the seam. Yaw deltas
  // must be shortest signed arcs, or a plain difference picks up a ±360 discontinuity.
  const wrap = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

  it('overshoot across the seam keeps its sign (+0.4 reads +0.4, not -0.4)', () => {
    // Reach 170 → -172 (188 wrapped): an 18° rightward reach; landing 0.4° beyond the target.
    const m = missComponents([170, 0], [-172, 0], [-171.6, 0]);
    expect(m.reach).toBeCloseTo(18, 6);
    expect(m.radial).toBeCloseTo(0.4, 6);
    expect(m.tangential).toBeCloseTo(0, 6);
  });

  it('landing back across the seam is the true small miss, never a ~360 outlier', () => {
    // Target at -179.8 (180.2 wrapped); a 0.3° undershoot lands at 179.9 on the OTHER side of
    // the seam. A plain difference would read my = 359.7 - a fabricated catastrophic outlier.
    const m = missComponents([170, 0], [-179.8, 0], [179.9, 0]);
    expect(m.reach).toBeCloseTo(10.2, 6);
    expect(m.radial).toBeCloseTo(-0.3, 6);
    expect(Math.abs(m.radial)).toBeLessThan(1); // never jumps by ~360
    expect(Math.abs(m.tangential)).toBeLessThan(1);
  });

  it('mixed yaw+pitch reach across the seam recovers the constructed (radial, tangential) pair', () => {
    const start: [number, number] = [174, 2];
    const target: [number, number] = [-179.5, 5]; // 180.5 wrapped: true reach dy = 6.5, dp = 3
    const reach = Math.hypot(6.5, 3);
    const uy = 6.5 / reach;
    const up = 3 / reach;
    const a = -0.5; // along-axis undershoot
    const b = 0.2; // tangential
    const landing: [number, number] = [wrap(target[0] + a * uy - b * up), target[1] + a * up + b * uy];
    expect(landing[0]).toBeGreaterThan(0); // fixture sanity: the landing wrapped back across the seam
    const m = missComponents(start, target, landing);
    expect(m.reach).toBeCloseTo(reach, 6);
    expect(m.radial).toBeCloseTo(a, 6);
    expect(m.tangential).toBeCloseTo(b, 6);
  });
});
