import { describe, it, expect } from 'vitest';
import { analyzeFlick, flick, FLICK_CONDITIONS, type FlickTap } from '../../src/instruments/flick';
import type { FittsCondition, TrialContext } from '../../src/types';
import { mulberry32 } from '../../src/stats/bootstrap';
import { sampleStd } from '../../src/scoring/stats';
import { FakeScene } from './fake-scene';

const ctx = (): TrialContext => ({
  cm360: 34,
  dpi: 800,
  rng: mulberry32(9),
  profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
});

function taps(mt: number, errSd: number, n = 6): FlickTap[] {
  const out: FlickTap[] = [];
  for (let i = 0; i < n; i++) {
    const e = (i % 2 === 0 ? 1 : -1) * errSd;
    out.push({ amplitude: 20, width: 3, mt, errAlong: e, nCorr: 0, hit: Math.abs(e) <= 1.5 });
  }
  return out;
}

/** Taps for one explicit (amplitude, width) condition with controllable speed + spread. */
function cond(amplitude: number, width: number, mt: number, errSd: number, n = 4): FlickTap[] {
  return Array.from({ length: n }, (_, i) => {
    const e = (i % 2 === 0 ? 1 : -1) * errSd;
    return { amplitude, width, mt, errAlong: e, nCorr: 0, hit: Math.abs(e) <= width / 2 };
  });
}

describe('analyzeFlick', () => {
  it('faster taps at equal accuracy yield higher throughput', () => {
    const slow = analyzeFlick(taps(600, 0.6), ctx());
    const fast = analyzeFlick(taps(300, 0.6), ctx());
    expect(fast.raw.throughput).toBeGreaterThan(slow.raw.throughput);
    expect(fast.score).toBeGreaterThan(slow.score);
  });

  it('more endpoint spread lowers throughput', () => {
    const tight = analyzeFlick(taps(400, 0.4), ctx());
    const loose = analyzeFlick(taps(400, 1.2), ctx());
    expect(tight.raw.throughput).toBeGreaterThan(loose.raw.throughput);
  });

  it('reports hit rate and instrument id', () => {
    const r = analyzeFlick(taps(400, 0.4), ctx());
    expect(r.instrument).toBe('flick');
    expect(r.raw.hitRate).toBeCloseTo(1, 6);
    expect(Number.isFinite(r.score)).toBe(true);
  });

  it('emits a finite, positive throughput-scale scoreSE (P1-1 nugget)', () => {
    // A grid with real condition-to-condition throughput spread → a measurable SE of the aggregate.
    const grid = [
      ...cond(40, 3, 250, 0.4),
      ...cond(28, 2.2, 400, 0.6),
      ...cond(12, 1.5, 650, 0.9),
    ];
    const r = analyzeFlick(grid, ctx());
    expect(r.scoreSE).toBeDefined();
    expect(Number.isFinite(r.scoreSE as number)).toBe(true);
    expect(r.scoreSE as number).toBeGreaterThan(0);
  });

  it('throws if a condition has too few taps to estimate spread', () => {
    expect(() => analyzeFlick([{ amplitude: 20, width: 3, mt: 400, errAlong: 0.5, nCorr: 0, hit: true }], ctx()))
      .toThrow();
  });
});

describe('flick - two-mode crossover (spider ballistic orient + raptor dual-fovea)', () => {
  // Ballistic = large amplitude (≥24); precision = small width (≤2). The score is the harmonic mean
  // of the two sub-throughputs, so it peaks at the CROSSOVER - a sensitivity good at both - rather
  // than at whichever single mode happens to be fastest. Numbers derived from the ISO throughput
  // formula by hand: the balanced player's pooled mean is LOWER than the specialist's, but its
  // harmonic mean is HIGHER. That divergence is the whole point.
  const balanced = [...cond(40, 3, 400, 0.5), ...cond(12, 1.5, 400, 0.3)]; // competent at both modes
  const lopsided = [...cond(40, 3, 250, 0.4), ...cond(12, 1.5, 700, 0.9)]; // great flick, poor lock

  it('rewards the balanced player over the specialist - opposite to what pooled throughput does', () => {
    const A = analyzeFlick(balanced, ctx());
    const B = analyzeFlick(lopsided, ctx());
    expect(B.raw.throughput).toBeGreaterThan(A.raw.throughput); // old pooled metric favors the specialist…
    expect(A.score).toBeGreaterThan(B.score); // …the crossover score favors the all-rounder
  });

  it('scores the harmonic mean of the ballistic and precision sub-throughputs', () => {
    const r = analyzeFlick(balanced, ctx());
    const b = r.raw.ballisticTP;
    const p = r.raw.precisionTP;
    expect(Number.isFinite(b)).toBe(true);
    expect(Number.isFinite(p)).toBe(true);
    expect(r.score).toBeCloseTo((2 * b * p) / (b + p), 6);
    expect(r.score).toBeLessThanOrEqual(Math.max(b, p)); // harmonic mean ≤ max of the two
  });
});

