import { describe, it, expect } from 'vitest';
import { analyzeTrack, bestLag, track } from '../../src/instruments/track';
import type { Frame } from '../../src/instruments/recording';
import type { TrialContext } from '../../src/types';
import { mulberry32 } from '../../src/stats/bootstrap';
import { FakeScene } from './fake-scene';

const ctx = (): TrialContext => ({
  cm360: 34,
  dpi: 800,
  rng: mulberry32(5),
  profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
});

function tracking(lagFrames: number, jitterAmp = 0): Frame[] {
  const frames: Frame[] = [];
  const N = 240;
  const targetAt = (i: number): [number, number] => [10 * Math.sin(i * 0.05), 3 * Math.sin(i * 0.04)];
  for (let i = 0; i < N; i++) {
    const tgt = targetAt(i);
    const src = targetAt(Math.max(0, i - lagFrames));
    const jit = jitterAmp * Math.sin(i * 1.9);
    frames.push({ t: i * 16, aim: [src[0] + jit, src[1]], target: tgt, targetRadius: 2.5 });
  }
  return frames;
}

describe('analyzeTrack', () => {
  it('a near-perfect tracker beats a laggy tracker', () => {
    const good = analyzeTrack({ frames: tracking(0), fires: [] }, ctx());
    const laggy = analyzeTrack({ frames: tracking(6), fires: [] }, ctx());
    expect(good.raw.tot).toBeGreaterThan(laggy.raw.tot);
    expect(good.score).toBeGreaterThan(laggy.score);
  });

  it('emits NO scoreSE - a single continuous recording falls back to the flat nugget (P1-1)', () => {
    const r = analyzeTrack({ frames: tracking(0), fires: [] }, ctx());
    expect(r.scoreSE).toBeUndefined();
  });

  it('flags reactive lag with a negative predictive index', () => {
    const laggy = analyzeTrack({ frames: tracking(8), fires: [] }, ctx());
    expect(laggy.raw.pi).toBeLessThan(0);
  });

  it('MEASURES the player\'s own tracking latency (scales with true lag; not a fixed constant)', () => {
    // The dragonfly forward model leads by its OWN measured latency. campeón must recover one per
    // player, not the old hard-coded 0.15 s. Properties derived from the fixture, not the code:
    const synced = analyzeTrack({ frames: tracking(0), fires: [] }, ctx());
    const mid = analyzeTrack({ frames: tracking(6), fires: [] }, ctx()); // 6 frames × 16 ms ≈ 96 ms
    const slow = analyzeTrack({ frames: tracking(10), fires: [] }, ctx());
    expect(synced.raw.latencySec).toBeLessThan(0.03); // a perfectly synced tracker reads ~0
    expect(mid.raw.latencySec).toBeGreaterThan(synced.raw.latencySec);
    expect(slow.raw.latencySec).toBeGreaterThan(mid.raw.latencySec); // monotone in true lag
    // …and the lag-6 estimate is nearer the true 96 ms than the old fixed 150 ms.
    expect(Math.abs(mid.raw.latencySec - 0.096)).toBeLessThan(Math.abs(mid.raw.latencySec - 0.15));
  });

  it('lag-compensates the predictive error: tremor survives, pure latency does not', () => {
    // After removing the player's measured latency, a pure-latency tracker's residual collapses to a
    // small floor; adding tremor at the SAME latency inflates it sharply. So jitter (sensitivity-
    // dependent) must dominate the residual, not the latency. (Derived from first principles.)
    const cleanLaggy = analyzeTrack({ frames: tracking(6, 0), fires: [] }, ctx());
    const jittery = analyzeTrack({ frames: tracking(6, 1.2), fires: [] }, ctx());
    expect(jittery.raw.predErr).toBeGreaterThan(2 * cleanLaggy.raw.predErr);
  });

  it('a jittery (over-sensitive) tracker has higher jitter than a smooth one', () => {
    const smooth = analyzeTrack({ frames: tracking(0, 0), fires: [] }, ctx());
    const jittery = analyzeTrack({ frames: tracking(0, 1.5), fires: [] }, ctx());
    expect(jittery.raw.jitter).toBeGreaterThan(smooth.raw.jitter);
    expect(smooth.score).toBeGreaterThan(jittery.score);
  });

  it('reports instrument id and finite score', () => {
    const r = analyzeTrack({ frames: tracking(2), fires: [] }, ctx());
    expect(r.instrument).toBe('track');
    expect(Number.isFinite(r.score)).toBe(true);
    expect(r.cm360).toBe(34);
  });
});

