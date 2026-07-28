import { describe, it, expect } from 'vitest';
import { GAME_YAW, yawFor } from '../../src/convert/yaw-table';
import { sensFor, countsForSens } from '../../src/convert/counts';
import { counts360 } from '../../src/types';
import type { GameId } from '../../src/types';

describe('yaw table', () => {
  it('has all eight supported games', () => {
    expect(GAME_YAW.map(g => g.id).sort()).toEqual(
      ['apex', 'cod', 'cs2', 'fortnite', 'ow2', 'pubg', 'r6', 'valorant']
    );
  });
  it('has the verified constants', () => {
    expect(yawFor('cs2')).toBe(0.022);
    expect(yawFor('apex')).toBe(0.022);
    expect(yawFor('valorant')).toBe(0.07);
    expect(yawFor('ow2')).toBe(0.0066);
    expect(yawFor('cod')).toBe(0.0066);
    expect(yawFor('fortnite')).toBe(0.005555);
    expect(yawFor('r6')).toBe(0.00573);
    expect(yawFor('pubg')).toBe(0.002222);
  });
  it('throws on an unknown game id', () => {
    expect(() => yawFor('unknown' as GameId)).toThrow('Unknown game: unknown');
  });
  it('round-trips counts → sens → counts for every game', () => {
    // The round trip is now DPI-free in both directions, which is the whole point of the unit
    // change: sens = 360 / (yaw * counts) and its inverse never mention a physical length.
    const counts = counts360(10800); // 34 cm at 800 DPI, for anyone reading this against the old test
    for (const g of GAME_YAW) {
      const sens = sensFor(counts, g.yaw);
      expect(countsForSens(sens, g.yaw)).toBeCloseTo(counts, 6);
    }
  });
});
