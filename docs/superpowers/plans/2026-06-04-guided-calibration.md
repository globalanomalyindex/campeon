# Guided Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the typed `setup` screen and the opaque slow/fast `gate` with a guided, physical calibration: enter pad width, sweep it for true DPI (acceleration check folded in), do a rendered 2D-panorama turn to seed a comfortable cm/360, pick your game. A typed DPI+sens fast path remains as a power-user shortcut and a11y / no-pointer-lock fallback.

**Architecture:** Pure core (conversions + a step reducer, unit-tested) under thin canvas shells (runtime-verified), matching the repo's existing seam. The optimizer is untouched: the rendered turn's tuned cm/360 becomes the search `bounds` (centered on the seed), and measured DPI flows into the draft. The guided flow is one `setup` route holding a step machine like the existing `gateReducer`; the `gate` route retires.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`), Vite, vitest, canvas 2D, Pointer Lock API. No new dependencies. No em dashes anywhere (project convention).

Design doc: `docs/superpowers/specs/2026-06-04-guided-calibration-design.md`.

---

## File Structure

**New (pure, unit-tested):**
- `src/convert/turn-rate.ts` - cm/360 <-> turn-rate conversions for the rendered turn.
- `src/input/dpi-sweep.ts` - effective DPI from a pad sweep + a horizontal-counts accumulator.
- `src/ui/calibrate-flow.ts` - pure step reducer + types for the guided flow.

**New (thin shells, runtime-verified):**
- `src/ui/calibrate/sweep-view.ts` - the locked mousepad sweep (slow + fast passes).
- `src/ui/calibrate/turn-view.ts` - the locked 2D-panorama turn (auto-marks at 360, tune-to-comfort).
- `src/styles/calibrate.css` - canvas + step styles, reusing brand tokens.

**Modified:**
- `src/ui/options/settings.ts` - add `boundsFromSeed` (reuses `normalizeBounds`).
- `src/ui/setup.ts` - rewrite as the guided-flow orchestrator (mounts the views, writes the draft).
- `src/ui/shell.ts` - drop the `gate` route from `Route` and `ROUTE_HASH`.
- `src/main.ts` - stop registering `gate`; import `calibrate.css`.

**Removed:**
- `src/ui/gate.ts` and `tests/ui/gate.test.ts` - the acceleration check now rides inside the sweep.

**Tests:**
- `tests/convert/turn-rate.test.ts`, `tests/input/dpi-sweep.test.ts`, `tests/ui/calibrate-flow.test.ts` (new).
- `tests/ui/options/settings.test.ts` (extend if present, else add a `boundsFromSeed` test file).
- `tests/ui/setup.test.ts` (rewrite for the new orchestrator's pure-reachable behavior).

---

## Phase A: Pure core (TDD)

### Task A1: turn-rate conversions

**Files:**
- Create: `src/convert/turn-rate.ts`
- Test: `tests/convert/turn-rate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/convert/turn-rate.test.ts
import { describe, it, expect } from 'vitest';
import { degPerCountFor, cm360FromTurnCounts, turnCountsFor } from '../../src/convert/turn-rate';

describe('turn-rate', () => {
  it('a full turn at the mapped rate is exactly 360 degrees', () => {
    const cm360 = 30, dpi = 800;
    const counts = turnCountsFor(cm360, dpi);
    expect(degPerCountFor(cm360, dpi) * counts).toBeCloseTo(360, 6);
  });

  it('cm360FromTurnCounts inverts turnCountsFor', () => {
    const cm360 = 42, dpi = 1600;
    expect(cm360FromTurnCounts(turnCountsFor(cm360, dpi), dpi)).toBeCloseTo(cm360, 6);
  });

  it('matches the physical definition (30 cm/360 at 800 dpi)', () => {
    // 30 cm / 2.54 = 11.811 in; * 800 = 9448.8 counts for a full turn
    expect(turnCountsFor(30, 800)).toBeCloseTo(9448.8, 1);
    expect(cm360FromTurnCounts(9448.8, 800)).toBeCloseTo(30, 3);
  });
});
```

- [ ] **Step 2: Run it, expect failure** - `npx vitest run tests/convert/turn-rate.test.ts` -> FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/convert/turn-rate.ts
// Turn-rate math for the rendered calibration turn. cm/360 is the physical turn distance;
// the panorama maps mouse counts to view degrees so one full 360 spans exactly that distance.
import { TURN_CM } from './cm360';
import type { Cm360, Dpi } from '../types';

/** Degrees of view rotation per mouse count, so one 360 spans `cm360` cm at this DPI. */
export function degPerCountFor(cm360: Cm360, dpi: Dpi): number {
  return TURN_CM / (cm360 * dpi); // TURN_CM = 360 * 2.54
}

/** Mouse counts of travel for one full 360 at this cm/360 and DPI. */
export function turnCountsFor(cm360: Cm360, dpi: Dpi): number {
  return (cm360 * dpi) / 2.54;
}

/** The cm/360 implied by sweeping `turnCounts` counts for one full 360 at this DPI. */
export function cm360FromTurnCounts(turnCounts: number, dpi: Dpi): Cm360 {
  return (turnCounts * 2.54) / dpi;
}
```

- [ ] **Step 4: Run it, expect pass.** `npx vitest run tests/convert/turn-rate.test.ts` -> PASS.

