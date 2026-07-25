import { describe, it, expect } from 'vitest';
import { percentileBand } from '../../src/stats/bootstrap';

/**
 * Confidence intervals widen only. That is a stated invariant of this project, and the
 * percentile band was breaking it in a way that is easy to miss.
 *
 * A bootstrap resample that comes out non-concave has no interior peak, so it contributes
 * no peak estimate. Those resamples were dropped from the list AND from the denominator,
 * so the 5th/95th percentiles were taken over the survivors alone while the output was
 * still labelled a 90% interval. When a third of resamples failed, the reported band
 * actually covered 90% of 67%, roughly 60%, and it got NARROWER the noisier the data was,
 * which is exactly backwards.
 *
 * A failed resample is evidence of more uncertainty about where the peak sits, not less.
 * So failures stay in the denominator and are attributed to whichever tail widens the
 * interval.
 */

const width = ([lo, hi]: [number, number]): number => hi - lo;

// A deterministic, evenly spaced set of surviving peak estimates.
const survivors = (n: number): number[] => Array.from({ length: n }, (_, i) => 10 + i);

describe('percentileBand: the band widens when resamples fail', () => {
  it('is unchanged when every resample survived', () => {
    const peaks = survivors(100);
    // Passing no total, and passing a total equal to the survivor count, must agree.
    expect(percentileBand([...peaks])).toEqual(percentileBand([...peaks], 100));
  });

  it('never narrows as more resamples fail, and strictly widens once failures bite', () => {
    const peaks = survivors(100);
    const base = percentileBand([...peaks], 100);

    let previous = width(base);
    for (const total of [110, 125, 150, 200, 400]) {
      const band = percentileBand([...peaks], total);
      const w = width(band);
      expect(w, `total=${total} must not narrow the band`).toBeGreaterThanOrEqual(previous);
      previous = w;
    }

    // With four times as many attempts as survivors, the band has to reach the full
    // observed range: the evidence cannot support anything tighter.
    const stretched = percentileBand([...peaks], 400);
    expect(stretched[0]).toBe(10);
    expect(stretched[1]).toBe(109);
    expect(width(stretched)).toBeGreaterThan(width(base));
  });

  it('drops the lower endpoint and lifts the upper one, rather than sliding the band', () => {
    const peaks = survivors(100);
    const base = percentileBand([...peaks], 100);
    const widened = percentileBand([...peaks], 140);
    expect(widened[0]).toBeLessThanOrEqual(base[0]);
    expect(widened[1]).toBeGreaterThanOrEqual(base[1]);
  });

  it('stays inside the observed estimates and never fabricates a value', () => {
    const peaks = survivors(40);
    for (const total of [40, 60, 100, 1000]) {
      const [lo, hi] = percentileBand([...peaks], total);
      expect(lo).toBeGreaterThanOrEqual(10);
      expect(hi).toBeLessThanOrEqual(49);
      expect(lo).toBeLessThanOrEqual(hi);
    }
  });

  it('survives a single surviving resample without producing a nonsense band', () => {
    const [lo, hi] = percentileBand([42], 400);
    expect(lo).toBe(42);
    expect(hi).toBe(42);
  });

  it('ignores a total smaller than the survivor count rather than inverting the band', () => {
    const peaks = survivors(50);
    expect(percentileBand([...peaks], 10)).toEqual(percentileBand([...peaks], 50));
  });
});
