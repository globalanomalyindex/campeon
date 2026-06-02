import { describe, it, expect } from 'vitest';
import { perGameSens } from '../../src/convert/schools';

describe('per-game output (360-distance)', () => {
  const out = perGameSens(34, 800);
  it('emits a sens for every game', () => {
    expect(Object.keys(out).sort()).toEqual(
      ['apex', 'cod', 'cs2', 'fortnite', 'ow2', 'pubg', 'r6', 'valorant']
    );
  });
  it('matches the spec worked examples', () => {
    expect(out.valorant!).toBeCloseTo(0.480, 2);
    expect(out.cs2!).toBeCloseTo(1.528, 2);
    expect(out.ow2!).toBeCloseTo(5.09, 2);
    expect(out.fortnite!).toBeCloseTo(6.05, 2);
  });
});
