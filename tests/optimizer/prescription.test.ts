import { describe, it, expect } from 'vitest';
import {
  buildPrescription, ratioFraming, CONFIRMED_MAX_ABS_LN, type AnchorReading,
} from '../../src/optimizer/result';
import type { KPin } from '../../src/input/count-convention';
import { counts360, type Counts360, type Report } from '../../src/types';
import { sensFor } from '../../src/convert/counts';
import { yawFor } from '../../src/convert/yaw-table';

const c = counts360;
const ci = (lo: number, hi: number): [Counts360, Counts360] => [c(lo), c(hi)];

const report: Report = {
  optimalCounts: c(8000),
  ci90: ci(7500, 8600),
  curve: [{ x: Math.log(8000), mean: 0.4 }],
};
const anchor: AnchorReading = { counts: c(7040), ci90: ci(6800, 7300) };
// The two allowed pin routes and the unpinned refusal, in phase 3's own KPin shape. There is no
// third route: a k inferred from a discrete DPI prior is the false-precision shortcut the spec bans.
const LATTICE_2: KPin = { pinned: true, k: 2, source: 'lattice', logSd: 0 };
const TYPED_125: KPin = { pinned: true, k: 1.25, source: 'typed-sens', logSd: 0.12 };
const UNPINNED: KPin = { pinned: false, reason: 'gate-closed' };