- [ ] **Step 5: Commit** - `git add src/convert/turn-rate.ts tests/convert/turn-rate.test.ts && git commit -m "feat(convert): turn-rate conversions for the rendered calibration turn"`

### Task A2: DPI from a pad sweep

**Files:**
- Create: `src/input/dpi-sweep.ts`
- Test: `tests/input/dpi-sweep.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/input/dpi-sweep.test.ts
import { describe, it, expect } from 'vitest';
import { dpiFromSweep, SweepAccumulator, isPlausibleSweepDpi } from '../../src/input/dpi-sweep';

describe('dpi-sweep', () => {
  it('recovers DPI from counts across a known pad width', () => {
    // a 40 cm pad at 800 dpi -> 40/2.54 in * 800 = 12598.4 counts
    expect(dpiFromSweep(12598.4, 40)).toBeCloseTo(800, 1);
  });

  it('returns NaN for a non-positive pad width', () => {
    expect(Number.isNaN(dpiFromSweep(10000, 0))).toBe(true);
  });

  it('SweepAccumulator sums signed dx and reports the magnitude', () => {
    const acc = new SweepAccumulator();
    acc.add({ t: 0, dx: 100, dy: 5 });
    acc.add({ t: 1, dx: 50, dy: -3 });
    acc.add({ t: 2, dx: -10, dy: 0 });
    expect(acc.total()).toBeCloseTo(140, 6); // |100 + 50 - 10|
    acc.reset();
    expect(acc.total()).toBe(0);
  });

  it('flags implausible measured DPI', () => {
    expect(isPlausibleSweepDpi(800)).toBe(true);
    expect(isPlausibleSweepDpi(5)).toBe(false);     // too low (sweep too short / pad typo)
    expect(isPlausibleSweepDpi(99000)).toBe(false); // absurd
  });
});
```

- [ ] **Step 2: Run it, expect failure.** `npx vitest run tests/input/dpi-sweep.test.ts` -> FAIL.

- [ ] **Step 3: Implement**

```ts
// src/input/dpi-sweep.ts
// Effective DPI measured from a horizontal sweep across a known pad width. The pointer-lock
// samples are already DPR-normalized counts, so this is true mouse DPI (and catches a mouse
// whose labeled DPI is wrong). Net horizontal travel is the pad width, so we sum signed dx.
import { isValidDpi } from './dpi';
import type { AimSample, Dpi } from '../types';

/** Effective DPI from `horizontalCounts` (DPR-normalized) swept across `padWidthCm`. NaN if width <= 0. */
export function dpiFromSweep(horizontalCounts: number, padWidthCm: number): Dpi {
  if (!(padWidthCm > 0)) return NaN;
  return horizontalCounts / (padWidthCm / 2.54); // counts per inch
}

/** Accumulates one sweep pass: net horizontal counts (signed dx sum, reported as magnitude). */
export class SweepAccumulator {
  private sum = 0;
  add(sample: AimSample): void { this.sum += sample.dx; }
  total(): number { return Math.abs(this.sum); }
  reset(): void { this.sum = 0; }
}

/** True when a measured DPI is plausible (delegates to the shared DPI bounds). */
export function isPlausibleSweepDpi(dpi: number): boolean { return isValidDpi(dpi); }
```

- [ ] **Step 4: Run it, expect pass.** -> PASS.

- [ ] **Step 5: Commit** - `git add src/input/dpi-sweep.ts tests/input/dpi-sweep.test.ts && git commit -m "feat(input): effective DPI from a mousepad sweep + horizontal accumulator"`

### Task A3: boundsFromSeed

**Files:**
- Modify: `src/ui/options/settings.ts`
- Test: `tests/ui/options/settings.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test** (append to the settings test, or create the file)

```ts
// tests/ui/options/settings.test.ts
import { describe, it, expect } from 'vitest';
import { boundsFromSeed, DEFAULT_BOUNDS } from '../../../src/ui/options/settings';

describe('boundsFromSeed', () => {
  it('centers a window on the seed within sane bounds', () => {
    const [lo, hi] = boundsFromSeed(30); // 30/1.7=17.6 .. 30*1.7=51
    expect(lo).toBeCloseTo(17.65, 1);
    expect(hi).toBeCloseTo(51, 1);
    expect(lo).toBeGreaterThanOrEqual(5);
    expect(hi).toBeLessThanOrEqual(150);
  });

  it('clamps a tiny seed to the minimum span', () => {
    const [lo, hi] = boundsFromSeed(3);
    expect(lo).toBe(5);
    expect(hi - lo).toBeGreaterThanOrEqual(5);
  });

  it('falls back to the default window for a bad seed', () => {
    expect(boundsFromSeed(NaN)).toEqual(DEFAULT_BOUNDS);
    expect(boundsFromSeed(0)).toEqual(DEFAULT_BOUNDS);
  });
});
```

- [ ] **Step 2: Run it, expect failure.** `npx vitest run tests/ui/options/settings.test.ts` -> FAIL (no `boundsFromSeed`).

- [ ] **Step 3: Implement** - append to `src/ui/options/settings.ts`:

```ts
/** Center the optimizer's search window on a seed cm/360 (the comfortable turn), clamped to sane bounds. */
export function boundsFromSeed(seed: Cm360, factor = 1.7): [Cm360, Cm360] {
  if (!Number.isFinite(seed) || seed <= 0) return [...DEFAULT_BOUNDS];
  return normalizeBounds(seed / factor, seed * factor);
}
```

- [ ] **Step 4: Run it, expect pass.** -> PASS.

- [ ] **Step 5: Commit** - `git add src/ui/options/settings.ts tests/ui/options/settings.test.ts && git commit -m "feat(options): boundsFromSeed centers the search window on the calibrated turn"`

### Task A4: the guided-flow step reducer

**Files:**
- Create: `src/ui/calibrate-flow.ts`
- Test: `tests/ui/calibrate-flow.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/ui/calibrate-flow.test.ts
import { describe, it, expect } from 'vitest';
import { calibrateReducer, initialCalState, type CalState } from '../../src/ui/calibrate-flow';

