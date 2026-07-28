import { describe, it, expect } from 'vitest';
import { TrialRecorder, countTrace, timeOnTarget, missComponents, type Frame } from '../../src/instruments/recording';
import { segment, ONSET_COUNTS_PER_SEC } from '../../src/scoring/submovement';
import { counts360 } from '../../src/types';
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

describe('countTrace', () => {
  /** Counts the hand emits in each successive 16 ms frame. One primary bump, one correction. */
  const EMISSION = [0, 12, 40, 90, 60, 20, 4, 2, 18, 6] as const;

  /** The frames those counts produce when the arena renders `rendered` counts per 360. */
  function framesFor(rendered: number): Frame[] {
    const degPerCount = 360 / rendered;
    const out: Frame[] = [{ t: 0, aim: [0, 0], target: null, targetRadius: null }];
    let yaw = 0;
    for (let i = 0; i < EMISSION.length; i++) {
      yaw += EMISSION[i]! * degPerCount;
      out.push({ t: (i + 1) * 16, aim: [yaw, 0], target: null, targetRadius: null });
    }
    return out;
  }

  /** The deg/s trace the segmenter used to be handed, kept here as the teeth of the test. */
  function degSpeeds(frames: readonly Frame[]): number[] {
    const out: number[] = [];
    for (let i = 1; i < frames.length; i++) {
      out.push(Math.abs(frames[i]!.aim[0] - frames[i - 1]!.aim[0]) / ((frames[i]!.t - frames[i - 1]!.t) / 1000));
    }
    return out;
  }

  it('is the emitted counts per second, whatever the frame spacing', () => {
    const trace = countTrace(framesFor(6000), counts360(6000));
    expect(trace).toHaveLength(EMISSION.length);
    expect(trace[1]!.countsPerSec).toBeCloseTo(12 / 0.016, 6);
    expect(trace[3]!.countsPerSec).toBeCloseTo(90 / 0.016, 6);
    expect(trace[3]!.t).toBe(64);
  });

  it('the same hand emission reads the same count trace at any rendered gain', () => {
    const slow = countTrace(framesFor(6000), counts360(6000));
    const fast = countTrace(framesFor(18000), counts360(18000));
    expect(fast).toHaveLength(slow.length);
    for (let i = 0; i < slow.length; i++) {
      expect(fast[i]!.countsPerSec).toBeCloseTo(slow[i]!.countsPerSec, 6);
    }
    // Teeth: the SAME emission renders three times the angular speed at 6000 counts/360 as at
    // 18000, so a threshold fixed in deg/s provably cannot return the same onset for both.
    expect(degSpeeds(framesFor(6000))[1]!).toBeCloseTo(3 * degSpeeds(framesFor(18000))[1]!, 6);
  });

  it('and therefore segments identically at both gains', () => {
    const a = segment(countTrace(framesFor(6000), counts360(6000)), { onsetThresh: ONSET_COUNTS_PER_SEC });
    const b = segment(countTrace(framesFor(18000), counts360(18000)), { onsetThresh: ONSET_COUNTS_PER_SEC });
    // The first frame pair emits nothing, so onset is the second sample: EMISSION[1] = 12 counts in
    // 16 ms is 750 counts/s, the first sample over the 600 floor.
    expect(a.onsetTime).toBe(32);
    expect(a.nCorr).toBe(1);
    expect(b.onsetTime).toBe(a.onsetTime);
    expect(b.nCorr).toBe(a.nCorr);
    expect(b.vPeak).toBeCloseTo(a.vPeak, 6);
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