describe('bestLag combined yaw+pitch covariance (P1-4)', () => {
  // A single combined covariance cov(lag) = yawCov(lag) + pitchCov(lag), peak-found ONCE. Because
  // covariance is amplitude-weighted, the clean high-SNR axis dominates and a small/noisy axis
  // cannot drag the estimate around. We DO NOT average two per-axis peaks - we sum the functions,
  // THEN find one peak. The fixture below pins exactly that property.
  const TRUE_LAG = 6;
  const N = 240;
  // Both axes carry the SAME true lag. Pitch carries a clean, large multi-tone weave; yaw carries a
  // small weave buried under heavy noise (low SNR). Multi-tone (not a single sine) so each axis's
  // covariance peak is sharp at the true lag rather than a broad ridge.
  const wY = (i: number): number => 0.5 * (Math.sin(i * 0.05) + 0.6 * Math.sin(i * 0.17) + 0.4 * Math.sin(i * 0.31));
  const wP = (i: number): number => 6 * (Math.sin(i * 0.04) + 0.6 * Math.sin(i * 0.13) + 0.4 * Math.sin(i * 0.27));
  const noise = mulberry32(7);
  const yawTgt: number[] = [];
  const pitchTgt: number[] = [];
  const yawAim: number[] = [];
  const pitchAim: number[] = [];
  for (let i = 0; i < N; i++) {
    yawTgt.push(wY(i));
    pitchTgt.push(wP(i));
    const si = Math.max(0, i - TRUE_LAG);
    // Yaw noise (±1.0) swamps its own ~0.5 amplitude → yaw-alone lag is unreliable.
    yawAim.push(wY(si) + (noise() - 0.5) * 2.0);
    pitchAim.push(wP(si) + (noise() - 0.5) * 0.1);
  }

  it('the combined estimate recovers the true lag better than yaw-alone when yaw is small/noisy', () => {
    const maxLag = 20;
    // Yaw-alone: feed the same series for both axes' "yaw" slot and a flat zero pitch so the pitch
    // covariance contributes nothing - i.e. exactly the old yaw-only behaviour.
    const flat = new Array(N).fill(0) as number[];
    const yawOnly = bestLag(yawAim, yawTgt, flat, flat, maxLag);
    const combined = bestLag(yawAim, yawTgt, pitchAim, pitchTgt, maxLag);

    const errYaw = Math.abs(yawOnly - TRUE_LAG);
    const errCombined = Math.abs(combined - TRUE_LAG);
    // Combined is materially closer to the truth than yaw-alone.
    expect(errCombined).toBeLessThan(errYaw);
    // …and is genuinely accurate (within a fraction of a frame of the true lag).
    expect(errCombined).toBeLessThan(0.6);
  });

  // An INDEPENDENT single-axis lag estimator: the same zero-mean covariance + integer search +
  // parabolic sub-sample refine bestLag uses, but written here by hand over one axis only. This is
  // the load-bearing reference - if bestLag's combined math regressed, the assertions below would
  // catch it because this value is computed without calling bestLag at all.
  function singleAxisLag(aim: readonly number[], tgt: readonly number[], maxLag: number): number {
    const ma = aim.reduce((s, v) => s + v, 0) / aim.length;
    const mt = tgt.reduce((s, v) => s + v, 0) / tgt.length;
    const cov = (lag: number): number => {
      let c = 0;
      let n = 0;
      for (let i = 0; i < aim.length; i++) {
        const j = i - lag;
        if (j < 0 || j >= tgt.length) continue;
        c += (aim[i]! - ma) * (tgt[j]! - mt);
        n += 1;
      }
      return n > 0 ? c / n : -Infinity;
    };
    let best = 0;
    let bestScore = -Infinity;
    for (let lag = -maxLag; lag <= maxLag; lag++) {
      const s = cov(lag);
      if (s > bestScore) {
        bestScore = s;
        best = lag;
      }
    }
    const cm = cov(best - 1);
    const cpv = cov(best + 1);
    const denom = cm - 2 * bestScore + cpv;
    if (denom < 0 && Number.isFinite(cm) && Number.isFinite(cpv)) {
      const delta = (0.5 * (cm - cpv)) / denom;
      if (Number.isFinite(delta) && Math.abs(delta) <= 1) return best + delta;
    }
    return best;
  }

  it('a flat-pitch call equals the INDEPENDENTLY-computed yaw-only lag (reduces to yaw-alone)', () => {
    const flat = new Array(N).fill(0) as number[];
    // With pitch carrying no signal, the combined call must equal the pure yaw estimate - and we pin
    // that against a hand-rolled single-axis reference, NOT against another bestLag call. A broken
    // "average two per-axis peaks" or constant-return implementation would fail this.
    const reference = singleAxisLag(yawAim, yawTgt, 20);
    expect(bestLag(yawAim, yawTgt, flat, flat, 20)).toBeCloseTo(reference, 10);
  });

  it('sums the covariance functions BEFORE peak-finding (NOT the average of two per-axis peaks)', () => {
    // Construct two clean axes whose TRUE lags differ: yaw leads by 3, pitch leads by 9. An
    // "average two independently-refined per-axis peaks" implementation would land near (3+9)/2 = 6.
    // The correct sum-then-peak fuses the covariance functions and lands at the joint maximum, which
    // - because both axes here have equal amplitude/SNR - sits at neither 6 nor a per-axis peak in
    // general; we pin it against the independent sum-of-covariances reference instead.
    const LAG_Y = 3;
    const LAG_P = 9;
    const aY: number[] = [];
    const tY: number[] = [];
    const aP: number[] = [];
    const tP: number[] = [];
    for (let i = 0; i < N; i++) {
      const y = Math.sin(i * 0.05) + 0.6 * Math.sin(i * 0.17);
      const p = Math.sin(i * 0.04) + 0.6 * Math.sin(i * 0.13);
      tY.push(y);
      tP.push(p);
      aY.push(i - LAG_Y >= 0 ? Math.sin((i - LAG_Y) * 0.05) + 0.6 * Math.sin((i - LAG_Y) * 0.17) : 0);
      aP.push(i - LAG_P >= 0 ? Math.sin((i - LAG_P) * 0.04) + 0.6 * Math.sin((i - LAG_P) * 0.13) : 0);
    }

    // Independent reference: build the SUMMED covariance function by hand and peak-find it once.
    const maY = aY.reduce((s, v) => s + v, 0) / N;
    const mtY = tY.reduce((s, v) => s + v, 0) / N;
    const maP = aP.reduce((s, v) => s + v, 0) / N;
    const mtP = tP.reduce((s, v) => s + v, 0) / N;
    const axisCov = (
      aim: number[],
      tgt: number[],
      ma: number,
      mt: number,
      lag: number,
    ): number => {
      let c = 0;
      let n = 0;
      for (let i = 0; i < N; i++) {
        const j = i - lag;
        if (j < 0 || j >= N) continue;
        c += (aim[i]! - ma) * (tgt[j]! - mt);
        n += 1;
      }
      return n > 0 ? c / n : -Infinity;
    };
    const summedCov = (lag: number): number =>
      axisCov(aY, tY, maY, mtY, lag) + axisCov(aP, tP, maP, mtP, lag);
    let best = 0;
    let bestScore = -Infinity;
    for (let lag = -20; lag <= 20; lag++) {
      const s = summedCov(lag);
      if (s > bestScore) {
        bestScore = s;
        best = lag;
      }
    }
    const cm = summedCov(best - 1);
    const cpv = summedCov(best + 1);
    const denom = cm - 2 * bestScore + cpv;
    let sumPeak = best;
    if (denom < 0) {
      const delta = (0.5 * (cm - cpv)) / denom;
      if (Math.abs(delta) <= 1) sumPeak = best + delta;
    }

    // The average of the two independently-refined per-axis peaks (the WRONG implementation).
    const avgOfPeaks =
      (singleAxisLag(aY, tY, 20) + singleAxisLag(aP, tP, 20)) / 2;

    const combined = bestLag(aY, tY, aP, tP, 20);

    // bestLag matches sum-then-peak to numerical precision...
    expect(combined).toBeCloseTo(sumPeak, 10);
    // ...and is measurably DIFFERENT from the average-of-per-axis-peaks answer, so the test would
    // fail if the implementation regressed to averaging.
    expect(Math.abs(combined - avgOfPeaks)).toBeGreaterThan(0.5);
  });
});

