import { describe, it, expect } from 'vitest';
import { computeBreakdown } from '../../src/optimizer/breakdown';
import type { TrialResult } from '../../src/types';

const cal = (cm360: number, gain: number, sigmaR: number): TrialResult => ({
  instrument: 'calibrate', cm360, score: 0.5,
  raw: { gain, sigmaR, biasMag: 0, mse: 0 }, at: 0,
});
const str = (cm360: number, ttkMs: number, hitRate: number): TrialResult => ({
  instrument: 'strike', cm360, score: 1, raw: { ttkMs, hitRate }, at: 0,
});

describe('computeBreakdown', () => {
  it('interpolates the bias-zero cm/360 where gain crosses 1 (in ln space)', () => {
    // gain 1.2 at 20, 0.8 at 40 → crosses 1 at the ln midpoint = the geometric mean √(20·40) ≈ 28.284
    const b = computeBreakdown([cal(20, 1.2, 0.5), cal(40, 0.8, 0.4)], 30);
    expect(b.biasZeroCm360).toBeCloseTo(Math.sqrt(20 * 40), 4); // pins the ln-space formula (load-bearing)
  });

  it('precisionFloorDeg is the minimum calibrate sigmaR', () => {
    const b = computeBreakdown([cal(20, 1.2, 0.5), cal(40, 0.8, 0.31), cal(30, 1.0, 0.42)], 30);
    expect(b.precisionFloorDeg).toBeCloseTo(0.31, 6);
  });

  it('ttk/hitRate come from the strike trial nearest the optimum', () => {
    const b = computeBreakdown([str(20, 700, 0.6), str(45, 520, 0.9), cal(30, 1.0, 0.4)], 44);
    expect(b.ttkMs).toBe(520);
    expect(b.hitRate).toBe(0.9);
  });

  it('falls back to NaN for absent instruments (no fabrication)', () => {
    const b = computeBreakdown([str(30, 500, 0.8)], 30);
    expect(Number.isNaN(b.biasZeroCm360)).toBe(true);
    expect(Number.isNaN(b.precisionFloorDeg)).toBe(true);
    expect(b.ttkMs).toBe(500);
  });

  it('no gain bracket (all overshoot) → nearest-to-1 gain trial cm360, not interpolation', () => {
    const b = computeBreakdown([cal(20, 1.4, 0.5), cal(30, 1.1, 0.4)], 25);
    expect(b.biasZeroCm360).toBe(30); // gain 1.1 is closest to 1
  });
});
