import { describe, it, expect } from 'vitest';
import { makeEvolution } from '../../src/optimizer/evolution';
import { finalizeReport } from '../../src/optimizer/session-controller';
import { mulberry32 } from '../../src/stats/bootstrap';
import type { Observation } from '../../src/types';

/**
 * The allocator has to LOCATE a peak, not merely search well.
 *
 * A session whose fitted vertex lands outside the searched band reports a bound rather than an
 * optimum, which is honest but useless to the player. A naive optimum-seeking allocator, which
 * concentrates its trials near the running best, fails that way about 23 percent of the time in
 * simulation, because a design clustered around one point cannot pin the curvature that the vertex
 * estimate divides by. The local c-optimality vertex screen in `evolution.ts` exists to spread the
 * design against exactly that, and this test pins the win so it cannot regress quietly.
 *
 * It also stands as the evidence against band-edge reservation. Reserving part of the budget for
 * pinned edge points was proposed as a precision fix and measured here first: it leaves the centred
 * case unchanged and drives the off-centre failure rate from 6.5 percent to 14.5 percent at a 30
 * percent reservation, because the band is centred on the player's habit rather than their optimum,
 * so edge trials are spent away from the peak. The proposal was withdrawn on these numbers.
 */

const CURVATURE = -1.0;
const NOISE = 0.35;
const TRIALS = 30;
const COLD = 4;
const REPS = 120;

/** One simulated session against the real engine, with the truth `peakOffset` from the band centre. */
function locates(seed: number, peakOffset: number): boolean {
  const rng = mulberry32(seed);
  const bounds: [number, number] = [34 / 1.7, 34 * 1.7];
  const [lo, hi] = bounds;
  const loX = Math.log(lo), hiX = Math.log(hi), midX = (loX + hiX) / 2;
  // The configuration src/ui/session-view.ts ships.
  const engine = makeEvolution({
    gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.1 }, sigma0: 0.3, seed: seed & 0xffff,
  });
  const obs: Observation[] = [];
  for (let t = 0; t < TRIALS; t++) {
    const x = t < COLD
      ? loX + ((hiX - loX) * t) / (COLD - 1)
      : Math.log(Math.min(hi, Math.max(lo, engine.suggest(obs, bounds))));
    const d = x - midX - peakOffset;
    obs.push({ x, y: CURVATURE * d * d + (rng() * 2 - 1) * NOISE * Math.sqrt(3) });
  }
  return finalizeReport(obs, bounds, mulberry32(seed ^ 0xbeef), { bootstrapIters: 40 })
    .peakAtBound === undefined;
}

const rate = (peakOffset: number): number => {
  let hit = 0;
  for (let s = 0; s < REPS; s++) if (locates(2000 + s * 31, peakOffset)) hit++;
  return hit / REPS;
};

describe('the allocator locates an interior optimum, it does not just search', () => {
  it('locates a centred peak in almost every session', () => {
    // Measured 99.0% over 400 reps. The margin here absorbs the smaller sample.
    expect(rate(0)).toBeGreaterThan(0.95);
  });

  it('still locates an off-centre peak, which is the realistic case', () => {
    // The band is centred on the player's habit, so the truth is usually NOT at the centre.
    // Measured 93.5% over 400 reps. A naive clustering allocator sits near 77% here.
    expect(rate(0.25)).toBeGreaterThan(0.85);
  });
});
