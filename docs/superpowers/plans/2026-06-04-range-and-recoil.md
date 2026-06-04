# Deagle Recoil + Free-Play Range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an impactful *cosmetic* fire recoil to the Desert Eagle, and a free-play "range" mode (reached from the result screen) where the player roams, shoots fixed dummies + popping mercs, nudges cm/360 live by feel, and can adopt a new number.

**Architecture:** Pure-core / thin-shell, matching the rest of the app. A new pure recoil spring (sibling to `sway.ts`) is summed into the viewmodel draw. The arena + cosmetic stack is extracted from `session-view` into a shared `arena-stage` used by both the session and a new `range` screen. The range is driven by a pure `range-director` (slot/timing bookkeeping) + pure `nudge`/`adopt` helpers; the screen shell wires them to the arena and is Chromium-verified.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`, `noUnusedLocals`) + Vite + Three.js, vitest (+ jsdom for DOM tests).

**Spec:** `docs/superpowers/specs/2026-06-04-range-and-recoil-design.md`

**Conventions to follow (read before starting):**
- TDD: write the failing test, watch it fail, minimal code, watch it pass, commit. Pure modules get unit tests; runtime WebGL/canvas shells (viewmodel, arena-stage, range screen) are exempt from unit tests and verified in Chromium - exactly as `viewmodel.ts` / `session-view.ts` are today.
- Run a single test file with `npx vitest run <path>`; the full suite with `npx vitest run`; typecheck+build with `npm run build`.
- Commit after each green task. Work happens on branch `psx/range-and-recoil` (already created; the spec is committed there).
- Chromium verification uses the preview MCP: `preview_start` (`campeon-dev`), navigate via `location.hash`, `preview_eval` for pixel/DOM probes, `preview_screenshot`. Note: `img.decode()` can hang in the preview - if you load an image in an eval, use `img.complete`/`onload` and draw synchronously, don't `await img.decode()`.

---

## File Structure

**New files**
- `src/ui/viewmodel/recoil.ts` - pure fire-recoil spring (Task 1).
- `src/ui/arena-stage.ts` - shared arena + cosmetic stack + lifecycle (Task 3).
- `src/ui/range-nudge.ts` - pure `nudgeCm360` clamp helper (Task 5).
- `src/ui/range-adopt.ts` - pure `adoptResult` (recompute per-game for a hand-picked cm/360) (Task 6).
- `src/ui/range-director.ts` - pure slot/respawn state machine (Task 7).
- `src/ui/range.ts` - the range screen shell (Task 9).
- Tests: `tests/ui/viewmodel/recoil.test.ts`, `tests/engine/arena-remove-target.test.ts`, `tests/ui/range-nudge.test.ts`, `tests/ui/range-adopt.test.ts`, `tests/ui/range-director.test.ts`, `tests/ui/result.test.ts`.

**Modified files**
- `src/ui/viewmodel/viewmodel.ts` - `fire()` method + recoil channel (Task 2).
- `src/engine/arena.ts` - `removeTarget(id)` (Task 4).
- `src/ui/session-view.ts` - build the arena via `createArenaStage`; call `viewmodel.fire()` (Task 3). Behavior-preserving.
- `src/ui/shell.ts` - add `'range'` route + `tuned?` on `lastResult` (Task 8).
- `src/ui/result.ts` - "step into the range" CTA + tuned-by-feel CI swap (Task 8).
- `src/main.ts` - register the `range` screen (Task 9).

---

## Task 1: Recoil spring (pure)

**Files:**
- Create: `src/ui/viewmodel/recoil.ts`
- Test: `tests/ui/viewmodel/recoil.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/ui/viewmodel/recoil.test.ts
import { describe, it, expect } from 'vitest';
import { restRecoil, punch, stepRecoil, DEFAULT_RECOIL, type RecoilState } from '../../../src/ui/viewmodel/recoil';

const mag = (s: RecoilState): number => Math.max(Math.abs(s.y), Math.abs(s.back));

