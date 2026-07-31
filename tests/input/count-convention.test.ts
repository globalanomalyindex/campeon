import { describe, it, expect } from 'vitest';
import { counts360, type Counts360 } from '../../src/types';
import { countsForSens } from '../../src/convert/counts';
import { GAME_YAW, yawFor } from '../../src/convert/yaw-table';
import { LATTICE_PURITY_MIN, SPACING_ONE_TOL, type Convention } from '../../src/input/lattice';
import {
  DPR_ONE_LOG_SD,
  kFromTypedSens,
  pinConvention,
  tierTwoFrom,
  type TypedSensRoute,
} from '../../src/input/count-convention';

/** The arena's own count for one 360, in browser deltas, for a player whose true setting is `sens`
 *  in `game` on a browser whose convention is `k`. This is the fixture the whole route inverts. */
function arenaCountsFor(game: 'cs2' | 'valorant', sens: number, k: number): Counts360 {
  return counts360(countsForSens(sens, yawFor(game)) * k);
}

const typed = (over: Partial<TypedSensRoute> = {}): TypedSensRoute => ({
  game: 'cs2',
  sens: 2,
  arenaCounts: arenaCountsFor('cs2', 2, 1.5),
  anchorLogSd: 0.12,
  ...over,
});

const scaledLattice: Convention = { state: 'scaled', k: 2, purity: 1 };
const spacingOne: Convention = { state: 'indeterminate', reason: 'spacing-one', purity: 1 };

describe('kFromTypedSens', () => {
  it('measures k by comparing the arena count against the exact typed count', () => {
    for (const k of [0.5, 1.25, 1.5, 2]) {
      expect(kFromTypedSens(arenaCountsFor('cs2', 2, k), 'cs2', 2)).toBeCloseTo(k, 10);
      expect(kFromTypedSens(arenaCountsFor('valorant', 0.35, k), 'valorant', 0.35)).toBeCloseTo(k, 10);
    }
  });

  it('refuses a sensitivity that cannot be inverted', () => {
    const arena = arenaCountsFor('cs2', 2, 1.5);
    expect(kFromTypedSens(arena, 'cs2', 0)).toBeNull();
    expect(kFromTypedSens(arena, 'cs2', -1)).toBeNull();
    expect(kFromTypedSens(arena, 'cs2', NaN)).toBeNull();
  });

  it('refuses an arena count that is not a measurement', () => {
    expect(kFromTypedSens(counts360(0), 'cs2', 2)).toBeNull();
    expect(kFromTypedSens(counts360(NaN), 'cs2', 2)).toBeNull();
    expect(kFromTypedSens(counts360(-4000), 'cs2', 2)).toBeNull();
  });

  it('refuses an out-of-band k instead of rescaling the table by an order of magnitude', () => {
    // A decimal-point slip in the typed sensitivity is the realistic cause: 0.2 typed as 2 puts k a
    // factor of ten out. The band is the same one the lattice candidates live in.
    expect(kFromTypedSens(arenaCountsFor('cs2', 2, 20), 'cs2', 2)).toBeNull();
    expect(kFromTypedSens(arenaCountsFor('cs2', 2, 0.01), 'cs2', 2)).toBeNull();
  });
});

