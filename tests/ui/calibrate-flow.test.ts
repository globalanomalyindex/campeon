import { describe, it, expect } from 'vitest';
import { calibrateReducer, initialCalState, type CalAction, type CalState } from '../../src/ui/calibrate-flow';

describe('calibrateReducer', () => {
  const s0: CalState = initialCalState();
  const atSweep: CalState = { step: 'sweep', blockReason: null, blockedAt: null, offerAccepted: false };

  it('guided start moves to the sweep, and resets the offer answer', () => {
    const s = calibrateReducer({ ...s0, offerAccepted: true }, { type: 'start-guided' });
    expect(s.step).toBe('sweep');
    expect(s.offerAccepted).toBe(false); // last run's answer must not silently pin this run's k
  });

  it('a completed sweep hands off to the offer, then the turn', () => {
    const afterSweep = calibrateReducer(atSweep, { type: 'sweep-complete' });
    expect(afterSweep.step).toBe('offer');
    expect(calibrateReducer(afterSweep, { type: 'offer-skipped' }).step).toBe('turn');
  });

  it('the offer resolves to the turn either way, recording only whether the pair was given', () => {
    const atOffer: CalState = { step: 'offer', blockReason: null, blockedAt: null, offerAccepted: false };
    expect(calibrateReducer(atOffer, { type: 'offer-accepted' }))
      .toEqual({ step: 'turn', blockReason: null, blockedAt: null, offerAccepted: true });
    expect(calibrateReducer(atOffer, { type: 'offer-skipped' }))
      .toEqual({ step: 'turn', blockReason: null, blockedAt: null, offerAccepted: false });
  });

  it('carries no measurement state, even with the card back', () => {
    // The old reducer ferried a dpi between the sweep and the spin, and the sweep is back, so this
    // is the assertion that has to hold again: routing, a refusal reason, where it refused, and one
    // yes/no. The measured DPI is held by the screen until the player accepts the reading, exactly
    // as the turn's estimate is. offerAccepted is a routing choice (which pin route the commit
    // takes), never a measured value.
    expect(s0).toEqual({ step: 'intro', blockReason: null, blockedAt: null, offerAccepted: false });
    const walked = ([
      { type: 'start-guided' }, { type: 'sweep-complete' }, { type: 'offer-accepted' },
      { type: 'turn-complete' },
    ] as CalAction[]).reduce(calibrateReducer, s0);
    expect(Object.keys(walked).sort()).toEqual(['blockReason', 'blockedAt', 'offerAccepted', 'step']);
    for (const v of Object.values(walked)) expect(typeof v).not.toBe('number');
  });

  it('a completed turn moves to the done step, where the spread is reported before committing', () => {
    const atTurn: CalState = { step: 'turn', blockReason: null, blockedAt: null, offerAccepted: true };
    const s = calibrateReducer(atTurn, { type: 'turn-complete' });
    expect(s.step).toBe('turn-done');
    expect(s.offerAccepted).toBe(true); // the commit still needs to know which pin route to take
  });

  it.each(['accel', 'invalid'] as const)('a sweep refusal (%s) blocks and remembers it was the sweep', (reason) => {
    const s = calibrateReducer(atSweep, { type: 'sweep-blocked', reason });
    expect(s.step).toBe('blocked');
    expect(s.blockReason).toBe(reason);
    expect(s.blockedAt).toBe('sweep');
  });

  it.each(['accel', 'spread'] as const)('a turn refusal (%s) blocks and remembers it was the turn', (reason) => {
    const atTurn: CalState = { step: 'turn', blockReason: null, blockedAt: null, offerAccepted: false };
    const s = calibrateReducer(atTurn, { type: 'turn-blocked', reason });
    expect(s.step).toBe('blocked');
    expect(s.blockReason).toBe(reason);
    expect(s.blockedAt).toBe('turn');
  });

  it('retry returns to the step that refused, not to a fixed one', () => {
    // 'accel' reaches the blocked screen from either instrument's fast pass, so the reason cannot
    // route the retry. A blocked sweep sent on to the turn would skip the card without saying so.
    const sweepBlocked: CalState = { step: 'blocked', blockReason: 'accel', blockedAt: 'sweep', offerAccepted: true };
    expect(calibrateReducer(sweepBlocked, { type: 'retry' }))
      .toEqual({ step: 'sweep', blockReason: null, blockedAt: null, offerAccepted: true });
    const turnBlocked: CalState = { step: 'blocked', blockReason: 'accel', blockedAt: 'turn', offerAccepted: true };
    expect(calibrateReducer(turnBlocked, { type: 'retry' }))
      .toEqual({ step: 'turn', blockReason: null, blockedAt: null, offerAccepted: true });
  });

  it('retry from the spread report redoes the turn, keeping the offer answer', () => {
    const done: CalState = { step: 'turn-done', blockReason: null, blockedAt: null, offerAccepted: true };
    expect(calibrateReducer(done, { type: 'retry' }))
      .toEqual({ step: 'turn', blockReason: null, blockedAt: null, offerAccepted: true });
  });

  it('manual entry is reachable from intro and returns to it', () => {
    const m = calibrateReducer(s0, { type: 'start-manual' });
    expect(m.step).toBe('manual');
    expect(calibrateReducer(m, { type: 'back-to-intro' }).step).toBe('intro');
  });
});
