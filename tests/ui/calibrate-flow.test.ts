import { describe, it, expect } from 'vitest';
import { calibrateReducer, initialCalState, type CalState } from '../../src/ui/calibrate-flow';

describe('calibrateReducer', () => {
  const s0: CalState = initialCalState();

  it('guided start moves to the offer, and resets the offer answer', () => {
    const s = calibrateReducer({ ...s0, offerAccepted: true }, { type: 'start-guided' });
    expect(s.step).toBe('offer');
    expect(s.offerAccepted).toBe(false); // last run's answer must not silently pin this run's k
  });

  it('the offer resolves to the turn either way, recording only whether the pair was given', () => {
    const atOffer: CalState = { step: 'offer', blockReason: null, offerAccepted: false };
    expect(calibrateReducer(atOffer, { type: 'offer-accepted' }))
      .toEqual({ step: 'turn', blockReason: null, offerAccepted: true });
    expect(calibrateReducer(atOffer, { type: 'offer-skipped' }))
      .toEqual({ step: 'turn', blockReason: null, offerAccepted: false });
  });

  it('carries no measurement state: routing, a refusal reason and one yes/no', () => {
    // The old reducer ferried a dpi between the sweep and the spin. The unit chain is deleted, and
    // a reducer field holding a number is the first place a physical unit could quietly grow back.
    // offerAccepted is a routing choice (which pin route the commit takes), never a measured value:
    // the pair itself lives on the draft and the pin is computed at commit against the turn.
    expect(s0).toEqual({ step: 'intro', blockReason: null, offerAccepted: false });
  });

  it('a completed turn moves to the done step, where the spread is reported before committing', () => {
    const s = calibrateReducer({ step: 'turn', blockReason: null, offerAccepted: true }, { type: 'turn-complete' });
    expect(s.step).toBe('turn-done');
    expect(s.offerAccepted).toBe(true); // the commit still needs to know which pin route to take
  });

  it('an accel refusal from the turn blocks with the accel reason', () => {
    const s = calibrateReducer({ step: 'turn', blockReason: null, offerAccepted: false }, { type: 'turn-blocked', reason: 'accel' });
    expect(s.step).toBe('blocked');
    expect(s.blockReason).toBe('accel');
  });

  it('a spread refusal (four passes never settled) blocks with the spread reason', () => {
    const s = calibrateReducer({ step: 'turn', blockReason: null, offerAccepted: false }, { type: 'turn-blocked', reason: 'spread' });
    expect(s.step).toBe('blocked');
    expect(s.blockReason).toBe('spread');
  });

  it('retry from blocked returns to the turn, clears the reason and keeps the offer answer', () => {
    const blocked: CalState = { step: 'blocked', blockReason: 'accel', offerAccepted: true };
    expect(calibrateReducer(blocked, { type: 'retry' }))
      .toEqual({ step: 'turn', blockReason: null, offerAccepted: true });
  });

  it('manual entry is reachable from intro and returns to it', () => {
    const m = calibrateReducer(s0, { type: 'start-manual' });
    expect(m.step).toBe('manual');
    expect(calibrateReducer(m, { type: 'back-to-intro' }).step).toBe('intro');
  });
});