describe('calibrateReducer', () => {
  const s0: CalState = initialCalState();

  it('guided start stores pad width and moves to the sweep', () => {
    const s = calibrateReducer(s0, { type: 'start-guided', padWidthCm: 40 });
    expect(s.step).toBe('sweep');
    expect(s.padWidthCm).toBe(40);
  });

  it('a clean sweep stores DPI and advances to the turn', () => {
    const s = calibrateReducer({ ...s0, step: 'sweep', padWidthCm: 40 },
      { type: 'sweep-done', dpi: 1600, accelerated: false });
    expect(s.step).toBe('turn');
    expect(s.dpi).toBe(1600);
  });

  it('an accelerated sweep blocks', () => {
    const s = calibrateReducer({ ...s0, step: 'sweep' },
      { type: 'sweep-done', dpi: 1600, accelerated: true });
    expect(s.step).toBe('blocked');
  });

  it('retry from blocked returns to the sweep', () => {
    const s = calibrateReducer({ ...s0, step: 'blocked' }, { type: 'retry' });
    expect(s.step).toBe('sweep');
  });

  it('the turn stores the seed and advances to the game pick', () => {
    const s = calibrateReducer({ ...s0, step: 'turn', dpi: 800 },
      { type: 'turn-done', seedCm360: 28.5 });
    expect(s.step).toBe('game');
    expect(s.seedCm360).toBeCloseTo(28.5, 6);
  });

  it('manual entry is reachable from intro and returns to it', () => {
    const m = calibrateReducer(s0, { type: 'start-manual' });
    expect(m.step).toBe('manual');
    expect(calibrateReducer(m, { type: 'back-to-intro' }).step).toBe('intro');
  });
});
```

- [ ] **Step 2: Run it, expect failure.** -> FAIL.

- [ ] **Step 3: Implement**

```ts
// src/ui/calibrate-flow.ts
// Pure step machine for the guided calibration (mirrors the gateReducer pattern: pure
// transitions, thin DOM in the screen). The screen performs navigation + draft writes.
export type CalStep = 'intro' | 'sweep' | 'turn' | 'game' | 'manual' | 'blocked';

export interface CalState {
  step: CalStep;
  padWidthCm: number;
  dpi: number | null;
  seedCm360: number | null;
}

export type CalAction =
  | { type: 'start-guided'; padWidthCm: number }
  | { type: 'start-manual' }
  | { type: 'sweep-done'; dpi: number; accelerated: boolean }
  | { type: 'turn-done'; seedCm360: number }
  | { type: 'retry' }
  | { type: 'back-to-intro' };

export function initialCalState(): CalState {
  return { step: 'intro', padWidthCm: 40, dpi: null, seedCm360: null };
}

