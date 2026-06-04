import { describe, it, expect } from 'vitest';
import { calibrateReducer, initialCalState, type CalState } from '../../src/ui/calibrate-flow';

describe('calibrateReducer', () => {
  const s0: CalState = initialCalState();

  it('guided start stores pad width and moves to the sweep', () => {
    const s = calibrateReducer(s0, { type: 'start-guided', padWidthCm: 40 });
    expect(s.step).toBe('sweep');
    expect(s.padWidthCm).toBe(40);
  });

  it('a clean sweep stores DPI and advances to the turn', () => {
    const s = calibrateReducer({ ...s0, step: 'sweep', padWidthCm: 40 },
      { type: 'sweep-done', dpi: 1600, accelerated: false });
    expect(s.step).toBe('turn');
    expect(s.dpi).toBe(1600);
  });

  it('an accelerated sweep blocks', () => {
    const s = calibrateReducer({ ...s0, step: 'sweep' },
      { type: 'sweep-done', dpi: 1600, accelerated: true });
    expect(s.step).toBe('blocked');
  });

  it('retry from blocked returns to the sweep', () => {
    const s = calibrateReducer({ ...s0, step: 'blocked' }, { type: 'retry' });
    expect(s.step).toBe('sweep');
  });

  it('the turn stores the seed and advances to the game pick', () => {
    const s = calibrateReducer({ ...s0, step: 'turn', dpi: 800 },
      { type: 'turn-done', seedCm360: 28.5 });
    expect(s.step).toBe('game');
    expect(s.seedCm360).toBeCloseTo(28.5, 6);
  });

  it('manual entry is reachable from intro and returns to it', () => {
    const m = calibrateReducer(s0, { type: 'start-manual' });
    expect(m.step).toBe('manual');
    expect(calibrateReducer(m, { type: 'back-to-intro' }).step).toBe('intro');
  });
});