describe('buildPrescription', () => {
  it('the ratio is anchor counts over located counts, with the conservative quotient interval', () => {
    const p = buildPrescription(report, anchor)!;
    expect(p).not.toBeNull();
    expect(p.ratio).toBe(7040 / 8000); // 0.88 exactly
    // Endpoint quotient [aLo/cHi, aHi/cLo]: deliberately wider than an independence-assuming
    // combination, because the dependence between the two CIs is not measured. Widen, never narrow.
    expect(p.ratioCi90).toEqual([6800 / 8600, 7300 / 7500]);
    expect(p.ratio!).toBeGreaterThanOrEqual(p.ratioCi90![0]);
    expect(p.ratio!).toBeLessThanOrEqual(p.ratioCi90![1]);
  });

  it('copies C* and its CI verbatim; this layer never refits', () => {
    const p = buildPrescription(report, anchor)!;
    expect(p.counts).toBe(report.optimalCounts);
    expect(p.countsCi90).toBe(report.ci90); // same reference: provably no recomputation
  });

  it('the ratio is byte-identical under scaling every count by the same factor', () => {
    // The unit-freedom thesis at the payoff layer: C0 and C* are counted in the same browser
    // units, so a convention factor k multiplies numerator and denominator alike and cancels.
    // The factors below keep every product exactly representable (integer inputs, few-bit
    // factors), so both quotients are the correctly rounded image of the same real number and
    // Object.is is exact rather than approximate. The full-pipeline version (a recorded session,
    // k = 7.3, exact at k = 1 and 1e-9 elsewhere per amendment A7) is phase 1a's task 6, and it
    // runs through THIS function, buildPrescription, because this is the shipped path; this test
    // pins the identity the payoff layer itself must preserve.
    const base = buildPrescription(report, anchor)!;
    for (const k of [2, 0.5, 1.5, 4]) {
      const scaled = buildPrescription(
        { ...report, optimalCounts: c(8000 * k), ci90: ci(7500 * k, 8600 * k) },
        { counts: c(7040 * k), ci90: ci(6800 * k, 7300 * k) },
      )!;
      expect(Object.is(scaled.ratio, base.ratio)).toBe(true);
      expect(Object.is(scaled.ratioCi90![0], base.ratioCi90![0])).toBe(true);
      expect(Object.is(scaled.ratioCi90![1], base.ratioCi90![1])).toBe(true);
    }
  });

  it('refuses with neither an anchor nor a pinned k: nothing to say, never a padded factor', () => {
    expect(buildPrescription(report, null)).toBeNull();
    expect(buildPrescription(report, null, UNPINNED)).toBeNull();
  });

  it('a refused anchor with a pinned k still yields tier two, with the ratio fields ABSENT (A5)', () => {
    // The reachable state that forced ratio/ratioCi90 optional: lattice scaled(k) pinned k, but
    // the turn disagreed and the flick anchor refused. Tier two is honest on its own; requiring
    // the ratio here would withhold a table whose one assumption IS measured.
    const p = buildPrescription(report, null, LATTICE_2)!;
    expect(p).not.toBeNull();
    expect('ratio' in p).toBe(false);
    expect('ratioCi90' in p).toBe(false);
    expect(p.counts).toBe(report.optimalCounts);
    expect(p.kSource).toBe('lattice');
    expect(p.perGameSens!.cs2).toBeCloseTo(sensFor(c(4000), yawFor('cs2')), 12);
  });

  it('refuses on a clamped vertex, even with k pinned: a factor or table against a bound would prescribe the window edge', () => {
    expect(buildPrescription({ ...report, peakAtBound: 'high' }, anchor)).toBeNull();
    expect(buildPrescription({ ...report, peakAtBound: 'low' }, anchor)).toBeNull();
    expect(buildPrescription({ ...report, peakAtBound: 'high' }, null, LATTICE_2)).toBeNull();
  });

  it('refuses degenerate inputs rather than emitting a plausible wrong number', () => {
    // A non-null but degenerate anchor is a CALLER BUG, not an honest refusal, so the whole
    // prescription refuses (tier two included) rather than papering over it: reconcile() returns
    // null when it cannot anchor, never NaN or an inverted interval.
    expect(buildPrescription(report, { counts: c(NaN), ci90: ci(6800, 7300) })).toBeNull();
    expect(buildPrescription(report, { counts: c(7040), ci90: ci(0, 7300) })).toBeNull();
    expect(buildPrescription(report, { counts: c(7040), ci90: ci(7300, 6800) })).toBeNull();
    expect(buildPrescription({ ...report, ci90: ci(8600, 7500) }, anchor)).toBeNull();
  });

  it('emits the per-game table ONLY under a pinned k, at true counts = browser counts / k', () => {
    const p = buildPrescription(report, anchor, LATTICE_2)!;
    expect(p.kSource).toBe('lattice');
    // k = 2 means the browser doubled hardware counts, so true counts per 360 = 8000 / 2 and the
    // native sens follows 360 / (yaw * trueCounts). The arithmetic lives in phase 3's
    // tierTwoFrom, the ONLY implementation of tier two (A4); this asserts the wiring, not a copy.
    expect(p.perGameSens!.cs2).toBeCloseTo(sensFor(c(4000), yawFor('cs2')), 12);
    expect(p.perGameSens!.valorant).toBeCloseTo(sensFor(c(4000), yawFor('valorant')), 12);
  });

  it('withholds tier two without k: the fields are ABSENT, not defaulted to k = 1', () => {
    const p = buildPrescription(report, anchor)!;
    // Spelling k = 1 here would be the exact silent factor error the lattice's one-sided
    // contract exists to prevent; absence is the only honest encoding of "unpinned".
    expect('perGameSens' in p).toBe(false);
    expect('kSource' in p).toBe(false);
    expect('kLogSd' in p).toBe(false);
    expect('hardwareCounts' in p).toBe(false);
  });

  it('treats an unpinned KPin exactly like an absent one: the refusal costs the tier, never the ratio', () => {
    const p = buildPrescription(report, anchor, UNPINNED)!;
    expect('perGameSens' in p).toBe(false);
    expect('kSource' in p).toBe(false);
    expect(p.ratio).toBe(7040 / 8000);
  });

  it('carries kLogSd and the hardware counts whole, so tier two can widen and tier three can disclose (A5, A6)', () => {
    const p = buildPrescription(report, anchor, TYPED_125)!;
    // The typed-sens route inherits the anchor's spread whole; the screen folds it into each
    // per-game row's band in quadrature with the search's own interval (D3). hardwareCounts =
    // C* / k is the only honest number tier three may call centimetre-convertible when k is
    // pinned.
    expect(p.kLogSd).toBe(0.12);
    expect(p.hardwareCounts).toBe(8000 / 1.25);
    const q = buildPrescription(report, anchor, LATTICE_2)!;
    expect(q.kLogSd).toBe(0);
    expect(q.hardwareCounts).toBe(4000);
  });

  it('can restrict the table to a subset of games', () => {
    const p = buildPrescription(report, anchor, TYPED_125, ['cs2', 'valorant'])!;
    expect(Object.keys(p.perGameSens!).sort()).toEqual(['cs2', 'valorant']);
  });
});