describe('pinConvention', () => {
  it('prefers the typed route when both are available', () => {
    // The lattice says 2, the typed route says 1.5. The typed route wins: it is exact arithmetic on
    // a number the player read off their own game, while the lattice is an inference about how the
    // browser reports deltas. They disagreeing is a signal about the browser, not a tie to split.
    const pin = pinConvention(scaledLattice, typed(), null);
    expect(pin.pinned).toBe(true);
    if (pin.pinned) {
      expect(pin.k).toBeCloseTo(1.5, 10);
      expect(pin.source).toBe('typed-sens');
      expect(pin.logSd).toBe(0.12);
    }
  });

  it('inherits the anchor log sd on the typed route, because k inherits the reproduction error', () => {
    const pin = pinConvention(null, typed({ anchorLogSd: 0.3 }), null);
    expect(pin).toMatchObject({ pinned: true, source: 'typed-sens', logSd: 0.3 });
  });

  it('falls back to the lattice when the typed number is unusable', () => {
    const pin = pinConvention(scaledLattice, typed({ sens: 0 }), null);
    expect(pin).toEqual({ pinned: true, k: 2, source: 'lattice', logSd: 0 });
  });

  it('pins from an exactly pure lattice with no spread of its own', () => {
    // logSd 0 is not a fabricated interval HERE: purity exactly one says the spacing divides every
    // delta, and the spacing IS k, so there is no sampling step left to be uncertain about.
    expect(pinConvention(scaledLattice, null, null)).toEqual({
      pinned: true, k: 2, source: 'lattice', logSd: 0,
    });
  });

  it('carries an impure lattice shortfall as k spread rather than claiming zero', () => {
    // The purity floor is 0.98, not 1.0, so a pin can rest on a candidate that leaves part of the
    // phase unaccounted for, and a sub-harmonic or super-harmonic mis-pick is not impossible. A
    // zero-width claim there is uncertainty the evidence has not earned, so the shortfall below one
    // becomes k's log sd and tier two widens by it.
    const pin = pinConvention({ state: 'scaled', k: 1.25, purity: 0.985 }, null, null);
    expect(pin).toMatchObject({ pinned: true, k: 1.25, source: 'lattice' });
    if (pin.pinned) expect(pin.logSd).toBeCloseTo(0.015, 12);
  });

  it('refuses the typed route when the anchor carries no honest spread', () => {
    // Pinning k off an anchor whose uncertainty is unknown would emit a per-game table with an
    // implied zero-width claim it has not earned. Refuse the route instead.
    expect(pinConvention(null, typed({ anchorLogSd: NaN }), null)).toEqual({
      pinned: false, reason: 'typed-sens-implausible',
    });
    expect(pinConvention(null, typed({ anchorLogSd: -0.2 }), null)).toEqual({
      pinned: false, reason: 'typed-sens-implausible',
    });
  });

  it('reports gate-closed when the estimator never ran and nothing was typed', () => {
    expect(pinConvention(null, null, null)).toEqual({ pinned: false, reason: 'gate-closed' });
  });

  it('reports lattice-indeterminate when the estimator ran and refused', () => {
    expect(pinConvention(spacingOne, null, null)).toEqual({
      pinned: false, reason: 'lattice-indeterminate',
    });
    expect(pinConvention({ state: 'indeterminate', reason: 'no-lattice', purity: 0.2 }, null, null)).toEqual({
      pinned: false, reason: 'lattice-indeterminate',
    });
  });

  it('reports typed-sens-implausible when the only offer was unusable', () => {
    expect(pinConvention(spacingOne, typed({ sens: 0 }), null)).toEqual({
      pinned: false, reason: 'typed-sens-implausible',
    });
  });
});

