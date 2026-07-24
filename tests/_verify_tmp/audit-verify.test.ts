import { describe, it } from 'vitest';
import { fitQuadratic } from '../../src/stats/peak-fit';
import { mulberry32 } from '../../src/stats/rng';
import { makeEvolution } from '../../src/optimizer/evolution';
import { runSession } from '../../src/optimizer/session-controller';
import { trialsToObservations } from '../../src/optimizer/objective';
import { GP } from '../../src/optimizer/gp';
import { expectedImprovement } from '../../src/optimizer/bayesopt';
import type { Instrument, InstrumentId, Observation, Profile, TrialResult } from '../../src/types';

const gauss = (rng: () => number): number => {
  const u = Math.max(1e-12, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

const LO = 15, HI = 60;
const xLo = Math.log(LO), xHi = Math.log(HI);

const PROFILE: Profile = {
  instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 },
  speedAccuracy: 0.5,
} as unknown as Profile;

/** Fake instrument: score = -curv*(ln cm360 - ln peak)^2 + noise, with a measured scoreSE. */
function fakeInstrument(id: InstrumentId, peak: number, curv: number, noise: number): Instrument {
  return {
    id,
    async run(ctx) {
      const d = Math.log(ctx.cm360) - Math.log(peak);
      const score = 10 - curv * d * d + noise * gauss(ctx.rng);
      const r: TrialResult = {
        instrument: id, cm360: ctx.cm360, score, raw: {}, at: 0, scoreSE: noise,
      };
      return r;
    },
  } as unknown as Instrument;
}

const SCENE = {} as never;

async function session(seed: number, cfg: {
  peaks: Record<InstrumentId, number>; curv: Record<InstrumentId, number>; noise: Record<InstrumentId, number>;
  maxTrials: number; coldStart: number; ciStopWidth?: number;
}) {
  const instruments = {
    track: fakeInstrument('track', cfg.peaks.track, cfg.curv.track, cfg.noise.track),
    flick: fakeInstrument('flick', cfg.peaks.flick, cfg.curv.flick, cfg.noise.flick),
    calibrate: fakeInstrument('calibrate', cfg.peaks.calibrate, cfg.curv.calibrate, cfg.noise.calibrate),
    strike: fakeInstrument('strike', cfg.peaks.strike, cfg.curv.strike, cfg.noise.strike),
  } as unknown as Record<InstrumentId, Instrument>;
  const engine = makeEvolution({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.1 }, sigma0: 0.3, maxTrials: cfg.maxTrials, seed });
  return runSession({
    dpi: 800, profile: PROFILE, bounds: [LO, HI], engine, instruments, scene: SCENE,
    schedule: ['track', 'flick', 'calibrate', 'strike'],
    maxTrials: cfg.maxTrials, coldStart: cfg.coldStart, minTrials: 12,
    rng: mulberry32(seed * 7919 + 13), bootstrapIters: 400,
    ...(cfg.ciStopWidth !== undefined ? { ciStopWidth: cfg.ciStopWidth } : {}),
  });
}

const SHIPPED = {
  peaks: { track: 30, flick: 30, calibrate: 30, strike: 30 } as Record<InstrumentId, number>,
  curv: { track: 2, flick: 2, calibrate: 2, strike: 2 } as Record<InstrumentId, number>,
  noise: { track: 0.6, flick: 0.6, calibrate: 0.6, strike: 0.6 } as Record<InstrumentId, number>,
};