export function calibrateReducer(state: CalState, action: CalAction): CalState {
  switch (action.type) {
    case 'start-guided':
      return { ...state, step: 'sweep', padWidthCm: action.padWidthCm };
    case 'start-manual':
      return { ...state, step: 'manual' };
    case 'sweep-done':
      return { ...state, dpi: action.dpi, step: action.accelerated ? 'blocked' : 'turn' };
    case 'turn-done':
      return { ...state, seedCm360: action.seedCm360, step: 'game' };
    case 'retry':
      return { ...state, step: 'sweep' };
    case 'back-to-intro':
      return { ...state, step: 'intro' };
  }
}
```

- [ ] **Step 4: Run it, expect pass.** -> PASS.

- [ ] **Step 5: Commit** - `git add src/ui/calibrate-flow.ts tests/ui/calibrate-flow.test.ts && git commit -m "feat(ui): pure step reducer for the guided calibration flow"`

---

## Phase B: Shells (runtime-verified)

> These are canvas/pointer-lock shells, not unit-tested (repo convention), except the orchestrator's pure-reachable behavior in B4. Verify each at the end of the phase in Chromium (Task C3).

### Task B1: calibrate styles

**Files:**
- Create: `src/styles/calibrate.css`
- Modify: `src/main.ts` (import it)

- [ ] **Step 1: Create `src/styles/calibrate.css`** (reuses brand tokens; matches the dark arena screens)

```css
.calibrate__stage { position: relative; width: 100%; background: #000;
  border: 1px solid var(--line, #26262e); border-radius: 14px; overflow: hidden; }
.calibrate__canvas { display: block; width: 100%; height: 360px; cursor: crosshair; }
.calibrate__hint { position: absolute; inset: 0; display: flex; align-items: center;
  justify-content: center; text-align: center; pointer-events: none; }
.calibrate__hint span { background: rgba(0,0,0,.6); padding: 11px 18px; border-radius: 10px; }
.calibrate__readouts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 14px; }
.calibrate__ro { border: 1px solid var(--line, #26262e); border-radius: 12px; padding: 12px 14px; }
.calibrate__ro .k { font-size: 10px; letter-spacing: .09em; text-transform: uppercase; opacity: .65; }
.calibrate__ro .v { font-size: 22px; margin-top: 5px; }
.calibrate__progress { height: 8px; border: 1px solid var(--line, #26262e); border-radius: 999px;
  overflow: hidden; margin: 10px 0; }
.calibrate__progress > div { height: 100%; width: 0; background: var(--accent, #ff3b30); }
.calibrate__good { color: #39d98a; } .calibrate__warn { color: #ffb020; }
```

- [ ] **Step 2: Import in `src/main.ts`** - add `import './styles/calibrate.css';` beside the other style imports.

- [ ] **Step 3: Verify build** - `npm run build` -> succeeds (no TS/asset errors).

- [ ] **Step 4: Commit** - `git add src/styles/calibrate.css src/main.ts && git commit -m "feat(ui): calibrate screen styles"`

### Task B2: the mousepad sweep view

**Files:**
- Create: `src/ui/calibrate/sweep-view.ts`

Drives two passes (slow, then fast). The user locks the pointer, places the mouse at the pad's left edge, presses the mouse button (onFire) to start a pass, sweeps straight across, presses again to end it. Net horizontal counts per pass -> DPI (from the slow pass) and an acceleration cross-check (slow vs fast via `accelVerdict`).

- [ ] **Step 1: Implement**

```ts
// src/ui/calibrate/sweep-view.ts
// Thin shell: the locked mousepad sweep. Slow pass measures DPI; fast pass cross-checks for
// acceleration. Marking uses onFire (a locked primary-button press), so no cursor is needed.
import { createPointerLock } from '../../input/pointer-lock';
import { accelVerdict } from '../../input/accel-check';
import { SweepAccumulator, dpiFromSweep, isPlausibleSweepDpi } from '../../input/dpi-sweep';

export interface SweepResult { dpi: number; accelerated: boolean; }
export interface SweepView { dispose(): void; }

type Phase = 'idle-slow' | 'running-slow' | 'idle-fast' | 'running-fast';

export function createSweepView(
  host: HTMLElement,
  opts: { padWidthCm: number; onResult: (r: SweepResult) => void; onInvalid: () => void },
): SweepView {
  host.innerHTML = `
    <section class="screen screen--arena fade-in">
      <div class="wrap stack">
        <h2 class="display">+ the sweep</h2>
        <p class="gate__lead" data-sweep="lead">click to lock, set your mouse at the <b>left edge</b> of your pad.</p>
        <div class="calibrate__stage">
          <canvas class="calibrate__canvas" data-sweep="canvas"></canvas>
          <div class="calibrate__hint" data-sweep="hint"><span>click to lock the pointer</span></div>
        </div>
        <div class="calibrate__readouts">
          <div class="calibrate__ro"><div class="k">pass</div><div class="v mono" data-sweep="pass">slow</div></div>
          <div class="calibrate__ro"><div class="k">counts</div><div class="v mono" data-sweep="counts">0</div></div>
          <div class="calibrate__ro"><div class="k">measured dpi</div><div class="v mono" data-sweep="dpi">-</div></div>
        </div>
        <p class="mono" data-sweep="status"></p>
      </div>
    </section>`;

  const $ = (s: string) => host.querySelector(`[data-sweep="${s}"]`) as HTMLElement;
  const canvas = $('canvas') as HTMLCanvasElement;
  const pointer = createPointerLock(canvas);

  let phase: Phase = 'idle-slow';
  let slowCounts = 0;
  const acc = new SweepAccumulator();

  const off = pointer.onSample((s) => { if (phase === 'running-slow' || phase === 'running-fast') {
    acc.add(s); $('counts').textContent = Math.round(acc.total()).toString();
  } });

  const offFire = pointer.onFire(() => {
    if (!pointer.isLocked()) return;
    if (phase === 'idle-slow') { acc.reset(); phase = 'running-slow'; setLead('sweep SLOW to the right edge, then click'); }
    else if (phase === 'running-slow') { slowCounts = acc.total(); phase = 'idle-fast'; $('pass').textContent = 'fast';
      setLead('back to the left edge, click, then sweep FAST to the right'); }
    else if (phase === 'idle-fast') { acc.reset(); phase = 'running-fast'; setLead('sweep FAST to the right edge, then click'); }
    else if (phase === 'running-fast') { finish(acc.total()); }
  });

  function setLead(t: string): void { $('lead').textContent = t; }

  function finish(fastCounts: number): void {
    const dpi = dpiFromSweep(slowCounts, opts.padWidthCm);
    $('dpi').textContent = isPlausibleSweepDpi(dpi) ? Math.round(dpi).toString() : 'invalid';
    if (!isPlausibleSweepDpi(dpi)) { opts.onInvalid(); return; }
    const { accelerated } = accelVerdict(slowCounts, fastCounts);
    pointer.exit();
    opts.onResult({ dpi: Math.round(dpi), accelerated });
  }

  const onLock = (): void => { $('hint').style.display = pointer.isLocked() ? 'none' : 'flex'; };
  document.addEventListener('pointerlockchange', onLock);
  canvas.addEventListener('click', () => { if (!pointer.isLocked()) void pointer.request().catch(() => opts.onInvalid()); });

  return { dispose() { off(); offFire(); document.removeEventListener('pointerlockchange', onLock); pointer.dispose(); } };
}
```

- [ ] **Step 2: Verify build** - `npm run build` -> succeeds.

- [ ] **Step 3: Commit** - `git add src/ui/calibrate/sweep-view.ts && git commit -m "feat(ui): locked mousepad sweep view (DPI + accel cross-check)"`

### Task B3: the 2D-panorama turn view

**Files:**
- Create: `src/ui/calibrate/turn-view.ts`

Port of the approved companion prototype, wired to `createPointerLock` (`onSample.dx/dy`) and `degPerCountFor`. The world rotates with the player; turning until **home** returns is one 360, which auto-marks. Up/down keys tune the comfortable cm/360 and re-arm the turn; `accept` confirms the seed.

- [ ] **Step 1: Implement**

```ts
// src/ui/calibrate/turn-view.ts
// Thin shell: the locked 2D-panorama turn. A 'home' marker starts dead ahead; turning until it
// comes back around is one 360 (auto-marks). Up/Down tune the comfortable cm/360. The DPI from
// the sweep makes the cm/360 readout real. Reduced-motion users take the typed fast path instead.
import { createPointerLock } from '../../input/pointer-lock';
import { degPerCountFor, cm360FromTurnCounts, turnCountsFor } from '../../convert/turn-rate';
import type { Cm360 } from '../../types';

export interface TurnView { dispose(): void; }

export function createTurnView(
  host: HTMLElement,
  opts: { dpi: number; onSeed: (cm360: Cm360) => void; seed0?: Cm360 },
): TurnView {
  host.innerHTML = `
    <section class="screen screen--arena fade-in">
      <div class="wrap stack">
        <h2 class="display">+ the turn</h2>
        <p class="gate__lead">click to lock, then turn until <b>home</b> comes back around. nudge with up/down until a full turn feels right in one swipe; <span class="mono">enter</span> accepts, <span class="mono">esc</span> releases.</p>
        <div class="calibrate__progress"><div data-turn="bar"></div></div>
        <div class="calibrate__stage">
          <canvas class="calibrate__canvas" data-turn="canvas"></canvas>
          <div class="calibrate__hint" data-turn="hint"><span>click to lock + start turning</span></div>
        </div>
        <div class="calibrate__readouts">
          <div class="calibrate__ro"><div class="k">heading</div><div class="v mono" data-turn="head">0&deg;</div></div>
          <div class="calibrate__ro"><div class="k">a full turn</div><div class="v mono" data-turn="cm">-</div></div>
          <div class="calibrate__ro"><div class="k">status</div><div class="v mono" data-turn="status">turn</div></div>
        </div>
      </div>
    </section>`;

  const $ = (s: string) => host.querySelector(`[data-turn="${s}"]`) as HTMLElement;
  const canvas = $('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const pointer = createPointerLock(canvas);
  const FOV = 100;
  const markers = [{ d: 0, home: true, label: 'home' }, { d: 90, label: '90' }, { d: 180, label: '180' }, { d: 270, label: '270' }];
  const angleDiff = (a: number, b: number): number => ((a - b + 540) % 360) - 180;

  let cm360: Cm360 = opts.seed0 ?? 30;
  let swept = 0, pitch = 0, completed = false, W = 0, H = 0;
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  function size(): void { const r = canvas.getBoundingClientRect(); W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(); }
  function rearm(): void { swept = 0; pitch = 0; completed = false; $('bar').style.width = '0'; $('head').textContent = '0°';
    $('status').textContent = 'turn'; $('cm').textContent = cm360FromTurnCounts(turnCountsFor(cm360, opts.dpi), opts.dpi).toFixed(1) + ' cm'; draw(); }

  const off = pointer.onSample((s) => {
    if (!pointer.isLocked() || completed) return;
    swept += s.dx; pitch = Math.max(-240, Math.min(240, pitch + s.dy));
    const totalDeg = Math.abs(swept) * degPerCountFor(cm360, opts.dpi);
    $('head').textContent = Math.min(360, Math.round(totalDeg)) + '°';
    $('bar').style.width = Math.min(100, (totalDeg / 360) * 100) + '%';
    if (totalDeg >= 360) { completed = true; $('status').textContent = 'full turn'; $('status').className = 'v mono calibrate__good';
      $('cm').textContent = cm360.toFixed(1) + ' cm'; }
    draw();
  });

  function draw(): void {
    const heading = ((Math.abs(swept) * degPerCountFor(cm360, opts.dpi)) % 360 + 360) % 360;
    const hy = Math.max(70, Math.min(H - 70, H / 2 - pitch * 0.45));
    ctx.fillStyle = '#141a24'; ctx.fillRect(0, 0, W, hy);
    ctx.fillStyle = '#0c0e12'; ctx.fillRect(0, hy, W, H - hy);
    ctx.strokeStyle = 'rgba(255,255,255,.06)';
    for (let g = 0; g < 360; g += 15) { const rel = angleDiff(g, heading); if (Math.abs(rel) > FOV / 2) continue;
      const x = W / 2 + (rel / FOV) * W; ctx.beginPath(); ctx.moveTo(x, hy); ctx.lineTo(W / 2 + (rel / FOV) * W * 2.4, H); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(W, hy); ctx.stroke();
    for (const m of markers) { const rel = angleDiff(m.d, heading); if (Math.abs(rel) > FOV / 2 + 6) continue;
      const x = W / 2 + (rel / FOV) * W, h = m.home ? 92 : 58;
      ctx.strokeStyle = m.home ? '#ff3b30' : 'rgba(255,255,255,.4)'; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = m.home ? 4 : 2;
      ctx.beginPath(); ctx.moveTo(x, hy); ctx.lineTo(x, hy - h); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, hy - h, m.home ? 6 : 4, 0, Math.PI * 2); ctx.fill();
      ctx.font = '11px monospace'; ctx.textAlign = 'center'; ctx.fillText(m.label, x, hy - h - 9); ctx.textAlign = 'left'; }
    ctx.strokeStyle = Math.abs(pitch) < 30 ? 'rgba(57,217,138,.9)' : 'rgba(255,176,32,.9)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(W / 2 - 9, hy); ctx.lineTo(W / 2 + 9, hy); ctx.moveTo(W / 2, hy - 9); ctx.lineTo(W / 2, hy + 9); ctx.stroke();
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.code === 'ArrowUp') { cm360 = Math.min(120, cm360 + 1); rearm(); e.preventDefault(); }
    else if (e.code === 'ArrowDown') { cm360 = Math.max(5, cm360 - 1); rearm(); e.preventDefault(); }
    else if (e.code === 'KeyR') { rearm(); }
    else if (e.code === 'Enter' && completed) { pointer.exit(); opts.onSeed(cm360); }
  };
  const onLock = (): void => { $('hint').style.display = pointer.isLocked() ? 'none' : 'flex'; };
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerlockchange', onLock);
  window.addEventListener('resize', size);
  canvas.addEventListener('click', () => { if (!pointer.isLocked()) void pointer.request().catch(() => {}); });
  rearm(); size();

  return { dispose() { off(); document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerlockchange', onLock); window.removeEventListener('resize', size); pointer.dispose(); } };
}
```

- [ ] **Step 2: Verify build** -> `npm run build` succeeds.

- [ ] **Step 3: Commit** - `git add src/ui/calibrate/turn-view.ts && git commit -m "feat(ui): 2D-panorama turn view (auto-marks at 360, tune-to-comfort)"`

### Task B4: rewrite setup.ts as the orchestrator

**Files:**
- Modify (rewrite): `src/ui/setup.ts`
- Test (rewrite): `tests/ui/setup.test.ts`

Holds `calibrateReducer`, renders per-step DOM, mounts the sweep/turn views, and on completion writes the draft (`dpi`, `bounds` from the seed, `currentGame`, `profile.speedAccuracy`) and navigates to `session`. The `manual` step is the typed fast path: it writes `dpi`/`currentSens`/`currentGame` and derives bounds via `cmPer360` -> `boundsFromSeed`.

- [ ] **Step 1: Write the failing test** (pure-reachable behavior only: intro -> guided moves toward sweep; manual path writes the draft + navigates)

```ts
// tests/ui/setup.test.ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { setup } from '../../src/ui/setup';
import { cmPer360 } from '../../src/convert/cm360';
import { yawFor } from '../../src/convert/yaw-table';
import { boundsFromSeed } from '../../src/ui/options/settings';
import type { AppContext, Route, SessionDraft } from '../../src/ui/shell';

function fakeCtx(): AppContext & { nav: Route[] } {
  const nav: Route[] = [];
  const draft: SessionDraft = { dpi: 800, currentGame: 'cs2', currentSens: 1, bounds: [15, 60],
    profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } } };
  return { route: 'setup', navigate(r: Route) { nav.push(r); }, draft, nav,
    storage: { saveSession() {}, loadSessions: () => [], saveResult() {}, exportJson: () => '' } } as AppContext & { nav: Route[] };
}

describe('setup (guided calibration orchestrator)', () => {
  it('offers a guided start and a typed fast path on the intro step', () => {
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    expect(host.querySelector('[data-action="start-guided"]')).toBeTruthy();
    expect(host.querySelector('[data-action="start-manual"]')).toBeTruthy();
  });

  it('the typed fast path writes dpi/sens/game + seeded bounds and navigates to session', () => {
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    (host.querySelector('[data-action="start-manual"]') as HTMLButtonElement).click();
    (host.querySelector('[data-field="dpi"]') as HTMLInputElement).value = '1600';
    (host.querySelector('[data-field="sens"]') as HTMLInputElement).value = '0.5';
    (host.querySelector('[data-action="manual-begin"]') as HTMLButtonElement).click();
    expect(ctx.draft.dpi).toBe(1600);
    expect(ctx.draft.currentSens).toBe(0.5);
    const seed = cmPer360(1600, 0.5, yawFor(ctx.draft.currentGame));
    expect(ctx.draft.bounds).toEqual(boundsFromSeed(seed));
    expect(ctx.nav).toContain('session');
  });
});
```

- [ ] **Step 2: Run it, expect failure.** -> FAIL (old setup writes `gate`, has no `start-manual`).

- [ ] **Step 3: Implement the rewrite**

```ts
// src/ui/setup.ts
// Guided calibration orchestrator. Pure step machine (calibrate-flow) under a thin shell that
// mounts the sweep + turn views and writes the session draft. Retires the typed setup + the gate.
import type { AppContext, Screen } from './shell';
import type { GameId } from '../types';
import { GAME_YAW, yawFor } from '../convert/yaw-table';
import { cmPer360 } from '../convert/cm360';
import { boundsFromSeed } from './options/settings';
import { calibrateReducer, initialCalState, type CalState } from './calibrate-flow';
import { createSweepView, type SweepView } from './calibrate/sweep-view';
import { createTurnView, type TurnView } from './calibrate/turn-view';

export function setup(host: HTMLElement, ctx: AppContext): Screen {
  let state: CalState = initialCalState();
  let view: SweepView | TurnView | null = null;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function dispatch(a: Parameters<typeof calibrateReducer>[1]): void {
    state = calibrateReducer(state, a);
    render();
  }

  function teardownView(): void { view?.dispose(); view = null; }

  function gameOptions(sel: GameId): string {
    return GAME_YAW.map((g) => `<option value="${g.id}"${g.id === sel ? ' selected' : ''}>${g.label}</option>`).join('');
  }

  function commitGuided(game: GameId, goal: number): void {
    ctx.draft.dpi = state.dpi ?? ctx.draft.dpi;
    ctx.draft.currentGame = game;
    ctx.draft.profile = { ...ctx.draft.profile, speedAccuracy: goal };
    ctx.draft.bounds = boundsFromSeed(state.seedCm360 ?? cmPer360(ctx.draft.dpi, 1, yawFor(game)));
    ctx.navigate('session');
  }

  function commitManual(dpi: number, sens: number, game: GameId, goal: number): void {
    ctx.draft.dpi = dpi;
    ctx.draft.currentSens = sens;
    ctx.draft.currentGame = game;
    ctx.draft.profile = { ...ctx.draft.profile, speedAccuracy: goal };
    ctx.draft.bounds = boundsFromSeed(cmPer360(dpi, sens, yawFor(game)));
    ctx.navigate('session');
  }

  function render(): void {
    teardownView();
    host.replaceChildren();

    if (state.step === 'sweep') {
      view = createSweepView(host, { padWidthCm: state.padWidthCm,
        onResult: (r) => dispatch({ type: 'sweep-done', dpi: r.dpi, accelerated: r.accelerated }),
        onInvalid: () => dispatch({ type: 'sweep-done', dpi: NaN, accelerated: true }) });
      return;
    }
    if (state.step === 'turn' && state.dpi) {
      view = createTurnView(host, { dpi: state.dpi, onSeed: (cm) => dispatch({ type: 'turn-done', seedCm360: cm }) });
      return;
    }

    const root = document.createElement('section');
    root.className = state.step === 'blocked' ? 'screen screen--arena fade-in' : 'screen screen--shell fade-in';
    root.innerHTML = stepHtml();
    host.appendChild(root);
    wire(root);
  }

  function stepHtml(): string {
    if (state.step === 'intro') return `
      <div class="wrap stack setup__inner">
        <h2 class="display setup__title">+ calibrate</h2>
        <p class="setup__lead">we'll measure your turn by feel, not by numbers. first, how wide is your mousepad?</p>
        ${reduced ? `<p class="setup__lead mono">reduced-motion is on - you can skip the rendered turn with "i already know my numbers" below.</p>` : ''}
        <label class="field">mousepad width (cm)
          <input class="mono" type="number" min="15" max="120" step="1" data-field="pad" value="${state.padWidthCm}"></label>
        <button class="action action--primary" data-action="start-guided">start</button>
        <button class="action action--ghost" data-action="start-manual">i already know my numbers</button>
      </div>`;
    if (state.step === 'blocked') return `
      <div class="wrap stack gate__inner">
        <p class="gate__lead">mouse acceleration looks like it's on (or your pad width was off) - cm/360 is undefined under acceleration.</p>
        <p>turn off OS/driver acceleration ("enhance pointer precision"), then retry.</p>
        <button class="action action--primary" data-action="retry">retry</button>
        <button class="action action--ghost" data-action="manual">type my numbers instead</button>
      </div>`;
    if (state.step === 'manual') return `
      <div class="wrap stack setup__inner">
        <h2 class="display setup__title">+ your numbers</h2>
        <label class="field">mouse dpi<input class="mono" type="number" min="100" max="32000" step="50" data-field="dpi" value="${ctx.draft.dpi}"></label>
        <label class="field">current game<select data-field="game">${gameOptions(ctx.draft.currentGame)}</select></label>
        <label class="field">in-game sensitivity<input class="mono" type="number" min="0.01" step="0.01" data-field="sens" value="${ctx.draft.currentSens}"></label>
        <label class="field">goal - precision to speed<input type="range" min="0" max="1" step="0.01" data-field="goal" value="${ctx.draft.profile.speedAccuracy}"></label>
        <button class="action action--primary" data-action="manual-begin">begin</button>
        <button class="action action--ghost" data-action="back">back</button>
      </div>`;
    // step === 'game'
    return `
      <div class="wrap stack setup__inner">
        <h2 class="display setup__title">+ your game</h2>
        <p class="setup__lead">your comfortable turn is <span class="mono">${(state.seedCm360 ?? 0).toFixed(1)}</span> cm/360. pick your game so we can translate the result.</p>
        <label class="field">game<select data-field="game">${gameOptions(ctx.draft.currentGame)}</select></label>
        <label class="field">goal - precision to speed<input type="range" min="0" max="1" step="0.01" data-field="goal" value="${ctx.draft.profile.speedAccuracy}"></label>
        <button class="action action--primary" data-action="game-begin">play</button>
      </div>`;
  }

  function wire(root: HTMLElement): void {
    const click = (sel: string, fn: () => void): void => root.querySelector(`[data-action="${sel}"]`)?.addEventListener('click', fn);
    const val = (sel: string): string => (root.querySelector(`[data-field="${sel}"]`) as HTMLInputElement | HTMLSelectElement)?.value ?? '';
    click('start-guided', () => dispatch({ type: 'start-guided', padWidthCm: Number(val('pad')) }));
    click('start-manual', () => dispatch({ type: 'start-manual' }));
    click('retry', () => dispatch({ type: 'retry' }));
    click('manual', () => dispatch({ type: 'start-manual' }));
    click('back', () => dispatch({ type: 'back-to-intro' }));
    click('manual-begin', () => commitManual(Number(val('dpi')), Number(val('sens')), val('game') as GameId, Number(val('goal'))));
    click('game-begin', () => commitGuided(val('game') as GameId, Number(val('goal'))));
  }

  return {
    mount() { render(); },
    unmount() { teardownView(); host.replaceChildren(); },
  };
}
```

- [ ] **Step 4: Run the test, expect pass.** `npx vitest run tests/ui/setup.test.ts` -> PASS.

- [ ] **Step 5: Commit** - `git add src/ui/setup.ts tests/ui/setup.test.ts && git commit -m "feat(ui): rewrite setup as the guided-calibration orchestrator + typed fast path"`

---

## Phase C: Wiring + retirement

### Task C1: drop the gate route

**Files:**
- Modify: `src/ui/shell.ts`

- [ ] **Step 1: Edit `Route`** - remove `'gate'`: `export type Route = 'hero' | 'setup' | 'session' | 'result' | 'case-study' | 'options' | 'range';`

- [ ] **Step 2: Edit `ROUTE_HASH`** - remove the `gate: '#/gate',` entry.

- [ ] **Step 3: Run the shell tests** - `npx vitest run tests/ui/shell.test.ts` -> PASS (adjust any test that referenced `gate`; the guided flow stays inside `setup`, so navigation hero -> setup -> session is unchanged).

- [ ] **Step 4: Commit** - `git add src/ui/shell.ts tests/ui/shell.test.ts && git commit -m "refactor(ui): retire the gate route (accel check now rides in the sweep)"`

### Task C2: unregister + delete gate

**Files:**
- Modify: `src/main.ts`
- Delete: `src/ui/gate.ts`, `tests/ui/gate.test.ts`

- [ ] **Step 1: Edit `src/main.ts`** - remove `import { gate } from './ui/gate';` and remove `gate,` from the `screens` map.

- [ ] **Step 2: Delete files** - `git rm src/ui/gate.ts tests/ui/gate.test.ts`

- [ ] **Step 3: Full suite + build** - `npm test && npm run build` -> all green, no dangling `gate` references.

- [ ] **Step 4: Commit** - `git add -A && git commit -m "chore(ui): delete the gate screen + its test"`

### Task C3: runtime verification in Chromium

**Files:** none (manual/runtime QA)

- [ ] **Step 1:** `npm run dev`, open the app, go to `#/setup`.
- [ ] **Step 2:** Guided path: enter pad width -> sweep (lock, click to start/stop slow, then fast) -> confirm a plausible DPI is shown -> turn (lock, spin until `home` returns, watch it auto-mark, tune with up/down, `Enter`) -> game pick -> the session starts and the live plot is centered near your tuned cm/360.
- [ ] **Step 3:** Acceleration path: with OS "enhance pointer precision" on (or a deliberately wrong pad width), the sweep routes to the blocked step with the retry + "type my numbers" options.
- [ ] **Step 4:** Fast path / fallback: from intro, "i already know my numbers" -> type dpi/sens/game -> session seeds correctly. Confirm reduced-motion users can reach this path.
- [ ] **Step 5:** Confirm the result screen still shows the per-game sens for the picked game.

- [ ] **Step 6: Final commit if any QA fixes** - `git commit -am "fix(ui): guided-calibration runtime QA"` (only if changes were needed).

---

## Notes for the implementer

- **No em dashes** anywhere in code, comments, or commit messages (project convention). Use hyphens.
- The sweep + turn views are **shells**: do not add unit tests for their canvas/pointer-lock internals; they are runtime-verified in C3. The pure math they call (`turn-rate`, `dpi-sweep`, `boundsFromSeed`) and the reducer are fully unit-tested.
- The optimizer and the four drills are **untouched**. The only seam is the draft (`dpi`, `bounds`); `runSession` already consumes `bounds`.
- Keep `currentSens` in `SessionDraft` (the fast path still uses it); the guided path simply never sets it.
