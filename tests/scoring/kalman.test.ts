import { describe, it, expect } from 'vitest';
import { KalmanCV } from '../../src/scoring/kalman';

describe('KalmanCV — constant-velocity tracking', () => {
  it('converges to the true velocity on clean CV data', () => {
    const k = new KalmanCV({ q: 1e-3, r: 1e-2 });
    let pos = 0;
    for (let i = 0; i < 30; i++) {
      k.predict(1); // dt = 1s
      k.update(pos); // measurement = true position
      pos += 1; // true velocity = 1 deg/s
    }
    expect(k.vel).toBeCloseTo(1, 1);
    expect(k.pos).toBeCloseTo(pos - 1, 0);
  });

  it('predicts a lead point ahead of the current estimate', () => {
    const k = new KalmanCV({ q: 1e-3, r: 1e-2 });
    let pos = 0;
    for (let i = 0; i < 30; i++) {
      k.predict(1);
      k.update(pos);
      pos += 1;
    }
    expect(k.lead(0.5)).toBeCloseTo(k.pos + k.vel * 0.5, 9);
    expect(k.lead(0.5)).toBeGreaterThan(k.pos);
  });

  it('innovation is small on CV data but spikes at a velocity step', () => {
    const k = new KalmanCV({ q: 1e-3, r: 1e-2 });
    let pos = 0;
    let lastSteady = 0;
    for (let i = 0; i < 20; i++) {
      k.predict(1);
      lastSteady = Math.abs(k.update(pos));
      pos += 1;
    }
    k.predict(1);
    const spike = Math.abs(k.update(pos + 1));
    expect(lastSteady).toBeLessThan(0.2);
    expect(spike).toBeGreaterThan(lastSteady * 3);
  });

  it('large R trusts the model: a single outlier barely moves the estimate', () => {
    const k = new KalmanCV({ q: 1e-4, r: 100 }, { pos: 0, vel: 0, posVar: 1, velVar: 1 });
    k.predict(1);
    k.update(50);
    expect(Math.abs(k.pos)).toBeLessThan(5);
  });
});
