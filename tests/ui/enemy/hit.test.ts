import { describe, it, expect } from 'vitest';
import { classifyHit, GRAZE_FACTOR } from '../../../src/ui/enemy/hit';
import { separation } from '../../../src/engine/targets';

describe('classifyHit — cosmetic shot classification', () => {
  const bearing: [number, number] = [10, 3];
  const radius = 1.5;

  it('kills when the crosshair sits inside the target angular disc', () => {
    expect(classifyHit([10, 3], bearing, radius)).toBe('kill'); // dead-on, sep 0
    // ~1° off in yaw → inside a 1.5° radius (verified via separation)
    const v: [number, number] = [11, 3];
    expect(separation(v, bearing)).toBeLessThanOrEqual(radius);
    expect(classifyHit(v, bearing, radius)).toBe('kill');
  });

  it('grazes between 1× and GRAZE_FACTOR× the radius', () => {
    const v: [number, number] = [13, 3]; // ~3° off in yaw ≈ ~2× the 1.5° radius
    const sep = separation(v, bearing);
    expect(sep).toBeGreaterThan(radius);
    expect(sep).toBeLessThanOrEqual(GRAZE_FACTOR * radius);
    expect(classifyHit(v, bearing, radius)).toBe('graze');
  });

  it('misses beyond the graze band', () => {
    const v: [number, number] = [20, 3]; // ~10° off → well past 2.5×1.5
    expect(separation(v, bearing)).toBeGreaterThan(GRAZE_FACTOR * radius);
    expect(classifyHit(v, bearing, radius)).toBe('miss');
  });

  it('depends only on angular distance — symmetric, never on a stored score', () => {
    expect(classifyHit([10, 4], bearing, radius)).toBe(classifyHit([10, 2], bearing, radius));
  });
});
