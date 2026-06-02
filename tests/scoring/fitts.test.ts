import { describe, it, expect } from 'vitest';
import type { Tap, FittsCondition } from '../../src/types';
import {
  WE_CONST,
  sampleStd,
  conditionThroughput,
  aggregateThroughput,
} from '../../src/scoring/fitts';

describe('WE_CONST', () => {
  it('is the ISO 9241-9 effective-width multiplier √(2πe) ≈ 4.133', () => {
    expect(WE_CONST).toBeCloseTo(Math.sqrt(2 * Math.PI * Math.E), 3);
  });
});

describe('sampleStd', () => {
  it('uses the sample (N−1) denominator', () => {
    expect(sampleStd([2, -2])).toBeCloseTo(Math.sqrt(8), 9); // ((2²+2²)/(2−1)) = 8
    expect(sampleStd([1, 1, 1])).toBe(0);
  });
});

describe('conditionThroughput', () => {
  it('computes Ae/We/IDe/TP from the effective-width formula', () => {
    const condition: FittsCondition = { amplitude: 10, width: 4 };
    const taps: Tap[] = [
      { mt: 1000, endpointErrorAlongAxis: 2 },
      { mt: 1000, endpointErrorAlongAxis: -2 },
    ];
    const r = conditionThroughput(taps, condition);
    const we = WE_CONST * Math.sqrt(8);
    const ide = Math.log2(10 / we + 1);
    expect(r.ae).toBeCloseTo(10, 9);
    expect(r.we).toBeCloseTo(we, 9);
    expect(r.ide).toBeCloseTo(ide, 9);
    expect(r.mtMean).toBeCloseTo(1000, 9);
    expect(r.tp).toBeCloseTo(ide / 1.0, 9);
  });

  it('adds mean overshoot into the effective amplitude', () => {
    const taps: Tap[] = [
      { mt: 500, endpointErrorAlongAxis: 1 },
      { mt: 500, endpointErrorAlongAxis: 3 },
    ];
    const r = conditionThroughput(taps, { amplitude: 20, width: 3 });
    expect(r.ae).toBeCloseTo(22, 9);
  });

  it('is monotone: more spread → lower TP; faster MT → higher TP', () => {
    const cond: FittsCondition = { amplitude: 15, width: 3 };
    const tight = conditionThroughput(
      [{ mt: 500, endpointErrorAlongAxis: 0.5 }, { mt: 500, endpointErrorAlongAxis: -0.5 }],
      cond,
    );
    const loose = conditionThroughput(
      [{ mt: 500, endpointErrorAlongAxis: 3 }, { mt: 500, endpointErrorAlongAxis: -3 }],
      cond,
    );
    expect(tight.tp).toBeGreaterThan(loose.tp);
    const fast = conditionThroughput(
      [{ mt: 250, endpointErrorAlongAxis: 0.5 }, { mt: 250, endpointErrorAlongAxis: -0.5 }],
      cond,
    );
    expect(fast.tp).toBeGreaterThan(tight.tp);
  });

  it('throws on degenerate input (fewer than 2 taps, or zero spread)', () => {
    expect(() => conditionThroughput([{ mt: 500, endpointErrorAlongAxis: 0 }], { amplitude: 10, width: 3 }))
      .toThrow(RangeError);
    expect(() =>
      conditionThroughput(
        [{ mt: 500, endpointErrorAlongAxis: 1 }, { mt: 500, endpointErrorAlongAxis: 1 }],
        { amplitude: 10, width: 3 },
      ),
    ).toThrow(RangeError);
  });
});

describe('aggregateThroughput', () => {
  it('is the mean of per-condition throughputs (mean-of-means)', () => {
    const a = conditionThroughput(
      [{ mt: 500, endpointErrorAlongAxis: 1 }, { mt: 500, endpointErrorAlongAxis: -1 }],
      { amplitude: 10, width: 3 },
    );
    const b = conditionThroughput(
      [{ mt: 800, endpointErrorAlongAxis: 1 }, { mt: 800, endpointErrorAlongAxis: -1 }],
      { amplitude: 30, width: 3 },
    );
    expect(aggregateThroughput([a, b])).toBeCloseTo((a.tp + b.tp) / 2, 9);
  });
  it('throws on an empty condition list', () => {
    expect(() => aggregateThroughput([])).toThrow(RangeError);
  });
});
