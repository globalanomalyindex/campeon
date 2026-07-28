import { describe, it, expect } from 'vitest';
import { degreesPerCount, sensFor, countsForSens, crossGame, sensRatio } from '../../src/convert/counts';
import { counts360 } from '../../src/types';

// The physical settings these expectations came from, kept only as a cross-check against the
// retired cm form: 34 cm/360 at 800 DPI is 34 * 800 / 2.54 = 10708.66 counts per 360, and CS2 at
// sens 1 is 51.95 cm/360 at 800 DPI, which is 16362 counts. Every assertion below is stated in
// counts; the centimetre numbers appear in comments only, because the tool no longer has a ruler.
const CM34_AT_800 = counts360((34 * 800) / 2.54);

describe('degreesPerCount', () => {
  it('puts one full 360 at exactly the given count total', () => {
    expect(degreesPerCount(counts360(9450)) * 9450).toBeCloseTo(360, 9);
    expect(degreesPerCount(counts360(8240))).toBeCloseTo(360 / 8240, 12);
  });

  it('agrees with the retired cm form at the same physical setting, which is the proof DPI cancels', () => {
    // Retired: TURN_CM / (cm360 * dpi) = 914.4 / (34 * 800) = 0.0336176.
    expect(degreesPerCount(CM34_AT_800)).toBeCloseTo(914.4 / (34 * 800), 12);
  });

  it('refuses a non-positive or non-finite count total instead of emitting Infinity', () => {
    expect(() => degreesPerCount(counts360(0))).toThrow(RangeError);
    expect(() => degreesPerCount(counts360(-1))).toThrow(/finite and positive/);
    expect(() => degreesPerCount(counts360(Number.NaN))).toThrow(/finite and positive/);
    expect(() => degreesPerCount(counts360(Number.POSITIVE_INFINITY))).toThrow(/finite and positive/);
  });
});

describe('sensFor and countsForSens', () => {
  it('emits the same native sensitivities the cm form did, with no DPI in the call', () => {
    expect(sensFor(CM34_AT_800, 0.07)).toBeCloseTo(0.480, 3);     // Valorant, exactly 0.4802521
    expect(sensFor(CM34_AT_800, 0.022)).toBeCloseTo(1.528, 3);    // CS2 and Apex, exactly 1.5280749
    expect(sensFor(CM34_AT_800, 0.0066)).toBeCloseTo(5.0936, 3);  // OW2 and CoD, exactly 5.0935829
  });

  it('countsForSens is exact, not estimated: it is the game definition inverted', () => {
    expect(countsForSens(1, 0.022)).toBeCloseTo(360 / 0.022, 9);
    expect(countsForSens(1, 0.022)).toBeCloseTo(16363.6, 1); // = 51.95 cm at 800 DPI
  });

  it('round-trips against sensFor at every yaw in the table range', () => {
    for (const yaw of [0.002222, 0.005555, 0.0066, 0.022, 0.07]) {
      const counts = countsForSens(1.7, yaw);
      expect(sensFor(counts, yaw)).toBeCloseTo(1.7, 9);
    }
  });

  it('refuses rather than dividing by zero', () => {
    expect(() => sensFor(counts360(0), 0.022)).toThrow(/finite and positive/);
    expect(() => sensFor(counts360(8240), 0)).toThrow(/finite and positive/);
    expect(() => countsForSens(0, 0.022)).toThrow(/finite and positive/);
    expect(() => countsForSens(1, Number.NaN)).toThrow(/finite and positive/);
  });
});

describe('crossGame', () => {
  it('is a ratio of yaw constants, so the count convention cancels out of it', () => {
    expect(crossGame(1, 0.022, 0.07)).toBeCloseTo(0.022 / 0.07, 12);
    expect(crossGame(1, 0.022, 0.07)).toBeCloseTo(0.314, 3);
    expect(crossGame(2.5, 0.0066, 0.0066)).toBeCloseTo(2.5, 12);
  });

  it('refuses a non-positive yaw on either side', () => {
    expect(() => crossGame(1, 0, 0.07)).toThrow(/finite and positive/);
    expect(() => crossGame(1, 0.022, 0)).toThrow(/finite and positive/);
  });
});

describe('sensRatio, the tier-one number', () => {
  it('is the anchor over the optimum, because sensitivity runs inverse to counts per 360', () => {
    // A player whose hands believe 9000 counts, measured best at 8240, needs a HIGHER in-game
    // sensitivity, so the multiplier is above 1.
    expect(sensRatio(counts360(9000), counts360(8240))).toBeCloseTo(9000 / 8240, 12);
    expect(sensRatio(counts360(8240), counts360(9000))).toBeLessThan(1);
    expect(sensRatio(counts360(8240), counts360(8240))).toBe(1);
  });

  it('refuses rather than returning a plausible multiplier when either side is not a count total', () => {
    expect(() => sensRatio(counts360(0), counts360(8240))).toThrow(/finite and positive/);
    expect(() => sensRatio(counts360(8240), counts360(Number.NaN))).toThrow(/finite and positive/);
  });
});
