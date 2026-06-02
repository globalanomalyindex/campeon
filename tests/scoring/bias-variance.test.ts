import { describe, it, expect } from 'vitest';
import type { Shot } from '../../src/types';
import {
  decompose,
  ewmaBias,
  calibrationCost,
} from '../../src/scoring/bias-variance';

describe('decompose', () => {
  it('separates a pure systematic bias (zero spread)', () => {
    const shots: Shot[] = [
      { error: [2, 0], required: 10 },
      { error: [2, 0], required: 10 },
    ];
    const d = decompose(shots);
    expect(d.bias[0]).toBeCloseTo(2, 9);
    expect(d.bias[1]).toBeCloseTo(0, 9);
    expect(d.sigmaR).toBeCloseTo(0, 9);
    expect(d.mse).toBeCloseTo(4, 9);
    expect(d.gain).toBeCloseTo(1.2, 9);
  });

  it('separates pure variance (zero mean)', () => {
    const shots: Shot[] = [
      { error: [1, 0], required: 10 },
      { error: [-1, 0], required: 10 },
    ];
    const d = decompose(shots);
    expect(d.bias[0]).toBeCloseTo(0, 9);
    expect(d.sigmaR).toBeCloseTo(1, 9);
    expect(d.mse).toBeCloseTo(1, 9);
    expect(d.gain).toBeCloseTo(1, 9);
  });

  it('satisfies the bias–variance identity MSE = mean‖e‖²', () => {
    const shots: Shot[] = [
      { error: [1.5, -0.5], required: 12 },
      { error: [-0.5, 0.5], required: 12 },
      { error: [0.5, 1.5], required: 12 },
      { error: [2.0, -1.0], required: 12 },
    ];
    const d = decompose(shots);
    const meanSq =
      shots.reduce((s, sh) => s + sh.error[0] ** 2 + sh.error[1] ** 2, 0) / shots.length;
    expect(d.mse).toBeCloseTo(meanSq, 9);
    expect(d.mse).toBeCloseTo(d.bias[0] ** 2 + d.bias[1] ** 2 + d.sigmaR ** 2, 9);
  });

  it('gain < 1 for systematic undershoot', () => {
    const d = decompose([
      { error: [-2, 0], required: 10 },
      { error: [-2, 0], required: 10 },
    ]);
    expect(d.gain).toBeLessThan(1);
  });

  it('throws on empty input', () => {
    expect(() => decompose([])).toThrow(RangeError);
  });
});

describe('ewmaBias', () => {
  it('tracks toward the steady bias', () => {
    const shots: Shot[] = Array.from({ length: 40 }, () => ({ error: [3, -1] as [number, number], required: 10 }));
    const b = ewmaBias(shots, 0.2);
    expect(b[0]).toBeCloseTo(3, 1);
    expect(b[1]).toBeCloseTo(-1, 1);
  });
  it('starts from the provided seed', () => {
    const b = ewmaBias([{ error: [0, 0], required: 10 }], 0.5, [4, 4]);
    expect(b[0]).toBeCloseTo(2, 9);
  });
});

describe('calibrationCost', () => {
  it('is bias-dominant with the default weights', () => {
    const biasy = calibrationCost({ bias: [2, 0], gain: 1.2, sigmaR: 0, mse: 4 }, 500, 500);
    const noisy = calibrationCost({ bias: [0, 0], gain: 1, sigmaR: 2, mse: 4 }, 500, 500);
    expect(biasy).toBeGreaterThan(noisy);
  });
  it('adds a time penalty relative to the reference', () => {
    const fast = calibrationCost({ bias: [0, 0], gain: 1, sigmaR: 1, mse: 1 }, 500, 500);
    const slow = calibrationCost({ bias: [0, 0], gain: 1, sigmaR: 1, mse: 1 }, 1000, 500);
    expect(slow).toBeGreaterThan(fast);
  });
});
