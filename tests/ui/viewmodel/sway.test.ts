import { describe, it, expect } from 'vitest';
import { restSway, kick, stepSway, DEFAULT_SWAY, type SwayState } from '../../../src/ui/viewmodel/sway';

const mag = (s: SwayState): number => Math.hypot(s.x, s.y);
const speed = (s: SwayState): number => Math.hypot(s.vx, s.vy);

describe('weapon sway spring', () => {
  it('stays exactly at rest with no input', () => {
    let s = restSway();
    for (let i = 0; i < 50; i++) s = stepSway(s, 1 / 60);
    expect(s).toEqual(restSway());
  });

  it('a look kick displaces velocity opposite the look direction', () => {
    const s = kick(restSway(), 10, 0); // look right (+yaw) → gun lags left (−vx)
    expect(s.vx).toBeLessThan(0);
    expect(speed(s)).toBeGreaterThan(0);
  });

  it('ignores look deltas inside the deadzone (idle micro-jitter holds still)', () => {
    const s = kick(restSway(), 0.05, -0.05); // both below the 0.08° deadzone
    expect(s).toEqual(restSway());
  });

  it('settles back toward rest after a kick (damped, finite, bounded)', () => {
    let s = kick(restSway(), 12, -6);
    let peak = 0;
    for (let i = 0; i < 240; i++) {
      s = stepSway(s, 1 / 60);
      peak = Math.max(peak, mag(s));
      expect(Number.isFinite(s.x) && Number.isFinite(s.y)).toBe(true);
      expect(mag(s)).toBeLessThanOrEqual(DEFAULT_SWAY.maxOffset + 1e-9);
    }
    expect(peak).toBeGreaterThan(0); // it actually moved
    expect(mag(s)).toBeLessThan(1e-3); // …and returned to (near) rest after ~4s
    expect(speed(s)).toBeLessThan(1e-2);
  });

  it('clamps the offset under a violent whip', () => {
    let s = kick(restSway(), 5000, 5000);
    for (let i = 0; i < 60; i++) {
      s = stepSway(s, 1 / 60);
      expect(Math.abs(s.x)).toBeLessThanOrEqual(DEFAULT_SWAY.maxOffset + 1e-9);
      expect(Math.abs(s.y)).toBeLessThanOrEqual(DEFAULT_SWAY.maxOffset + 1e-9);
    }
  });
});
