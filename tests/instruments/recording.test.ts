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
