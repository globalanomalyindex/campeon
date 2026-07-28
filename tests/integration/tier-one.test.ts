// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { runSession, type SessionOutcome } from '../../src/optimizer/session-controller';
import { makeBo } from '../../src/optimizer/bayesopt';
import { mulberry32 } from '../../src/stats/rng';
import { FakeScene } from '../instruments/fake-scene';
import { anchorFromReaches, FLICK_MIN_LEVELS, FLICK_MIN_REACHES } from '../../src/anchor/flick-anchor';
import { reconcile } from '../../src/anchor/reconcile';
import { turnFromPasses } from '../../src/anchor/reference-turn';
import { ratioFraming } from '../../src/optimizer/result';
import { sessionView, type SessionViewDeps } from '../../src/ui/session-view';
import { result } from '../../src/ui/result';
import type { AppContext } from '../../src/ui/shell';
import type { ArenaStage } from '../../src/ui/arena-stage';
import {
  counts360,
  type Counts360,
  type Instrument,
  type Profile,
  type Result,
  type Session,
  type TrialResult,
} from '../../src/types';

/**
 * The one test that carries the change: a session with a KNOWN anchor and a KNOWN optimum, driven
 * through the shipped estimators, the shipped reconciliation and the shipped screen, asserting that
 * the factor a player is told to multiply by is the quotient of those two numbers and that its
 * interval is the conservative endpoint quotient of their two intervals.
 *
 * The scripted player believes B0 counts per 360 and aims best at PEAK, so the honest instruction is
 * to multiply by B0 / PEAK = 1.5. Those two numbers are deliberately far apart: a seam that never
 * wired the anchor in would report a factor of 1.00 or no factor at all, and both would pass a test
 * whose truth sat near 1.
 *
 * What is NOT exercised here, so nobody reads more into it than it says. The instrument is scripted
 * rather than one of the four drills, because sessionView hardcodes INSTRUMENTS and SCHEDULE and its
 * only injection seam is deps.runSession, and because scripting a real drill means scripting a
 * performance model and then testing the model. The scripted player drives the scene through exactly
 * the protocol the drills use. And the transport into the view is that same seam, carrying the real
 * outcome of the real run below rather than a literal. Closing either would need pointer lock, WebGL
 * and a hand on a mouse, which no unit test has.
 */

const B0 = 9000; // what the player's hands believe a full turn costs
const PEAK = 6000; // where the player actually aims best
const PER_TRIAL = 12;
const MAX_TRIALS = 24;
const BOUNDS: [Counts360, Counts360] = [counts360(3000), counts360(12000)];
const PROFILE: Profile = {
  speedAccuracy: 0.5,
  instrumentWeights: { track: 0, flick: 1, calibrate: 0, strike: 0 },
};

/** Per-frame share of the reach's primary displacement: sums to 1.00 at index 6, then corrects, so
 *  the segmenter finds a strict trough at exactly the sample whose aim is the primary's extent. */
const FRACTIONS = [0, 0.06, 0.26, 0.44, 0.18, 0.04, 0.02, 0.12, 0.05, 0.01] as const;

/** The scripted player. ln f = (ln B0 - ln C_r) * rate^j + bias, the model flick-anchor.ts fits. */
function scriptedPlayer(scene: FakeScene): Instrument {
  const rng = mulberry32(0x1e57);
  const gauss = (): number => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  return {
    id: 'flick',
    run(ctx) {
      const e0 = Math.log(B0) - Math.log(ctx.counts);
      for (let j = 0; j < PER_TRIAL; j++) {
        const dir = j % 2 === 0 ? 1 : -1;
        const start = scene.view()[0];
        scene.spawnTarget({ kind: 'static', yaw: start + dir * 30, pitch: 0, distance: 20, worldRadius: 0.6 });
        const f = Math.exp(e0 * Math.pow(0.6, j) + Math.log(0.94) + 0.03 * gauss());
        let yaw = start;
        for (const share of FRACTIONS) {
          scene.tick(16, [yaw, 0]);
          yaw += share * dir * 30 * f;
        }
        scene.clearTargets();
        scene.tick(16, [yaw, 0]);
      }
      const d = Math.log(ctx.counts) - Math.log(PEAK);
      return Promise.resolve<TrialResult>({
        instrument: 'flick',
        counts: ctx.counts,
        score: -d * d + (ctx.rng() * 2 - 1) * 0.02,
        raw: { throughput: 4, hitRate: 0.86, mtMean: 480 },
        at: 0,
      });
    },
  };
}

