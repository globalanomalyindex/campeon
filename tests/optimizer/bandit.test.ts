import { describe, it, expect } from 'vitest';
import { makeUcb1Bandit } from '../../src/optimizer/bandit';
import type { Observation } from '../../src/types';

const bounds: [number, number] = [15, 60];
const arms = [16, 24, 32, 44, 58];

describe('makeUcb1Bandit', () => {
  it('plays each unplayed arm once before repeating', () => {
    const b = makeUcb1Bandit({ arms });
    const hist: Observation[] = [];
    const picks: number[] = [];
    for (let i = 0; i < arms.length; i++) {
      const s = b.suggest(hist, bounds);
      picks.push(s);
      hist.push({ x: Math.log(s), y: 0 });
    }
    expect([...picks].sort((a, c) => a - c)).toEqual([...arms].sort((a, c) => a - c));
  });

  it('favors the arm with the best observed mean once all are played', () => {
    const b = makeUcb1Bandit({ arms });
    const hist: Observation[] = [];
    for (const a of arms) {
      const y = a === 32 ? 10 : 0;
      hist.push({ x: Math.log(a), y });
      hist.push({ x: Math.log(a), y });
    }
    expect(b.suggest(hist, bounds)).toBe(32);
  });

  it('maps observations to the nearest arm', () => {
    const b = makeUcb1Bandit({ arms });
    const hist: Observation[] = [];
    for (const a of arms) {
      hist.push({ x: Math.log(a), y: 0 });
      hist.push({ x: Math.log(a), y: 0 });
    }
    hist.push({ x: Math.log(33), y: 100 }); // nearest arm is 32
    expect(b.suggest(hist, bounds)).toBe(32);
  });

  it('isDone at the pull budget', () => {
    const b = makeUcb1Bandit({ arms, maxPulls: 6 });
    expect(b.isDone(new Array<Observation>(5).fill({ x: 0, y: 0 }))).toBe(false);
    expect(b.isDone(new Array<Observation>(6).fill({ x: 0, y: 0 }))).toBe(true);
  });
});
