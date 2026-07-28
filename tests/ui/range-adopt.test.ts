import { describe, it, expect } from 'vitest';
import { adoptResult } from '../../src/ui/range-adopt';
import { counts360, countsBounds } from '../../src/types';
import type { Result } from '../../src/types';

const measured: Result = {
  optimalCounts: counts360(9450),
  ci90: countsBounds(8600, 10400),
  breakdown: { biasZeroCounts: counts360(9300), precisionFloorDeg: 0.35, ttkMs: 510, hitRate: 0.86 },
  curve: [{ x: Math.log(9450), mean: 0.2 }],
  bounds: countsBounds(4800, 19200),
  driftZ: -0.4,
  // A prescription measured against the SEARCH's optimum, which is exactly what must not ride along
  // onto a number the player picked by hand.
  prescription: {
    ratio: 1.09,
    ratioCi90: [1.02, 1.17],
    counts: counts360(9450),
    countsCi90: countsBounds(8600, 10400),
  },
};

describe('adoptResult', () => {
  it('sets the adopted count total and flags the result tuned', () => {
    const tuned = adoptResult(measured, counts360(10200));
    expect(tuned.optimalCounts).toBe(10200);
    expect(tuned.tuned).toBe(true);
  });

  it('DROPS the prescription, so a hand-picked number carries no multiply factor', () => {
    // The factor was measured against where the SEARCH peaked. Carried onto a value the player
    // dialled by feel it would report a change from their current sensitivity that nothing measured,
    // and it would ride into localStorage and the exported JSON, where the screen's gate cannot
    // reach it.
    expect('prescription' in adoptResult(measured, counts360(10200))).toBe(false);
  });

  it('DROPS the measured 90 percent interval, because a tuned value carries none', () => {
    // tuned-value-has-no-measured-ci is a canon rule this repo already had, and the code was
    // breaking it in the one place nobody looked. The result screen hid the band on a tuned value,
    // so on screen the rule held; the field itself rode into localStorage and the exported JSON,
    // where there is no screen to gate it, and the export is the artifact a player keeps.
    expect('ci90' in adoptResult(measured, counts360(10200))).toBe(false);
  });

  it('keeps the measured breakdown (characterizes the measured run, not the hand-picked value)', () => {
    expect(adoptResult(measured, counts360(10200)).breakdown.ttkMs).toBe(510);
  });

  it('does not mutate the measured result', () => {
    const before = JSON.stringify(measured);
    adoptResult(measured, counts360(10200));
    expect(JSON.stringify(measured)).toBe(before);
  });

  it('DROPS the measured curve/bounds (a hand-picked value has no measured curve - honesty)', () => {
    const tuned = adoptResult(measured, counts360(10200));
    expect('curve' in tuned).toBe(false);
    expect('bounds' in tuned).toBe(false);
  });

  it('DROPS the drift disclosure and the facet concordance', () => {
    const tuned = adoptResult(measured, counts360(10200));
    expect('driftZ' in tuned).toBe(false);
    expect('facetConcordance' in tuned).toBe(false);
  });
});