/** The real controller, the real observer, a real scene. Memoized rather than run at module load:
 *  a rejection from an eager module-scope promise surfaces as an unhandled rejection with no test
 *  attached to it, which is a worse failure report than the same throw inside the first `it`. */
let cached: Promise<SessionOutcome> | null = null;
const session = (): Promise<SessionOutcome> => {
  if (cached === null) {
    const scene = new FakeScene();
    const player = scriptedPlayer(scene);
    cached = runSession({
      profile: PROFILE,
      bounds: BOUNDS,
      engine: makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.05 }, acquisition: 'ei' }),
      instruments: { track: player, flick: player, calibrate: player, strike: player },
      scene,
      schedule: ['flick'],
      maxTrials: MAX_TRIALS,
      coldStart: 8,
      rng: mulberry32(4242),
      bootstrapIters: 200,
    });
  }
  return cached;
};

/** An in-memory Storage, so the result screen can find the session its plot marks come from. */
function memoryStorage(): AppContext['storage'] {
  const sessions: Session[] = [];
  const results: Record<string, Result> = {};
  return {
    saveSession: (s) => void sessions.push(s),
    loadSessions: () => sessions,
    saveResult: (id, r) => void (results[id] = r),
    loadResults: () => results,
    exportJson: () => '',
  };
}

function fakeStage(scene: FakeScene): ArenaStage {
  return {
    arena: scene as unknown as ArenaStage['arena'],
    requestLock: vi.fn(() => Promise.resolve('raw')),
    exitLock: vi.fn(),
    isLocked: () => false,
    setCounts: vi.fn(),
    setEnemyEnvironment: vi.fn(),
    ready: Promise.resolve(),
    dispose: vi.fn(),
  } as unknown as ArenaStage;
}

const flush = (): Promise<void> => Promise.resolve().then(() => undefined);

/** Drive the shipped view from the shipped outcome, lock the run in, and return the live context. */
async function lockInThroughTheView(outcome: SessionOutcome): Promise<AppContext> {
  const ctx = {
    navigate: vi.fn(),
    route: 'session',
    storage: memoryStorage(),
    draft: {
      currentGame: 'cs2',
      currentSens: 1,
      profile: PROFILE,
      bounds: BOUNDS,
      // The other anchor route: three blind passes around the same belief, through the shipped
      // estimator rather than a hand-built TurnEstimate, so its one-sided shrinkage is in the loop.
      turn: turnFromPasses([8900, 9050, 9000])!,
    },
  } as unknown as AppContext;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const deps: SessionViewDeps = {
    createStage: () => fakeStage(new FakeScene()),
    runSession: () => Promise.resolve(outcome),
  };
  const screen = sessionView(host, ctx, deps);
  screen.mount();
  const root = host.querySelector('.session') as HTMLElement;
  (root.querySelector('[data-prelock="begin"]') as HTMLButtonElement).click();
  // Four ticks, one per await in the chain requestLock → begin → runSegment → runSession, plus one
  // spare. Flushing more than the chain needs is inert; flushing fewer would click lock before
  // lastReport is set and finalize would return at its own guard with nothing saved.
  for (let i = 0; i < 4; i++) await flush();
  (root.querySelector('[data-dialed="lock"]') as HTMLButtonElement).click();
  screen.unmount();
  host.remove();
  return ctx;
}

