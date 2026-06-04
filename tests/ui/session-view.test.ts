// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { marksFromTrials, instructionFor, searchLabel } from '../../src/ui/session-view';
import type { TrialResult } from '../../src/types';

describe('session-view helpers', () => {
  it('frames the loop as evolution - gene-pool seeding, then numbered generations testing a sensitivity', () => {
    // The thesis ("generations of sensitivities") must be visible: cold-start trials are Generation 0
    // (the initial gene pool); after that each trial is a numbered generation testing one cm/360.
    expect(searchLabel(0, 18, 8)).toBe('gen 0 · seeding the gene pool · testing 18.0 cm/360');
    expect(searchLabel(8, 32.37, 8)).toBe('generation 1 · testing 32.4 cm/360');
    expect(searchLabel(11, 30, 8)).toBe('generation 4 · testing 30.0 cm/360');
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
