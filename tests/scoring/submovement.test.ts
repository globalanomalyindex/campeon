import { describe, it, expect } from 'vitest';
import { segment, ONSET_COUNTS_PER_SEC, type CountSample } from '../../src/scoring/submovement';

/** Gaussian speed bumps in COUNTS PER SECOND, sampled every `step` ms over [0, end]. */
function bumps(peaks: Array<{ mu: number; sigma: number; amp: number }>, end = 700, step = 5): CountSample[] {
  const out: CountSample[] = [];
  for (let t = 0; t <= end; t += step) {
    let countsPerSec = 0;
    for (const p of peaks) countsPerSec += p.amp * Math.exp(-((t - p.mu) ** 2) / (2 * p.sigma * p.sigma));
    out.push({ t, countsPerSec });
  }
  return out;
}

describe('segment', () => {
  it('a single smooth reach has no corrective sub-movements', () => {
    const trace = bumps([{ mu: 250, sigma: 45, amp: 18000 }]);
    const s = segment(trace, { onsetThresh: 900 });
    expect(s.nCorr).toBe(0);
    expect(s.vPeak).toBeCloseTo(18000, -1);
    expect(s.tD).toBeGreaterThan(0);
    expect(s.tD).toBeLessThan(250);
    expect(s.onsetTime).toBeCloseTo(s.tD, 9);
  });

  it('counts one correction for a primary reach + one secondary bump', () => {
    const trace = bumps([
      { mu: 200, sigma: 40, amp: 18000 },
      { mu: 430, sigma: 35, amp: 6600 },
    ]);
    const s = segment(trace, { onsetThresh: 900 });
    expect(s.nCorr).toBe(1);
    expect(s.tO).toBeGreaterThan(0);
  });

  it('counts two corrections for three bumps', () => {
    const trace = bumps([
      { mu: 180, sigma: 35, amp: 18000 },
      { mu: 360, sigma: 30, amp: 7500 },
      { mu: 520, sigma: 30, amp: 4500 },
    ]);
    expect(segment(trace, { onsetThresh: 900 }).nCorr).toBe(2);
  });

  it('measures detection latency from a non-zero cue time', () => {
    const trace = bumps([{ mu: 300, sigma: 40, amp: 15000 }]);
    const s = segment(trace, { onsetThresh: 900, cueTime: 100 });
    expect(s.onsetTime).toBeGreaterThan(100);
    expect(s.tD).toBeCloseTo(s.onsetTime - 100, 9);
  });

  it('throws when movement never crosses the onset threshold', () => {
    const flat = bumps([{ mu: 300, sigma: 40, amp: 300 }]);
    expect(() => segment(flat, { onsetThresh: 900 })).toThrow(RangeError);
  });

  it('the default threshold is the count-space one, and it is not 30 of anything', () => {
    // The old default was 30 deg/s, which is 30 * counts360 / 360 counts/s - a different number at
    // every gain the optimiser renders. The default is now a property of the hand.
    expect(ONSET_COUNTS_PER_SEC).toBe(600);
    const trace = bumps([{ mu: 250, sigma: 45, amp: 18000 }]);
    expect(segment(trace).onsetTime).toBe(segment(trace, { onsetThresh: ONSET_COUNTS_PER_SEC }).onsetTime);
  });
});

describe('troughDrop: the primary orient must not be ended by one jittery frame', () => {
  // A 60 Hz unsmoothed difference trace, hand written so every branch is forced. The frame at
  // t = 48 is a single-frame dip inside the acceleration ramp: it is BOTH a strict local maximum
  // at t = 32 and a strict local minimum at t = 48.
  const jitter: CountSample[] = [
    { t: 0, countsPerSec: 0 },
    { t: 16, countsPerSec: 1200 },
    { t: 32, countsPerSec: 3000 },
    { t: 48, countsPerSec: 2800 },
    { t: 64, countsPerSec: 6000 },
    { t: 80, countsPerSec: 9000 },
    { t: 96, countsPerSec: 5000 },
    { t: 112, countsPerSec: 1500 },
    { t: 128, countsPerSec: 2500 },
    { t: 144, countsPerSec: 900 },
    { t: 160, countsPerSec: 200 },
  ];

  it('the default is byte-identical to the pre-existing rule, jitter and all', () => {
    // The scored instruments were tuned against this rule. Changing it here would move nCorr and
    // tO for flick and strike, which is a retune wearing a bug fix as a costume.
    const s = segment(jitter, { onsetThresh: 600 });
    expect(s.onsetTime).toBe(16);
    expect(s.troughTime).toBe(48);
    expect(s.tO).toBe(32);
    expect(s.vPeak).toBe(3000);
    expect(s.nCorr).toBe(2);
  });

  it('troughDrop 0.5 walks past the jitter to the real end of the primary orient', () => {
    const s = segment(jitter, { onsetThresh: 600, troughDrop: 0.5 });
    expect(s.troughTime).toBe(112);
    expect(s.tO).toBe(96);
    expect(s.nCorr).toBe(1);
    // vPeak keeps its first-local-maximum meaning so strike's diagnostic does not move.
    expect(s.vPeak).toBe(3000);
  });
});
