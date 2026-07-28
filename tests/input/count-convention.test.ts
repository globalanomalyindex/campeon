import { describe, it, expect } from 'vitest';
import { counts360, type Counts360 } from '../../src/types';
import { countsForSens } from '../../src/convert/counts';
import { yawFor } from '../../src/convert/yaw-table';
import type { Convention } from '../../src/input/lattice';
import {
  kFromTypedSens,
  pinConvention,
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
    const pin = pinConvention(scaledLattice, typed());
    expect(pin.pinned).toBe(true);
    if (pin.pinned) {
      expect(pin.k).toBeCloseTo(1.5, 10);
      expect(pin.source).toBe('typed-sens');
      expect(pin.logSd).toBe(0.12);
    }
  });

  it('inherits the anchor log sd on the typed route, because k inherits the reproduction error', () => {
    const pin = pinConvention(null, typed({ anchorLogSd: 0.3 }));
    expect(pin).toMatchObject({ pinned: true, source: 'typed-sens', logSd: 0.3 });
  });

  it('falls back to the lattice when the typed number is unusable', () => {
    const pin = pinConvention(scaledLattice, typed({ sens: 0 }));
    expect(pin).toEqual({ pinned: true, k: 2, source: 'lattice', logSd: 0 });
  });

  it('pins from an exactly pure lattice with no spread of its own', () => {
    // logSd 0 is not a fabricated interval HERE: purity exactly one says the spacing divides every
    // delta, and the spacing IS k, so there is no sampling step left to be uncertain about.
    expect(pinConvention(scaledLattice, null)).toEqual({
      pinned: true, k: 2, source: 'lattice', logSd: 0,
    });
  });

  it('carries an impure lattice shortfall as k spread rather than claiming zero', () => {
    // The purity floor is 0.98, not 1.0, so a pin can rest on a candidate that leaves part of the
    // phase unaccounted for, and a sub-harmonic or super-harmonic mis-pick is not impossible. A
    // zero-width claim there is uncertainty the evidence has not earned, so the shortfall below one
    // becomes k's log sd and tier two widens by it.
    const pin = pinConvention({ state: 'scaled', k: 1.25, purity: 0.985 }, null);
    expect(pin).toMatchObject({ pinned: true, k: 1.25, source: 'lattice' });
    if (pin.pinned) expect(pin.logSd).toBeCloseTo(0.015, 12);
  });

  it('refuses the typed route when the anchor carries no honest spread', () => {
    // Pinning k off an anchor whose uncertainty is unknown would emit a per-game table with an
    // implied zero-width claim it has not earned. Refuse the route instead.
    expect(pinConvention(null, typed({ anchorLogSd: NaN }))).toEqual({
      pinned: false, reason: 'typed-sens-implausible',
    });
    expect(pinConvention(null, typed({ anchorLogSd: -0.2 }))).toEqual({
      pinned: false, reason: 'typed-sens-implausible',
    });
  });

  it('reports gate-closed when the estimator never ran and nothing was typed', () => {
    expect(pinConvention(null, null)).toEqual({ pinned: false, reason: 'gate-closed' });
  });

  it('reports lattice-indeterminate when the estimator ran and refused', () => {
    expect(pinConvention(spacingOne, null)).toEqual({
      pinned: false, reason: 'lattice-indeterminate',
    });
    expect(pinConvention({ state: 'indeterminate', reason: 'no-lattice', purity: 0.2 }, null)).toEqual({
      pinned: false, reason: 'lattice-indeterminate',
    });
  });

  it('reports typed-sens-implausible when the only offer was unusable', () => {
    expect(pinConvention(spacingOne, typed({ sens: 0 }))).toEqual({
      pinned: false, reason: 'typed-sens-implausible',
    });
  });
});
