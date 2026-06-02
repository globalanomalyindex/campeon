import { describe, it, expect } from 'vitest';
import { perGameSens, monitorDistanceMatchCm360, CONVERSION_SCHOOLS } from '../../src/convert/schools';

describe('per-game output (360-distance)', () => {
  const out = perGameSens(34, 800);
  it('emits a sens for every game', () => {
    expect(Object.keys(out).sort()).toEqual(
      ['apex', 'cod', 'cs2', 'fortnite', 'ow2', 'pubg', 'r6', 'valorant']
    );
  });
  it('matches the spec worked examples', () => {
    expect(out.valorant).toBeCloseTo(0.480, 2);
    expect(out.cs2).toBeCloseTo(1.528, 2);
    expect(out.ow2).toBeCloseTo(5.09, 2);
    expect(out.fortnite).toBeCloseTo(6.05, 2);
    expect(out.r6).toBeCloseTo(5.867, 2);
    expect(out.pubg).toBeCloseTo(15.131, 2);
  });
});

describe('monitor-distance conversion (FOV-aware)', () => {
  it('is identity when source and target FOV match (any fraction)', () => {
    expect(monitorDistanceMatchCm360(30, 103, 103, 0.5)).toBeCloseTo(30, 6);
  });
  it('at fraction → 0 reduces to the focal-length (tangent) ratio', () => {
    const out = monitorDistanceMatchCm360(30, 90, 106.26, 0.0001);
    expect(out / 30).toBeCloseTo(Math.tan((106.26 / 2) * Math.PI / 180) / Math.tan((90 / 2) * Math.PI / 180), 2);
  });
  it('exposes both schools with 360-distance as the default', () => {
    expect(CONVERSION_SCHOOLS.map((s) => s.id)).toEqual(['360', 'monitor']);
    expect(CONVERSION_SCHOOLS[0]!.fovAware).toBe(false);
    expect(CONVERSION_SCHOOLS[1]!.fovAware).toBe(true);
  });
});
