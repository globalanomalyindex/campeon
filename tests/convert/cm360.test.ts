import { describe, it, expect } from 'vitest';
import { cmPer360, sensFor, crossGame, TURN_CM } from '../../src/convert/cm360';

describe('cm360 conversion', () => {
  it('TURN_CM = 360 × 2.54 = 914.4', () => expect(TURN_CM).toBeCloseTo(914.4, 5));

  it('CS2 @800 DPI, sens 1.0 → ≈51.95 cm/360', () =>
    expect(cmPer360(800, 1, 0.022)).toBeCloseTo(51.95, 1));

  it('sensFor is the exact inverse of cmPer360', () => {
    const cm = cmPer360(800, 1.7, 0.022);
    expect(sensFor(cm, 800, 0.022)).toBeCloseTo(1.7, 6);
  });

  it('34 cm/360 @800 DPI → native sens per game', () => {
    expect(sensFor(34, 800, 0.07)).toBeCloseTo(0.480, 2);   // Valorant
    expect(sensFor(34, 800, 0.022)).toBeCloseTo(1.528, 2);  // CS2 / Apex
    expect(sensFor(34, 800, 0.0066)).toBeCloseTo(5.09, 2);  // OW2 / CoD
  });

  it('crossGame CS2(1.0)→Valorant = 0.022/0.07 ≈ 0.314', () =>
    expect(crossGame(1, 800, 0.022, 800, 0.07)).toBeCloseTo(0.314, 3));

  it('crossGame preserves cm/360 across different DPIs', () =>
    expect(crossGame(1, 400, 0.022, 800, 0.022)).toBeCloseTo(0.5, 6));
});
