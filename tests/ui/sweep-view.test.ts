import { describe, it, expect } from 'vitest';
import {
  initialSweepMachine, sweepTap, MIN_PASS_COUNTS, SLOW_PASSES, type SweepMachine,
} from '../../src/ui/calibrate/sweep-view';
import { CARD_WIDTH_CM, dpiFromSweep } from '../../src/input/dpi-sweep';
import { accelVerdict } from '../../src/input/accel-check';

/** Net counts a sweep across the ID-1 card produces at a given measured DPI. */
const countsFor = (dpi: number): number => (CARD_WIDTH_CM / 2.54) * dpi;

/** One entry per completed pass: the first tap arms, the second finishes it at `c`. */
function runPasses(m: SweepMachine, passCounts: number[], mode: 'raw' | 'os-adjusted'): SweepMachine {
  let s = m;
  for (const c of passCounts) {
    s = sweepTap(s, 0, mode, CARD_WIDTH_CM);
    s = sweepTap(s, c, mode, CARD_WIDTH_CM);
  }
  return s;
}

describe('sweep machine: the pass loop', () => {
  it('starts idle with no passes and no reading', () => {
    expect(initialSweepMachine())
      .toEqual({ phase: 'idle-slow', passes: [], result: null, blockReason: null, spreadPct: null });
  });

  it('an arming tap starts a pass and commits nothing, whatever counts ride along', () => {
    const s = sweepTap(initialSweepMachine(), 999999, 'raw', CARD_WIDTH_CM);
    expect(s.phase).toBe('slow');
    expect(s.passes).toEqual([]);
  });

  it('a finishing tap below the floor is an accidental click: ignored, the pass stays live', () => {
    const live = sweepTap(initialSweepMachine(), 0, 'raw', CARD_WIDTH_CM);
    const after = sweepTap(live, MIN_PASS_COUNTS - 1, 'raw', CARD_WIDTH_CM);
    expect(after).toBe(live); // identity, so the shell can detect the refusal and explain it
  });

  it('asks for a second slow pass before committing anything', () => {
    const s = runPasses(initialSweepMachine(), [countsFor(1600)], 'raw');
    expect(SLOW_PASSES).toBe(2);
    expect(s.phase).toBe('idle-slow');
    expect(s.result).toBeNull();
  });
});

describe('sweep machine: verdicts', () => {
  it('two agreeing passes on raw input commit the combined reading, with no quick pass', () => {
    // Raw pointer input bypasses OS acceleration at the source, so demanding a probe pass would be
    // theater. Same call the turn makes.
    const s = runPasses(initialSweepMachine(), [countsFor(1590), countsFor(1610)], 'raw');
    expect(s.phase).toBe('done');
    expect(s.result!.accelerated).toBe(false);
    expect(s.result!.dpi).toBeCloseTo(1600, 6);
    expect(s.spreadPct).toBeGreaterThan(0); // the consistency indicator, never a CI on the reading
  });

  it('a browser without raw input earns the quick cross-check pass', () => {
    const slow = runPasses(initialSweepMachine(), [countsFor(1600), countsFor(1600)], 'os-adjusted');
    expect(slow.phase).toBe('idle-fast');
    expect(slow.result).toBeNull(); // nothing is committed while the check is outstanding
    const done = runPasses(slow, [countsFor(1600)], 'os-adjusted');
    expect(done.phase).toBe('done');
    expect(done.result!.dpi).toBeCloseTo(1600, 6);
  });

  it('a quick pass that ran materially longer blocks for acceleration', () => {
    const slow = runPasses(initialSweepMachine(), [countsFor(1600), countsFor(1600)], 'os-adjusted');
    const s = runPasses(slow, [countsFor(1600) * 1.6], 'os-adjusted');
    expect(s.phase).toBe('blocked');
    expect(s.blockReason).toBe('accel');
    expect(s.result).toBeNull();
  });

  it('the tolerance is the card\'s, not the mousepad\'s, so honest short sweeps are not false-flagged', () => {
    // The defect the widener exists for: on an 8.56 cm card, ordinary edge-alignment slop is a large
    // fraction of the sweep, and the 10 percent default built for a 40 cm pad blocks honest runs.
    const slop = 1.15;
    expect(accelVerdict(countsFor(1600), countsFor(1600) * slop).accelerated).toBe(true); // at the default
    const slow = runPasses(initialSweepMachine(), [countsFor(1600), countsFor(1600)], 'os-adjusted');
    const s = runPasses(slow, [countsFor(1600) * slop], 'os-adjusted');
    expect(s.phase).toBe('done'); // and not at the card's
  });

  it('passes that disagree refuse, carrying the spread the copy has to name', () => {
    const s = runPasses(initialSweepMachine(), [countsFor(1400), countsFor(1800)], 'raw');
    expect(s.phase).toBe('blocked');
    expect(s.blockReason).toBe('invalid');
    expect(s.spreadPct).toBeGreaterThan(20);
    expect(s.result).toBeNull(); // a disagreement is never averaged into a committed number
  });

  it('a reading no mouse produces refuses instead of committing', () => {
    // Two short sweeps that agree perfectly with each other and with nothing else: agreement alone
    // cannot make a number real, so the plausible band is checked as well.
    const short = 200; // over the accidental-click floor, far under a card's worth of counts
    expect(dpiFromSweep(short, CARD_WIDTH_CM)).toBeLessThan(100);
    const s = runPasses(initialSweepMachine(), [short, short], 'raw');
    expect(s.phase).toBe('blocked');
    expect(s.blockReason).toBe('invalid');
  });

  it('terminal states absorb input: nothing after the verdict may move the number', () => {
    const done = runPasses(initialSweepMachine(), [countsFor(1600), countsFor(1600)], 'raw');
    expect(sweepTap(done, countsFor(9000), 'raw', CARD_WIDTH_CM)).toBe(done);
    const blocked = runPasses(initialSweepMachine(), [countsFor(1400), countsFor(1800)], 'raw');
    expect(sweepTap(blocked, countsFor(1600), 'raw', CARD_WIDTH_CM)).toBe(blocked);
  });

  it('the reference width is the caller\'s, and the reading scales with it', () => {
    // The machine holds no standard of its own: the flow names the width it is holding the player
    // to, so a sweep across something other than an ID-1 card is a different call site and not a
    // silently wrong reading.
    const pad = 40;
    let s = sweepTap(initialSweepMachine(), 0, 'raw', pad);
    s = sweepTap(s, (pad / 2.54) * 800, 'raw', pad);
    s = sweepTap(s, 0, 'raw', pad);
    s = sweepTap(s, (pad / 2.54) * 800, 'raw', pad);
    expect(s.phase).toBe('done');
    expect(s.result!.dpi).toBeCloseTo(800, 6);
  });
});
