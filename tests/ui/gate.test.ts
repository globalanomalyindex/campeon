// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { gateReducer, type GateState } from '../../src/ui/gate';

describe('gateReducer', () => {
  const start: GateState = { step: 'intro', mode: null, slow: 0, fast: 0, blocked: false };

  it('advances to accel after a lock is granted, recording the mode', () => {
    const s = gateReducer(start, { type: 'locked', mode: 'raw' });
    expect(s.step).toBe('accel');
    expect(s.mode).toBe('raw');
  });

  it('blocks when slow/fast swipe totals differ by more than 10%', () => {
    const s = gateReducer({ ...start, step: 'accel' }, { type: 'accel', slow: 1000, fast: 1200 });
    expect(s.blocked).toBe(true);
    expect(s.step).toBe('blocked');
  });

  it('reaches ready when acceleration is within tolerance', () => {
    const s = gateReducer({ ...start, step: 'accel' }, { type: 'accel', slow: 1000, fast: 1040 });
    expect(s.blocked).toBe(false);
    expect(s.step).toBe('ready');
  });

  it('retry from blocked returns to the accel step', () => {
    const s = gateReducer({ ...start, step: 'blocked', blocked: true }, { type: 'retry' });
    expect(s.step).toBe('accel');
    expect(s.blocked).toBe(false);
  });
});
