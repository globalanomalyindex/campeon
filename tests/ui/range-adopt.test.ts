import { describe, it, expect } from 'vitest';
import { adoptResult } from '../../src/ui/range-adopt';
import { perGameSens } from '../../src/convert/schools';
import type { Result } from '../../src/types';

const measured: Result = {
  optimalCm360: 30,
  ci90: [28, 32],
  perGameSens: perGameSens(30, 800),
  breakdown: { biasZeroCm360: 30, precisionFloorDeg: 0.8, ttkMs: 420, hitRate: 0.7 },
};

describe('adoptResult', () => {
  it('sets the adopted cm/360 and recomputes per-game sens for it', () => {
    const tuned = adoptResult(measured, 42, 800);
    expect(tuned.optimalCm360).toBe(42);
    expect(tuned.perGameSens).toEqual(perGameSens(42, 800));
    expect(tuned.perGameSens).not.toEqual(measured.perGameSens);
  });
  it('keeps the measured breakdown (characterizes the measured run, not the hand-picked value)', () => {
    const tuned = adoptResult(measured, 42, 800);
    expect(tuned.breakdown).toEqual(measured.breakdown);
  });
  it('does not mutate the measured result', () => {
    const before = JSON.parse(JSON.stringify(measured));
    adoptResult(measured, 42, 800);
    expect(measured).toEqual(before);
  });
});
