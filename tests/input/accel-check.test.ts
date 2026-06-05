import { describe, it, expect } from 'vitest';
import { accumulateMagnitude, accelVerdict, accelTolForWidth, AccelMeter } from '../../src/input/accel-check';
import type { AimSample } from '../../src/types';

const s = (dx: number, dy: number): AimSample => ({ t: 0, dx, dy });

describe('accumulateMagnitude', () => {
  it('sums the per-sample path length (hypot)', () => {
    expect(accumulateMagnitude([s(3, 4), s(0, 0), s(6, 8)])).toBeCloseTo(15, 9);
  });
});

describe('accelVerdict', () => {
  it('passes when slow and fast totals match (accel off)', () => {
    expect(accelVerdict(1000, 1000).accelerated).toBe(false);
    expect(accelVerdict(1000, 1080).accelerated).toBe(false); // 8% < 10%
  });
  it('blocks when the fast swipe accumulates materially more (accel on)', () => {
    const v = accelVerdict(1000, 1300);
    expect(v.accelerated).toBe(true);
    expect(v.ratio).toBeCloseTo(0.3, 9);
  });
  it('honors a custom tolerance', () => {
    expect(accelVerdict(1000, 1080, 0.05).accelerated).toBe(true);
  });
  it('does not divide by zero on an empty slow swipe', () => {
    expect(accelVerdict(0, 0).ratio).toBe(0);
  });
});

describe('accelTolForWidth', () => {
  it('keeps the ~10% tolerance for a long mousepad-scale reference', () => {
    expect(accelTolForWidth(40)).toBeCloseTo(0.10, 9);
    expect(accelTolForWidth(20)).toBeCloseTo(0.10, 9);
  });
  it('loosens the tolerance for a short card so honest sweeps are not false-flagged', () => {
    const tol = accelTolForWidth(8.56); // the ISO ID-1 card width
    expect(tol).toBeGreaterThan(0.20);
    expect(tol).toBeLessThanOrEqual(0.25);
  });
  it('clamps to a sane band and is safe for non-positive widths', () => {
    expect(accelTolForWidth(2)).toBe(0.25);   // 2.0/2 = 1.0, clamped to the ceiling
    expect(accelTolForWidth(0)).toBe(0.10);
    expect(accelTolForWidth(-5)).toBe(0.10);
  });
});

describe('AccelMeter', () => {
  it('accumulates and resets', () => {
    const m = new AccelMeter();
    m.add(s(3, 4));
    m.add(s(6, 8));
    expect(m.total()).toBeCloseTo(15, 9);
    m.reset();
    expect(m.total()).toBe(0);
  });
});