// The third route: the deduction from a plain-density display. A unit lattice is what an honest
// browser produces, so before this route existed the tool refused the typeable number exactly when
// the browser was behaving correctly. The premise that closes the gap is stated at the pin: nothing
// but display density can scale a delta, and devicePixelRatio reports display density.
describe('pinConvention, the devicePixelRatio route', () => {
  it('pins k at 1 on a unit lattice when the display density is exactly 1', () => {
    // Not the lattice speaking: the lattice said `spacing-one`, which is a refusal. The pin is the
    // deduction, and it is labelled as one so nothing downstream can present it as a measurement.
    expect(pinConvention(spacingOne, null, 1)).toEqual({
      pinned: true, k: 1, source: 'dpr-one', logSd: DPR_ONE_LOG_SD,
    });
  });

  it('carries the spacing-one band as k spread rather than claiming a zero-width deduction', () => {
    // The deduction fixes k's VALUE exactly, but the check that corroborates it classifies anything
    // within SPACING_ONE_TOL of 1 as a unit lattice, so a scaling of up to two percent would be
    // pinned as 1 and never seen. That band is the spread. It is also at least the purity shortfall
    // the lattice route carries, since LATTICE_PURITY_MIN caps that shortfall at the same 0.02.
    const pin = pinConvention(spacingOne, null, 1);
    expect(pin.pinned && pin.logSd).toBe(SPACING_ONE_TOL);
    expect(DPR_ONE_LOG_SD).toBeGreaterThan(0);
    // Equal by construction, to float: the purity floor and the spacing band are both two percent,
    // so this spread can never be narrower than the one the lattice route would have carried.
    expect(DPR_ONE_LOG_SD).toBeCloseTo(1 - LATTICE_PURITY_MIN, 12);
  });

  it('refuses at every density other than exactly 1, with no rounding and no band', () => {
    // At any other density the fractional factor has somewhere to come from, so the collapse the
    // one-sided contract exists for is live again and the refusal stands. 1.25 and 1.5 are the
    // cases a rounded or "close enough" comparison would wrongly pin, which is why they are here.
    for (const dpr of [1.25, 1.5, 2, 3]) {
      expect(pinConvention(spacingOne, null, dpr)).toEqual({
        pinned: false, reason: 'lattice-indeterminate',
      });
    }
    // Neighbours of 1 on both sides: the deduction is licensed by exactly 1 and by nothing near it.
    for (const dpr of [0.999999, 1.000001, 1.02, 0.98]) {
      expect(pinConvention(spacingOne, null, dpr).pinned).toBe(false);
    }
  });

  it('refuses when the density could not be vouched for, and never invents one', () => {
    // null is the shell saying "not read, or it moved during the capture". A density read after a
    // stream was captured under a different one is the unit bug this route is built to avoid.
    expect(pinConvention(spacingOne, null, null).pinned).toBe(false);
    expect(pinConvention(spacingOne, null, NaN).pinned).toBe(false);
  });

  it('refuses at density 1 when the gate is closed, because acceleration is a different problem', () => {
    // A null lattice means the estimator was never entitled to run: the stream is OS-adjusted, so
    // an acceleration curve sits between the mouse and the deltas. The deduction says nothing about
    // that, and a pin here would answer a question nobody asked with a number that is not k.
    expect(pinConvention(null, null, 1)).toEqual({ pinned: false, reason: 'gate-closed' });
  });

  it('refuses at density 1 when the stream never corroborated a unit lattice', () => {
    // The premise has to survive contact with the evidence. A stream the estimator could not fit,
    // or never had enough of, is not a unit lattice, and deducing from a premise the data does not
    // support is the shortcut this whole module exists to refuse.
    for (const reason of ['no-lattice', 'too-few-samples'] as const) {
      expect(pinConvention({ state: 'indeterminate', reason, purity: 0.4 }, null, 1)).toEqual({
        pinned: false, reason: 'lattice-indeterminate',
      });
    }
  });

  it('never overturns a lattice that spoke: evidence outranks the premise', () => {
    // A measured scaled(2) at density 1 contradicts the premise. The premise loses: it may license
    // a pin where the estimator is silent and may not silence one that measured something.
    expect(pinConvention(scaledLattice, null, 1)).toEqual({
      pinned: true, k: 2, source: 'lattice', logSd: 0,
    });
  });

  it('loses to the typed route, which measures the factor instead of assuming it away', () => {
    const pin = pinConvention(spacingOne, typed(), 1);
    expect(pin).toMatchObject({ pinned: true, source: 'typed-sens' });
    if (pin.pinned) expect(pin.k).toBeCloseTo(1.5, 10);
  });

  it('still pins by deduction when a typed offer was unusable, exactly as the lattice route does', () => {
    // An offer we could not use costs the offer, not the run: the measured or deduced route behind
    // it is still there, and refusing both would withhold a tier over a mistyped number.
    expect(pinConvention(spacingOne, typed({ sens: 0 }), 1)).toMatchObject({
      pinned: true, k: 1, source: 'dpr-one',
    });
  });
});

