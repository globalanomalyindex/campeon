import { describe, it, expect } from 'vitest';
import { calibrateReducer, initialCalState, type CalState } from '../../src/ui/calibrate-flow';

describe('calibrateReducer', () => {
  const s0: CalState = initialCalState();

  it('guided start moves to the sweep', () => {
    expect(calibrateReducer(s0, { type: 'start-guided' }).step).toBe('sweep');
  });

  it('a clean sweep stores DPI and advances to the spin', () => {
    const s = calibrateReducer({ ...s0, step: 'sweep' }, { type: 'sweep-done', dpi: 1600, accelerated: false });
    expect(s.step).toBe('spin');
    expect(s.dpi).toBe(1600);
  });

  it('an accelerated sweep blocks', () => {
    expect(calibrateReducer({ ...s0, step: 'sweep' }, { type: 'sweep-done', dpi: 1600, accelerated: true }).step).toBe('blocked');
  });

  it('retry from blocked returns to the sweep and clears stale dpi', () => {
    const s = calibrateReducer({ ...s0, step: 'blocked', dpi: 1600 }, { type: 'retry' });
    expect(s.step).toBe('sweep');
    expect(s.dpi).toBeNull();
  });

  it('manual entry is reachable from intro and returns to it', () => {
    const m = calibrateReducer(s0, { type: 'start-manual' });
    expect(m.step).toBe('manual');
    expect(calibrateReducer(m, { type: 'back-to-intro' }).step).toBe('intro');
  });
});
