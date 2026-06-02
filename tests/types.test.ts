import { describe, it, expect } from 'vitest';
import type { Cm360, GameId, TrialResult, YawEntry } from '../src/types';

describe('types', () => {
  it('contract objects are constructible', () => {
    const cm: Cm360 = 34;
    const game: GameId = 'valorant';
    const yaw: YawEntry = { id: game, label: 'Valorant', yaw: 0.07 };
    const trial: TrialResult = { instrument: 'track', cm360: cm, score: 0.8, raw: { eLead: 1.2 }, at: 0 };
    expect(yaw.yaw).toBe(0.07);
    expect(trial.instrument).toBe('track');
  });
});