describe('track.run', () => {
  it('drives a moving target for the trial duration and resolves a scored result', async () => {
    const scene = new FakeScene();
    const p = track.run(ctx(), scene);
    for (let i = 0; i < 400; i++) {
      const b: [number, number] = [10 * Math.sin(i * 0.05), 3 * Math.sin(i * 0.04)];
      scene.moveTarget(b, 2.5);
      scene.tick(16, b);
    }
    const r = await p;
    expect(r.instrument).toBe('track');
    expect(scene.spawned.some((s) => s.kind === 'moving')).toBe(true);
    expect(scene.cleared).toBeGreaterThan(0);
    expect(Number.isFinite(r.score)).toBe(true);
    expect(r.at).toBeGreaterThan(0);
  });

  it('spawns the prey around the current view - not the world origin - so it is on-screen when the view has drifted', () => {
    const scene = new FakeScene();
    scene.view_ = [50, 12]; // the view drifts between trials; the prior trial left it here
    void track.run(ctx(), scene);
    const moving = scene.spawned.find((s) => s.kind === 'moving');
    expect(moving).toBeDefined();
    // The base placement must track the current view (the ±12°/±5° weave then keeps it on-screen).
    // The old code hard-coded yaw:0,pitch:0, so the prey could start far off-screen → garbage tracking.
    expect(moving!.yaw).toBeCloseTo(50);
    expect(moving!.pitch).toBeCloseTo(12);
  });
});
