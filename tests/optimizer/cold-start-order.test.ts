import { describe, it, expect } from 'vitest';
import { coldStartOrder } from '../../src/optimizer/session-controller';

/**
 * The cold-start grid used to be presented in ascending cm/360, which made the correlation
 * between trial index and the variable under test exactly 1.0. A player warms up as a session
 * runs, so the warm-up gain landed on the higher sensitivities and was read as evidence for
 * the slow end of the range. The drift adjustment cannot rescue that: its own collinearity
 * guard drops the drift column precisely when the aliasing is worst.
 *
 * This is the function that fixes it, so it gets the coverage the fix deserves. It changes
 * what the tool measures, which makes it exactly the kind of pure function the project says
 * must be unit tested.
 */

/** Pearson correlation between position and the level presented at that position. */
function corr(order: readonly number[]): number {
  const n = order.length;
  const mean = (a: readonly number[]): number => a.reduce((s, v) => s + v, 0) / n;
  const mk = mean(Array.from({ length: n }, (_, i) => i));
  const ml = mean(order);
  let num = 0, dk = 0, dl = 0;
  for (let i = 0; i < n; i++) {
    const a = i - mk, b = order[i]! - ml;
    num += a * b; dk += a * a; dl += b * b;
  }
  return dk === 0 || dl === 0 ? 0 : num / Math.sqrt(dk * dl);
}

describe('coldStartOrder', () => {
  it('is a permutation of every level, so no level is dropped or repeated', () => {
    for (const n of [3, 4, 5, 6, 8, 9, 12, 16, 20]) {
      const order = coldStartOrder(n);
      expect(order, `n=${n} length`).toHaveLength(n);
      expect([...order].sort((a, b) => a - b), `n=${n} covers 0..${n - 1} exactly once`)
        .toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });

  it('breaks the order/level correlation that was the whole defect', () => {
    // Ascending order scores 1.0. Anything at or above 0.5 still aliases practice with
    // sensitivity badly enough to bias the located optimum.
    for (const n of [4, 5, 6, 8, 9, 12, 16, 20]) {
      const r = Math.abs(corr(coldStartOrder(n)));
      expect(r, `n=${n} correlation was ${r.toFixed(3)}`).toBeLessThan(0.5);
    }
    // The shipped configuration is 8 (max(4, 2 * 4 instruments)).
    expect(Math.abs(corr(coldStartOrder(8)))).toBeLessThan(0.3);
  });

  it('spreads each instrument’s own trials across the range, not just the whole sequence', () => {
    // The schedule cycles four instruments, so instrument i only ever sees positions
    // i, i+4, i+8... The drift adjustment is fitted per instrument, so each of those
    // subsequences has to straddle the range too. With coldStart 8 every instrument gets two
    // levels, and they must not both come from the same half.
    const n = 8, instruments = 4;
    const order = coldStartOrder(n);
    for (let inst = 0; inst < instruments; inst++) {
      const mine: number[] = [];
      for (let k = inst; k < n; k += instruments) mine.push(order[k]!);
      expect(mine, `instrument ${inst} gets two levels`).toHaveLength(2);
      const lowHalf = mine.filter((l) => l < n / 2).length;
      expect(lowHalf, `instrument ${inst} straddles the range, got levels ${mine.join(',')}`).toBe(1);
    }
  });

  it('is deterministic, because the session RNG is shared with the instruments', () => {
    // Drawing from config.rng here would change the target geometry a player sees.
    for (const n of [4, 8, 12]) {
      expect(coldStartOrder(n)).toEqual(coldStartOrder(n));
    }
  });

  it('degrades sanely at the edges', () => {
    expect(coldStartOrder(0)).toEqual([]);
    expect(coldStartOrder(1)).toEqual([0]);
    expect(coldStartOrder(2)).toEqual([0, 1]);
  });
});
