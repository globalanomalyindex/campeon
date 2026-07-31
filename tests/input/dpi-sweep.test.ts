import { describe, it, expect } from 'vitest';
import * as sweepModule from '../../src/input/dpi-sweep';
import { dpiFromSweep, dpiFromPasses, SweepAccumulator, isPlausibleSweepDpi, CARD_WIDTH_CM } from '../../src/input/dpi-sweep';

describe('dpi-sweep', () => {
  it('recovers DPI from counts across a known pad width', () => {
    // a 40 cm pad at 800 dpi -> 40/2.54 in * 800 = 12598.4 counts
    expect(dpiFromSweep(12598.4, 40)).toBeCloseTo(800, 1);
  });

  it('uses the standardized ID-1 card width as the reference anchor', () => {
    expect(CARD_WIDTH_CM).toBeCloseTo(8.56, 6); // ISO/IEC 7810 ID-1 long edge, 85.60 mm
  });

  it('recovers DPI from counts swept across a card', () => {
    // a card (8.56 cm) at 1600 dpi -> 8.56/2.54 in * 1600 = 5391.5 counts
    const dpi = 1600;
    const counts = (CARD_WIDTH_CM / 2.54) * dpi;
    expect(dpiFromSweep(counts, CARD_WIDTH_CM)).toBeCloseTo(dpi, 6);
  });

  it('returns NaN for a non-positive pad width', () => {
    expect(Number.isNaN(dpiFromSweep(10000, 0))).toBe(true);
  });

  it('SweepAccumulator sums signed dx and reports the magnitude', () => {
    const acc = new SweepAccumulator();
    acc.add({ t: 0, dx: 100, dy: 5 });
    acc.add({ t: 1, dx: 50, dy: -3 });
    acc.add({ t: 2, dx: -10, dy: 0 });
    expect(acc.total()).toBeCloseTo(140, 6); // |100 + 50 - 10|
    acc.reset();
    expect(acc.total()).toBe(0);
  });

  it('a wobble out and back does not inflate the sweep, because the card width is a NET distance', () => {
    // The opposite convention to the turn's, on purpose. The turn accumulates |dx| because a
    // wobble there is travel the hand really made around the circle; the card's two edges are a
    // fixed 8.56 cm apart however much the hand shook between them, so a path-length sum would
    // report a higher DPI for a shakier hand.
    const acc = new SweepAccumulator();
    for (const dx of [40, -10, 35, -8, 42, -12, 38]) acc.add({ t: 0, dx, dy: 0 });
    expect(acc.total()).toBeCloseTo(125, 6); // the net crossing, not the 185 of path length
  });

  it('flags implausible measured DPI', () => {
    expect(isPlausibleSweepDpi(800)).toBe(true);
    expect(isPlausibleSweepDpi(5)).toBe(false);     // too low (sweep too short / pad typo)
    expect(isPlausibleSweepDpi(99000)).toBe(false); // absurd
  });

  it('carries nothing of the deleted spin', () => {
    // The spin's seed accumulator lived here and left with the instrument: it fed a dial computed
    // from a hard-coded 30 cm per 360, which filled and turned green at the same count for every
    // player, so the instrument measured its own constant. The sweep is back; that is not.
    expect(Object.keys(sweepModule).filter((k) => /spin|seed/i.test(k))).toEqual([]);
  });
});

describe('dpiFromPasses', () => {
  // counts for a given DPI swept across the ID-1 card
  const countsFor = (dpi: number): number => (CARD_WIDTH_CM / 2.54) * dpi;

  it('n=1 is a byte-identical single-pass fallback (= dpiFromSweep), agreed=true, no spread', () => {
    const c = countsFor(1600);
    const r = dpiFromPasses([c], CARD_WIDTH_CM);
    expect(r.dpi).toBe(dpiFromSweep(c, CARD_WIDTH_CM));
    expect(r.dpi).toBeCloseTo(1600, 6);
    expect(r.agreed).toBe(true);
    expect(r.spreadPct).toBe(0);
  });

  it('n=2 returns the mean of the two pass DPIs', () => {
    const r = dpiFromPasses([countsFor(1580), countsFor(1620)], CARD_WIDTH_CM);
    expect(r.dpi).toBeCloseTo(1600, 4);
  });

  it('n=2 agrees when the two passes are close', () => {
    const r = dpiFromPasses([countsFor(1590), countsFor(1610)], CARD_WIDTH_CM);
    expect(r.agreed).toBe(true);
  });

  it('n=2 disagrees when the two passes diverge beyond threshold', () => {
    const r = dpiFromPasses([countsFor(1400), countsFor(1800)], CARD_WIDTH_CM);
    expect(r.agreed).toBe(false);
  });

  it('n>=3 takes the median, rejects an outlier, and returns the surviving mean', () => {
    // three tight (~1600) + one wild outlier; the outlier must be dropped
    const r = dpiFromPasses(
      [countsFor(1590), countsFor(1600), countsFor(1610), countsFor(2400)],
      CARD_WIDTH_CM,
    );
    // surviving mean of the three tight passes (outlier dropped)
    expect(r.dpi).toBeCloseTo(1600, 0);
    expect(r.agreed).toBe(true);
  });

  it('n>=3 reports spreadPct as a consistency indicator (small when passes agree)', () => {
    const r = dpiFromPasses([countsFor(1595), countsFor(1600), countsFor(1605)], CARD_WIDTH_CM);
    expect(r.spreadPct).toBeGreaterThanOrEqual(0);
    expect(r.spreadPct).toBeLessThan(2); // a tight cluster is a low-spread, consistent reading
  });

  it('n>=3 flags !agreed when the surviving passes stay moderately spread (inside the reject band, past the agree band)', () => {
    // ~9% spread: survives the 15% outlier reject, but exceeds the ~6% agree threshold
    const r = dpiFromPasses([countsFor(1530), countsFor(1600), countsFor(1670)], CARD_WIDTH_CM);
    expect(r.agreed).toBe(false);
    expect(r.spreadPct).toBeGreaterThan(6);
  });

  it('returns NaN dpi for an empty pass list', () => {
    expect(Number.isNaN(dpiFromPasses([], CARD_WIDTH_CM).dpi)).toBe(true);
  });
});
