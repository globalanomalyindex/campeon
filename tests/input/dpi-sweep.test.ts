import { describe, it, expect } from 'vitest';
import { dpiFromSweep, SweepAccumulator, isPlausibleSweepDpi, CARD_WIDTH_CM } from '../../src/input/dpi-sweep';

describe('dpi-sweep', () => {
  it('recovers DPI from counts across a known pad width', () => {
    // a 40 cm pad at 800 dpi -> 40/2.54 in * 800 = 12598.4 counts
    expect(dpiFromSweep(12598.4, 40)).toBeCloseTo(800, 1);
  });

  it('uses the standardized ID-1 card width as the reference anchor', () => {
    expect(CARD_WIDTH_CM).toBeCloseTo(8.56, 6); // ISO/IEC 7810 ID-1 long edge, 85.60 mm
  });

  it('recovers DPI from counts swept across a card', () => {
    // a card (8.56 cm) at 1600 dpi -> 8.56/2.54 in * 1600 = 5391.5 counts
    const dpi = 1600;
    const counts = (CARD_WIDTH_CM / 2.54) * dpi;
    expect(dpiFromSweep(counts, CARD_WIDTH_CM)).toBeCloseTo(dpi, 6);
  });

  it('returns NaN for a non-positive pad width', () => {
    expect(Number.isNaN(dpiFromSweep(10000, 0))).toBe(true);
  });

  it('SweepAccumulator sums signed dx and reports the magnitude', () => {
    const acc = new SweepAccumulator();
    acc.add({ t: 0, dx: 100, dy: 5 });
    acc.add({ t: 1, dx: 50, dy: -3 });
    acc.add({ t: 2, dx: -10, dy: 0 });
    expect(acc.total()).toBeCloseTo(140, 6); // |100 + 50 - 10|
    acc.reset();
    expect(acc.total()).toBe(0);
  });

  it('flags implausible measured DPI', () => {
    expect(isPlausibleSweepDpi(800)).toBe(true);
    expect(isPlausibleSweepDpi(5)).toBe(false);     // too low (sweep too short / pad typo)
    expect(isPlausibleSweepDpi(99000)).toBe(false); // absurd
  });
});