describe('end to end: a known anchor and a known optimum reach the screen as one factor', () => {
  it('the session produces enough readable reaches for the anchor to speak at all', async () => {
    const outcome = await session();
    expect(outcome.reaches.length).toBeGreaterThanOrEqual(FLICK_MIN_REACHES);
    expect(new Set(outcome.reaches.map((r) => r.rendered)).size).toBeGreaterThanOrEqual(FLICK_MIN_LEVELS);
    // The located optimum has to be interior, or buildPrescription refuses on the clamp and this
    // whole file measures the refusal path instead of the one it is here for.
    expect(outcome.report.peakAtBound).toBeUndefined();
    expect(Math.abs(outcome.report.optimalCounts / PEAK - 1)).toBeLessThan(0.12);
  });

  it('the two routes recover the belief and their combination brackets it', async () => {
    const outcome = await session();
    const flick = anchorFromReaches(outcome.reaches);
    if (flick.identifiable !== true) throw new Error(`flick anchor refused: ${flick.reason}`);
    expect(Math.abs(flick.counts / B0 - 1)).toBeLessThan(0.08);
    const anchor = reconcile(turnFromPasses([8900, 9050, 9000])!, flick);
    if (anchor === null) throw new Error('expected a combined anchor');
    expect(anchor.sources).toEqual(['turn', 'flick']);
    expect(anchor.ci90[0]).toBeLessThan(B0);
    expect(anchor.ci90[1]).toBeGreaterThan(B0);
  });

  it('the Result carries the factor, and it is the quotient of the two measured numbers', async () => {
    const outcome = await session();
    const ctx = await lockInThroughTheView(outcome);
    const r = ctx.lastResult!.result;
    const p = r.prescription;
    expect(p).toBeDefined();
    // Rebuild the anchor from the same inputs the view had. Exact equality, not a tolerance: the
    // screen must be showing the quotient of the reconciliation and the report, not something
    // recomputed, rounded or smoothed on the way through.
    const anchor = reconcile(ctx.draft.turn!, anchorFromReaches(outcome.reaches))!;
    expect(p!.ratio).toBe(anchor.counts / r.optimalCounts);
    expect(p!.ratioCi90).toEqual([anchor.ci90[0] / r.ci90![1], anchor.ci90[1] / r.ci90![0]]);
    // And it is the right number: B0 / PEAK is 1.5, and the window carries the anchor's own error
    // plus the search's. A factor near 1.00 here would mean the anchor never reached the payoff.
    expect(p!.ratio).toBeGreaterThan(1.3);
    expect(p!.ratio).toBeLessThan(1.7);
    // The interval brackets the point estimate and never claims a change it cannot distinguish.
    expect(p!.ratioCi90![0]).toBeLessThanOrEqual(p!.ratio!);
    expect(p!.ratioCi90![1]).toBeGreaterThanOrEqual(p!.ratio!);
    expect(ratioFraming(p!.ratioCi90!)).toBe('directional');
  });

  it('the screen renders that factor and that interval, to the resolution the copy quotes', async () => {
    const outcome = await session();
    const ctx = await lockInThroughTheView(outcome);
    const p = ctx.lastResult!.result.prescription!;
    const host = document.createElement('div');
    document.body.appendChild(host);
    result(host, ctx).mount();

    const tierOne = host.querySelector('[data-tier="one"]') as HTMLElement;
    expect(tierOne.dataset.hero).toBe('ratio');
    // Two decimals is the factor's honest resolution (the anchor floor is about 4 percent), and the
    // screen must print the number it was handed rather than one it re-derived.
    expect(host.querySelector('[data-result="ratio"]')!.textContent).toBe(p.ratio!.toFixed(2));
    expect(host.querySelector('[data-result="ratio-ci"]')!.textContent)
      .toBe(`${p.ratioCi90![0].toFixed(2)} to ${p.ratioCi90![1].toFixed(2)}`);
    // The lead is the instruction, and the located counts are still on the page as tier three.
    expect(host.querySelector('.result__lead')!.textContent).toBe('Multiply your in-game sensitivity by');
    expect(host.querySelector('[data-result="tier-three-counts"]')!.textContent)
      .toBe(Math.round(ctx.lastResult!.result.optimalCounts).toLocaleString('en-US'));
    // No pin this session, so tier two is withheld and tier three keeps browser counts and names
    // the second unmeasured factor rather than converting past it.
    expect((host.querySelector('[data-result="tier-three-counts"]') as HTMLElement).dataset.countsKind)
      .toBe('browser');
    expect(host.querySelector('[data-result="tier-two-withheld"]')).not.toBeNull();
    host.remove();
  });

  it('the spoken summary carries the same factor and the same interval as the visible one', async () => {
    // The screen-reader line is not a paraphrase: a player using it gets the same instruction, with
    // the range spelled " to " so no en-dash glyph is ever voiced.
    const outcome = await session();
    const ctx = await lockInThroughTheView(outcome);
    const p = ctx.lastResult!.result.prescription!;
    const host = document.createElement('div');
    document.body.appendChild(host);
    result(host, ctx).mount();
    const sr = host.querySelector('.result__sr-summary')!.textContent!;
    expect(sr).toContain(`Multiply your in-game sensitivity by ${p.ratio!.toFixed(2)}`);
    expect(sr).toContain(`${p.ratioCi90![0].toFixed(2)} to ${p.ratioCi90![1].toFixed(2)}`);
    expect(sr).not.toContain('–');
    host.remove();
  });
});