describe('tierTwoFrom', () => {
  const latticePin = { pinned: true, k: 1.5, source: 'lattice', logSd: 0 } as const;

  it('withholds the table entirely when k is unpinned', () => {
    // Not an empty table, not a table of dashes: absent. A per-game sensitivity with an unpinned k
    // is a number that would be wrong by exactly the factor we failed to measure.
    expect(tierTwoFrom(counts360(6000), { pinned: false, reason: 'gate-closed' })).toBeNull();
    expect(tierTwoFrom(counts360(6000), { pinned: false, reason: 'lattice-indeterminate' })).toBeNull();
    expect(tierTwoFrom(counts360(6000), { pinned: false, reason: 'typed-sens-implausible' })).toBeNull();
  });

  it('withholds the table when the optimum or the pinned k is not a usable number', () => {
    // The k guard is not unreachable defensiveness: KPin is a plain structural type, so any caller
    // assembling one by hand (phase 1b's fixtures do) can hand this a zero and would otherwise get
    // an Infinity table back.
    expect(tierTwoFrom(counts360(0), latticePin)).toBeNull();
    expect(tierTwoFrom(counts360(NaN), latticePin)).toBeNull();
    expect(tierTwoFrom(counts360(6000), { pinned: true, k: 0, source: 'lattice', logSd: 0 })).toBeNull();
    expect(tierTwoFrom(counts360(6000), { pinned: true, k: NaN, source: 'lattice', logSd: 0 })).toBeNull();
  });

  it('emits the native sensitivity for every game at the pinned convention', () => {
    const t = tierTwoFrom(counts360(6000), latticePin);
    expect(t).not.toBeNull();
    // C* = 6000 browser deltas at k = 1.5 is 4000 real counts per 360.
    // cs2 yaw 0.022: 360 / (0.022 * 4000) = 4.0909...
    expect(t!.perGameSens.cs2).toBeCloseTo(4.090909, 6);
    // valorant effective yaw 0.07: 360 / (0.07 * 4000) = 1.2857...
    expect(t!.perGameSens.valorant).toBeCloseTo(1.285714, 6);
    expect(Object.keys(t!.perGameSens).sort()).toEqual(GAME_YAW.map((g) => g.id).sort());
  });

  it('scales every emitted sensitivity exactly with k, and nothing else', () => {
    // This is the whole reach of k: it multiplies the absolute numbers in tier two and touches
    // nothing else. The arena is self-consistent in browser counts, so the ratio in tier one is
    // unaffected by k, which is why an unpinned k costs a tier rather than the answer.
    const a = tierTwoFrom(counts360(6000), { pinned: true, k: 1.5, source: 'lattice', logSd: 0 })!;
    const b = tierTwoFrom(counts360(6000), { pinned: true, k: 3, source: 'lattice', logSd: 0 })!;
    for (const g of GAME_YAW) {
      expect(b.perGameSens[g.id]!).toBeCloseTo(a.perGameSens[g.id]! * 2, 9);
    }
  });

  it('restricts the table to the requested games', () => {
    const t = tierTwoFrom(counts360(6000), latticePin, ['cs2', 'apex'])!;
    expect(Object.keys(t.perGameSens).sort()).toEqual(['apex', 'cs2']);
  });

  it('carries the pinned k, its source and its log sd, and nothing that could be mistaken for a ratio', () => {
    const typedPinned = { pinned: true, k: 1.5, source: 'typed-sens', logSd: 0.12 } as const;
    const t = tierTwoFrom(counts360(6000), typedPinned)!;
    expect(t.kSource).toBe('typed-sens');
    expect(t.kLogSd).toBe(0.12);
    expect(t.k).toBe(1.5); // tier three renders hardware counts as C* / k and must not re-derive it
    expect(Object.keys(t).sort()).toEqual(['k', 'kLogSd', 'kSource', 'perGameSens']);
    expect(tierTwoFrom(counts360(6000), latticePin)!.kSource).toBe('lattice');
  });
});