describe('ratioFraming', () => {
  it('directional when the interval excludes no-change', () => {
    expect(ratioFraming([0.79, 0.97])).toBe('directional');
    expect(ratioFraming([1.02, 1.31])).toBe('directional');
  });

  it('confirmed when the interval contains 1 and is confined within the resolution floor', () => {
    expect(ratioFraming([0.96, 1.04])).toBe('confirmed');
    // ln(1.05) = 0.0488 sits just under the 0.05 floor: the widest band still read as "already
    // there". Pinned so the constant cannot drift below the copy that quotes 5%.
    expect(Math.log(1.05)).toBeLessThanOrEqual(CONFIRMED_MAX_ABS_LN);
    expect(ratioFraming([0.96, 1.05])).toBe('confirmed');
  });

  it('indistinct when the interval contains 1 but is wider than the floor', () => {
    // The screen must then DROP the change framing (spec error path: an interval spanning a
    // ratio of 1 cannot distinguish a change from none).
    expect(ratioFraming([0.94, 1.04])).toBe('indistinct');
    expect(ratioFraming([0.9, 1.2])).toBe('indistinct');
  });
});

describe('the pinned convention, declared rather than smuggled', () => {
  it('rides exactly when the table does, and is absent when k is unpinned', () => {
    const pinned = buildPrescription(report, anchor, LATTICE_2)!;
    expect(pinned.k).toBe(2);
    expect('k' in pinned).toBe(true);
    const typed = buildPrescription(report, anchor, TYPED_125)!;
    expect(typed.k).toBe(1.25);
    const unpinned = buildPrescription(report, anchor)!;
    expect('k' in unpinned).toBe(false);
    expect(buildPrescription(report, anchor, UNPINNED)!.k).toBeUndefined();
  });

  it('is a disclosure, never the divisor: tier three reads hardwareCounts, which was divided once', () => {
    // Re-deriving C*/k at render time would be a second place for the division to live, and the
    // two would drift the first time either side changed. hardwareCounts is that division, done
    // once in buildPrescription; k rides so a Result rehydrated from storage can still SAY which
    // factor was pinned, with no draft left to ask.
    const p = buildPrescription(report, anchor, TYPED_125)!;
    expect(p.hardwareCounts).toBe(p.counts / p.k!);
    expect(p.hardwareCounts).toBe(8000 / 1.25);
  });

  it('every field the object carries is a field the interface declares', () => {
    // The guard, and the reason this task exists. TypeScript does not excess-property-check through
    // a spread, so `{ ...tierTwoFrom(...) }` can put a member on the shipped Prescription that no
    // type mentions, and the Prescription is persisted and exported. This list is the declared
    // shape: a spread that grows a new member fails here before it reaches a player's JSON.
    const p = buildPrescription(report, anchor, TYPED_125)!;
    expect(Object.keys(p).sort()).toEqual([
      'counts', 'countsCi90', 'hardwareCounts', 'k', 'kLogSd', 'kSource', 'perGameSens',
      'ratio', 'ratioCi90',
    ]);
  });
});
