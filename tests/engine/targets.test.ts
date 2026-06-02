import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import {
  angularRadius,
  bearingOf,
  positionAt,
  placeStatic,
  Target,
} from '../../src/engine/targets';
import { mulberry32 } from '../../src/stats/bootstrap';

describe('angularRadius', () => {
  it('is atan(r/d) in degrees', () => {
    expect(angularRadius(1, 10)).toBeCloseTo(5.7106, 3);
    expect(angularRadius(1, 1)).toBeCloseTo(45, 6);
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
});

describe('positionAt / bearingOf are inverses', () => {
  it('round-trips an arbitrary bearing', () => {
    const [y, p] = bearingOf(positionAt(33, -12, 25));
    expect(y).toBeCloseTo(33, 6);
    expect(p).toBeCloseTo(-12, 6);
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
