import { describe, it, expect } from 'vitest';
import { counts360, countsBounds } from '../src/types';
import type { Counts360, GameId, TrialResult, YawEntry } from '../src/types';

describe('types', () => {
  it('contract objects are constructible', () => {
    const game: GameId = 'valorant';
    const yaw: YawEntry = { id: game, label: 'Valorant', yaw: 0.07 };
    const trial: TrialResult = { instrument: 'track', counts: counts360(8240), score: 0.8, raw: { eLead: 1.2 }, at: 0 };
    expect(yaw.yaw).toBe(0.07);
    expect(trial.instrument).toBe('track');
  });
});

describe('Counts360, the branded unit', () => {
  it('brands without touching the number', () => {
    expect(counts360(8240)).toBe(8240);
    expect(countsBounds(4800, 19200)).toEqual([4800, 19200]);
  });

  it('refuses a bare number where a count total is required', () => {
    // The defect the brand exists to catch. While the unit was `type Counts360 = number` the compiler
    // had no way to tell 34 (centimetres) from 8240 (counts), so a migration that changed the
    // MEANING of the parameter would have compiled everywhere and reported wrong numbers silently.
    // This directive is the assertion: if the brand is ever weakened back to a bare alias, tsc
    // reports TS2578 for an unused @ts-expect-error and `npm run build` fails.
    // @ts-expect-error a bare number is not a count total
    const bare: Counts360 = 8240;
    expect(bare).toBe(8240);
  });

  it('widens back to number under arithmetic, so a derived total must be re-branded on purpose', () => {
    const lo = counts360(4800);
    const doubled: number = lo * 2; // arithmetic on a branded number yields a plain number
    expect(doubled).toBe(9600);
    expect(counts360(doubled)).toBe(9600);
  });
});
