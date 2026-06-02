import { describe, it, expect } from 'vitest';
import { flattenCoalesced } from '../../src/input/pointer-lock';

describe('flattenCoalesced', () => {
  it('DPR-normalizes each coalesced event and keeps per-event timestamps', () => {
    const events = [
      { movementX: 10, movementY: -4, timeStamp: 100 },
      { movementX: 6, movementY: 0, timeStamp: 101 },
    ];
    expect(flattenCoalesced(events, 2, 0)).toEqual([
      { t: 100, dx: 5, dy: -2 },
      { t: 101, dx: 3, dy: 0 },
    ]);
  });
  it('falls back to the supplied time when an event has no timeStamp', () => {
    const events = [{ movementX: 4, movementY: 4 }];
    expect(flattenCoalesced(events, 1, 250)).toEqual([{ t: 250, dx: 4, dy: 4 }]);
  });
  it('returns an empty array for no events', () => {
    expect(flattenCoalesced([], 1, 0)).toEqual([]);
  });
});
