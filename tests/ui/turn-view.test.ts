// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  initialTurnMachine, turnTap, turnDirection,
  MIN_PASS_COUNTS, NATURAL_PASSES, type TurnMachine,
} from '../../src/ui/calibrate/turn-view';

/** One entry per completed pass: the first tap arms recording, the second finishes it at `c`. */
function runPasses(m: TurnMachine, passCounts: number[], mode: 'raw' | 'os-adjusted'): TurnMachine {
  let s = m;
  for (const c of passCounts) {
    s = turnTap(s, 0, mode); // arm: counts are ignored on a non-recording tap
    s = turnTap(s, c, mode); // finish
  }
  return s;
}

describe('turn machine: the pass loop', () => {
  it('starts idle with no passes and no verdict', () => {
    expect(initialTurnMachine()).toEqual({ phase: 'idle', passes: [], estimate: null, blockReason: null });
  });

  it('alternates direction right-left-right-left, so asymmetry cancels instead of averaging in', () => {
    expect([0, 1, 2, 3].map(turnDirection)).toEqual(['right', 'left', 'right', 'left']);
  });

  it('an arming tap starts recording and commits nothing, whatever counts ride along', () => {
    const s = turnTap(initialTurnMachine(), 999999, 'raw');
    expect(s.phase).toBe('recording');
    expect(s.passes).toEqual([]);
  });

  it('a finishing tap below the floor is an accidental click: ignored, the pass stays live', () => {
    const recording = turnTap(initialTurnMachine(), 0, 'raw');
    const after = turnTap(recording, MIN_PASS_COUNTS - 1, 'raw');
    expect(after).toBe(recording); // identity, so the shell can detect the refusal and explain it
  });
});

describe('turn machine: verdicts', () => {
  it('three agreeing passes on raw input complete without a fast pass', () => {
    // Raw pointer input bypasses OS acceleration at the source; demanding a probe pass anyway
    // would be theater.
    const s = runPasses(initialTurnMachine(), [8000, 8100, 8050], 'raw');
    expect(s.phase).toBe('done');
    expect(s.estimate!.agreed).toBe(true);
    expect(s.estimate!.passes).toBe(NATURAL_PASSES);
    const geo = Math.exp((Math.log(8000) + Math.log(8100) + Math.log(8050)) / 3);
    expect(s.estimate!.counts).toBeCloseTo(geo, 6);
  });

  it('three agreeing passes on os-adjusted input demand the deliberately fast pass', () => {
    const s = runPasses(initialTurnMachine(), [8000, 8100, 8050], 'os-adjusted');
    expect(s.phase).toBe('fast-idle');
  });

  it('an honest fast pass completes; the estimate stays the natural passes own, untouched', () => {
    let s = runPasses(initialTurnMachine(), [8000, 8100, 8050], 'os-adjusted');
    const before = s.estimate!.counts;
    s = turnTap(s, 0, 'os-adjusted');       // arm the fast pass
    s = turnTap(s, 8020, 'os-adjusted');    // same full turn, just faster: totals match
    expect(s.phase).toBe('done');
    expect(s.estimate!.counts).toBe(before); // the probe verifies, it never shades the number
  });

  it('an accelerated fast pass blocks rather than shading the number', () => {
    let s = runPasses(initialTurnMachine(), [8000, 8100, 8050], 'os-adjusted');
    s = turnTap(s, 0, 'os-adjusted');
    s = turnTap(s, 12000, 'os-adjusted'); // ~1.5x the slow total: OS accel inflated the fast turn
    expect(s.phase).toBe('blocked');
    expect(s.blockReason).toBe('accel');
  });

  it('three disagreeing passes offer a fourth rather than failing or averaging', () => {
    const s = runPasses(initialTurnMachine(), [8000, 8000, 10000], 'raw');
    expect(s.phase).toBe('fourth-offer');
    expect(s.estimate!.agreed).toBe(false);
  });

  it('the fourth pass isolates the odd one out and completes', () => {
    let s = runPasses(initialTurnMachine(), [8000, 8000, 10000], 'raw');
    s = turnTap(s, 0, 'raw');    // accept the offer
    s = turnTap(s, 8050, 'raw'); // the fourth agrees with the first two
    expect(s.phase).toBe('done');
    expect(s.estimate!.passes).toBe(3); // turnFromPasses dropped the outlier
  });

  it('a fourth pass that still cannot settle blocks with the spread reason', () => {
    let s = runPasses(initialTurnMachine(), [8000, 9500, 11000], 'raw');
    expect(s.phase).toBe('fourth-offer');
    s = turnTap(s, 0, 'raw');
    s = turnTap(s, 6500, 'raw');
    expect(s.phase).toBe('blocked');
    expect(s.blockReason).toBe('spread');
  });

  it('done and blocked absorb further taps: nothing after the verdict moves the number', () => {
    const done = runPasses(initialTurnMachine(), [8000, 8100, 8050], 'raw');
    expect(turnTap(done, 5000, 'raw')).toBe(done);
  });
});