describe('audit verification', () => {
  it('A/B: drop rate + unclamped band width on real sessions', async () => {
    const REPS = 60;
    let drops = 0, tot = 0, sessionsOver25 = 0;
    const rawWidths: number[] = [];
    const clampedWidths: number[] = [];
    const peaks: number[] = [];
    let extrap = 0, outOfBounds = 0;
    for (let r = 0; r < REPS; r++) {
      const { trials, report } = await session(r + 1, { ...SHIPPED, maxTrials: 20, coldStart: 8 });
      const obs = trialsToObservations(trials, PROFILE);
      // replicate bootstrapCi's pooled loop to count non-concave draws
      const fit = fitQuadratic(obs);
      const resid = obs.map((o) => o.y - (fit.b0 + fit.b1 * o.x + fit.b2 * o.x * o.x));
      const fitted = (x: number) => fit.b0 + fit.b1 * x + fit.b2 * x * x;
      const rng = mulberry32(999 + r);
      const ps: number[] = [];
      let nc = 0;
      for (let i = 0; i < 400; i++) {
        const res: Observation[] = obs.map((o) => ({ x: o.x, y: fitted(o.x) + resid[Math.floor(rng() * resid.length)] }));
        const q = fitQuadratic(res);
        if (q.b2 >= 0) { nc++; continue; }
        const p = Math.exp(-q.b1 / (2 * q.b2));
        if (Number.isFinite(p) && p > 0) ps.push(p); else nc++;
      }
      drops += nc; tot += 400;
      if (nc / 400 > 0.25) sessionsOver25++;
      ps.sort((a, b) => a - b);
      if (ps.length > 10) {
        const at = (q: number) => ps[Math.min(ps.length - 1, Math.floor(q * ps.length))];
        rawWidths.push(Math.log(at(0.95)) - Math.log(at(0.05)));
      }
      clampedWidths.push(Math.log(report.ci90[1]) - Math.log(report.ci90[0]));
      peaks.push(report.optimalCm360);
      // extrapolation check on the plain fit
      if (fit.b2 < 0) {
        const xs = obs.map((o) => o.x);
        const xStar = -fit.b1 / (2 * fit.b2);
        if (xStar < Math.min(...xs) || xStar > Math.max(...xs)) extrap++;
        if (xStar < xLo || xStar > xHi) outOfBounds++;
      }
    }
    const m = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const lnPeaks = peaks.map(Math.log);
    const mu = m(lnPeaks);
    const sd = Math.sqrt(lnPeaks.reduce((s, v) => s + (v - mu) ** 2, 0) / (lnPeaks.length - 1));
    console.log('A/B', JSON.stringify({
      dropFrac: drops / tot,
      sessionsOver25pctDrop: sessionsOver25 / REPS,
      meanRawLnWidth: m(rawWidths),
      meanClampedLnWidth: m(clampedWidths),
      rangeLn: xHi - xLo,
      lnPeakSd: sd,
      extrapFrac: extrap / REPS,
      outOfBoundsFrac: outOfBounds / REPS,
    }, null, 1));
  }, 600000);

  it('C: EI offspring screen - rank and realized step', async () => {
    // Build a realistic 16-obs history from a real session, then replay the suggest() screen.
    const { trials } = await session(7, { ...SHIPPED, maxTrials: 16, coldStart: 8 });
    const history = trialsToObservations(trials, PROFILE);
    const gp = new GP({ signalVar: 1, lengthScale: 0.6, noiseVar: 0.1 }, history);
    const gridSize = 96;
    let parentX = xLo, parentMean = -Infinity;
    for (let i = 0; i <= gridSize; i++) {
      const x = xLo + ((xHi - xLo) * i) / gridSize;
      const mm = gp.predict(x).mean;
      if (mm > parentMean) { parentMean = mm; parentX = x; }
    }
    const rng = mulberry32(0x5eed);
    const lambda = 6, sigma = 0.3, xi = 0.01;
    let rankSum = 0, stepSum = 0, nomStepSum = 0;
    const REPS = 2000;
    for (let g = 0; g < REPS; g++) {
      const cands: number[] = [];
      for (let k = 0; k < lambda; k++) {
        cands.push(Math.min(xHi, Math.max(xLo, parentX + sigma * gauss(rng))));
      }
      let best = -Infinity, chosen = cands[0];
      for (const x of cands) {
        const { mean, variance } = gp.predict(x);
        const a = expectedImprovement(mean, variance, parentMean, xi);
        if (a > best) { best = a; chosen = x; }
      }
      const dists = cands.map((x) => Math.abs(x - parentX)).sort((a, b) => b - a); // farthest first
      const rank = dists.indexOf(Math.abs(chosen - parentX)) + 1; // 1 = farthest
      rankSum += rank;
      stepSum += Math.abs(chosen - parentX);
      nomStepSum += dists.reduce((s, v) => s + v, 0) / lambda;
    }
    console.log('C', JSON.stringify({
      meanRankFromFarthest: rankSum / REPS, lambda,
      meanRealizedStep: stepSum / REPS,
      meanCandidateStep: nomStepSum / REPS,
      sigma,
    }, null, 1));
  }, 600000);

  it('D: condition number of the uncentred normal equations', () => {
    const n = 20;
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < n; i++) {
      const x = xLo + ((i + 0.5) / n) * (xHi - xLo);
      const cols = [1, x, x * x];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) A[r][c] += cols[r] * cols[c];
    }
    // power iteration on A and A^-1 is overkill; use eigenvalues via characteristic polynomial numerically
    const evs = eig3(A);
    const xm = xLo + 0.5 * (xHi - xLo);
    const Ac = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < n; i++) {
      const u = xLo + ((i + 0.5) / n) * (xHi - xLo) - xm;
      const cols = [1, u, u * u];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) Ac[r][c] += cols[r] * cols[c];
    }
    const evc = eig3(Ac);
    console.log('D', JSON.stringify({
      uncentredCond: Math.max(...evs) / Math.min(...evs),
      centredCond: Math.max(...evc) / Math.min(...evc),
    }, null, 1));
  });

  it('F/G: total-sd vs noise-sd normalization', () => {
    const cfgPeaks: Record<string, number> = { flick: 24, track: 34, calibrate: 26, strike: 32 };
    const cfgCurv: Record<string, number> = { flick: 1.0, track: 0.15, calibrate: 2.5, strike: 0.4 };
    const ids = ['flick', 'track', 'calibrate', 'strike'];

    // G: estimand shift with noise realisation (huge n, uniform design → sampling error negligible)
    const blendPeak = (noise: Record<string, number>): number => {
      const obs: Observation[] = [];
      const N = 4000;
      for (const id of ids) {
        const ys: number[] = [];
        const xs: number[] = [];
        for (let i = 0; i < N; i++) {
          const x = xLo + ((i + 0.5) / N) * (xHi - xLo);
          const d = x - Math.log(cfgPeaks[id]);
          // deterministic "expected" scores: use the exact variance decomposition rather than a draw
          xs.push(x); ys.push(-cfgCurv[id] * d * d);
        }
        const mu = ys.reduce((s, v) => s + v, 0) / N;
        const sigSd = Math.sqrt(ys.reduce((s, v) => s + (v - mu) ** 2, 0) / (N - 1));
        const totSd = Math.sqrt(sigSd * sigSd + noise[id] * noise[id]);
        for (let i = 0; i < N; i++) obs.push({ x: xs[i], y: (ys[i] - mu) / totSd });
      }
      const q = fitQuadratic(obs);
      return Math.exp(-q.b1 / (2 * q.b2));
    };
    const zero = blendPeak({ flick: 0, track: 0, calibrate: 0, strike: 0 });
    const unif = blendPeak({ flick: 0.3, track: 0.3, calibrate: 0.3, strike: 0.3 });
    const noisyTrack = blendPeak({ flick: 0.3, track: 0.8, calibrate: 0.3, strike: 0.3 });
    const noisyFlick = blendPeak({ flick: 0.8, track: 0.3, calibrate: 0.3, strike: 0.3 });
    console.log('G', JSON.stringify({ zero, unif, noisyTrack, noisyFlick, swingPct: 100 * (noisyFlick - noisyTrack) / noisyTrack }, null, 1));

    // F: spread of the estimate under the two normalizations, uniform design, n per facet = 5
    const noise: Record<string, number> = { flick: 0.25, track: 0.6, calibrate: 0.15, strike: 0.45 };
    const REPS = 1200;
    const runNorm = (mode: 'total' | 'noise') => {
      const rng = mulberry32(4242);
      const lnPeaks: number[] = [];
      let nc = 0;
      for (let r = 0; r < REPS; r++) {
        const obs: Observation[] = [];
        for (const id of ids) {
          const per = 5;
          const ys: number[] = []; const xs: number[] = [];
          for (let i = 0; i < per; i++) {
            const x = xLo + ((i + 0.5) / per) * (xHi - xLo);
            const d = x - Math.log(cfgPeaks[id]);
            xs.push(x); ys.push(-cfgCurv[id] * d * d + noise[id] * gauss(rng));
          }
          const mu = ys.reduce((s, v) => s + v, 0) / per;
          const sd = Math.sqrt(ys.reduce((s, v) => s + (v - mu) ** 2, 0) / (per - 1));
          const scale = mode === 'total' ? sd : noise[id];
          if (!(scale > 0)) continue;
          for (let i = 0; i < per; i++) obs.push({ x: xs[i], y: (ys[i] - mu) / scale });
        }
        const q = fitQuadratic(obs);
        if (q.b2 >= 0) { nc++; continue; }
        lnPeaks.push(-q.b1 / (2 * q.b2));
      }
      lnPeaks.sort((a, b) => a - b);
      const at = (p: number) => lnPeaks[Math.floor(p * lnPeaks.length)];
      return { nonConcave: nc, spread5_95: at(0.95) - at(0.05), median: Math.exp(at(0.5)) };
    };
    console.log('F', JSON.stringify({ total: runNorm('total'), noise: runNorm('noise') }, null, 1));
  });
});

/** Eigenvalues of a symmetric 3x3 via Jacobi. */
function eig3(Ain: number[][]): number[] {
  const A = Ain.map((r) => [...r]);
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (i !== j) off += A[i][j] * A[i][j];
    if (off < 1e-20 * (A[0][0] ** 2 + A[1][1] ** 2 + A[2][2] ** 2)) break;
    for (let p = 0; p < 2; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(A[p][q]) < 1e-30) continue;
      const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = A[k][p], akq = A[k][q];
        A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = A[p][k], aqk = A[q][k];
        A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk;
      }
    }
  }
  return [A[0][0], A[1][1], A[2][2]].map(Math.abs);
}
