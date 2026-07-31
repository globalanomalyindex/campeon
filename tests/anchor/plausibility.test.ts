import { describe, it, expect } from 'vitest';
import * as plausibility from '../../src/anchor/plausibility';
import {
  cm360From, turnPlausibility, cardContradictsTurn, HUMAN_MIN_CM360, HUMAN_MAX_CM360,
} from '../../src/anchor/plausibility';
import { CARD_WIDTH_CM, dpiFromSweep } from '../../src/input/dpi-sweep';
import { counts360, type Counts360 } from '../../src/types';

/** The counts a browser reports for `cm` of travel at `dpi`, scaled by the count convention k. */
const countsFor = (cm: number, dpi: number, k = 1): Counts360 => counts360((cm / 2.54) * dpi * k);
/** What the card sweep measures on that browser: the raw counts across the ID-1 card, in counts per inch. */
const sweptDpi = (dpi: number, k = 1): number => dpiFromSweep((CARD_WIDTH_CM / 2.54) * dpi * k, CARD_WIDTH_CM);

describe('cm360From', () => {
  it('converts a count total and a measured DPI into centimetres of travel', () => {
    expect(cm360From(countsFor(40, 1600), 1600)).toBeCloseTo(40, 9);
    expect(cm360From(countsFor(22.5, 800), 800)).toBeCloseTo(22.5, 9);
  });

  it('the count convention cancels, so a scaled browser reads the same centimetres', () => {
    // The claim the whole check rests on, and the one that looks like a bug on the page: the sweep
    // runs on RAW browser counts, so it measures dpi * k rather than the hardware DPI. The turn
    // counts through the same pointer lock and carries the same k, so k divides out and the
    // centimetres are right with k unmeasured. Composed through the shipped dpiFromSweep rather
    // than through arithmetic written here, so it pins the pipeline and not the formula.
    const truth = cm360From(countsFor(40, 1600), sweptDpi(1600));
    for (const k of [0.5, 1, 2, 3.7]) {
      expect(sweptDpi(1600, k)).toBeCloseTo(1600 * k, 6);      // the sweep really is off by k
      expect(cm360From(countsFor(40, 1600, k), sweptDpi(1600, k))).toBeCloseTo(truth, 6);
    }
  });

  it('refuses rather than fabricates when either side is not a measurement', () => {
    expect(Number.isNaN(cm360From(counts360(0), 1600))).toBe(true);
    expect(Number.isNaN(cm360From(counts360(Number.NaN), 1600))).toBe(true);
    expect(Number.isNaN(cm360From(countsFor(40, 1600), 0))).toBe(true);
    expect(Number.isNaN(cm360From(countsFor(40, 1600), 40))).toBe(true);     // below MIN_DPI
    expect(Number.isNaN(cm360From(countsFor(40, 1600), 90000))).toBe(true);  // above MAX_DPI
  });
});

describe('turnPlausibility', () => {
  it('reads a human turn as human, and carries the distance for the copy to show', () => {
    const p = turnPlausibility(countsFor(38, 1600), 1600);
    expect(p.verdict).toBe('human');
    expect(p.cm360).toBeCloseTo(38, 9);
  });

  it('flags a turn shorter than any hand makes, and one longer', () => {
    expect(turnPlausibility(countsFor(HUMAN_MIN_CM360 - 1, 1600), 1600).verdict).toBe('short');
    expect(turnPlausibility(countsFor(HUMAN_MAX_CM360 + 1, 1600), 1600).verdict).toBe('long');
  });

  it('holds the band ends inside the human verdict, so a boundary reading is not a fault', () => {
    expect(turnPlausibility(countsFor(HUMAN_MIN_CM360, 1600), 1600).verdict).toBe('human');
    expect(turnPlausibility(countsFor(HUMAN_MAX_CM360, 1600), 1600).verdict).toBe('human');
  });

  it('catches the gross error it exists for: a sweep that covered half the card', () => {
    // The sweep stopped halfway, so the measured DPI comes out half, so the turn converts to twice
    // the distance. From a 45 cm anchor that lands at 90, outside the band and flagged.
    const half = dpiFromSweep((CARD_WIDTH_CM / 2 / 2.54) * 1600, CARD_WIDTH_CM);
    expect(half).toBeCloseTo(800, 6);
    const p = turnPlausibility(countsFor(45, 1600), half);
    expect(p.cm360).toBeCloseTo(90, 6);
    expect(p.verdict).toBe('long');
  });

  it('says unmeasured, not faulty, when there is nothing to check against', () => {
    // The guided path runs the turn with no sweep behind it whenever the player skips or refuses
    // the card. An absent check must never render as a failed one.
    const p = turnPlausibility(countsFor(40, 1600), Number.NaN);
    expect(p.verdict).toBe('unmeasured');
    expect(Number.isNaN(p.cm360)).toBe(true);
  });
});

describe('cardContradictsTurn', () => {
  it('is true only when the card and the turn genuinely disagree', () => {
    expect(cardContradictsTurn(countsFor(38, 1600), 1600)).toBe(false);
    expect(cardContradictsTurn(countsFor(6, 1600), 1600)).toBe(true);
    expect(cardContradictsTurn(countsFor(140, 1600), 1600)).toBe(true);
  });

  it('is false with no sweep behind it: a missing check is not a failed one', () => {
    expect(cardContradictsTurn(countsFor(38, 1600), Number.NaN)).toBe(false);
    expect(cardContradictsTurn(counts360(0), 1600)).toBe(false);
  });

  it('flags and nothing else: no export here can return a corrected anchor', () => {
    // The line this module exists to hold. The deleted spin measured its own hard-coded constant
    // and showed the player a dial that agreed with it; a plausibility check that quietly rescaled
    // the turn to fit the band would be the same defect with better manners. Every export is a
    // read: two numbers, a verdict and a boolean.
    expect(Object.keys(plausibility).sort()).toEqual(
      ['HUMAN_MAX_CM360', 'HUMAN_MIN_CM360', 'cardContradictsTurn', 'cm360From', 'turnPlausibility'],
    );
    const counts = countsFor(6, 1600);
    cardContradictsTurn(counts, 1600);
    expect(counts).toBe(countsFor(6, 1600)); // the anchor the flag was computed from is untouched
  });
});
