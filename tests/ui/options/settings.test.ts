import { describe, it, expect } from 'vitest';
import { normalizeBounds, effectiveYaw, effectiveYawTable, DEFAULT_BOUNDS } from '../../../src/ui/options/settings';

describe('options settings helpers', () => {
  it('normalizeBounds orders, clamps to [5,150], guarantees a >=5 span, and never inverts', () => {
    expect(normalizeBounds(60, 15)).toEqual([15, 60]);     // reorders
    expect(normalizeBounds(1, 9)).toEqual([5, 10]);        // lo clamped to 5; span widened to >=5
    expect(normalizeBounds(30, 30)).toEqual([30, 35]);     // degenerate equal inputs
    expect(normalizeBounds(NaN, 40)).toEqual(DEFAULT_BOUNDS);
    expect(normalizeBounds(200, 201)).toEqual([145, 150]); // both above HI: clamp, NEVER invert (was [200,150])
    expect(normalizeBounds(148, 149)).toEqual([145, 150]); // near ceiling: pull lo down to keep the span
    expect(normalizeBounds(20, 21)).toEqual([20, 25]);     // tiny valid range widened to >=5
    // invariants for every output
    for (const [a, b] of [[60, 15], [1, 9], [30, 30], [200, 201], [148, 149], [20, 21], [3, 4]] as const) {
      const [lo, hi] = normalizeBounds(a, b);
      expect(lo).toBeGreaterThanOrEqual(5);
      expect(hi).toBeLessThanOrEqual(150);
      expect(hi - lo).toBeGreaterThanOrEqual(5);
    }
  });
  it('effectiveYaw uses an override when present, else the table value', () => {
    expect(effectiveYaw('cs2', {})).toBeCloseTo(0.022, 6);
    expect(effectiveYaw('cs2', { cs2: 0.03 })).toBeCloseTo(0.03, 6);
  });
  it('effectiveYawTable merges overrides over the base table', () => {
    const t = effectiveYawTable({ valorant: 0.08 });
    expect(t.find((e) => e.id === 'valorant')!.yaw).toBeCloseTo(0.08, 6);
    expect(t.find((e) => e.id === 'cs2')!.yaw).toBeCloseTo(0.022, 6);
  });
});
