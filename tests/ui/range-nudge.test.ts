import { describe, it, expect } from 'vitest';
import { nudgeCm360 } from '../../src/ui/range-nudge';

describe('nudgeCm360', () => {
  const bounds: [number, number] = [15, 60];
  it('applies a positive and negative step', () => {
    expect(nudgeCm360(30, 0.5, bounds)).toBeCloseTo(30.5);
    expect(nudgeCm360(30, -0.5, bounds)).toBeCloseTo(29.5);
  });
  it('clamps to the upper and lower bound, never inverts', () => {
    expect(nudgeCm360(59.8, 0.5, bounds)).toBe(60);
    expect(nudgeCm360(15.2, -0.5, bounds)).toBe(15);
  });
  it('honors a fine step', () => {
    expect(nudgeCm360(30, 0.1, bounds)).toBeCloseTo(30.1);
  });
});
