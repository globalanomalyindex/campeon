import { describe, it, expect } from 'vitest';
import { flattenCoalesced, rawDeltasFrom } from '../../src/input/pointer-lock';

describe('flattenCoalesced', () => {
  it('carries movementX and movementY through unchanged and keeps per-event timestamps', () => {
    // The defect pinned here: this used to divide by devicePixelRatio on the stated reasoning that
    // Chrome reports device pixels and Firefox CSS pixels, so dividing by DPR "makes the two agree".
    // Dividing two streams that differ by a factor by that same factor cannot reconcile them; it
    // made one correct and left the other wrong by DPR. The samples are now exactly what the browser
    // reported, which is also what keeps the integer lattice readable for the convention probe.
    const events = [
      { movementX: 10, movementY: -4, timeStamp: 100 },
      { movementX: 6, movementY: 0, timeStamp: 101 },
    ];
    expect(flattenCoalesced(events, 0)).toEqual([
      { t: 100, dx: 10, dy: -4 },
      { t: 101, dx: 6, dy: 0 },
    ]);
  });

  it('falls back to the supplied time when an event has no timeStamp', () => {
    expect(flattenCoalesced([{ movementX: 4, movementY: 4 }], 250)).toEqual([{ t: 250, dx: 4, dy: 4 }]);
  });

  it('returns an empty array for no events', () => {
    expect(flattenCoalesced([], 0)).toEqual([]);
  });

  it('has no devicePixelRatio parameter left to pass', () => {
    // @ts-expect-error the dpr parameter is gone; a caller that still passes one is a live bug
    flattenCoalesced([], 1, 0);
  });
});

describe('rawDeltasFrom', () => {
  it('exposes the untouched horizontal deltas, in event order', () => {
    const events = [
      { movementX: 3, movementY: 1, timeStamp: 1 },
      { movementX: -4, movementY: 0, timeStamp: 2 },
      { movementX: 0, movementY: 9, timeStamp: 3 },
    ];
    expect(rawDeltasFrom(events)).toEqual([3, -4, 0]);
  });

  it('keeps a non-integer delta rather than rounding it, because the non-integer IS the finding', () => {
    // A stream whose spacing is not 1 is how the convention probe detects a scaled delta stream.
    // Rounding here would erase the only evidence that exists, and would do it silently.
    expect(rawDeltasFrom([{ movementX: 1.5, movementY: 0 }])).toEqual([1.5]);
  });

  it('returns an empty array for no events', () => {
    expect(rawDeltasFrom([])).toEqual([]);
  });
});
