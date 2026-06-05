import { describe, it, expect } from 'vitest';
import { calibrateReducer, initialCalState, type CalState } from '../../src/ui/calibrate-flow';

describe('calibrateReducer', () => {
  const s0: CalState = initialCalState();

  it('guided start moves to the sweep', () => {
    expect(calibrateReducer(s0, { type: 'start-guided' }).step).toBe('sweep');
  });

  it('a clean sweep stores DPI and advances to the spin (no block reason)', () => {
    const s = calibrateReducer({ ...s0, step: 'sweep' }, { type: 'sweep-done', dpi: 1600, accelerated: false });
    expect(s.step).toBe('spin');
    expect(s.dpi).toBe(1600);
    expect(s.blockReason).toBeNull();
  });

  it('an accelerated sweep blocks with the accel reason', () => {
    const s = calibrateReducer({ ...s0, step: 'sweep' }, { type: 'sweep-done', dpi: 1600, accelerated: true });
    expect(s.step).toBe('blocked');
    expect(s.blockReason).toBe('accel');
  });

  it('an invalid sweep blocks with the invalid reason (a too-short/uneven pass, NOT acceleration)', () => {
    const s = calibrateReducer({ ...s0, step: 'sweep' }, { type: 'sweep-invalid' });
    expect(s.step).toBe('blocked');
    expect(s.blockReason).toBe('invalid');
    expect(s.dpi).toBeNull();
  });

  it('retry from blocked returns to the sweep and clears stale dpi + reason', () => {
    const s = calibrateReducer({ ...s0, step: 'blocked', dpi: 1600, blockReason: 'accel' }, { type: 'retry' });
    expect(s.step).toBe('sweep');
    expect(s.dpi).toBeNull();
    expect(s.blockReason).toBeNull();
  });

  it('manual entry is reachable from intro and returns to it', () => {
    const m = calibrateReducer(s0, { type: 'start-manual' });
    expect(m.step).toBe('manual');
    expect(calibrateReducer(m, { type: 'back-to-intro' }).step).toBe('intro');
  });
});