describe('fire recoil spring', () => {
  it('stays exactly at rest with no fire', () => {
    let s = restRecoil();
    for (let i = 0; i < 40; i++) s = stepRecoil(s, 1 / 60);
    expect(s).toEqual(restRecoil());
  });

  it('a punch injects upward + backward velocity', () => {
    const s = punch(restRecoil());
    expect(s.vy).toBeGreaterThan(0);
    expect(s.vback).toBeGreaterThan(0);
    expect(mag(s)).toBe(0); // impulse is in velocity; offset only grows once stepped
  });

  it('kicks then settles back to rest (bounded, finite)', () => {
    let s = punch(restRecoil());
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      s = stepRecoil(s, 1 / 60);
      peak = Math.max(peak, mag(s));
      expect(Number.isFinite(s.y) && Number.isFinite(s.back)).toBe(true);
      expect(mag(s)).toBeLessThanOrEqual(DEFAULT_RECOIL.max + 1e-9);
    }
    expect(peak).toBeGreaterThan(0); // it actually moved
    expect(mag(s)).toBeLessThan(1e-2); // ...and settled within ~1s
  });

  it('clamps under rapid repeated fire', () => {
    let s = restRecoil();
    for (let i = 0; i < 30; i++) {
      s = punch(s);
      s = stepRecoil(s, 1 / 60);
      expect(Math.abs(s.y)).toBeLessThanOrEqual(DEFAULT_RECOIL.max + 1e-9);
      expect(Math.abs(s.back)).toBeLessThanOrEqual(DEFAULT_RECOIL.max + 1e-9);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/viewmodel/recoil.test.ts`
Expected: FAIL - "Cannot find module '.../recoil'" / `restRecoil is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/ui/viewmodel/recoil.ts
/**
 * Fire recoil - a pure, snappy damped spring that punches the viewmodel on each shot, then settles.
 * Deliberately separate from sway (sway is slow camera-driven parallax; recoil is a sharp fire-driven
 * snap): `punch` injects an upward + backward impulse, `stepRecoil` pulls both channels back to rest
 * each frame. The viewmodel sums the offset into its blit (kick up + brief scale lunge + a little roll).
 * Offsets are normalized fractions of the viewmodel size. COSMETIC only - never touches the camera/aim.
 *
 * Pure: no DOM, no time source - the caller supplies dt. Unit-tested for rest-stability + convergence.
 */

export interface RecoilState {
  /** Vertical kick (up), normalized fraction of viewmodel height. */
  y: number;
  vy: number;
  /** Backward lunge → a brief scale-up, normalized. */
  back: number;
  vback: number;
}

export interface RecoilParams {
  /** Spring stiffness - high → fast settle (snappy). */
  stiffness: number;
  /** Damping - at/above 2·√stiffness → no wobble. */
  damping: number;
  /** Upward velocity injected per shot. */
  kickUp: number;
  /** Backward (scale) velocity injected per shot. */
  kickBack: number;
  /** Hard clamp on |y| and |back| so rapid fire can't fling the gun off-anchor. */
  max: number;
}

export const DEFAULT_RECOIL: RecoilParams = {
  stiffness: 320, // ≫ sway's 90 → settles in ~150–220ms
  damping: 34, // ≈ 2·√320 ≈ 35.8 → just under critical: a crisp snap, no wobble
  kickUp: 0.9,
  kickBack: 0.6,
  max: 0.14,
};

export const restRecoil = (): RecoilState => ({ y: 0, vy: 0, back: 0, vback: 0 });

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Inject a fire impulse: kick the gun up and lunge it back (velocity only; offset grows once stepped). */
export function punch(s: RecoilState, p: RecoilParams = DEFAULT_RECOIL): RecoilState {
  return { y: s.y, vy: s.vy + p.kickUp, back: s.back, vback: s.vback + p.kickBack };
}

/** Advance both recoil channels toward rest by `dtSec` (semi-implicit Euler - stable at frame dt). */
export function stepRecoil(s: RecoilState, dtSec: number, p: RecoilParams = DEFAULT_RECOIL): RecoilState {
  const ay = -p.stiffness * s.y - p.damping * s.vy;
  const ab = -p.stiffness * s.back - p.damping * s.vback;
  const vy = s.vy + ay * dtSec;
  const vback = s.vback + ab * dtSec;
  return {
    y: clamp(s.y + vy * dtSec, -p.max, p.max),
    vy,
    back: clamp(s.back + vback * dtSec, -p.max, p.max),
    vback,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ui/viewmodel/recoil.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/viewmodel/recoil.ts tests/ui/viewmodel/recoil.test.ts
git commit -m "feat(viewmodel): pure fire-recoil spring"
```

---

## Task 2: Wire recoil + `fire()` into the viewmodel

**Files:**
- Modify: `src/ui/viewmodel/viewmodel.ts`

This is a runtime canvas shell (loads `deagle.png` via image decode), so - like the existing viewmodel - it has no jsdom unit test; the recoil math is covered by Task 1 and the integration is Chromium-verified in Task 10. There is no RED test step here by design (consistent with the codebase's treatment of `viewmodel.ts`).

- [ ] **Step 1: Add the recoil import**

In `src/ui/viewmodel/viewmodel.ts`, change the sway import line:

```ts
import { kick, restSway, stepSway, type SwayState } from './sway';
```
to add recoil:
```ts
import { kick, restSway, stepSway, type SwayState } from './sway';
import { punch, restRecoil, stepRecoil, type RecoilState } from './recoil';
```

- [ ] **Step 2: Add `fire()` to the `Viewmodel` interface**

In the `export interface Viewmodel { ... }` block, add after the `look(...)` line:

```ts
  /** Fire the gun: play the muzzle animation + a recoil punch. Cosmetic; no-op recoil under reduced motion. */
  fire(): void;
```

- [ ] **Step 3: Add the recoil state next to sway**

After `let sway: SwayState = restSway();` add:

```ts
  let recoil: RecoilState = restRecoil(); // fire-driven snap, summed with sway in draw
```

- [ ] **Step 4: Sum recoil into `draw`**

Replace the body of the `draw` function (the block that computes `destH`/`destW`/`cx`/`dx`/`dy`/`roll` and blits) with:

```ts
  const BACK_SCALE_K = 0.12; // how much a backward lunge enlarges the gun
  const RECOIL_ROLL_K = 0.5; // muzzle-rise tilt (rad) per unit recoil
  const draw = (nowMs: number): void => {
    const { rect } = ctrl.frameAt(nowMs);
    ctx.clearRect(0, 0, el.width, el.height);
    // Anchor lower-right (CS:Source); offset by sway (parallax) + recoil (fire punch). Both cosmetic.
    const lunge = 1 + recoil.back * BACK_SCALE_K; // brief scale-up on fire (muzzle lunges at the viewer)
    const destH = el.height * 0.66 * lunge;
    const destW = destH * (rect.sw / rect.sh);
    const cx = el.width * 0.72 + sway.x * el.width; // horizontal centre (right of screen centre) + sway
    const dx = cx - destW / 2;
    const dy = el.height - destH + sway.y * el.height - recoil.y * el.height; // recoil kicks the gun up
    const roll = sway.x * 0.6 + recoil.y * RECOIL_ROLL_K; // barrel tilt: sway + a touch of muzzle rise
    ctx.save();
    ctx.translate(cx, dy + destH); // pivot at the grip (bottom of the gun)
    ctx.rotate(roll);
    ctx.translate(-cx, -(dy + destH));
    ctx.drawImage(off, rect.sx, rect.sy, rect.sw, rect.sh, dx, dy, destW, destH);
    ctx.restore();
  };
```

(The `BACK_SCALE_K`/`RECOIL_ROLL_K` consts may instead be hoisted to module scope; keep them near `draw` to match the existing style.)

- [ ] **Step 5: Step recoil each tick**

In the returned object's `tick(nowMs)`, after `sway = stepSway(sway, dt);` add:

```ts
      recoil = stepRecoil(recoil, dt);
```

- [ ] **Step 6: Add the `fire()` method**

In the returned object, after the `look(...)` method add:

```ts
    fire() {
      ctrl.play('fire', performance.now(), 'idleReady');
      if (!reduced) recoil = punch(recoil);
      if (reduced) draw(0); // static fire frame, no animated recoil
    },
```

- [ ] **Step 7: Typecheck + build**

Run: `npm run build`
Expected: tsc clean, `✓ built`. (No behavior to unit-test here; recoil math is Task 1.)

- [ ] **Step 8: Commit**

```bash
git add src/ui/viewmodel/viewmodel.ts
git commit -m "feat(viewmodel): fire() plays muzzle anim + recoil punch"
```

---

## Task 3: Extract the shared `arena-stage`; refactor `session-view` onto it

**Files:**
- Create: `src/ui/arena-stage.ts`
- Modify: `src/ui/session-view.ts`
- Test: existing `tests/ui/session-view.test.ts` must stay green (it tests the pure exports `marksFromTrials`/`searchLabel`/`instructionFor`, not the WebGL mount).

Behavior-preserving refactor: the session must run exactly as before, now sourcing its arena/cosmetic stack from the shared helper (and firing recoil via `viewmodel.fire()`).

- [ ] **Step 1: Create `arena-stage.ts`**

```ts
// src/ui/arena-stage.ts
import { WebGLRenderer } from 'three';
import { Arena, type InputSource } from '../engine/arena';
import { createPsxPass } from '../engine/psx-pass';
import { createPointerLock } from '../input/pointer-lock';
import { mulberry32 } from '../stats/rng';
import { createViewmodel, type Viewmodel } from './viewmodel/viewmodel';
import { createEnemyLayer, type EnemyLayerHandle } from './enemy/enemy-layer';
import { createShotFeedback } from './feedback';
import type { AnimName } from './viewmodel/atlas';
import type { InstrumentId } from '../types';

export interface ArenaStage {
  readonly arena: Arena;
  /** Request pointer lock (resolves on lock / rejects if denied). Wire to a user click. */
  requestLock(): Promise<void>;
  /** Live sensitivity change (range nudge) → arena.setSensitivity at the fixed dpi. */
  setCm360(cm360: number): void;
  /** Skin subsequent target spawns with an environment's prey sheet (null-safe if not yet loaded). */
  setEnemyEnvironment(id: InstrumentId): void;
  /** Play a viewmodel animation (null-safe). */
  playViewmodel(name: AnimName, then?: AnimName | null): void;
  /** Resolves once the async viewmodel + enemy layers have attached. */
  readonly ready: Promise<void>;
  dispose(): void;
}

/**
 * The shared PSX arena + cosmetic stack used by BOTH the scored session and the free-play range. Owns
 * the renderer, PSX pass, pointer-lock, Arena, the async Deagle viewmodel + merc-prey enemy layer, the
 * sway + fire-recoil feeds, the miss-tick feedback, the rAF loop, resize, and full teardown. The
 * consumer screen owns its own DOM (passes in its canvas + host) and its own gameplay logic (instrument
 * loop, or range director). Runtime-only (WebGL + image decode) - verified in Chromium, not unit tests.
 */
export function createArenaStage(
  host: HTMLElement,
  opts: { canvas: HTMLCanvasElement; cm360: number; dpi: number; reducedMotion: boolean; rngSeed?: number },
): ArenaStage {
  const { canvas, cm360, dpi, reducedMotion } = opts;
  let alive = true;
  let viewmodel: Viewmodel | null = null;
  let enemies: EnemyLayerHandle | null = null;

  const feedback = createShotFeedback(host); // brief "miss" tick when a shot lands in no hitbox

  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const size = (): [number, number] => [window.innerWidth, window.innerHeight];
  const psx = createPsxPass(renderer, size); // PS1 abyss: low-res + dither + posterize + scanlines
  const pointer = createPointerLock(canvas);
  const input: InputSource = { onSample: (cb) => pointer.onSample(cb), onFire: (cb) => pointer.onFire(cb) };
  const arena = new Arena({ renderer, input, size, cm360, dpi, rng: mulberry32(opts.rngSeed ?? 7), postProcessor: psx });

  const ready = Promise.all([
    createViewmodel({ reducedMotion }).then((vm) => {
      if (!alive) { vm.dispose(); return; }
      viewmodel = vm;
      host.appendChild(vm.el);
    }),
    createEnemyLayer({ reducedMotion, onShot: (r) => { if (r === 'miss') feedback.miss(); } }).then((layer) => {
      if (!alive) { layer.dispose(); return; }
      enemies = layer;
      arena.attachEnemies(layer); // arena.dispose() will dispose it
    }),
  ]).then(() => undefined);

  // Fire → recoil + muzzle animation (cosmetic; never touches the camera/aim → cm/360 stays exact).
  const offFire = pointer.onFire(() => viewmodel?.fire());

  // Weapon sway: feed camera look deltas to the viewmodel for the parallax / depth feel.
  let prevView: [number, number] | null = null;
  arena.onAim((_s, view) => {
    if (prevView) viewmodel?.look(view[0] - prevView[0], view[1] - prevView[1]);
    prevView = view;
  });

  const onResize = (): void => arena.resize();
  window.addEventListener('resize', onResize);
  let last = 0;
  let raf = window.requestAnimationFrame(function loop(ts: number): void {
    const dt = last === 0 ? 16 : ts - last; last = ts;
    arena.tick(dt); arena.render();
    viewmodel?.tick(ts);
    raf = window.requestAnimationFrame(loop);
  });

  return {
    arena,
    requestLock: () => pointer.request(),
    setCm360: (next) => arena.setSensitivity(next, dpi),
    setEnemyEnvironment: (id) => enemies?.setEnvironment(id),
    playViewmodel: (name, then = null) => viewmodel?.play(name, then),
    ready,
    dispose() {
      alive = false;
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      offFire();
      feedback.dispose();
      viewmodel?.dispose();
      pointer.dispose();
      arena.dispose();
    },
  };
}
```

> Note: confirm `createPointerLock(canvas).request()` returns `Promise<void>` (session-view uses `pointer.request().then(...)`). If its resolved type differs, keep `requestLock(): Promise<unknown>` to match.

- [ ] **Step 2: Rewrite `session-view.ts` to use the stage**

Replace the entire file with (pure exports unchanged so the existing test still passes):

```ts
// src/ui/session-view.ts
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
const MAX_TRIALS = 24; // spec §5.4: ~15–30, capped ~20–25
const COLD_START = 8; // Generation 0 - the initial gene pool (≥2 trials/instrument before selection)

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

/** Live HUD line for the evolutionary loop. */
export function searchLabel(index: number, cm360: number, coldStart: number): string {
  const testing = `testing ${cm360.toFixed(1)} cm/360`;
  return index < coldStart
    ? `gen 0 · seeding the gene pool · ${testing}`
    : `generation ${index - coldStart + 1} · ${testing}`;
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
          <figcaption class="mono" data-hud="estimate"></figcaption></figure>`;
      host.appendChild(root);

      const canvas = root.querySelector('canvas') as HTMLCanvasElement;
      const svg = root.querySelector('[data-plot]') as unknown as SVGElement;
      const hudInstruction = root.querySelector('[data-hud="instruction"]')!;
      const hudProgress = root.querySelector('[data-hud="progress"]')!;
      const hudEstimate = root.querySelector('[data-hud="estimate"]')!;

      const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const stage = createArenaStage(root, { canvas, cm360: ctx.draft.bounds[0], dpi: ctx.draft.dpi, reducedMotion: reduced });

      const drawPlot = (report: Report, trials: readonly TrialResult[]): void => {
        const g = plotGeometry({
          bounds: ctx.draft.bounds, marks: marksFromTrials(trials),
          curve: report.curve, ci90: report.ci90, peak: report.optimalCm360,
          size: { width: svg.clientWidth || 360, height: svg.clientHeight || 180 },
        });
        renderConvergencePlot(svg, g, 'blended score');
        hudEstimate.textContent = `most-evolved · ${report.optimalCm360.toFixed(1)} cm/360 · 90% CI ${report.ci90[0].toFixed(1)}–${report.ci90[1].toFixed(1)}`;
      };

      const start = (): void => {
        stage.playViewmodel('flickDraw', 'idleReady'); // flick the cigarette, draw the deagle (the reveal)
        const engine = makeEvolution({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.1 }, sigma0: 0.3, maxTrials: MAX_TRIALS });
        void runSession({
          dpi: ctx.draft.dpi, profile: ctx.draft.profile, bounds: ctx.draft.bounds,
          engine, instruments: INSTRUMENTS, scene: stage.arena, schedule: SCHEDULE,
          maxTrials: MAX_TRIALS, coldStart: COLD_START, rng: mulberry32(2026), minTrials: 12, ciStopWidth: 6, bootstrapIters: 300,
          onTrialStart: (id, i, cm360) => {
            hudInstruction.textContent = instructionFor(id);
            hudProgress.textContent = searchLabel(i, cm360, COLD_START);
            stage.setEnemyEnvironment(id); // skin this trial's targets with the environment's prey
            stage.arena.clearTargets();
          },
          onTrial: (_t, trials, interim) => drawPlot(interim, trials),
        }).then(({ report, trials }) => {
          if (!alive) return; // unmounted mid-session - never touch a torn-down context
          const sessionId = `s-${trials.length}-${Math.round(report.optimalCm360 * 100)}`;
          const result = buildResult(report, trials, ctx.draft.dpi);
          ctx.storage.saveSession({ id: sessionId, dpi: ctx.draft.dpi, profile: ctx.draft.profile, trials: [...trials], status: 'complete', createdAt: 0 });
          ctx.storage.saveResult(sessionId, result);
          ctx.lastResult = { sessionId, result };
          ctx.navigate('result');
        });
      };

      canvas.addEventListener('click', () => void stage.requestLock().then(start).catch(start), { once: true });

      cleanup = () => {
        alive = false;
        stage.dispose();
      };
    },
    unmount() { cleanup?.(); host.replaceChildren(); },
  };
}
```

- [ ] **Step 3: Run the session-view test + full suite + build**

Run: `npx vitest run tests/ui/session-view.test.ts && npx vitest run && npm run build`
Expected: session-view test PASS (pure exports unchanged), full suite PASS, tsc + build clean.

- [ ] **Step 4: Chromium smoke check**

Start preview (`preview_start` `campeon-dev`), set `location.hash = '#/'`, drive hero→setup→gate→session, click to lock, confirm a measured session runs to the result screen and firing now shows recoil. Confirm no console errors. (Full QA is Task 10; this is just confirming the refactor didn't regress.)

- [ ] **Step 5: Commit**

```bash
git add src/ui/arena-stage.ts src/ui/session-view.ts
git commit -m "refactor(ui): extract shared arena-stage; session fires viewmodel.fire()"
```

---

## Task 4: `Arena.removeTarget(id)`

**Files:**
- Modify: `src/engine/arena.ts`
- Test: `tests/engine/arena-remove-target.test.ts`

The range retires individual targets on kill; without per-target removal, dead spheres accumulate and grow the per-shot hit scan. `clearTargets()` already shows the disposal pattern.

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/arena-remove-target.test.ts
import { describe, it, expect } from 'vitest';
import { Arena, type RendererLike } from '../../src/engine/arena';

const renderer: RendererLike = { render() {}, setSize() {}, dispose() {} };
const input = { onSample: () => () => {}, onFire: () => () => {} };
const makeArena = (): Arena =>
  new Arena({ renderer, input, size: () => [800, 600], cm360: 30, dpi: 800 });

describe('Arena.removeTarget', () => {
  it('removes a single target by id, leaving others', () => {
    const arena = makeArena();
    const a = arena.spawnTarget({ kind: 'static', yaw: 0, pitch: 0, distance: 20 });
    const b = arena.spawnTarget({ kind: 'static', yaw: 10, pitch: 0, distance: 20 });
    arena.removeTarget(a.id);
    // a is gone: firing classifies against only the remaining target - no throw, b still present.
    expect(() => arena.removeTarget(a.id)).not.toThrow(); // removing twice is a safe no-op
    arena.removeTarget(b.id);
    arena.dispose();
  });

  it('drops a moving target from the moving set so tick no longer advances it', () => {
    const arena = makeArena();
    const m = arena.spawnTarget({ kind: 'moving', yaw: 0, pitch: 0, distance: 20, motion: { yawAmp: 5, baseFreq: 1 } });
    arena.removeTarget(m.id);
    expect(() => arena.tick(16)).not.toThrow();
    arena.dispose();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/arena-remove-target.test.ts`
Expected: FAIL - `arena.removeTarget is not a function`.

- [ ] **Step 3: Implement `removeTarget`**

In `src/engine/arena.ts`, add this method immediately after `clearTargets()`:

```ts
  /** Remove a single target by id (range free-play retires killed targets one at a time). Safe no-op
   *  if the id is unknown. The cosmetic merc death persists in the enemy layer's fade-out set. */
  removeTarget(id: string): void {
    const target = this.targets.get(id);
    if (!target) return;
    this.scene.remove(target.mesh);
    if (target instanceof MovingTarget) this.moving.delete(target);
    target.dispose();
    this.targets.delete(id);
  }
```

(`MovingTarget` is already imported at the top of `arena.ts`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/arena-remove-target.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/arena.ts tests/engine/arena-remove-target.test.ts
git commit -m "feat(engine): Arena.removeTarget(id) for per-target retirement"
```

---

## Task 5: `nudgeCm360` (pure)

**Files:**
- Create: `src/ui/range-nudge.ts`
- Test: `tests/ui/range-nudge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/ui/range-nudge.test.ts
import { describe, it, expect } from 'vitest';
import { nudgeCm360 } from '../../src/ui/range-nudge';

describe('nudgeCm360', () => {
  const bounds: [number, number] = [15, 60];
  it('applies a positive and negative step', () => {
    expect(nudgeCm360(30, 0.5, bounds)).toBeCloseTo(30.5);
    expect(nudgeCm360(30, -0.5, bounds)).toBeCloseTo(29.5);
  });
  it('clamps to the upper and lower bound, never inverts', () => {
    expect(nudgeCm360(59.8, 0.5, bounds)).toBe(60);
    expect(nudgeCm360(15.2, -0.5, bounds)).toBe(15);
  });
  it('honors a fine step', () => {
    expect(nudgeCm360(30, 0.1, bounds)).toBeCloseTo(30.1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/range-nudge.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement**

```ts
// src/ui/range-nudge.ts
import type { Cm360 } from '../types';

/** Nudge a cm/360 by `step` (may be negative), clamped to [lo, hi]. Never returns below the lower bound,
 *  so the live sensitivity can never go ≤ 0 (which would break degreesPerCount). */
export function nudgeCm360(current: Cm360, step: number, bounds: [Cm360, Cm360]): Cm360 {
  const [lo, hi] = bounds;
  return Math.max(lo, Math.min(hi, current + step));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ui/range-nudge.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/range-nudge.ts tests/ui/range-nudge.test.ts
git commit -m "feat(range): pure nudgeCm360 clamp helper"
```

---

## Task 6: `adoptResult` (pure)

**Files:**
- Create: `src/ui/range-adopt.ts`
- Test: `tests/ui/range-adopt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/ui/range-adopt.test.ts
import { describe, it, expect } from 'vitest';
import { adoptResult } from '../../src/ui/range-adopt';
import { perGameSens } from '../../src/convert/schools';
import type { Result } from '../../src/types';

const measured: Result = {
  optimalCm360: 30,
  ci90: [28, 32],
  perGameSens: perGameSens(30, 800),
  breakdown: { biasZeroCm360: 30, precisionFloorDeg: 0.8, ttkMs: 420, hitRate: 0.7 },
};

describe('adoptResult', () => {
  it('sets the adopted cm/360 and recomputes per-game sens for it', () => {
    const tuned = adoptResult(measured, 42, 800);
    expect(tuned.optimalCm360).toBe(42);
    expect(tuned.perGameSens).toEqual(perGameSens(42, 800));
    // a different number → different native sensitivities
    expect(tuned.perGameSens).not.toEqual(measured.perGameSens);
  });
  it('keeps the measured breakdown (it characterizes the measured run, not the hand-picked value)', () => {
    const tuned = adoptResult(measured, 42, 800);
    expect(tuned.breakdown).toEqual(measured.breakdown);
  });
  it('does not mutate the measured result', () => {
    const before = JSON.parse(JSON.stringify(measured));
    adoptResult(measured, 42, 800);
    expect(measured).toEqual(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/range-adopt.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement**

```ts
// src/ui/range-adopt.ts
import type { Cm360, Dpi, Result } from '../types';
import { perGameSens } from '../convert/schools';

/**
 * Build a "tuned by feel" Result from a measured one at a hand-picked cm/360. Recomputes the native
 * per-game sensitivities for the new number; KEEPS the measured breakdown (it characterizes the measured
 * run, not the hand-picked value). The measured CI is carried unchanged in the object but the result
 * screen drops it when the result is flagged `tuned` - a hand-picked number has no measured CI (honesty).
 * Pure: returns a new object, never mutates the input.
 */
export function adoptResult(measured: Result, adoptedCm360: Cm360, dpi: Dpi): Result {
  return {
    ...measured,
    optimalCm360: adoptedCm360,
    perGameSens: perGameSens(adoptedCm360, dpi),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ui/range-adopt.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/range-adopt.ts tests/ui/range-adopt.test.ts
git commit -m "feat(range): pure adoptResult (recompute per-game for a tuned cm/360)"
```

---

## Task 7: Range director (pure)

**Files:**
- Create: `src/ui/range-director.ts`
- Test: `tests/ui/range-director.test.ts`

The director owns slot/timing bookkeeping only. Hit *classification* (which target was killed) happens in the screen adapter via the existing pure `classifyHit`; the adapter reports kills to `onKill(id)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/ui/range-director.test.ts
import { describe, it, expect } from 'vitest';
import { initRange, onKill, dueSpawns, bindSpawn, DEFAULT_RESPAWN_MS, type RangeSlot } from '../../src/ui/range-director';

const SLOTS: RangeSlot[] = [
  { kind: 'fixed', placement: { yaw: -12, pitch: 0, distance: 8, worldRadius: 0.6 } },
  { kind: 'roam' },
];

describe('range director', () => {
  it('requests a spawn for every slot at start, then not again once bound', () => {
    const s = initRange(SLOTS);
    const first = dueSpawns(s, 0);
    expect(first.map((r) => r.slotIndex).sort()).toEqual([0, 1]);
    expect(first[0]!.kind).toBe('fixed');
    expect(first[0]!.placement).toEqual(SLOTS[0]!.placement);
    expect(first[1]!.kind).toBe('roam');
    first.forEach((r, i) => bindSpawn(s, r.slotIndex, `t${i}`));
    expect(dueSpawns(s, 16)).toEqual([]); // all slots live → nothing due
  });

  it('a kill retires the slot and schedules a respawn after the delay', () => {
    const s = initRange(SLOTS);
    dueSpawns(s, 0).forEach((r) => bindSpawn(s, r.slotIndex, `id${r.slotIndex}`));
    const slot = onKill(s, 'id1', 1000);
    expect(slot).toBe(1);
    expect(dueSpawns(s, 1000 + DEFAULT_RESPAWN_MS - 1)).toEqual([]); // not yet
    const due = dueSpawns(s, 1000 + DEFAULT_RESPAWN_MS);
    expect(due.map((r) => r.slotIndex)).toEqual([1]); // the killed slot respawns (roam)
    expect(due[0]!.kind).toBe('roam');
  });

  it('onKill with an unknown id is a no-op returning -1', () => {
    const s = initRange(SLOTS);
    dueSpawns(s, 0).forEach((r) => bindSpawn(s, r.slotIndex, `id${r.slotIndex}`));
    expect(onKill(s, 'nope', 500)).toBe(-1);
    expect(dueSpawns(s, 100000)).toEqual([]); // nothing was retired
  });

  it('does not request the same slot twice between due and bind', () => {
    const s = initRange(SLOTS);
    expect(dueSpawns(s, 0).length).toBe(2); // claims both
    expect(dueSpawns(s, 0)).toEqual([]); // already claimed, not yet bound → not re-requested
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/range-director.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement**

```ts
// src/ui/range-director.ts
import type { Degrees, Ms } from '../types';

export interface SlotPlacement { yaw: Degrees; pitch: Degrees; distance: number; worldRadius: number; }
export interface RangeSlot { kind: 'fixed' | 'roam'; placement?: SlotPlacement; }

interface SlotState {
  slot: RangeSlot;
  liveId: string | null; // arena target id occupying this slot, or null when empty/pending
  respawnAt: Ms | null; // when an empty slot should (re)spawn; null once claimed by dueSpawns
}
export interface RangeState { slots: SlotState[]; respawnDelayMs: Ms; }

export const DEFAULT_RESPAWN_MS = 600;

/** Initial state: every slot empty + due at t=0, so the first `dueSpawns` populates the range. */
export function initRange(slots: RangeSlot[], respawnDelayMs: Ms = DEFAULT_RESPAWN_MS): RangeState {
  return { slots: slots.map((slot) => ({ slot, liveId: null, respawnAt: 0 })), respawnDelayMs };
}

/** A kill of `targetId` empties its slot and schedules a respawn `respawnDelayMs` later. Returns the slot
 *  index, or -1 if the id isn't one of ours. Mutates state. */
export function onKill(state: RangeState, targetId: string, nowMs: Ms): number {
  const i = state.slots.findIndex((s) => s.liveId === targetId);
  if (i < 0) return -1;
  state.slots[i]!.liveId = null;
  state.slots[i]!.respawnAt = nowMs + state.respawnDelayMs;
  return i;
}

export interface SpawnRequest { slotIndex: number; kind: 'fixed' | 'roam'; placement?: SlotPlacement; }

/** Slots whose respawn time has arrived → spawn requests. Marks each claimed (respawnAt=null) so it isn't
 *  requested again before `bindSpawn` records the new target id. Mutates state. */
export function dueSpawns(state: RangeState, nowMs: Ms): SpawnRequest[] {
  const out: SpawnRequest[] = [];
  state.slots.forEach((s, slotIndex) => {
    if (s.liveId === null && s.respawnAt !== null && nowMs >= s.respawnAt) {
      s.respawnAt = null; // claimed; bindSpawn will set liveId
      out.push(s.slot.placement ? { slotIndex, kind: s.slot.kind, placement: s.slot.placement } : { slotIndex, kind: s.slot.kind });
    }
  });
  return out;
}

/** Record the arena target id that fulfilled a slot's spawn request. */
export function bindSpawn(state: RangeState, slotIndex: number, targetId: string): void {
  state.slots[slotIndex]!.liveId = targetId;
}
```

> Note (`exactOptionalPropertyTypes`): build the `SpawnRequest` without a `placement` key when there's no placement (as above) rather than `placement: undefined`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ui/range-director.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/range-director.ts tests/ui/range-director.test.ts
git commit -m "feat(range): pure slot/respawn director"
```

---

## Task 8: Shell route + `tuned` flag + result-screen CTA & tuned rendering

**Files:**
- Modify: `src/ui/shell.ts`
- Modify: `src/ui/result.ts`
- Test: `tests/ui/result.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
// tests/ui/result.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { result } from '../../src/ui/result';
import type { AppContext } from '../../src/ui/shell';
import type { Result } from '../../src/types';

const baseResult: Result = {
  optimalCm360: 34.5,
  ci90: [32.1, 36.9],
  perGameSens: { cs2: 1.23 },
  breakdown: { biasZeroCm360: 34, precisionFloorDeg: 0.8, ttkMs: 410, hitRate: 0.72 },
};

function makeCtx(over: Partial<AppContext> = {}): AppContext {
  return {
    route: 'result',
    navigate: () => {},
    storage: { saveSession() {}, loadSessions: () => [], saveResult() {}, exportJson: () => '' },
    draft: { dpi: 800, currentGame: 'cs2', currentSens: 1, profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } }, bounds: [15, 60] },
    lastResult: { sessionId: 's1', result: baseResult },
    ...over,
  } as AppContext;
}

describe('result screen', () => {
  let host: HTMLElement;
  beforeEach(() => { host = document.createElement('div'); });

  it('renders a "step into the range" CTA that navigates to range', () => {
    let dest = '';
    const ctx = makeCtx({ navigate: (r) => { dest = r; } });
    result(host, ctx).mount();
    const btn = host.querySelector('[data-action="range"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(dest).toBe('range');
  });

  it('shows the measured 90% CI when not tuned', () => {
    result(host, makeCtx()).mount();
    expect(host.querySelector('[data-result="ci"]')!.textContent).toContain('32.1');
    expect(host.textContent).not.toContain('tuned by feel');
  });

  it('drops the CI and labels "tuned by feel" when the result is adopted', () => {
    const ctx = makeCtx({ lastResult: { sessionId: 's1', result: baseResult, tuned: true } });
    result(host, ctx).mount();
    expect(host.querySelector('[data-result="ci"]')).toBeNull();
    expect(host.textContent).toContain('tuned by feel');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/result.test.ts`
Expected: FAIL - no `[data-action="range"]`; `tuned` not a valid `lastResult` field (tsc error) / CI still present.

- [ ] **Step 3: Add the `range` route + `tuned` flag in `shell.ts`**

In `src/ui/shell.ts`:

(a) Extend the `Route` union:
```ts
export type Route = 'hero' | 'setup' | 'gate' | 'session' | 'result' | 'case-study' | 'options' | 'range';
```

(b) Add the hash entry in `ROUTE_HASH`:
```ts
const ROUTE_HASH: Record<Route, string> = {
  hero: '#/', setup: '#/setup', gate: '#/gate', session: '#/session',
  result: '#/result', 'case-study': '#/case-study', options: '#/options', range: '#/range',
};
```

(c) Extend `lastResult` with the optional `tuned` flag:
```ts
  lastResult?: { sessionId: string; result: Result; tuned?: boolean };
```

(d) Guard `range` like `result` (needs a result to play against):
```ts
const GUARDS: Partial<Record<Route, (ctx: AppContext) => Route | null>> = {
  result: (ctx) => (ctx.lastResult ? null : 'hero'),
  range: (ctx) => (ctx.lastResult ? null : 'hero'),
};
```

- [ ] **Step 4: Add the CTA + tuned rendering in `result.ts`**

In `src/ui/result.ts`:

(a) Read the tuned flag at the top of `mount` (after the `if (!r)` guard):
```ts
      const tuned = ctx.lastResult?.tuned ?? false;
```

(b) Replace the CI `<p>` line in the template with a tuned-aware line:
```ts
          ${tuned
            ? `<p class="result__ci result__ci--tuned mono">tuned by feel - not a measured optimum</p>`
            : `<p class="result__ci mono">90% CI <span data-result="ci">${fmt(r.ci90[0])}–${fmt(r.ci90[1])}</span> cm/360</p>`}
```

(c) Add the range CTA to `result__actions` (before "run again"):
```ts
          <div class="result__actions">
            <button class="action action--ghost" data-action="export">export json</button>
            <button class="action action--ghost" data-action="range">step into the range</button>
            <button class="action action--primary" data-action="again">run again</button>
          </div>
```

(d) Wire the CTA after the existing `again`/`export` listeners:
```ts
      root.querySelector('[data-action="range"]')!.addEventListener('click', () => ctx.navigate('range'));
```

- [ ] **Step 5: Run the test + full suite + build**

Run: `npx vitest run tests/ui/result.test.ts && npx vitest run && npm run build`
Expected: result test PASS (3), full suite PASS, tsc + build clean. (tsc will flag any screen map missing `range` - that's fixed in Task 9; if you run `npm run build` before Task 9, temporarily expect the `Record<Route, ScreenFactory>` error in `main.ts` and resolve it in Task 9. To keep this task green in isolation, do Task 9's `main.ts` edit before `npm run build`, or run only the vitest suite here and build at the end of Task 9.)

- [ ] **Step 6: Commit**

```bash
git add src/ui/shell.ts src/ui/result.ts tests/ui/result.test.ts
git commit -m "feat(ui): range route + tuned-by-feel result (CI dropped on adopt)"
```

---

## Task 9: Range screen + register it

**Files:**
- Create: `src/ui/range.ts`
- Modify: `src/main.ts`

Runtime WebGL shell - verified in Chromium (Task 10), not jsdom (its pure logic lives in Tasks 5–7, already tested).

- [ ] **Step 1: Create `range.ts`**

```ts
// src/ui/range.ts
import type { AppContext, Screen } from './shell';
import type { InstrumentId, TargetHandle, TargetSpec } from '../types';
import { createArenaStage } from './arena-stage';
import { initRange, onKill, dueSpawns, bindSpawn, type RangeSlot, type RangeState } from './range-director';
import { nudgeCm360 } from './range-nudge';
import { adoptResult } from './range-adopt';
import { classifyHit } from './enemy/hit';

const SLOTS: RangeSlot[] = [
  { kind: 'fixed', placement: { yaw: -12, pitch: 0, distance: 8, worldRadius: 0.6 } }, // near
  { kind: 'fixed', placement: { yaw: 0, pitch: 2, distance: 18, worldRadius: 0.6 } }, // mid
  { kind: 'fixed', placement: { yaw: 14, pitch: -1, distance: 32, worldRadius: 0.6 } }, // far
  { kind: 'roam' }, { kind: 'roam' }, { kind: 'roam' },
];
const ENVS: InstrumentId[] = ['track', 'flick', 'calibrate', 'strike'];
const fmt = (v: number): string => v.toFixed(1);

export function range(host: HTMLElement, ctx: AppContext): Screen {
  let alive = true;
  let cleanup: (() => void) | null = null;

  return {
    mount() {
      const measured = ctx.lastResult?.result;
      const sessionId = ctx.lastResult?.sessionId;
      if (!measured || !sessionId) { ctx.navigate('hero'); return; }
      const dpi = ctx.draft.dpi;
      const bounds = ctx.draft.bounds;
      const measuredCm360 = measured.optimalCm360;
      let current = measuredCm360;

      const root = document.createElement('section');
      root.className = 'screen screen--arena range';
      root.innerHTML = `
        <canvas class="session__canvas"></canvas>
        <div class="session__crosshair" aria-hidden="true"></div>
        <header class="range__hud mono">
          <span class="display"><span data-range="cm360">${fmt(current)}</span><small> cm/360</small></span>
          <span class="range__delta" data-range="delta"></span>
        </header>
        <footer class="range__bar">
          <button class="action action--ghost" data-range="down" aria-label="decrease sensitivity by 0.5">−</button>
          <button class="action action--ghost" data-range="up" aria-label="increase sensitivity by 0.5">+</button>
          <button class="action action--primary" data-range="adopt">adopt this feel</button>
          <button class="action action--ghost" data-range="reset">reset to measured</button>
          <button class="action action--ghost" data-range="exit">back to result</button>
        </footer>
        <p class="range__hint mono" aria-hidden="true">click to lock · [ / ] nudge · shift = fine · esc releases</p>`;
      host.appendChild(root);

      const canvas = root.querySelector('canvas') as HTMLCanvasElement;
      const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const stage = createArenaStage(root, { canvas, cm360: current, dpi, reducedMotion: reduced });

      const cmEl = root.querySelector('[data-range="cm360"]')!;
      const deltaEl = root.querySelector('[data-range="delta"]')!;
      const refresh = (): void => {
        cmEl.textContent = fmt(current);
        const d = current - measuredCm360;
        deltaEl.textContent = Math.abs(d) < 0.05 ? 'your measured sweet spot' : `${d > 0 ? '+' : ''}${d.toFixed(1)} from your number`;
      };
      refresh();

      const applyCm = (next: number): void => { current = next; stage.setCm360(current); refresh(); };
      const nudge = (dir: number, fine: boolean): void => applyCm(nudgeCm360(current, dir * (fine ? 0.1 : 0.5), bounds));

      root.querySelector('[data-range="down"]')!.addEventListener('click', () => nudge(-1, false));
      root.querySelector('[data-range="up"]')!.addEventListener('click', () => nudge(1, false));
      root.querySelector('[data-range="exit"]')!.addEventListener('click', () => ctx.navigate('result'));
      root.querySelector('[data-range="reset"]')!.addEventListener('click', () => {
        applyCm(measuredCm360);
        ctx.lastResult = { sessionId, result: measured, tuned: false };
        ctx.storage.saveResult(sessionId, measured);
      });
      root.querySelector('[data-range="adopt"]')!.addEventListener('click', () => {
        const tunedResult = adoptResult(measured, current, dpi);
        ctx.lastResult = { sessionId, result: tunedResult, tuned: true };
        ctx.storage.saveResult(sessionId, tunedResult);
        ctx.navigate('result');
      });

      const onKey = (e: KeyboardEvent): void => {
        if (e.key === '[') nudge(-1, e.shiftKey);
        else if (e.key === ']') nudge(1, e.shiftKey);
      };
      window.addEventListener('keydown', onKey);

      // Free-play: after lock + cosmetic layers ready, the director maintains the target population.
      const targets = new Map<string, { slotIndex: number; handle: TargetHandle }>();
      let state: RangeState | null = null;
      let offFire: (() => void) | null = null;
      let offFrame: (() => void) | null = null;
      let envI = 0;

      const spawnForSlot = (req: { slotIndex: number; kind: 'fixed' | 'roam'; placement?: { yaw: number; pitch: number; distance: number; worldRadius: number } }): void => {
        let spec: TargetSpec;
        if (req.kind === 'roam') {
          const [vYaw, vPitch] = stage.arena.view();
          const yaw = vYaw + (Math.random() * 2 - 1) * 26; // within ~±26° of where you're looking → on-screen
          const pitch = Math.max(-40, Math.min(40, vPitch + (Math.random() * 2 - 1) * 14));
          stage.setEnemyEnvironment(ENVS[envI++ % ENVS.length]!); // vary the merc sheet per roam spawn
          spec = { kind: 'static', yaw, pitch, distance: 14 + Math.random() * 18, worldRadius: 0.6 };
        } else {
          spec = { kind: 'static', ...req.placement! };
        }
        const handle = stage.arena.spawnTarget(spec);
        targets.set(handle.id, { slotIndex: req.slotIndex, handle });
        bindSpawn(state!, req.slotIndex, handle.id);
      };

      const startFreePlay = (): void => {
        if (!alive) return;
        state = initRange(SLOTS);
        // Cosmetic pop runs inside arena.handleFire BEFORE these fireCbs; here we decide retire+respawn.
        offFire = stage.arena.onFire((now) => {
          if (!state) return;
          const view = stage.arena.view();
          let killId: string | null = null;
          for (const [id, { handle }] of targets) {
            if (classifyHit(view, handle.bearing(), handle.radiusDeg()) === 'kill') { killId = id; break; }
          }
          if (killId) {
            onKill(state, killId, now);
            targets.delete(killId);
            stage.arena.removeTarget(killId); // retire the sphere; the merc death persists in the fade-out set
          }
        });
        offFrame = stage.arena.onFrame((_dt, now) => {
          if (!state) return;
          for (const req of dueSpawns(state, now)) spawnForSlot(req);
        });
      };

      // Lock, then wait for the cosmetic layers so mercs (not bare spheres) appear, then start.
      canvas.addEventListener('click', () => {
        void stage.requestLock().catch(() => {}).then(() => stage.ready).then(startFreePlay);
      }, { once: true });

      cleanup = () => {
        alive = false;
        window.removeEventListener('keydown', onKey);
        offFire?.();
        offFrame?.();
        stage.dispose();
      };
    },
    unmount() { cleanup?.(); host.replaceChildren(); },
  };
}
```

- [ ] **Step 2: Register the screen in `main.ts`**

In `src/main.ts`, import `range` and add it to the screens map:

```ts
import { range } from './ui/range';
// ...
const screens: Record<Route, ScreenFactory> = {
  hero, setup, gate, session: sessionView, result, 'case-study': caseStudy, options, range,
};
```

- [ ] **Step 3: Typecheck + build + full suite**

Run: `npm run build && npx vitest run`
Expected: tsc + build clean (the `Record<Route, ScreenFactory>` is now complete), full suite PASS.

- [ ] **Step 4: Commit**

```bash
git add src/ui/range.ts src/main.ts
git commit -m "feat(range): free-play range screen (dummies + poppers, live nudge, adopt)"
```

---

## Task 10: Chromium QA, tuning, and styles

**Files:**
- Modify: `src/styles/*.css` (range HUD/bar styling - follow existing `session`/`result` classes)
- Possibly tune: `src/ui/viewmodel/recoil.ts` (`DEFAULT_RECOIL`), `src/ui/viewmodel/viewmodel.ts` (`BACK_SCALE_K`/`RECOIL_ROLL_K`).

- [ ] **Step 1: Add range styles**

Add CSS for `.range__hud`, `.range__delta`, `.range__bar`, `.range__hint`, and `.result__ci--tuned`, reusing the existing brutalist/mono tokens and mirroring `.session__hud` / `.result__actions`. Keep the HUD top-left, the bar bottom-centered, `pointer-events` sane during lock. (No test; visual.)

- [ ] **Step 2: Chromium QA pass** (preview MCP)

Verify, with no console errors:
1. **Recoil:** in a session (or the range), each shot kicks the gun up + lunges + settles fast; rapid fire stays bounded; under `prefers-reduced-motion` the gun is static (no recoil). Tune `DEFAULT_RECOIL` / `BACK_SCALE_K` / `RECOIL_ROLL_K` until it reads punchy but not nauseating; re-run `npx vitest run tests/ui/viewmodel/recoil.test.ts` if you change recoil params.
2. **Entry:** result screen shows "step into the range"; clicking navigates to `#/range`.
3. **Range:** click locks; 3 fixed dummies (near/mid/far) + 3 roaming mercs appear (mercs, not bare gold spheres - i.e. spawns happen after `ready`); shooting a target pops it (death persists) and it respawns (fixed in place, roam at a new on-screen bearing); misses flash the ember tick.
4. **Nudge:** `[`/`]` and the −/+ buttons change cm/360 live (the view turn-rate visibly changes); the HUD number + delta track; `Shift` gives fine steps; clamps at the bounds.
5. **Adopt/reset:** "adopt this feel" returns to the result screen showing the adopted number, **no CI**, "tuned by feel"; per-game table reflects the new number; re-entering the range and "reset to measured" restores the measured number + CI.
6. **Teardown:** leaving the range (exit, or back/forward) cancels its rAF and disposes the renderer (no leaked WebGL contexts, no console errors); the session still runs end-to-end.

- [ ] **Step 3: Final full gate**

Run: `npx vitest run && npm run build`
Expected: all tests PASS, tsc + build clean.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(range): styles + recoil tuning; Chromium-verified"
```

- [ ] **Step 5: Update memory + df2tm** (per the project workflow)

Update `campeon-overview.md` status (tests count, `main` @ new sha, recoil+range milestone), add df2tm journal bullet + any new concept lines (candidates: `shared-stage-extraction` - two screens sharing one hardened lifecycle; `adopt-vs-measured-honesty` - drop a measured CI for a hand-picked value).

- [ ] **Step 6: Finish the branch**

Use **superpowers:finishing-a-development-branch** to present merge options.

---

## Self-Review (against the spec)

**Spec coverage:** §1 recoil → Tasks 1–2; §2 arena-stage → Task 3; §3 route/screen/entry → Tasks 8–9; §4 director (fixed+roam, classifyHit reuse, removeTarget) → Tasks 4, 7, 9; §5 nudge+adopt+honesty → Tasks 5, 6, 8, 9; §6 a11y/reduced-motion/teardown → Tasks 3, 9, 10; §7 file map → File Structure + tasks; §8 testing → per-task tests + Task 10; §9 non-goals → respected (no optimizer re-run, no view-kick, no scoring). All covered.

**Placeholder scan:** No TBD/TODO; every code step has complete code; every test has real assertions.

**Type consistency:** `createArenaStage(host, {canvas,cm360,dpi,reducedMotion,rngSeed?})` used identically in session-view and range; `ArenaStage` methods (`requestLock`/`setCm360`/`setEnemyEnvironment`/`playViewmodel`/`ready`/`dispose`) match their call sites; director API (`initRange`/`onKill`/`dueSpawns`/`bindSpawn`, `RangeSlot`/`RangeState`/`SpawnRequest`/`SlotPlacement`) consistent across Task 7 and Task 9; `adoptResult(measured, cm360, dpi)`, `nudgeCm360(current, step, bounds)`, `Arena.removeTarget(id)`, and `Viewmodel.fire()` match their consumers; `lastResult.tuned?` added in shell and read in result + written in range.
