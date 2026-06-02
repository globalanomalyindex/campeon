import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../../src/stats/rng';
import { mulberry32 as viaBootstrap } from '../../src/stats/bootstrap';

describe('mulberry32', () => {
  it('is deterministic and in [0,1)', () => {
    const r = mulberry32(42);
    const seq = [r(), r(), r()];
    for (const v of seq) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    const r2 = mulberry32(42);
    expect([r2(), r2(), r2()]).toEqual(seq);
  });

  it('different seeds give different streams', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('bootstrap re-exports the same implementation (sequence preserved)', () => {
    const a = mulberry32(7);
    const b = viaBootstrap(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
