import { describe, it, expect } from 'vitest';
import { nudgeCounts } from '../../src/ui/range-nudge';
import { counts360, countsBounds } from '../../src/types';

describe('nudgeCounts', () => {
  const bounds = countsBounds(4800, 19200);
  it('applies a positive and negative step', () => {
    expect(nudgeCounts(counts360(9000), 150, bounds)).toBeCloseTo(9150);
    expect(nudgeCounts(counts360(9000), -150, bounds)).toBeCloseTo(8850);
  });
  it('clamps to the upper and lower bound, never inverts', () => {
    expect(nudgeCounts(counts360(19100), 150, bounds)).toBe(19200);
    expect(nudgeCounts(counts360(4900), -150, bounds)).toBe(4800);
  });
  it('honors a fine step', () => {
    expect(nudgeCounts(counts360(9000), 30, bounds)).toBeCloseTo(9030);
  });
});
