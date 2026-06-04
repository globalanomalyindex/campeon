import { describe, it, expect } from 'vitest';
import { degPerCountFor, cm360FromTurnCounts, turnCountsFor } from '../../src/convert/turn-rate';

describe('turn-rate', () => {
  it('a full turn at the mapped rate is exactly 360 degrees', () => {
    const cm360 = 30, dpi = 800;
    const counts = turnCountsFor(cm360, dpi);
    expect(degPerCountFor(cm360, dpi) * counts).toBeCloseTo(360, 6);
  });

  it('cm360FromTurnCounts inverts turnCountsFor', () => {
    const cm360 = 42, dpi = 1600;
    expect(cm360FromTurnCounts(turnCountsFor(cm360, dpi), dpi)).toBeCloseTo(cm360, 6);
  });

  it('matches the physical definition (30 cm/360 at 800 dpi)', () => {
    // 30 cm / 2.54 = 11.811 in; * 800 = 9448.8 counts for a full turn
    expect(turnCountsFor(30, 800)).toBeCloseTo(9448.8, 1);
    expect(cm360FromTurnCounts(9448.8, 800)).toBeCloseTo(30, 3);
  });
});
