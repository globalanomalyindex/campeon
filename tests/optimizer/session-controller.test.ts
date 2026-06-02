import { describe, it, expect } from 'vitest';
import { finalizeReport } from '../../src/optimizer/session-controller';
import { mulberry32 } from '../../src/stats/bootstrap';
import type { Observation } from '../../src/types';

const bounds: [number, number] = [15, 60];

const concave = (peakCm: number, noise = 0): Observation[] => {
  const c = Math.log(peakCm);
  const rng = mulberry32(5);
  return [15, 19, 24, 30, 38, 48, 60].map((cm) => {
    const x = Math.log(cm);
    return { x, y: -(x - c) * (x - c) + (rng() * 2 - 1) * noise };
  });
};

describe('finalizeReport', () => {
  it('reports the curve peak with a CI that contains it', () => {
    const r = finalizeReport(concave(34, 0.02), bounds, mulberry32(1), { bootstrapIters: 200 });
    expect(r.optimalCm360).toBeGreaterThan(28);
    expect(r.optimalCm360).toBeLessThan(40);
    expect(r.ci90[0]).toBeLessThanOrEqual(r.optimalCm360);
    expect(r.ci90[1]).toBeGreaterThanOrEqual(r.optimalCm360);
    expect(r.curve.length).toBeGreaterThan(0);
  });

  it('clamps the optimum and CI to the bounds', () => {
    const r = finalizeReport(concave(34, 0.02), bounds, mulberry32(2), { bootstrapIters: 200 });
    expect(r.optimalCm360).toBeGreaterThanOrEqual(15);
    expect(r.optimalCm360).toBeLessThanOrEqual(60);
    expect(r.ci90[0]).toBeGreaterThanOrEqual(15);
    expect(r.ci90[1]).toBeLessThanOrEqual(60);
  });

  it('falls back to a full-bounds CI when the curve is not concave (flat data)', () => {
    const flat: Observation[] = [15, 25, 35, 45, 60].map((cm, i) => ({ x: Math.log(cm), y: 0.1 * i }));
    const r = finalizeReport(flat, bounds, mulberry32(3));
    expect(r.ci90).toEqual([15, 60]);
    expect(Number.isFinite(r.optimalCm360)).toBe(true);
  });

  it('widens the CI when a supplied GP peak disagrees with the curve peak', () => {
    const base = finalizeReport(concave(34, 0.02), bounds, mulberry32(4), { bootstrapIters: 200 });
    const widened = finalizeReport(concave(34, 0.02), bounds, mulberry32(4), {
      bootstrapIters: 200,
      gpPeakCm360: 55,
    });
    expect(widened.ci90[1]).toBeGreaterThanOrEqual(55 - 1e-9);
    expect(widened.ci90[1]).toBeGreaterThanOrEqual(base.ci90[1]);
  });

  it('does NOT widen when the GP peak agrees with the curve peak', () => {
    const base = finalizeReport(concave(34, 0.02), bounds, mulberry32(8), { bootstrapIters: 200 });
    const agree = finalizeReport(concave(34, 0.02), bounds, mulberry32(8), {
      bootstrapIters: 200,
      gpPeakCm360: base.optimalCm360, // identical → log-distance 0, below threshold
    });
    expect(agree.ci90).toEqual(base.ci90);
  });

  it('handles empty observations without throwing (honest full-bounds report)', () => {
    const r = finalizeReport([], bounds, mulberry32(1));
    expect(r.ci90).toEqual([15, 60]);
    expect(Number.isFinite(r.optimalCm360)).toBe(true);
    expect(r.curve).toEqual([]);
  });

  it('the fallback curve is the observed points as {x, mean}, sorted by x', () => {
    // Convex (a valley) → no interior maximum → fitPeak throws → fallback path. cm order shuffled
    // to also exercise the sort.
    const c = Math.log(30);
    const convex: Observation[] = [45, 15, 35, 60, 25].map((cm) => {
      const x = Math.log(cm);
      return { x, y: (x - c) * (x - c) };
    });
    const r = finalizeReport(convex, bounds, mulberry32(3));
    expect(r.curve.length).toBe(5);
    for (let i = 1; i < r.curve.length; i++) expect(r.curve[i].x).toBeGreaterThan(r.curve[i - 1].x);
  });
});