describe('FLICK_CONDITIONS', () => {
  it('spans a grid of amplitudes and widths (ID range)', () => {
    expect(FLICK_CONDITIONS.length).toBeGreaterThanOrEqual(4);
  });
});

// --- A2: ISO 9241-9 along-axis projection ---
// The endpoint error fed to conditionThroughput must be the miss (landing - target) PROJECTED onto
// the start->target unit axis (+ = overshoot) - the standard's own quantity. The old convention
// signed the TOTAL radial miss by yaw order (aim[0] >= tgt[0]), so on near-vertical reaches the
// sign tracked the horizontal wobble, not over/undershoot - inflating We and cancelling real bias
// out of Ae. These fixtures fire at target + a*u + b*v (a = along-axis, b = tangential) so the true
// along-axis error is `a` by construction, and assert the run recovers analyzeFlick(true errors)
// EXACTLY - any sign hack or tangential pollution breaks the equality.

/** Replicate flick.run's deterministic presentation order (REPS x conditions, Fisher-Yates). */
function presentationOrder(rng: () => number): FittsCondition[] {
  const order: FittsCondition[] = [];
  for (let r = 0; r < 3; r++) for (const c of FLICK_CONDITIONS) order.push(c);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

/** Drive flick.run, landing each shot at tgt + a*u + b*v; returns the result + both error sets. */
async function driveProjected(
  makeRng: () => () => number, // factory: run and the order replica need independent copies
  aOf: (k: number) => number, // along-axis miss for the k-th tap of a condition (+ = overshoot)
  bOf: (k: number) => number, // tangential miss for the k-th tap of a condition
): Promise<{
  r: Awaited<ReturnType<typeof flick.run>>;
  trueTaps: FlickTap[];
  oldTaps: FlickTap[];
  verticalReaches: number;
}> {
  const scene = new FakeScene();
  const c: TrialContext = { ...ctx(), rng: makeRng() };
  const order = presentationOrder(makeRng()); // same seed → same shuffle as inside run
  const p = flick.run(c, scene);
  const trueTaps: FlickTap[] = [];
  const oldTaps: FlickTap[] = [];
  const counts = new Map<string, number>();
  let prevAim: [number, number] = [0, 0]; // scene.view() at present time (start of the reach)
  let verticalReaches = 0;
  for (let i = 0; i < order.length; i++) {
    const spec = scene.spawned[i]!;
    const tgt: [number, number] = [spec.yaw ?? 0, spec.pitch ?? 0];
    const dy = tgt[0] - prevAim[0];
    const dp = tgt[1] - prevAim[1];
    const reach = Math.hypot(dy, dp);
    expect(reach).toBeGreaterThan(1); // fixture sanity: a real reach every time
    if (Math.abs(dy) < 0.01 * Math.abs(dp)) verticalReaches += 1;
    const uy = dy / reach;
    const up = dp / reach;
    const cond = order[i]!;
    const condKey = `${cond.amplitude}|${cond.width}`;
    const k = counts.get(condKey) ?? 0;
    counts.set(condKey, k + 1);
    const a = aOf(k);
    const b = bOf(k);
    const aim: [number, number] = [tgt[0] + a * uy - b * up, tgt[1] + a * up + b * uy];
    scene.tick(120, [prevAim[0] + dy * 0.4, prevAim[1] + dp * 0.4]);
    scene.tick(120, [prevAim[0] + dy * 0.9, prevAim[1] + dp * 0.9]);
    scene.tick(120, aim);
    scene.fire(aim);
    const miss = Math.hypot(aim[0] - tgt[0], aim[1] - tgt[1]);
    trueTaps.push({ amplitude: cond.amplitude, width: cond.width, mt: 360, errAlong: a, nCorr: 0, hit: miss <= 2 });
    oldTaps.push({
      amplitude: cond.amplitude,
      width: cond.width,
      mt: 360,
      errAlong: miss * (aim[0] >= tgt[0] ? 1 : -1), // the pre-A2 yaw-order sign hack
      nCorr: 0,
      hit: miss <= 2,
    });
    prevAim = aim;
  }
  return { r: await p, trueTaps, oldTaps, verticalReaches };
}

describe('flick.run - A2 ISO along-axis projection', () => {
  it('recovers analyzeFlick(true projected errors) exactly on random-bearing reaches', async () => {
    const { r, trueTaps, oldTaps } = await driveProjected(
      () => mulberry32(9),
      (k) => (k % 2 === 0 ? 0.4 : 0.6), // consistent overshoot with real spread
      (k) => (k % 2 === 0 ? 0.3 : -0.3), // alternating tangential wobble
    );
    const expected = analyzeFlick(trueTaps, ctx());
    expect(r.score).toBeCloseTo(expected.score, 6);
    expect(r.raw.throughput).toBeCloseTo(expected.raw.throughput, 6);
    expect(r.raw.ballisticTP).toBeCloseTo(expected.raw.ballisticTP, 6);
    expect(r.raw.precisionTP).toBeCloseTo(expected.raw.precisionTP, 6);
    // The old yaw-order proxy produced a materially different (corrupted) number.
    const corrupted = analyzeFlick(oldTaps, ctx());
    expect(Math.abs(corrupted.raw.throughput - expected.raw.throughput)).toBeGreaterThan(1e-3);
  });

  it('on near-vertical reaches the old sign hack inflated We and cancelled bias out of Ae; the projection recovers both', async () => {
    // Scripted rng: 14 shuffle draws of 0 (deterministic order), then alternating 0.25/0.75 →
    // dir = π/2 / 3π/2 → every reach is (near-)vertical, where the old sign was pure noise.
    const makeScripted = (): (() => number) => {
      let n = 0;
      return () => {
        n += 1;
        return n <= 14 ? 0 : n % 2 === 1 ? 0.25 : 0.75;
      };
    };
    const { r, trueTaps, oldTaps, verticalReaches } = await driveProjected(
      makeScripted,
      (k) => (k % 2 === 0 ? 0.4 : 0.6), // true along-axis: all overshoot (mean +0.467, SD 0.115)
      () => 0.3, // constant horizontal wobble - the ONLY thing the old sign could see here
    );
    expect(verticalReaches).toBe(trueTaps.length); // fixture sanity: every reach near-vertical
    const expected = analyzeFlick(trueTaps, ctx());
    expect(r.score).toBeCloseTo(expected.score, 6);
    expect(r.raw.throughput).toBeCloseTo(expected.raw.throughput, 6);
    // Corruption of the OLD convention, shown on the same landings. Every landing overshoots along
    // the axis, yet the old sign tracked the horizontal wobble vs the up/down reach direction:
    const errsOf = (taps: FlickTap[], key: string): number[] =>
      taps.filter((t) => `${t.amplitude}|${t.width}` === key).map((t) => t.errAlong);
    const keys = [...new Set(oldTaps.map((t) => `${t.amplitude}|${t.width}`))];
    const mixed = keys.filter((key) => {
      const es = errsOf(oldTaps, key);
      return es.some((e) => e > 0) && es.some((e) => e < 0);
    });
    expect(mixed.length).toBeGreaterThan(0); // pure overshoot rendered as mixed-sign spread
    for (const key of mixed) {
      const trueErrs = errsOf(trueTaps, key);
      const oldErrs = errsOf(oldTaps, key);
      expect(sampleStd(oldErrs)).toBeGreaterThan(3 * sampleStd(trueErrs)); // We inflated
      expect(Math.abs(oldErrs.reduce((s, e) => s + e, 0) / oldErrs.length)).toBeLessThan(
        trueErrs.reduce((s, e) => s + e, 0) / trueErrs.length,
      ); // real overshoot bias cancelled out of Ae
    }
    expect(analyzeFlick(oldTaps, ctx()).raw.throughput).toBeLessThan(expected.raw.throughput);
  });
});

describe('flick.run', () => {
  it('presents targets, records fires, and resolves a scored result', async () => {
    const scene = new FakeScene();
    const p = flick.run(ctx(), scene);
    const scatter = mulberry32(99); // realistic seeded endpoint spread (deterministic, ±0.8°)
    for (let k = 0; k < 40; k++) {
      const spec = scene.spawned[scene.spawned.length - 1];
      const aim: [number, number] = [
        (spec?.yaw ?? 0) + (scatter() * 2 - 1) * 0.8,
        (spec?.pitch ?? 0) + (scatter() * 2 - 1) * 0.8,
      ];
      scene.tick(120, aim);
      scene.tick(120, aim);
      scene.tick(120, aim);
      scene.fire(aim);
    }
    const r = await p;
    expect(r.instrument).toBe('flick');
    expect(scene.spawned.length).toBeGreaterThan(1);
    expect(Number.isFinite(r.score)).toBe(true);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(20); // realistic throughput, not the inflated zero-spread artifact
    expect(r.raw.conditions).toBe(FLICK_CONDITIONS.length);
  });
});
