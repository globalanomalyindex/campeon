import { describe, it, expect } from 'vitest';
import { segment, type VelSample } from '../../src/scoring/submovement';

// Gaussian speed bump helper (deg/s) sampled every `step` ms over [0, end].
function bumps(peaks: Array<{ mu: number; sigma: number; amp: number }>, end = 700, step = 5): VelSample[] {
  const out: VelSample[] = [];
  for (let t = 0; t <= end; t += step) {
    let speed = 0;
    for (const p of peaks) speed += p.amp * Math.exp(-((t - p.mu) ** 2) / (2 * p.sigma * p.sigma));
    out.push({ t, speed });
  }
  return out;
}

describe('segment', () => {
  it('a single smooth reach has no corrective sub-movements', () => {
    const trace = bumps([{ mu: 250, sigma: 45, amp: 600 }]);
    const s = segment(trace, { onsetThresh: 30 });
    expect(s.nCorr).toBe(0);
    expect(s.vPeak).toBeCloseTo(600, -1);
    expect(s.tD).toBeGreaterThan(0);
    expect(s.tD).toBeLessThan(250);
    expect(s.onsetTime).toBeCloseTo(s.tD, 9);
  });

  it('counts one correction for a primary reach + one secondary bump', () => {
    const trace = bumps([
      { mu: 200, sigma: 40, amp: 600 },
      { mu: 430, sigma: 35, amp: 220 },
    ]);
    const s = segment(trace, { onsetThresh: 30 });
    expect(s.nCorr).toBe(1);
    expect(s.tO).toBeGreaterThan(0);
  });

  it('counts two corrections for three bumps', () => {
    const trace = bumps([
      { mu: 180, sigma: 35, amp: 600 },
      { mu: 360, sigma: 30, amp: 250 },
      { mu: 520, sigma: 30, amp: 150 },
    ]);
    const s = segment(trace, { onsetThresh: 30 });
    expect(s.nCorr).toBe(2);
  });

  it('measures detection latency from a non-zero cue time', () => {
    const trace = bumps([{ mu: 300, sigma: 40, amp: 500 }]);
    const s = segment(trace, { onsetThresh: 30, cueTime: 100 });
    expect(s.onsetTime).toBeGreaterThan(100);
    expect(s.tD).toBeCloseTo(s.onsetTime - 100, 9);
  });

  it('throws when movement never crosses the onset threshold', () => {
    const flat = bumps([{ mu: 300, sigma: 40, amp: 10 }]);
    expect(() => segment(flat, { onsetThresh: 30 })).toThrow(RangeError);
  });
});
