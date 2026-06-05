# Click-Only Auto-Refining Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make calibration click-and-aim only: a click-only spin (lift to continue) for the starting point, then the optimizer refines your cm/360 generation after generation while you watch it settle and lock it in; the game pick is deferred to the result.

**Architecture:** The evolutionary `runSession` already does the refinement. We add two additive seams to it (`shouldStop`, `initialTrials`), replace the arrow-tuned turn with a tap/hold spin shell, run the session in segments so the player can lock-in or keep-refining at each convergence (releasing pointer lock to click), and defer the game pick (the result already lists every game).

**Tech Stack:** TypeScript (strict, exactOptionalPropertyTypes), Vite, Vitest, canvas 2D, Pointer Lock API, Three.js (arena, untouched).

**Reference:** Spec at `docs/superpowers/specs/2026-06-05-auto-refine-calibration-design.md`.

**Conventions:** No em dashes anywhere (use hyphens). Commit messages end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: `runSession` gains `shouldStop` + `initialTrials`

Two additive, optional config fields. `initialTrials` seeds the trial list (and so skips cold-start when enough are supplied), enabling "keep refining" to resume. `shouldStop` lets the caller break the loop. Nothing else changes.

**Files:**
- Modify: `src/optimizer/session-controller.ts`
- Test: `tests/optimizer/session-controller.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/optimizer/session-controller.test.ts` (reuse the file's existing fake-instrument/fake-scene helpers; if it lacks them, mirror the pattern from `tests/instruments/*` using a scripted scene). These tests use a trivial fake instrument that returns a fixed `TrialResult`:

```ts
import { describe, it, expect } from 'vitest';
import { runSession } from '../../src/optimizer/session-controller';
import type { ArenaScene, Instrument, InstrumentId, Profile, TrialResult } from '../../src/types';

const profile: Profile = { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } };
const fakeScene = {} as ArenaScene; // never used by the fake instrument
function fakeInstrument(id: InstrumentId): Instrument {
  return { id, async run(ctx) { return { instrument: id, cm360: ctx.cm360, score: 1 - Math.abs(Math.log(ctx.cm360 / 30)), samples: 1 } as unknown as TrialResult; } };
}
const instruments = { track: fakeInstrument('track'), flick: fakeInstrument('flick'), calibrate: fakeInstrument('calibrate'), strike: fakeInstrument('strike') };
const engine = { suggest: () => 30 };

describe('runSession shouldStop / initialTrials', () => {
  it('stops the loop when shouldStop returns true', async () => {
    let n = 0;
    const { trials } = await runSession({
      dpi: 800, profile, bounds: [10, 90], engine, instruments, scene: fakeScene,
      schedule: ['track', 'flick', 'calibrate', 'strike'], maxTrials: 24, coldStart: 4,
      rng: () => 0.5, shouldStop: () => { n += 1; return n >= 6; }, // stop after the 6th check
    });
    expect(trials.length).toBe(6);
  });

  it('resumes from initialTrials and skips cold-start', async () => {
    const seedTrials = Array.from({ length: 8 }, (_, i) =>
      ({ instrument: 'track', cm360: 28 + i, score: 0.5, samples: 1 } as unknown as TrialResult));
    let firstSuggestObsLen = -1;
    const resumeEngine = { suggest: (obs: readonly unknown[]) => { if (firstSuggestObsLen < 0) firstSuggestObsLen = obs.length; return 30; } };
    const { trials } = await runSession({
      dpi: 800, profile, bounds: [10, 90], engine: resumeEngine, instruments, scene: fakeScene,
      schedule: ['track', 'flick', 'calibrate', 'strike'], maxTrials: 10, coldStart: 4,
      rng: () => 0.5, initialTrials: seedTrials,
    });
    expect(trials.length).toBe(10);            // 8 seeded + 2 new
    expect(firstSuggestObsLen).toBeGreaterThan(0); // suggest ran immediately (no cold-start seeds)
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/optimizer/session-controller.test.ts`
Expected: FAIL - `shouldStop` / `initialTrials` not in `SessionConfig` (TS) and not honored.

- [ ] **Step 3: Add the fields to `SessionConfig`**

In `src/optimizer/session-controller.ts`, add to the `SessionConfig` interface (after `interimBootstrapIters`):

```ts
  /** Pre-existing trials to resume from. When supplied, the loop starts with these (a copy) and
   *  cold-start seeds only run if fewer than `coldStart` are present - so a converged session can be
   *  continued ("keep refining") without re-seeding. */
  initialTrials?: readonly TrialResult[];
  /** Checked once per iteration after the trial + onTrial; returning true breaks the loop and
   *  finalizes from the trials gathered so far (a user "lock it in"). */
  shouldStop?: () => boolean;
```

- [ ] **Step 4: Honor them in the loop**

In `runSession`, change the `trials` initialization and add the `shouldStop` check. Replace:

```ts
  const trials: TrialResult[] = [];
  while (trials.length < config.maxTrials) {
```

with:

```ts
  const trials: TrialResult[] = config.initialTrials ? [...config.initialTrials] : [];
  while (trials.length < config.maxTrials) {
    if (config.shouldStop?.()) break;
```

(The cold-start condition `trials.length < coldStart` already self-skips when `initialTrials` is long enough, so no other change is needed. The `shouldStop` check at the top of the loop also prevents an extra trial after a stop request.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/optimizer/session-controller.test.ts`
Expected: PASS (all, including the existing session-controller tests).

- [ ] **Step 6: Commit**

```bash
git add src/optimizer/session-controller.ts tests/optimizer/session-controller.test.ts
git commit -m "feat(optimizer): runSession shouldStop + initialTrials (resume) seams

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Click-only spin replaces the arrow-tuned turn; game step removed

Coordinated front-flow change: the reducer renames `turn` -> `spin` and drops the `game` step; a new `spin-view.ts` shell implements the tap/hold spin; `turn-view.ts` is deleted; `setup.ts` mounts the spin and commits with defaults. All compile-green together.

**Files:**
- Modify: `src/ui/calibrate-flow.ts` (full new contents)
- Create: `src/ui/calibrate/spin-view.ts`
- Delete: `src/ui/calibrate/turn-view.ts`
- Modify: `src/ui/setup.ts`
- Test: `tests/ui/calibrate-flow.test.ts`, `tests/ui/setup.test.ts`

- [ ] **Step 1: Update the reducer tests (write failing)**

Replace the body of `tests/ui/calibrate-flow.test.ts` with (drops the `game`/`turn` assertions, adds `spin`):

```ts
import { describe, it, expect } from 'vitest';
import { calibrateReducer, initialCalState, type CalState } from '../../src/ui/calibrate-flow';

describe('calibrateReducer', () => {
  const s0: CalState = initialCalState();

  it('guided start moves to the sweep', () => {
    expect(calibrateReducer(s0, { type: 'start-guided' }).step).toBe('sweep');
  });

  it('a clean sweep stores DPI and advances to the spin', () => {
    const s = calibrateReducer({ ...s0, step: 'sweep' }, { type: 'sweep-done', dpi: 1600, accelerated: false });
    expect(s.step).toBe('spin');
    expect(s.dpi).toBe(1600);
  });

  it('an accelerated sweep blocks', () => {
    expect(calibrateReducer({ ...s0, step: 'sweep' }, { type: 'sweep-done', dpi: 1600, accelerated: true }).step).toBe('blocked');
  });

  it('retry from blocked returns to the sweep and clears stale dpi', () => {
    const s = calibrateReducer({ ...s0, step: 'blocked', dpi: 1600 }, { type: 'retry' });
    expect(s.step).toBe('sweep');
    expect(s.dpi).toBeNull();
  });

  it('manual entry is reachable from intro and returns to it', () => {
    const m = calibrateReducer(s0, { type: 'start-manual' });
    expect(m.step).toBe('manual');
    expect(calibrateReducer(m, { type: 'back-to-intro' }).step).toBe('intro');
  });
});
```

- [ ] **Step 2: Update the setup test (write failing)**

In `tests/ui/setup.test.ts`, the first test already asserts the intro buttons + no pad field; keep it. The manual-path test is unchanged. No new failing assertion is required here beyond what Task compiles; run the suite in Step 8.

- [ ] **Step 3: Run reducer tests to verify they fail**

Run: `npx vitest run tests/ui/calibrate-flow.test.ts`
Expected: FAIL - `sweep-done` still goes to `turn`, not `spin`.

- [ ] **Step 4: Rewrite the reducer**

Replace the entire contents of `src/ui/calibrate-flow.ts`:

```ts
// Pure step machine for the guided calibration (mirrors the gateReducer pattern: pure transitions,
// thin DOM in the screen). The screen performs navigation + draft writes; the spin commits via its
// onSeed callback, so there is no 'game' step and no terminal action in the reducer.
export type CalStep = 'intro' | 'sweep' | 'spin' | 'manual' | 'blocked';

export interface CalState {
  step: CalStep;
  dpi: number | null;
}

export type CalAction =
  | { type: 'start-guided' }
  | { type: 'start-manual' }
  | { type: 'sweep-done'; dpi: number; accelerated: boolean }
  | { type: 'retry' }
  | { type: 'back-to-intro' };

export function initialCalState(): CalState {
  return { step: 'intro', dpi: null };
}

export function calibrateReducer(state: CalState, action: CalAction): CalState {
  switch (action.type) {
    case 'start-guided':
      return { ...state, step: 'sweep' };
    case 'start-manual':
      return { ...state, step: 'manual' };
    case 'sweep-done':
      return { ...state, dpi: action.dpi, step: action.accelerated ? 'blocked' : 'spin' };
    case 'retry':
      return { ...state, step: 'sweep', dpi: null };
    case 'back-to-intro':
      return { ...state, step: 'intro' };
  }
}
```

- [ ] **Step 5: Create the spin view**

Create `src/ui/calibrate/spin-view.ts`:

```ts
// src/ui/calibrate/spin-view.ts
// Thin shell: a click-only full-turn spin that yields a personalized seed cm/360. The player swipes
// to fill a radial dial; a quick TAP completes (seed = total swept counts treated as one 360); a
// HOLD (press, lift/reset, release) suspends counting so they can reposition when they run out of
// pad. Reduced-motion users take the typed fast path instead. Runtime-verified, not unit-tested.
import { createPointerLock } from '../../input/pointer-lock';
import { degPerCountFor, cm360FromTurnCounts } from '../../convert/turn-rate';
import type { Cm360 } from '../../types';

export interface SpinView { dispose(): void; }

const PROVISIONAL_CM360 = 30; // visual dial rate only; NOT the measured seed
const TAP_MS = 220;           // press shorter than this (with little movement) = a tap (done)
const TAP_MOVE_MAX = 40;      // counts of movement during a press still considered "still" (a tap)
const MIN_DONE_DEG = 270;     // must have swept >= this (at the provisional rate) for a tap to complete

export function createSpinView(host: HTMLElement, opts: { dpi: number; onSeed: (cm360: Cm360) => void }): SpinView {
  host.innerHTML = `
    <section class="screen screen--arena fade-in">
      <div class="wrap stack">
        <h2 class="display">+ the spin</h2>
        <p class="gate__lead" data-spin="lead">click to lock, then spin all the way around once - the way you'd whip around in game. tap when you're facing forward again. ran out of room? hold the button, reset your mouse, let go.</p>
        <div class="calibrate__stage">
          <canvas class="calibrate__canvas" data-spin="canvas"></canvas>
          <div class="calibrate__hint" data-spin="hint"><span>click to lock + start spinning</span></div>
        </div>
        <p class="mono" data-spin="status">spin one full turn</p>
      </div>
    </section>`;

  const $ = (s: string) => host.querySelector(`[data-spin="${s}"]`) as HTMLElement;
  const canvas = $('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  const pointer = createPointerLock(canvas);
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const degPerCount = degPerCountFor(PROVISIONAL_CM360, opts.dpi);

  let swept = 0;            // signed accumulated horizontal counts (magnitude = total travel)
  let paused = false;      // counting suspended (set on mousedown until classified)
  let repositioning = false; // UI: showing the reposition prompt (set by the hold timer)
  let W = 0, H = 0;
  let downAt = 0, downSwept = 0;
  let holdTimer: number | null = null;

  const progressDeg = (): number => Math.abs(swept) * degPerCount;

  function size(): void {
    const r = canvas.getBoundingClientRect(); W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0); draw();
  }
  function draw(): void {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, rad = Math.max(20, Math.min(W, H) * 0.32);
    ctx.lineWidth = 10; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(234,231,220,0.14)';
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke();
    const frac = Math.min(1, progressDeg() / 360);
    ctx.strokeStyle = repositioning ? '#ffb020' : '#FFC400';
    ctx.beginPath(); ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ff3b30'; ctx.beginPath(); ctx.arc(cx, cy - rad, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(234,231,220,0.92)'; ctx.font = '600 26px ui-monospace, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(repositioning ? 'reposition' : Math.round(Math.min(360, progressDeg())) + '°', cx, cy);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  function setLead(t: string): void { $('lead').textContent = t; }

  const off = pointer.onSample((s) => {
    if (!pointer.isLocked() || paused) return;
    swept += s.dx; draw();
  });

  const onDown = (ev: MouseEvent): void => {
    if (!pointer.isLocked() || ev.button !== 0) return;
    downAt = ev.timeStamp; downSwept = swept; paused = true; // suspend until classified
    holdTimer = window.setTimeout(() => { repositioning = true; setLead('repositioning - reset your mouse, then let go'); draw(); }, TAP_MS);
  };
  const onUp = (ev: MouseEvent): void => {
    if (ev.button !== 0 || downAt === 0) return;
    if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; }
    const dt = ev.timeStamp - downAt;
    const moved = Math.abs(swept - downSwept);
    downAt = 0;
    const isTap = dt < TAP_MS && moved < TAP_MOVE_MAX;
    if (isTap && progressDeg() >= MIN_DONE_DEG) {
      pointer.exit();
      opts.onSeed(cm360FromTurnCounts(Math.abs(swept), opts.dpi));
      return;
    }
    paused = false; repositioning = false;
    setLead('keep spinning until home is back in front of you'); draw();
  };

  const onLock = (): void => { $('hint').style.display = pointer.isLocked() ? 'none' : 'flex'; };
  const onCanvasClick = (): void => { if (!pointer.isLocked()) void pointer.request().catch(() => {}); };
  document.addEventListener('pointerlockchange', onLock);
  document.addEventListener('mousedown', onDown);
  document.addEventListener('mouseup', onUp);
  window.addEventListener('resize', size);
  canvas.addEventListener('click', onCanvasClick);
  size();

  return { dispose() {
    off();
    if (holdTimer !== null) clearTimeout(holdTimer);
    document.removeEventListener('pointerlockchange', onLock);
    document.removeEventListener('mousedown', onDown);
    document.removeEventListener('mouseup', onUp);
    window.removeEventListener('resize', size);
    canvas.removeEventListener('click', onCanvasClick);
    pointer.dispose();
  } };
}
```

- [ ] **Step 6: Delete the turn view**

```bash
git rm src/ui/calibrate/turn-view.ts
```

- [ ] **Step 7: Rewire `setup.ts`**

In `src/ui/setup.ts`:

(a) Replace the turn-view import:

```ts
import { createSpinView, type SpinView } from './calibrate/spin-view';
```

(remove the `createTurnView, type TurnView` import line). Update the `view` union type accordingly:

```ts
  let view: SweepView | SpinView | null = null;
```

(b) Replace the `turn` render branch with a `spin` branch:

```ts
    if (state.step === 'spin' && state.dpi !== null) {
      const dpi = state.dpi;
      view = createSpinView(host, { dpi, onSeed: (cm) => commitGuided(cm) });
      return;
    }
```

(c) Change `commitGuided` to take only the seed and default game/profile:

```ts
  function commitGuided(seedCm360: number): void {
    const dpi = state.dpi;
    if (dpi !== null) ctx.draft.dpi = dpi;
    ctx.draft.profile = { ...ctx.draft.profile, speedAccuracy: 0.5 }; // balanced default; tune later on options
    ctx.draft.bounds = boundsFromSeed(seedCm360);
    ctx.navigate('session');
  }
```

(d) Remove the `// step === 'game'` branch of `stepHtml()` entirely (the function's final `return` block). After removing it, ensure `stepHtml()` still returns a string on every path: the branches are `intro`, `blocked`, `manual`; add a final fallback `return '';` (the `spin` step never reaches `stepHtml` because it returns early in `render()`).

(e) Remove the now-unused `game-begin` wiring line in `wire()`:

```ts
    // delete: click('game-begin', () => commitGuided(...));
```

(f) Remove unused imports if they become unused: `GAME_YAW`/`yawFor`/`cmPer360`/`GameId` are still used by `gameOptions`/`commitManual`, so keep them. Confirm with tsc in Step 8.

- [ ] **Step 8: Typecheck + run affected tests**

Run: `npx tsc --noEmit && npx vitest run tests/ui/calibrate-flow.test.ts tests/ui/setup.test.ts`
Expected: tsc clean; tests PASS. (If `setup.test.ts`'s manual-path test references anything removed, it should not - the manual path is untouched.)

- [ ] **Step 9: Commit**

```bash
git add src/ui/calibrate-flow.ts src/ui/calibrate/spin-view.ts src/ui/setup.ts tests/ui/calibrate-flow.test.ts tests/ui/setup.test.ts
git rm --cached src/ui/calibrate/turn-view.ts 2>/dev/null; true
git commit -m "feat(ui): click-only spin (tap/hold) replaces the arrow-tuned turn; defer game pick

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Watch-and-lock-in session (segments + dialed-in panel)

The session runs in segments. A segment runs until its CI is tight (or a cap); then it releases pointer lock and shows a "dialed in" panel with the number + CI and two actions: lock it in (-> result) or keep refining (-> another segment from the accumulated trials). The live plot still updates every trial (watch).

**Files:**
- Modify: `src/ui/arena-stage.ts` (add `exitLock`)
- Modify: `src/ui/session-view.ts` (full new contents)
- Test: existing `tests/ui/session-view.test.ts` must still pass (the scored-session contract is unchanged); no new unit test (the segment/panel flow is a runtime-verified shell).

- [ ] **Step 1: Add `exitLock` to the arena stage**

In `src/ui/arena-stage.ts`, add to the `ArenaStage` interface (after `requestLock`):

```ts
  /** Release pointer lock (hand the cursor back, e.g. to click the dialed-in panel). */
  exitLock(): void;
```

and to the returned object (after `requestLock`):

```ts
    exitLock: () => pointer.exit(),
```

- [ ] **Step 2: Rewrite `session-view.ts`**

Replace the entire contents of `src/ui/session-view.ts`:

```ts
import { makeEvolution } from '../optimizer/evolution';
import { runSession } from '../optimizer/session-controller';
import { buildResult } from '../optimizer/result';
import { INSTRUMENTS } from '../instruments/registry';
import { mulberry32 } from '../stats/rng';
import { plotGeometry, renderConvergencePlot, type PlotMark } from './convergence-plot';
import { createArenaStage } from './arena-stage';
import type { AppContext, Screen } from './shell';
import type { InstrumentId, Report, TrialResult } from '../types';

const SCHEDULE: InstrumentId[] = ['flick', 'track', 'calibrate', 'strike'];
const MAX_TRIALS = 30;       // hard cap across all segments
const COLD_START = 8;        // Generation 0 - the initial gene pool
const FIRST_STOP_CI = 6;     // a segment converges when the 90% CI (cm/360) is tighter than this
const REFINE_GENS = 6;       // extra generations per "keep refining"

export function marksFromTrials(trials: readonly TrialResult[]): PlotMark[] {
  return trials.map((t) => ({ cm360: t.cm360, score: t.score, instrument: t.instrument }));
}

const COPY: Record<InstrumentId, string> = {
  track: '+track · the open-air intercept - hold your lead on the weaving prey (dragonfly + falcon)',
  flick: '+flick · the ambush - break-cover targets to snap and lock (spider + raptor)',
  calibrate: '+calibrate · shooting through the bend - learn the gap between aim and impact (archerfish)',
  strike: '+strike · the strike window - commit the instant you see it, no settling (mantis shrimp)',
};
export function instructionFor(id: InstrumentId): string { return COPY[id]; }

/** Live HUD line: cold-start trials are Generation 0; after that each trial is a numbered generation. */
export function searchLabel(index: number, cm360: number, coldStart: number): string {
  const testing = `testing ${cm360.toFixed(1)} cm/360`;
  return index < coldStart ? `gen 0 · seeding the gene pool · ${testing}` : `generation ${index - coldStart + 1} · ${testing}`;
}

export function sessionView(host: HTMLElement, ctx: AppContext): Screen {
  let alive = true;
  let cleanup: (() => void) | null = null;

  return {
    mount() {
      const root = document.createElement('section');
      root.className = 'screen screen--arena session';
      root.innerHTML = `
        <canvas class="session__canvas"></canvas>
        <div class="session__crosshair" aria-hidden="true"></div>
        <header class="session__hud mono"><span data-hud="instruction">click to lock in</span>
          <span data-hud="progress"></span></header>
        <figure class="session__plot"><svg data-plot aria-label="convergence on your optimal cm/360"></svg>
          <figcaption class="mono" data-hud="estimate"></figcaption></figure>
        <div class="session__dialed" data-dialed hidden>
          <p class="mono session__dialed-label">dialed in</p>
          <p class="display session__dialed-num"><span data-dialed="num"></span><small> cm/360</small></p>
          <p class="mono session__dialed-ci">90% CI <span data-dialed="ci"></span></p>
          <div class="session__dialed-actions">
            <button class="action action--primary" data-dialed="lock">lock it in</button>
            <button class="action action--ghost" data-dialed="refine">keep refining</button>
          </div>
        </div>`;
      host.appendChild(root);

      const canvas = root.querySelector('canvas') as HTMLCanvasElement;
      const svg = root.querySelector('[data-plot]') as unknown as SVGElement;
      const hudInstruction = root.querySelector('[data-hud="instruction"]')!;
      const hudProgress = root.querySelector('[data-hud="progress"]')!;
      const hudEstimate = root.querySelector('[data-hud="estimate"]')!;
      const panel = root.querySelector('[data-dialed]') as HTMLElement;
      const $d = (s: string) => root.querySelector(`[data-dialed="${s}"]`) as HTMLElement;

      const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const stage = createArenaStage(root, { canvas, cm360: ctx.draft.bounds[0], dpi: ctx.draft.dpi, reducedMotion: reduced });
      const engine = makeEvolution({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.1 }, sigma0: 0.3, maxTrials: MAX_TRIALS });

      let allTrials: TrialResult[] = [];
      let lastReport: Report | null = null;
      let lockedIn = false;

      const drawPlot = (report: Report, trials: readonly TrialResult[]): void => {
        const g = plotGeometry({
          bounds: ctx.draft.bounds, marks: marksFromTrials(trials),
          curve: report.curve, ci90: report.ci90, peak: report.optimalCm360,
          size: { width: svg.clientWidth || 360, height: svg.clientHeight || 180 },
        });
        renderConvergencePlot(svg, g, 'blended score');
        hudEstimate.textContent = `most-evolved · ${report.optimalCm360.toFixed(1)} cm/360 · 90% CI ${report.ci90[0].toFixed(1)}–${report.ci90[1].toFixed(1)}`;
      };

      const runSegment = async (maxTrials: number, ciStopWidth: number | undefined): Promise<void> => {
        const { report, trials } = await runSession({
          dpi: ctx.draft.dpi, profile: ctx.draft.profile, bounds: ctx.draft.bounds,
          engine, instruments: INSTRUMENTS, scene: stage.arena, schedule: SCHEDULE,
          maxTrials, coldStart: COLD_START, rng: mulberry32(2026), minTrials: 12,
          ...(ciStopWidth !== undefined ? { ciStopWidth } : {}),
          bootstrapIters: 300, initialTrials: allTrials, shouldStop: () => lockedIn,
          onTrialStart: (id, i, cm360) => {
            hudInstruction.textContent = instructionFor(id);
            hudProgress.textContent = searchLabel(i, cm360, COLD_START);
            stage.setEnemyEnvironment(id);
            stage.arena.clearTargets();
          },
          onTrial: (_t, trials2, interim) => { lastReport = interim; drawPlot(interim, trials2); },
        });
        allTrials = trials; lastReport = report;
      };

      const finalize = (): void => {
        if (!alive || !lastReport) return;
        const report = lastReport;
        const sessionId = `s-${allTrials.length}-${Math.round(report.optimalCm360 * 100)}`;
        const result = buildResult(report, allTrials, ctx.draft.dpi);
        ctx.storage.saveSession({ id: sessionId, dpi: ctx.draft.dpi, profile: ctx.draft.profile, trials: [...allTrials], status: 'complete', createdAt: 0 });
        ctx.storage.saveResult(sessionId, result);
        ctx.lastResult = { sessionId, result };
        ctx.navigate('result');
      };

      const showPanel = (report: Report): void => {
        stage.exitLock();
        drawPlot(report, allTrials);
        $d('num').textContent = report.optimalCm360.toFixed(1);
        $d('ci').textContent = `${report.ci90[0].toFixed(1)}–${report.ci90[1].toFixed(1)} cm/360`;
        panel.hidden = false;
      };

      const begin = async (): Promise<void> => {
        stage.playViewmodel('flickDraw', 'idleReady');
        await runSegment(Math.min(MAX_TRIALS, COLD_START + 12), FIRST_STOP_CI);
        if (!alive) return;
        if (lockedIn) { finalize(); return; }
        showPanel(lastReport!);
      };

      $d('lock').addEventListener('click', () => { lockedIn = true; panel.hidden = true; finalize(); });
      $d('refine').addEventListener('click', () => {
        panel.hidden = true;
        void stage.requestLock().catch(() => {});
        const target = Math.min(MAX_TRIALS, allTrials.length + REFINE_GENS);
        if (target <= allTrials.length) { finalize(); return; } // hit the cap - lock in
        void runSegment(target, undefined).then(() => { if (alive) showPanel(lastReport!); });
      });

      canvas.addEventListener('click', () => void stage.requestLock().then(begin).catch(begin), { once: true });

      cleanup = () => { alive = false; lockedIn = true; stage.dispose(); };
    },
    unmount() { cleanup?.(); host.replaceChildren(); },
  };
}
```

- [ ] **Step 3: Typecheck + run the session-view test**

Run: `npx tsc --noEmit && npx vitest run tests/ui/session-view.test.ts`
Expected: tsc clean; the existing session-view test PASSES (it pins the scored-session contract: schedule, draft writes, navigation - unchanged here). If the test asserts an exact `MAX_TRIALS` or `ciStopWidth`, update the assertion to the new segment behavior (the scored result + navigation contract must remain).

- [ ] **Step 4: Commit**

```bash
git add src/ui/arena-stage.ts src/ui/session-view.ts tests/ui/session-view.test.ts
git commit -m "feat(ui): watch-and-lock-in session (segments + dialed-in panel)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Result screen "your game" highlight selector

The per-game table already lists every game's sensitivity. Add a small `<select>` that re-highlights the chosen row (pure client-side; no recompute), so the deferred game pick happens here.

**Files:**
- Modify: `src/ui/result.ts`
- Test: `tests/ui/result.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/ui/result.test.ts` (it uses jsdom + a fake ctx with a `lastResult`; mirror the existing setup in that file):

```ts
  it('the your-game selector re-highlights the matching row', () => {
    const ctx = fakeCtxWithResult(); const host = document.createElement('div');
    result(host, ctx).mount();
    const select = host.querySelector('[data-action="your-game"]') as HTMLSelectElement;
    expect(select).toBeTruthy();
    const target = 'valorant';
    select.value = target; select.dispatchEvent(new Event('change'));
    const row = host.querySelector(`tr[data-game="${target}"]`) as HTMLElement;
    expect(row.getAttribute('data-current')).toBe('true');
    // only one row is current
    expect(host.querySelectorAll('tr[data-current="true"]').length).toBe(1);
  });
```

(If `tests/ui/result.test.ts` lacks a `fakeCtxWithResult` helper, add one building a minimal `Result` with `perGameSens` for at least two `GAME_YAW` ids and `optimalCm360`/`ci90`/`breakdown` finite values.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/ui/result.test.ts`
Expected: FAIL - no `[data-action="your-game"]` selector.

- [ ] **Step 3: Add the selector + highlight logic**

In `src/ui/result.ts`, add a select above the table (inside `result__inner`, before the `<table>`):

```ts
          <label class="field result__game-pick">your game
            <select data-action="your-game">${GAME_YAW.map((g) => `<option value="${g.id}"${g.id === ctx.draft.currentGame ? ' selected' : ''}>${g.label}</option>`).join('')}</select></label>
```

and after `host.appendChild(root);` in `mount()`, wire it:

```ts
      const sel = root.querySelector('[data-action="your-game"]') as HTMLSelectElement | null;
      sel?.addEventListener('change', () => {
        root.querySelectorAll('tr[data-current="true"]').forEach((tr) => tr.removeAttribute('data-current'));
        const row = root.querySelector(`tr[data-game="${sel.value}"]`);
        row?.setAttribute('data-current', 'true');
      });
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/ui/result.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/result.ts tests/ui/result.test.ts
git commit -m "feat(ui): your-game highlight selector on the result (deferred game pick)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Styles + final verification

**Files:**
- Modify: `src/styles/calibrate.css` (or the session stylesheet) - the dialed-in panel + minor spin tweaks
- Verification only otherwise

- [ ] **Step 1: Style the dialed-in panel**

Append to `src/styles/calibrate.css` (the panel overlays the session, centered, brand gold accent):

```css
.session__dialed { position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 10px; text-align: center;
  background: rgba(13,13,13,.82); backdrop-filter: blur(3px); z-index: 5; }
.session__dialed[hidden] { display: none; }
.session__dialed-label { letter-spacing: .14em; text-transform: uppercase; color: var(--gold, #FFC400); }
.session__dialed-num { font-size: clamp(40px, 9vw, 84px); line-height: 1; }
.session__dialed-num small { font-size: .3em; opacity: .7; }
.session__dialed-ci { opacity: .75; }
.session__dialed-actions { display: flex; gap: 12px; margin-top: 12px; flex-wrap: wrap; justify-content: center; }
```

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: all tests PASS.

- [ ] **Step 3: Typecheck + production build**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc clean; build succeeds.

- [ ] **Step 4: Residue checks**

Run: `grep -rn "turn-view\|createTurnView\|turn-done\|'game'" src/ui` (expect: no stale references except unrelated matches; `createTurnView`/`turn-view`/`turn-done` must be gone).

- [ ] **Step 5: Runtime note**

Pointer lock cannot be automated headlessly. After merge + deploy, confirm by hand: the spin's tap completes + seeds, hold repositions without corrupting the count, lifts read ~0; the session shows the dialed-in panel on convergence, "lock it in" navigates to the result, "keep refining" runs more generations and re-shows the panel; the result `your game` selector re-highlights. Flag the spin constants (`TAP_MS`, `MIN_DONE_DEG`, `PROVISIONAL_CM360`) and the panel thresholds (`FIRST_STOP_CI`, `REFINE_GENS`) as feel-tunable.

- [ ] **Step 6: Commit**

```bash
git add src/styles/calibrate.css
git commit -m "style(ui): dialed-in panel for the watch-and-lock-in session

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Click-only spin + lift (tap=done, hold=reposition), personalized seed -> Task 2 (spin-view) + reuses `cm360FromTurnCounts`/`boundsFromSeed`.
- Remove arrow-tuned turn -> Task 2 (delete turn-view, reducer `turn`->`spin`).
- Watch + lock in / keep refining -> Task 1 (`shouldStop`+`initialTrials`) + Task 3 (segments + panel + `exitLock`).
- Defer game pick -> Task 2 (drop game step, commit defaults) + Task 4 (result selector).
- Honest measurement framing -> spin copy (Task 2) + spec; the optimizer (unchanged) is the measurement.
- Cut reading -> trimmed intro/spin copy (Task 2).

**Placeholder scan:** none - every code step has complete code. (`fakeCtxWithResult`/fake-instrument helpers reference existing test patterns; if absent, the step says to add them mirroring siblings.)

**Type consistency:** `CalState` is `{ step, dpi }` (no `seedCm360`, no `game` step); `CalStep` includes `spin`, excludes `turn`/`game`. `createSpinView(host, { dpi, onSeed })` matches the `setup.ts` mount. `SessionConfig` gains `initialTrials?: readonly TrialResult[]` and `shouldStop?: () => boolean`, both used in Task 3. `ArenaStage.exitLock(): void` added in Task 3 Step 1 and called in `showPanel`. `commitGuided(seedCm360: number)` matches its single call site `onSeed: (cm) => commitGuided(cm)`.

**Risk notes:** `session-view.test.ts` may assert old constants (`MAX_TRIALS`/`ciStopWidth`); Task 3 Step 3 updates it to the segment behavior while preserving the scored-result + navigation contract. The spin and the session panel are pointer-lock shells (runtime-verified), explicitly flagged for hands-on feel-tuning.
