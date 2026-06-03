// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { marksFromTrials, instructionFor, searchLabel } from '../../src/ui/session-view';
import type { TrialResult } from '../../src/types';

describe('session-view helpers', () => {
  it('surfaces the sensitivity the search is handing you this trial (not just a trial counter)', () => {
    // The loop's whole point — "iteratively giving you new sensitivities" — must be visible: each
    // trial announces the cm/360 being tested, to 1 decimal, alongside the progress count.
    expect(searchLabel(8, 24, 32.37)).toBe('trial 9 / 24 · testing 32.4 cm/360');
    expect(searchLabel(0, 24, 18)).toBe('trial 1 / 24 · testing 18.0 cm/360');
  });

  it('maps trials to plot marks preserving cm360/score/instrument', () => {
    const trials: TrialResult[] = [
      { instrument: 'flick', cm360: 30, score: 0.4, raw: {}, at: 0 },
      { instrument: 'track', cm360: 42, score: -0.1, raw: {}, at: 0 },
    ];
    expect(marksFromTrials(trials)).toEqual([
      { cm360: 30, score: 0.4, instrument: 'flick' },
      { cm360: 42, score: -0.1, instrument: 'track' },
    ]);
  });

  it('gives each instrument human instruction copy that names its organism', () => {
    expect(instructionFor('track').toLowerCase()).toMatch(/track|dragonfly|falcon/);
    expect(instructionFor('flick').toLowerCase()).toMatch(/flick|spider|snap/);
    expect(instructionFor('calibrate').toLowerCase()).toMatch(/calibrat|archerfish|bias/);
    expect(instructionFor('strike').toLowerCase()).toMatch(/strike|shrimp|fast/);
  });
});
