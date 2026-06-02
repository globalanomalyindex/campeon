import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import {
  angularRadius,
  bearingOf,
  positionAt,
  placeStatic,
  Target,
} from '../../src/engine/targets';
import { separation, motionOffset, MovingTarget } from '../../src/engine/targets';
import { mulberry32 } from '../../src/stats/bootstrap';

describe('angularRadius', () => {
  it('is the sphere half-angle asin(r/d) in degrees', () => {
    expect(angularRadius(1, 10)).toBeCloseTo(5.739, 3);
    expect(angularRadius(1, 1)).toBeCloseTo(90, 6); // sphere fills the forward hemisphere when d = r
  });
});

describe('bearingOf', () => {
  it('straight ahead = [0,0]', () => {
    const [y, p] = bearingOf(new Vector3(0, 0, -10));
    expect(y).toBeCloseTo(0, 9);
    expect(p).toBeCloseTo(0, 9);
  });
  it('+X is +90° yaw (right); +Y is +pitch (up)', () => {
    expect(bearingOf(new Vector3(10, 0, 0))[0]).toBeCloseTo(90, 6);
    expect(bearingOf(new Vector3(0, 10, -10))[1]).toBeCloseTo(45, 6);
  });
  it('-X is -90° yaw (left); directly behind is ±180°', () => {
    expect(bearingOf(new Vector3(-10, 0, 0))[0]).toBeCloseTo(-90, 6);
    expect(Math.abs(bearingOf(new Vector3(0, 0, 10))[0])).toBeCloseTo(180, 6);
  });
});

describe('positionAt / bearingOf are inverses', () => {
  it('round-trips an arbitrary bearing', () => {
    const [y, p] = bearingOf(positionAt(33, -12, 25));
    expect(y).toBeCloseTo(33, 6);
    expect(p).toBeCloseTo(-12, 6);
  });
  it('round-trips bearings across all quadrants (pins the frame against sign flips)', () => {
    for (const [y, p] of [[-45, 10], [0, -30], [135, -20], [-120, 5]] as const) {
      const [ry, rp] = bearingOf(positionAt(y, p, 15));
      expect(ry).toBeCloseTo(y, 5);
      expect(rp).toBeCloseTo(p, 5);
    }
  });
});

describe('Target', () => {
  it('reports its bearing and angular radius', () => {
    const t = new Target('t1', { yaw: 20, pitch: -5, distance: 20, worldRadius: 0.6 });
    const [y, p] = t.bearing();
    expect(y).toBeCloseTo(20, 4);
    expect(p).toBeCloseTo(-5, 4);
    expect(t.radiusDeg()).toBeCloseTo(angularRadius(0.6, 20), 9);
    expect(t.id).toBe('t1');
  });
});

describe('placeStatic', () => {
  it('places within the forward cone for a seeded RNG', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 50; i++) {
      const pl = placeStatic(rng);
      expect(Math.abs(pl.yaw)).toBeLessThanOrEqual(25);
      expect(Math.abs(pl.pitch)).toBeLessThanOrEqual(12);
      expect(pl.distance).toBeGreaterThan(0);
      expect(pl.worldRadius).toBeGreaterThan(0);
    }
  });
});

describe('separation', () => {
  it('is the great-circle angle between two bearings', () => {
    expect(separation([0, 0], [0, 0])).toBeCloseTo(0, 9);
    expect(separation([0, 0], [90, 0])).toBeCloseTo(90, 6);
    expect(separation([0, 0], [0, 90])).toBeCloseTo(90, 6);
    expect(separation([10, 5], [10, 5])).toBeCloseTo(0, 9);
  });
  it('is symmetric and bounded by 180', () => {
    expect(separation([30, 10], [-40, -5])).toBeCloseTo(separation([-40, -5], [30, 10]), 9);
    expect(separation([0, 0], [180, 0])).toBeLessThanOrEqual(180 + 1e-6);
  });
});

describe('motionOffset', () => {
  it('is deterministic from the seed and bounded by the amplitudes', () => {
    const motion = { yawAmp: 8, pitchAmp: 3, baseFreq: 0.5, seed: 7 };
    for (let t = 0; t <= 5; t += 0.25) {
      const [dy, dp] = motionOffset(motion, t);
      expect(Math.abs(dy)).toBeLessThanOrEqual(8 + 1e-9);
      expect(Math.abs(dp)).toBeLessThanOrEqual(3 + 1e-9);
    }
    expect(motionOffset(motion, 1.3)).toEqual(motionOffset(motion, 1.3));
  });
  it('actually moves over time', () => {
    const motion = { yawAmp: 8, pitchAmp: 3, baseFreq: 0.5, seed: 1 };
    const a = motionOffset(motion, 0);
    const b = motionOffset(motion, 0.6);
    expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])).toBeGreaterThan(0.1);
  });
});

describe('MovingTarget', () => {
  it('updates its bearing as time advances along the path', () => {
    const t = new MovingTarget(
      'm1',
      { yaw: 0, pitch: 0, distance: 20, worldRadius: 0.6 },
      { yawAmp: 10, pitchAmp: 4, baseFreq: 0.5, seed: 3 },
      0,
    );
    const b0 = t.bearing();
    t.update(1500);
    const b1 = t.bearing();
    expect(separation(b0, b1)).toBeGreaterThan(0.5);
    expect(t.radiusDeg()).toBeGreaterThan(0);
    t.dispose();
  });
});
