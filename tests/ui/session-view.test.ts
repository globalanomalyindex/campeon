// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { marksFromTrials, instructionFor } from '../../src/ui/session-view';
import type { TrialResult } from '../../src/types';

describe('session-view helpers', () => {
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
