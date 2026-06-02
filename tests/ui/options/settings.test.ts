import { describe, it, expect } from 'vitest';
import { normalizeBounds, effectiveYaw, effectiveYawTable, DEFAULT_BOUNDS } from '../../../src/ui/options/settings';

describe('options settings helpers', () => {
  it('normalizeBounds orders, clamps to [5,150], and enforces a minimum span', () => {
    expect(normalizeBounds(60, 15)).toEqual([15, 60]);
    expect(normalizeBounds(1, 9)).toEqual([5, 9]);
    expect(normalizeBounds(30, 30)).toEqual([30, 35]);
    expect(normalizeBounds(NaN, 40)).toEqual(DEFAULT_BOUNDS);
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
