# campeón Phase 5 — Shell + Flow + State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the proven measurement core into a usable, end-to-end product: hero → setup → validity gate → live session → result, persisted locally, with the four bio-instruments visibly triangulating **one** cm/360 answer.

**Architecture:** A dependency-free `ui/` shell (hash router + injected `AppContext`; each screen is a pure factory over that context) wraps the existing pure core and the Three.js arena. A `state/` layer persists sessions/results behind the `Storage` interface (localStorage, cloud-ready) and exports JSON. Two thin pure additions complete the core for the UI: `optimizer/breakdown.ts` (each facet's contribution to the one answer) and `optimizer/result.ts` (`Report` + trials + dpi → `Result`). `runSession` grows two optional callbacks (`onTrialStart`, `onTrial`) so the session screen can render the live convergence view without changing the return shape. The **convergence plot** (`ui/convergence-plot.ts`) is split into pure geometry (data → coordinates/paths, unit-tested) and a thin SVG renderer — the same analyze/shell seam used throughout; it is the load-bearing expression of the "one latent optimum, four probes" thesis.

**Tech Stack:** TypeScript (strict, `verbatimModuleSyntax`, `exactOptionalPropertyTypes`) · Vite · Three.js (arena reused from P2/P3) · Vitest + jsdom (DOM/localStorage tests) · DOM + CSS + SVG (no UI framework).

**The unified-system mandate (this phase makes the thesis visible — see memory `campeon-unified-system-goal`):**
- The session screen's centerpiece is **one shared convergence view**: a single cm/360 axis, every trial color-coded by organism dropping onto **one sharpening curve + CI band**. Never four separate score meters.
- The result is **one number at the apex**; its breakdown reveals each facet's *contribution to that one answer* (archerfish → bias-zero cm/360, the precision floor, mantis-shrimp → TTK/hit-rate).
- The hero frames the falcon as **one predator with many faculties**; setup's goal slider sets *where on the single speed↔accuracy trade-off you live*.
- Honesty is craft: a wide CI when facets disagree is shown as a feature, never hidden.

---

## File structure (created/modified in this phase)

```
src/
├─ main.ts                      # MODIFY — mount the shell; keep #arena dev harness reachable
├─ stats/
│  └─ rng.ts                    # CREATE — hoist mulberry32 (now 3+ consumers); bootstrap re-exports
├─ optimizer/
│  ├─ breakdown.ts              # CREATE — computeBreakdown(trials, optimalCm360) → Breakdown
│  ├─ result.ts                 # CREATE — buildResult(report, trials, dpi, games?) → Result
│  └─ session-controller.ts     # MODIFY — onTrialStart / onTrial callbacks (decoupled interim RNG)
├─ state/
│  ├─ storage.ts                # CREATE — Storage impl over an injectable backend (localStorage)
│  └─ export.ts                 # CREATE — pure export bundle + toJson + DOM download trigger
├─ ui/
│  ├─ convergence-plot.ts       # CREATE — pure plotGeometry + thin renderConvergencePlot (SVG)
│  ├─ shell.ts                  # CREATE — hash router, AppContext, SessionDraft, screen lifecycle
│  ├─ hero.ts                   # CREATE — the falcon-silhouette landing
│  ├─ setup.ts                  # CREATE — DPI + game/sens (+ "you sit at X today") + goal slider
│  ├─ gate.ts                   # CREATE — validity gate (pointer-lock + accel check + stance)
│  ├─ session-view.ts           # CREATE — arena + runSession + live convergence + per-instrument HUD
│  └─ result.ts                 # CREATE — one number + CI + per-game table + breakdown + export/save
└─ styles/
   ├─ tokens.css                # MODIFY — organism accent tokens + shell/screen scale tokens
   └─ shell.css                 # CREATE — shell layout, screens, plot, controls (brand-faithful)
tests/
├─ stats/rng.test.ts            # CREATE
├─ optimizer/breakdown.test.ts  # CREATE
├─ optimizer/result.test.ts     # CREATE
├─ optimizer/session-controller.test.ts  # MODIFY — add onTrial/onTrialStart cases
├─ state/storage.test.ts        # CREATE (jsdom)
├─ state/export.test.ts         # CREATE
├─ ui/convergence-plot.test.ts  # CREATE (geometry: node; render: jsdom)
├─ ui/shell.test.ts             # CREATE (jsdom)
├─ ui/hero.test.ts              # CREATE (jsdom)
├─ ui/setup.test.ts             # CREATE (jsdom)
└─ ui/result.test.ts            # CREATE (jsdom)
```

**Scope boundary (deferred to Phase 6 "Polish", noted so reviewers don't flag gaps):** the `+case study` science page and the full `+options` panel (conversion-school switch, per-game yaw overrides, search-bounds editor) are Phase 6. This phase routes their hero links to tasteful stub screens. Also deferred (P4 carry-overs, unchanged by this phase): per-point Fitts-spread nugget into `Observation.noise`; wiring the GP/curve-disagreement CI-widen into `runSession`.

---

## Conventions (every task)

- **Tests:** explicit `import { describe, it, expect } from 'vitest';` — never globals.
- **DOM/localStorage tests:** add `// @vitest-environment jsdom` as the FIRST line of the test file (Task 0 installs jsdom).
- **Type-only imports:** `import type { ... }` (`verbatimModuleSyntax`).
- **`exactOptionalPropertyTypes`:** don't pass `undefined` explicitly to optional props; omit them.
- **Commit trailer (verbatim) on every commit:**
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- **Brand:** bone `#EAE7DC` / slate `#4A5A66` / slate-2 `#6C7A85` / gold `#FFC400` / ink `#0D0D0D` / parchment `#EFDEA5`; Gefalent display, system sans body, mono for data. The `+` prefix is the action mark. Honor `prefers-reduced-motion` (tokens already zero the durations).
- **Run a single test file:** `npx vitest run tests/<path>`. **Full suite:** `npm test`. **Types:** `npx tsc --noEmit`.

---

### Task 0: Test environment — jsdom

**Files:**
- Modify: `package.json` (devDependency)

- [ ] **Step 1: Install jsdom**

```bash
npm install -D jsdom
```

- [ ] **Step 2: Verify it resolves**

Run: `node -e "require('jsdom'); console.log('jsdom ok')"`
Expected: `jsdom ok`

We keep the global vitest env as `node` (fast, pure-core default) and opt specific files into jsdom with a `// @vitest-environment jsdom` docblock. No `vitest.config.ts` change needed.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add jsdom for DOM/localStorage tests (Phase 5)"
```

---

### Task 1: Hoist `mulberry32` to `stats/rng.ts`

**Files:**
- Create: `src/stats/rng.ts`
- Modify: `src/stats/bootstrap.ts` (remove the local fn, re-export)
- Test: `tests/stats/rng.test.ts`

Rationale: `mulberry32` now has 3+ consumers (bootstrap, arena-harness, session-controller, tests). Hoist it to a shared util; keep a re-export so existing `from '../stats/bootstrap'` imports stay valid (no churn).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/stats/rng.test.ts
import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../../src/stats/rng';
import { mulberry32 as viaBootstrap } from '../../src/stats/bootstrap';

describe('mulberry32', () => {
  it('is deterministic and in [0,1)', () => {
    const r = mulberry32(42);
    const seq = [r(), r(), r()];
    for (const v of seq) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    const r2 = mulberry32(42);
    expect([r2(), r2(), r2()]).toEqual(seq);
  });

  it('different seeds give different streams', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('bootstrap re-exports the same implementation (sequence preserved)', () => {
    const a = mulberry32(7);
    const b = viaBootstrap(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** — Run: `npx vitest run tests/stats/rng.test.ts` — Expected: FAIL (`src/stats/rng` not found).

- [ ] **Step 3: Create `src/stats/rng.ts` with the function moved VERBATIM**

```typescript
// src/stats/rng.ts
/** Deterministic seeded PRNG (mulberry32) — reproducible bootstrap, sessions, and tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 4: Edit `src/stats/bootstrap.ts`** — delete the local `mulberry32` definition (lines defining it) and add at the top, after the existing imports:

```typescript
import { mulberry32 } from './rng';
export { mulberry32 } from './rng';
```

(Keep `bootstrapCi` and the private `peakCm360` exactly as they are; `bootstrapCi` still uses the imported `mulberry32` indirectly via callers — it takes `rng` as a param, so no body change.)

- [ ] **Step 5: Run rng + full suite; expect PASS** — Run: `npx vitest run tests/stats/rng.test.ts && npm test` — Expected: all green (164 prior + 3 new). Then `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/stats/rng.ts src/stats/bootstrap.ts tests/stats/rng.test.ts
git commit -m "refactor(stats): hoist mulberry32 to stats/rng (shared util); bootstrap re-exports"
```

---

### Task 2: `optimizer/breakdown.ts` — each facet's contribution

**Files:**
- Create: `src/optimizer/breakdown.ts`
- Test: `tests/optimizer/breakdown.test.ts`

Reads the instrument-specific `raw` metrics (calibrate `gain`/`sigmaR`, strike `ttkMs`/`hitRate`) to produce the `Result.breakdown`. **biasZeroCm360** = the cm/360 where calibrate gain `g` crosses 1 (interpolated in ln-space between the bracketing trials — `g>1` overshoot at low cm/360, `g<1` undershoot at high cm/360). **precisionFloorDeg** = the *minimum* calibrate `sigmaR` observed (the skill/hardware floor, spec §4.3). **ttkMs / hitRate** = the strike trial nearest the optimum. Missing data → `NaN` (the UI renders `—`); never fabricate a value.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/optimizer/breakdown.test.ts
import { describe, it, expect } from 'vitest';
import { computeBreakdown } from '../../src/optimizer/breakdown';
import type { TrialResult } from '../../src/types';

const cal = (cm360: number, gain: number, sigmaR: number): TrialResult => ({
  instrument: 'calibrate', cm360, score: 0.5,
  raw: { gain, sigmaR, biasMag: 0, mse: 0 }, at: 0,
});
const str = (cm360: number, ttkMs: number, hitRate: number): TrialResult => ({
  instrument: 'strike', cm360, score: 1, raw: { ttkMs, hitRate }, at: 0,
});

describe('computeBreakdown', () => {
  it('interpolates the bias-zero cm/360 where gain crosses 1 (in ln space)', () => {
    // gain 1.2 at 20, 0.8 at 40 → crosses 1 at the ln midpoint = exp((ln20+ln40)/2) ≈ 28.28
    const b = computeBreakdown([cal(20, 1.2, 0.5), cal(40, 0.8, 0.4)], 30);
    expect(b.biasZeroCm360).toBeGreaterThan(27);
    expect(b.biasZeroCm360).toBeLessThan(29.5);
  });

  it('precisionFloorDeg is the minimum calibrate sigmaR', () => {
    const b = computeBreakdown([cal(20, 1.2, 0.5), cal(40, 0.8, 0.31), cal(30, 1.0, 0.42)], 30);
    expect(b.precisionFloorDeg).toBeCloseTo(0.31, 6);
  });

  it('ttk/hitRate come from the strike trial nearest the optimum', () => {
    const b = computeBreakdown([str(20, 700, 0.6), str(45, 520, 0.9), cal(30, 1.0, 0.4)], 44);
    expect(b.ttkMs).toBe(520);
    expect(b.hitRate).toBe(0.9);
  });

  it('falls back to NaN for absent instruments (no fabrication)', () => {
    const b = computeBreakdown([str(30, 500, 0.8)], 30);
    expect(Number.isNaN(b.biasZeroCm360)).toBe(true);
    expect(Number.isNaN(b.precisionFloorDeg)).toBe(true);
    expect(b.ttkMs).toBe(500);
  });

  it('no gain bracket (all overshoot) → nearest-to-1 gain trial cm360, not interpolation', () => {
    const b = computeBreakdown([cal(20, 1.4, 0.5), cal(30, 1.1, 0.4)], 25);
    expect(b.biasZeroCm360).toBe(30); // gain 1.1 is closest to 1
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** — `npx vitest run tests/optimizer/breakdown.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```typescript
// src/optimizer/breakdown.ts
import type { Cm360, Degrees, Ms, TrialResult } from '../types';

export interface Breakdown {
  /** cm/360 where the calibrate gain crosses 1 (the bias-zero sensitivity, spec §4.3). */
  biasZeroCm360: Cm360;
  /** Minimum calibrate σ_R observed — the precision floor (skill/hardware), not a recommendation. */
  precisionFloorDeg: Degrees;
  /** Strike time-to-kill at the optimum. */
  ttkMs: Ms;
  /** Strike hit rate at the optimum. */
  hitRate: number;
}

const byInstrument = (trials: readonly TrialResult[], id: TrialResult['instrument']) =>
  trials.filter((t) => t.instrument === id);

/** cm/360 where gain = 1, interpolated in ln-space across the bracketing pair; else nearest-to-1. */
function biasZero(cal: readonly TrialResult[]): Cm360 {
  const pts = cal
    .filter((t) => Number.isFinite(t.raw.gain) && t.cm360 > 0)
    .map((t) => ({ lx: Math.log(t.cm360), g: t.raw.gain as number, cm: t.cm360 }))
    .sort((a, b) => a.lx - b.lx);
  if (pts.length === 0) return NaN;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if ((a.g - 1) === 0) return a.cm;
    if ((a.g - 1) * (b.g - 1) < 0) {
      const f = (1 - a.g) / (b.g - a.g); // a.g + f·(b.g−a.g) = 1
      return Math.exp(a.lx + f * (b.lx - a.lx));
    }
  }
  // No crossing: report the trial whose gain is closest to 1 (honest nearest estimate).
  return pts.reduce((best, p) => (Math.abs(p.g - 1) < Math.abs(best.g - 1) ? p : best)).cm;
}

/** Pure breakdown of the one answer into each facet's contribution. Missing data → NaN (no fabrication). */
export function computeBreakdown(trials: readonly TrialResult[], optimalCm360: Cm360): Breakdown {
  const cal = byInstrument(trials, 'calibrate');
  const str = byInstrument(trials, 'strike');

  const sigmas = cal.map((t) => t.raw.sigmaR).filter((v): v is number => Number.isFinite(v));
  const precisionFloorDeg = sigmas.length ? Math.min(...sigmas) : NaN;

  const lOpt = Math.log(optimalCm360);
  const nearest = str
    .filter((t) => t.cm360 > 0)
    .reduce<TrialResult | null>(
      (best, t) =>
        best === null || Math.abs(Math.log(t.cm360) - lOpt) < Math.abs(Math.log(best.cm360) - lOpt)
          ? t
          : best,
      null,
    );

  return {
    biasZeroCm360: biasZero(cal),
    precisionFloorDeg,
    ttkMs: nearest ? (nearest.raw.ttkMs ?? NaN) : NaN,
    hitRate: nearest ? (nearest.raw.hitRate ?? NaN) : NaN,
  };
}
```

- [ ] **Step 4: Run it; expect PASS** — `npx vitest run tests/optimizer/breakdown.test.ts` — Expected: 5 pass. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/optimizer/breakdown.ts tests/optimizer/breakdown.test.ts
git commit -m "feat(optimizer): breakdown — bias-zero cm/360, precision floor, strike TTK/hit-rate"
```

---

### Task 3: `optimizer/result.ts` — `Report` + trials + dpi → `Result`

**Files:**
- Create: `src/optimizer/result.ts`
- Test: `tests/optimizer/result.test.ts`

Combines the `Report` (optimum + CI), the per-game native sensitivities (`perGameSens`), and the `breakdown` into the `Result` the UI renders and persists.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/optimizer/result.test.ts
import { describe, it, expect } from 'vitest';
import { buildResult } from '../../src/optimizer/result';
import { sensFor } from '../../src/convert/cm360';
import { yawFor } from '../../src/convert/yaw-table';
import type { Report, TrialResult } from '../../src/types';

const report: Report = { optimalCm360: 32, ci90: [28, 37], curve: [{ x: Math.log(32), mean: 0.1 }] };
const trials: TrialResult[] = [
  { instrument: 'calibrate', cm360: 28, score: 0.5, raw: { gain: 1.1, sigmaR: 0.4 }, at: 0 },
  { instrument: 'calibrate', cm360: 37, score: 0.5, raw: { gain: 0.9, sigmaR: 0.35 }, at: 0 },
  { instrument: 'strike', cm360: 33, score: 1, raw: { ttkMs: 510, hitRate: 0.86 }, at: 0 },
];

describe('buildResult', () => {
  it('carries the optimum + CI and computes native per-game sensitivities at the optimum', () => {
    const r = buildResult(report, trials, 800);
    expect(r.optimalCm360).toBe(32);
    expect(r.ci90).toEqual([28, 37]);
    expect(r.perGameSens.cs2).toBeCloseTo(sensFor(32, 800, yawFor('cs2')), 9);
    expect(r.perGameSens.valorant).toBeCloseTo(sensFor(32, 800, yawFor('valorant')), 9);
  });

  it('includes the breakdown', () => {
    const r = buildResult(report, trials, 800);
    expect(r.breakdown.ttkMs).toBe(510);
    expect(r.breakdown.precisionFloorDeg).toBeCloseTo(0.35, 6);
    expect(r.breakdown.biasZeroCm360).toBeGreaterThan(28);
    expect(r.breakdown.biasZeroCm360).toBeLessThan(37);
  });

  it('can restrict per-game output to a subset', () => {
    const r = buildResult(report, trials, 800, ['cs2', 'valorant']);
    expect(Object.keys(r.perGameSens).sort()).toEqual(['cs2', 'valorant']);
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** — `npx vitest run tests/optimizer/result.test.ts`.

- [ ] **Step 3: Implement**

```typescript
// src/optimizer/result.ts
import type { Cm360, Dpi, GameId, Report, Result, TrialResult } from '../types';
import { perGameSens } from '../convert/schools';
import { computeBreakdown } from './breakdown';

/**
 * Assemble the player-facing Result: the one cm/360 answer + CI, the native per-game sensitivities
 * at that answer, and the breakdown of how each facet contributed. `games` optionally restricts the
 * per-game table (default: all games in the yaw table).
 */
export function buildResult(
  report: Report,
  trials: readonly TrialResult[],
  dpi: Dpi,
  games?: readonly GameId[],
): Result {
  const all = perGameSens(report.optimalCm360, dpi);
  const perGameSensOut = games
    ? (Object.fromEntries(games.map((g) => [g, all[g]])) as Partial<Record<GameId, number>>)
    : all;
  return {
    optimalCm360: report.optimalCm360 as Cm360,
    ci90: report.ci90,
    perGameSens: perGameSensOut,
    breakdown: computeBreakdown(trials, report.optimalCm360),
  };
}
```

- [ ] **Step 4: Run it; expect PASS** — `npx vitest run tests/optimizer/result.test.ts`. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/optimizer/result.ts tests/optimizer/result.test.ts
git commit -m "feat(optimizer): buildResult — Report + trials + dpi → Result (per-game + breakdown)"
```

---

### Task 4: `runSession` live callbacks (`onTrialStart`, `onTrial`)

**Files:**
- Modify: `src/optimizer/session-controller.ts`
- Test: `tests/optimizer/session-controller.test.ts` (add a `describe` block; keep existing tests untouched)

The session screen needs (a) to announce the active instrument *before* a trial ("now: +flick"), and (b) a cheap interim `Report` *after* each trial to redraw the live convergence view. The interim bootstrap uses its **own** RNG (seeded per trial index) so it never consumes the shared instrument-noise stream — set or unset, the trial sequence is byte-identical (load-bearing test below).

- [ ] **Step 1: Write the failing tests** (append to `tests/optimizer/session-controller.test.ts`, inside the `runSession` area)

```typescript
import type { InstrumentId } from '../../src/types'; // ensure imported (it already is)

describe('runSession — live callbacks', () => {
  const base = () => ({
    dpi: 800,
    profile: profile({ flick: 1 }),
    bounds: sessionBounds,
    engine: makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.05 }, acquisition: 'ei' as const }),
    instruments: instruments({ flick: synthetic('flick', 33) }),
    scene: new FakeScene(),
    schedule: ['flick'] as InstrumentId[],
    maxTrials: 6,
    rng: mulberry32(5),
    bootstrapIters: 80,
  });

  it('fires onTrialStart before and onTrial after each trial with a finite interim estimate', async () => {
    const starts: number[] = [];
    const afters: number[] = [];
    await runSession({
      ...base(),
      onTrialStart: (_id, i) => starts.push(i),
      onTrial: (_t, trials, interim) => {
        afters.push(trials.length);
        expect(Number.isFinite(interim.optimalCm360)).toBe(true);
      },
    });
    expect(starts).toEqual([0, 1, 2, 3, 4, 5]);
    expect(afters).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('the trial sequence is identical whether or not onTrial is set (interim uses its own RNG)', async () => {
    const a = await runSession({ ...base(), rng: mulberry32(5) });
    const b = await runSession({ ...base(), rng: mulberry32(5), onTrial: () => {} });
    expect(b.trials.map((t) => t.cm360)).toEqual(a.trials.map((t) => t.cm360));
  });
});
```

- [ ] **Step 2: Run; expect FAIL** — `npx vitest run tests/optimizer/session-controller.test.ts` — Expected: FAIL (`onTrialStart`/`onTrial` not in `SessionConfig`).

- [ ] **Step 3: Edit `src/optimizer/session-controller.ts`**

Add the import (top, with the other imports):
```typescript
import { mulberry32 } from '../stats/rng';
```

Add to the `SessionConfig` interface (after `bootstrapIters?`):
```typescript
  /** Fired before each trial's instrument runs — for a live "now: +flick" HUD. */
  onTrialStart?: (id: InstrumentId, index: number, cm360: Cm360) => void;
  /** Fired after each trial with the trial, all trials so far, and a cheap interim Report — for the
   *  live convergence view. The interim bootstrap uses its OWN seeded RNG, so setting this never
   *  perturbs the (deterministic) instrument-noise stream. */
  onTrial?: (trial: TrialResult, trials: readonly TrialResult[], interim: Report) => void;
  /** Bootstrap resamples for the per-trial interim report (default 120; cheaper than the final). */
  interimBootstrapIters?: number;
```

In `runSession`, inside the `while` loop, replace the block from `const id = ...` through `trials.push(result);` with:
```typescript
    const id = schedule[trials.length % schedule.length];
    config.onTrialStart?.(id, trials.length, cm360);
    const result = await config.instruments[id].run(
      { cm360, dpi: config.dpi, rng, profile },
      config.scene,
    );
    trials.push(result);

    if (config.onTrial) {
      const interim = finalizeReport(
        trialsToObservations(trials, profile),
        bounds,
        mulberry32(0x5eed ^ trials.length), // own stream — does NOT touch the instrument RNG
        { bootstrapIters: config.interimBootstrapIters ?? 120 },
      );
      config.onTrial(result, trials, interim);
    }
```

(Leave the cold-start/`cm360` line and the `ciStopWidth` early-stop block exactly as they are.)

- [ ] **Step 4: Run session-controller tests + full suite; expect PASS** — `npx vitest run tests/optimizer/session-controller.test.ts && npm test`. Then `npx tsc --noEmit` clean. (The existing convergence/load-bearing tests must still pass unchanged — they set neither callback, so the interim path is skipped.)

- [ ] **Step 5: Commit**

```bash
git add src/optimizer/session-controller.ts tests/optimizer/session-controller.test.ts
git commit -m "feat(optimizer): runSession onTrialStart/onTrial hooks for the live convergence view"
```

---

### Task 5: `state/storage.ts` — persistence behind the `Storage` interface

**Files:**
- Create: `src/state/storage.ts`
- Test: `tests/state/storage.test.ts` (jsdom)

Implements `Storage` over an **injectable** key/value backend (defaults to `localStorage`). Sessions are upserted by `id`; results keyed by `sessionId`. Malformed/missing data degrades to empty (never throws on read). Injecting a Map-backed fake keeps the unit test independent of the environment.

- [ ] **Step 1: Write the failing test**

```typescript
// @vitest-environment jsdom
// tests/state/storage.test.ts
import { describe, it, expect } from 'vitest';
import { createStorage, type KvBackend } from '../../src/state/storage';
import type { Result, Session } from '../../src/types';

const fakeKv = (): KvBackend => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};
const session = (id: string): Session => ({
  id, dpi: 800,
  profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
  trials: [], status: 'complete', createdAt: 0,
});
const result: Result = {
  optimalCm360: 32, ci90: [28, 37], perGameSens: { cs2: 1.5 },
  breakdown: { biasZeroCm360: 30, precisionFloorDeg: 0.4, ttkMs: 500, hitRate: 0.8 },
};

describe('LocalStorage Storage', () => {
  it('round-trips sessions and upserts by id', () => {
    const s = createStorage(fakeKv());
    s.saveSession(session('a'));
    s.saveSession(session('b'));
    s.saveSession({ ...session('a'), dpi: 1600 }); // upsert, not append
    const all = s.loadSessions();
    expect(all.map((x) => x.id).sort()).toEqual(['a', 'b']);
    expect(all.find((x) => x.id === 'a')?.dpi).toBe(1600);
  });

  it('saves and exports results keyed by sessionId', () => {
    const s = createStorage(fakeKv());
    s.saveSession(session('a'));
    s.saveResult('a', result);
    const json = s.exportJson();
    const parsed = JSON.parse(json);
    expect(parsed.results.a.optimalCm360).toBe(32);
    expect(parsed.sessions[0].id).toBe('a');
    expect(typeof parsed.version).toBe('string');
  });

  it('returns [] for missing or malformed session data (never throws)', () => {
    const kv = fakeKv();
    kv.setItem('campeon.sessions.v1', '{not json');
    const s = createStorage(kv);
    expect(s.loadSessions()).toEqual([]);
  });

  it('defaults to window.localStorage when no backend is passed', () => {
    const s = createStorage();
    s.saveSession(session('z'));
    expect(s.loadSessions().some((x) => x.id === 'z')).toBe(true);
  });
});
```

- [ ] **Step 2: Run; expect FAIL** — `npx vitest run tests/state/storage.test.ts`.

- [ ] **Step 3: Implement**

```typescript
// src/state/storage.ts
import type { Result, Session, Storage } from '../types';

/** Minimal key/value surface — satisfied by window.localStorage and by test fakes. */
export interface KvBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const SESSIONS_KEY = 'campeon.sessions.v1';
const RESULTS_KEY = 'campeon.results.v1';
const VERSION = '1';

function readJson<T>(kv: KvBackend, key: string, fallback: T): T {
  const raw = kv.getItem(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback; // malformed → degrade, never throw on read
  }
}

class LocalStorageStore implements Storage {
  constructor(private readonly kv: KvBackend) {}

  saveSession(s: Session): void {
    const all = this.loadSessions().filter((x) => x.id !== s.id);
    all.push(s);
    this.kv.setItem(SESSIONS_KEY, JSON.stringify(all));
  }

  loadSessions(): Session[] {
    const all = readJson<Session[]>(this.kv, SESSIONS_KEY, []);
    return Array.isArray(all) ? all : [];
  }

  loadResults(): Record<string, Result> {
    const all = readJson<Record<string, Result>>(this.kv, RESULTS_KEY, {});
    return all && typeof all === 'object' ? all : {};
  }

  saveResult(sessionId: string, r: Result): void {
    const all = this.loadResults();
    all[sessionId] = r;
    this.kv.setItem(RESULTS_KEY, JSON.stringify(all));
  }

  exportJson(): string {
    return JSON.stringify(
      { version: VERSION, sessions: this.loadSessions(), results: this.loadResults() },
      null,
      2,
    );
  }
}

/** Create a Storage. Defaults to window.localStorage; pass a backend in tests. */
export function createStorage(backend?: KvBackend): Storage & { loadResults(): Record<string, Result> } {
  return new LocalStorageStore(backend ?? window.localStorage);
}
```

(Note: `Storage` from `types.ts` doesn't declare `loadResults`, but the impl exposes it for `export.ts`; the return type intersects it in. This keeps the public `Storage` contract intact while giving the export module typed access.)

- [ ] **Step 4: Run; expect PASS** — `npx vitest run tests/state/storage.test.ts`. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/state/storage.ts tests/state/storage.test.ts
git commit -m "feat(state): localStorage-backed Storage (injectable backend, upsert, safe reads)"
```

---

### Task 6: `state/export.ts` — JSON export bundle + download

**Files:**
- Create: `src/state/export.ts`
- Test: `tests/state/export.test.ts`

Pure bundle builder + serializer (tested), plus a thin DOM download trigger (runtime-only).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/state/export.test.ts
import { describe, it, expect } from 'vitest';
import { buildExportBundle, toJson } from '../../src/state/export';
import type { Result, Session } from '../../src/types';

const session: Session = {
  id: 'a', dpi: 800,
  profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
  trials: [], status: 'complete', createdAt: 123,
};
const result: Result = {
  optimalCm360: 32, ci90: [28, 37], perGameSens: { cs2: 1.5 },
  breakdown: { biasZeroCm360: 30, precisionFloorDeg: 0.4, ttkMs: 500, hitRate: 0.8 },
};

describe('export', () => {
  it('builds a versioned, timestamped bundle', () => {
    const b = buildExportBundle([session], { a: result }, 777);
    expect(b.version).toBe('1');
    expect(b.exportedAt).toBe(777);
    expect(b.sessions[0].id).toBe('a');
    expect(b.results.a.optimalCm360).toBe(32);
  });

  it('serializes to pretty JSON that round-trips', () => {
    const json = toJson(buildExportBundle([session], { a: result }, 777));
    expect(json).toContain('\n  '); // 2-space pretty
    expect(JSON.parse(json).results.a.ci90).toEqual([28, 37]);
  });
});
```

- [ ] **Step 2: Run; expect FAIL** — `npx vitest run tests/state/export.test.ts`.

- [ ] **Step 3: Implement**

```typescript
// src/state/export.ts
import type { Ms, Result, Session } from '../types';

export interface ExportBundle {
  version: string;
  exportedAt: Ms;
  sessions: Session[];
  results: Record<string, Result>;
}

export function buildExportBundle(
  sessions: readonly Session[],
  results: Readonly<Record<string, Result>>,
  now: Ms,
): ExportBundle {
  return { version: '1', exportedAt: now, sessions: [...sessions], results: { ...results } };
}

export function toJson(bundle: ExportBundle): string {
  return JSON.stringify(bundle, null, 2);
}

/** Browser-only: trigger a file download of `json`. Untested DOM glue. */
export function triggerDownload(filename: string, json: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Run; expect PASS** — `npx vitest run tests/state/export.test.ts`. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/state/export.ts tests/state/export.test.ts
git commit -m "feat(state): JSON export bundle (pure) + browser download trigger"
```

---

### Task 7: `ui/convergence-plot.ts` — the unified-system showpiece (pure geometry + SVG)

**Files:**
- Create: `src/ui/convergence-plot.ts`
- Modify: `src/styles/tokens.css` (organism accent tokens)
- Test: `tests/ui/convergence-plot.test.ts` (geometry: node; render: jsdom)

The single visualization that carries the thesis: a cm/360 axis (log) with every trial as an organism-colored mark, the fitted curve, the **sharpening CI band**, and the peak line — all converging on **one** answer. Geometry is pure (data → pixel coordinates / SVG path strings); rendering is a thin DOM shell.

🎓 **Design-engineering pattern:** split a data-viz into *geometry* (pure: domain → screen coordinates and path strings, fully unit-testable) and *rendering* (thin: write attributes to SVG nodes). Same analyze/shell seam the instruments use. You unit-test the math (does cm/360=lo map to the left edge? does the CI band span the right pixels?) without a DOM, and the renderer stays dumb.

- [ ] **Step 1: Add organism accent tokens** to `src/styles/tokens.css` (inside `:root`, after `--parchment`):

```css
  /* organism accents (track=slate, flick=gold from the core palette; +2 harmonized hues) */
  --c-track: #4A5A66;     /* falcon/dragonfly — slate */
  --c-flick: #FFC400;     /* spider/raptor — gold */
  --c-calibrate: #7FA6B6; /* archerfish — water blue (cool, harmonized with slate) */
  --c-strike: #E8702A;    /* mantis shrimp — strike ember (warm, harmonized with gold) */
```

- [ ] **Step 2: Write the failing test**

```typescript
// tests/ui/convergence-plot.test.ts
import { describe, it, expect } from 'vitest';
import { plotGeometry } from '../../src/ui/convergence-plot';

const size = { width: 600, height: 300 };
const bounds: [number, number] = [15, 60];

describe('plotGeometry', () => {
  it('maps the cm/360 bounds (log axis) to the padded x-extent', () => {
    const g = plotGeometry({ bounds, marks: [], size });
    const left = g.xToPx(15);
    const right = g.xToPx(60);
    expect(left).toBeCloseTo(g.pad, 6);
    expect(right).toBeCloseTo(size.width - g.pad, 6);
    // log axis: the geometric midpoint sits at the pixel midpoint
    expect(g.xToPx(Math.sqrt(15 * 60))).toBeCloseTo((left + right) / 2, 6);
  });

  it('places marks inside the plot and tags them with their instrument', () => {
    const g = plotGeometry({
      bounds,
      marks: [{ cm360: 30, score: 0.2, instrument: 'flick' }],
      size,
    });
    expect(g.marks).toHaveLength(1);
    expect(g.marks[0].instrument).toBe('flick');
    expect(g.marks[0].px).toBeGreaterThan(g.pad);
    expect(g.marks[0].px).toBeLessThan(size.width - g.pad);
    expect(g.marks[0].py).toBeGreaterThanOrEqual(g.pad);
    expect(g.marks[0].py).toBeLessThanOrEqual(size.height - g.pad);
  });

  it('builds an SVG path for the fitted curve and a CI rect + peak line', () => {
    const curve = [
      { x: Math.log(20), mean: 0 },
      { x: Math.log(30), mean: 0.5 },
      { x: Math.log(45), mean: 0.1 },
    ];
    const g = plotGeometry({ bounds, marks: [], curve, ci90: [27, 36], peak: 31, size });
    expect(g.curvePath).toMatch(/^M /);
    expect(g.ciRectPx).not.toBeNull();
    expect(g.ciRectPx!.width).toBeGreaterThan(0);
    expect(g.peakPx).toBeGreaterThan(g.pad);
  });

  it('handles empty data without throwing (no curve, no band)', () => {
    const g = plotGeometry({ bounds, marks: [], size });
    expect(g.curvePath).toBeNull();
    expect(g.ciRectPx).toBeNull();
    expect(g.peakPx).toBeNull();
  });
});

describe('renderConvergencePlot (jsdom)', () => {
  it('renders a mark per observation and the curve path', async () => {
    // @vitest-environment jsdom  ← if split is awkward, put this whole render block in its own file
    const { renderConvergencePlot } = await import('../../src/ui/convergence-plot');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const g = plotGeometry({
      bounds,
      marks: [
        { cm360: 25, score: 0.1, instrument: 'track' },
        { cm360: 35, score: 0.3, instrument: 'strike' },
      ],
      curve: [{ x: Math.log(20), mean: 0 }, { x: Math.log(40), mean: 0.4 }],
      size,
    });
    renderConvergencePlot(svg, g);
    expect(svg.querySelectorAll('[data-mark]').length).toBe(2);
    expect(svg.querySelector('[data-curve]')).not.toBeNull();
  });
});
```

> Implementer note: jsdom and node environments can't mix in one file via inline comment. **Split** into `tests/ui/convergence-plot.test.ts` (pure geometry, node) and `tests/ui/convergence-plot.render.test.ts` (`// @vitest-environment jsdom` first line, the render block). Keep both.

- [ ] **Step 3: Run; expect FAIL** — `npx vitest run tests/ui/convergence-plot.test.ts`.

- [ ] **Step 4: Implement**

```typescript
// src/ui/convergence-plot.ts
import type { Cm360, InstrumentId } from '../types';

export interface PlotSize { width: number; height: number; }
export interface PlotMark { cm360: Cm360; score: number; instrument: InstrumentId; }
export interface PlotInput {
  bounds: [Cm360, Cm360];
  marks: readonly PlotMark[];
  curve?: readonly { x: number; mean: number }[]; // x = ln(cm/360)
  ci90?: [Cm360, Cm360];
  peak?: Cm360;
  size: PlotSize;
  pad?: number;
}
export interface PlotMarkPx extends PlotMark { px: number; py: number; }
export interface PlotGeometry {
  size: PlotSize;
  pad: number;
  xToPx(cm360: Cm360): number;
  xTicks: { cm360: Cm360; px: number }[];
  marks: PlotMarkPx[];
  curvePath: string | null;
  ciRectPx: { x: number; width: number } | null;
  peakPx: number | null;
  yRange: [number, number];
}

const NICE_TICKS = [10, 15, 20, 25, 30, 35, 40, 50, 60, 80];

export function plotGeometry(input: PlotInput): PlotGeometry {
  const { bounds, marks, curve, ci90, peak, size } = input;
  const pad = input.pad ?? 28;
  const [lo, hi] = bounds;
  const lLo = Math.log(lo), lHi = Math.log(hi);
  const x0 = pad, x1 = size.width - pad;
  const y0 = size.height - pad, y1 = pad;

  const xToPx = (cm360: number): number =>
    x0 + ((Math.log(cm360) - lLo) / (lHi - lLo)) * (x1 - x0);

  // y-range from marks + curve, padded 8%; default [0,1] when empty.
  const ys = [...marks.map((m) => m.score), ...(curve?.map((c) => c.mean) ?? [])];
  let yMin = ys.length ? Math.min(...ys) : 0;
  let yMax = ys.length ? Math.max(...ys) : 1;
  if (yMax - yMin < 1e-9) { yMin -= 0.5; yMax += 0.5; }
  const span = yMax - yMin;
  yMin -= span * 0.08; yMax += span * 0.08;
  const yToPx = (score: number): number =>
    y0 + ((score - yMin) / (yMax - yMin)) * (y1 - y0);

  const xTicks = NICE_TICKS.filter((t) => t >= lo && t <= hi).map((t) => ({ cm360: t, px: xToPx(t) }));

  const marksPx: PlotMarkPx[] = marks.map((m) => ({ ...m, px: xToPx(m.cm360), py: yToPx(m.score) }));

  let curvePath: string | null = null;
  if (curve && curve.length >= 2) {
    curvePath = curve
      .map((c, i) => `${i === 0 ? 'M' : 'L'} ${xToPx(Math.exp(c.x)).toFixed(2)},${yToPx(c.mean).toFixed(2)}`)
      .join(' ');
  }

  const ciRectPx =
    ci90 && ci90[1] > ci90[0]
      ? { x: xToPx(ci90[0]), width: xToPx(ci90[1]) - xToPx(ci90[0]) }
      : null;

  const peakPx = peak !== undefined ? xToPx(peak) : null;

  return { size, pad, xToPx, xTicks, marks: marksPx, curvePath, ciRectPx, peakPx, yRange: [yMin, yMax] };
}

const NS = 'http://www.w3.org/2000/svg';
const el = (name: string, attrs: Record<string, string>): SVGElement => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
const ORGANISM_VAR: Record<InstrumentId, string> = {
  track: 'var(--c-track)', flick: 'var(--c-flick)', calibrate: 'var(--c-calibrate)', strike: 'var(--c-strike)',
};

/** Thin renderer: clears `svg` and draws the geometry (CI band → curve → marks → peak → ticks). */
export function renderConvergencePlot(svg: SVGElement, g: PlotGeometry): void {
  svg.setAttribute('viewBox', `0 0 ${g.size.width} ${g.size.height}`);
  svg.replaceChildren();

  if (g.ciRectPx) {
    svg.appendChild(el('rect', {
      x: g.ciRectPx.x.toFixed(2), y: String(g.pad), width: g.ciRectPx.width.toFixed(2),
      height: String(g.size.height - 2 * g.pad), fill: 'var(--gold)', 'fill-opacity': '0.12', 'data-ci': '',
    }));
  }
  if (g.curvePath) {
    svg.appendChild(el('path', {
      d: g.curvePath, fill: 'none', stroke: 'var(--bone)', 'stroke-width': '2',
      'stroke-opacity': '0.7', 'data-curve': '',
    }));
  }
  if (g.peakPx !== null) {
    svg.appendChild(el('line', {
      x1: g.peakPx.toFixed(2), y1: String(g.pad), x2: g.peakPx.toFixed(2),
      y2: String(g.size.height - g.pad), stroke: 'var(--gold)', 'stroke-width': '1.5', 'data-peak': '',
    }));
  }
  for (const m of g.marks) {
    const filled = m.instrument === 'track' || m.instrument === 'flick';
    svg.appendChild(el('circle', {
      cx: m.px.toFixed(2), cy: m.py.toFixed(2), r: '4',
      fill: filled ? ORGANISM_VAR[m.instrument] : 'none',
      stroke: ORGANISM_VAR[m.instrument], 'stroke-width': '1.5',
      'data-mark': m.instrument,
    }));
  }
  for (const t of g.xTicks) {
    const label = el('text', {
      x: t.px.toFixed(2), y: String(g.size.height - 8), 'text-anchor': 'middle',
      fill: 'var(--slate-2)', 'font-size': '10', 'font-family': 'var(--font-mono)',
    });
    label.textContent = String(t.cm360);
    svg.appendChild(label);
  }
}
```

- [ ] **Step 5: Run; expect PASS** — `npx vitest run tests/ui/convergence-plot.test.ts tests/ui/convergence-plot.render.test.ts`. `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/ui/convergence-plot.ts src/styles/tokens.css tests/ui/convergence-plot.test.ts tests/ui/convergence-plot.render.test.ts
git commit -m "feat(ui): convergence plot — pure log-axis geometry + thin SVG renderer (organism marks, CI band, peak)"
```

---

### Task 8: `ui/shell.ts` — hash router, `AppContext`, screen lifecycle

**Files:**
- Create: `src/ui/shell.ts`
- Create: `src/styles/shell.css`
- Test: `tests/ui/shell.test.ts` (jsdom)

A dependency-free router. Each screen is a factory `(host, ctx) => Screen` with `mount()`/`unmount()`. The shell maps `location.hash` → route, unmounts the previous screen, mounts the next. Cross-screen state lives in `ctx.draft` (in-memory `SessionDraft`). Flow screens guard: `gate`/`session`/`result` redirect to `setup`/`hero` if prerequisites are missing.

🎓 **Pattern:** a hand-rolled router + injected `AppContext` (no framework) keeps the whole shell testable and zero-dependency — the same "inject the boundary" discipline as the engine's `RendererLike`/`InputSource`. Screens are pure over a context; the router owns lifecycle (mount/unmount), so there are no leaked listeners between screens.

- [ ] **Step 1: Write the failing test**

```typescript
// @vitest-environment jsdom
// tests/ui/shell.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createShell, type Screen, type AppContext, type Route } from '../../src/ui/shell';

const recordingScreen = (log: string[], name: string) => (host: HTMLElement, _ctx: AppContext): Screen => ({
  mount() { host.innerHTML = `<div data-screen="${name}">${name}</div>`; log.push(`mount:${name}`); },
  unmount() { log.push(`unmount:${name}`); },
});

describe('shell router', () => {
  beforeEach(() => { location.hash = ''; document.body.innerHTML = '<div id="app"></div>'; });

  it('mounts the default (hero) screen on start', () => {
    const log: string[] = [];
    const root = document.getElementById('app')!;
    const shell = createShell(root, {
      screens: { hero: recordingScreen(log, 'hero'), setup: recordingScreen(log, 'setup') } as never,
    });
    shell.start();
    expect(root.querySelector('[data-screen="hero"]')).not.toBeNull();
    expect(log).toContain('mount:hero');
  });

  it('navigate unmounts the old screen and mounts the new one', () => {
    const log: string[] = [];
    const root = document.getElementById('app')!;
    const shell = createShell(root, {
      screens: { hero: recordingScreen(log, 'hero'), setup: recordingScreen(log, 'setup') } as never,
    });
    shell.start();
    shell.context.navigate('setup');
    expect(root.querySelector('[data-screen="setup"]')).not.toBeNull();
    expect(log).toEqual(['mount:hero', 'unmount:hero', 'mount:setup']);
  });

  it('exposes a mutable draft with sensible defaults', () => {
    const root = document.getElementById('app')!;
    const shell = createShell(root, { screens: { hero: recordingScreen([], 'hero') } as never });
    shell.start();
    expect(shell.context.draft.dpi).toBeGreaterThan(0);
    expect(shell.context.draft.bounds[0]).toBeLessThan(shell.context.draft.bounds[1]);
    expect(shell.context.draft.profile.speedAccuracy).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run; expect FAIL** — `npx vitest run tests/ui/shell.test.ts`.

- [ ] **Step 3: Implement `src/ui/shell.ts`**

```typescript
// src/ui/shell.ts
// NOTE: do NOT import CSS here — this module is imported by vitest. main.ts owns the CSS imports.
import type { Cm360, Dpi, GameId, Profile, Result, Session, Storage } from '../types';

export type Route = 'hero' | 'setup' | 'gate' | 'session' | 'result' | 'case-study' | 'options';

export interface Screen {
  mount(): void;
  unmount(): void;
}

/** Cross-screen, in-memory draft of the session being configured. */
export interface SessionDraft {
  dpi: Dpi;
  currentGame: GameId;
  currentSens: number;
  profile: Profile;
  bounds: [Cm360, Cm360];
}

export interface AppContext {
  navigate(route: Route): void;
  route: Route;
  storage: Storage;
  draft: SessionDraft;
  lastResult?: { sessionId: string; result: Result };
}

export type ScreenFactory = (host: HTMLElement, ctx: AppContext) => Screen;

export interface ShellDeps {
  storage?: Storage;
  screens: Record<Route, ScreenFactory>;
}

const ROUTE_HASH: Record<Route, string> = {
  hero: '#/', setup: '#/setup', gate: '#/gate', session: '#/session',
  result: '#/result', 'case-study': '#/case-study', options: '#/options',
};
const HASH_ROUTE = new Map<string, Route>(Object.entries(ROUTE_HASH).map(([r, h]) => [h, r as Route]));

function defaultDraft(): SessionDraft {
  return {
    dpi: 800,
    currentGame: 'cs2',
    currentSens: 1,
    profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
    bounds: [15, 60],
  };
}

/** Screens that require a configured draft / a result; otherwise redirect. */
const GUARDS: Partial<Record<Route, (ctx: AppContext) => Route | null>> = {
  result: (ctx) => (ctx.lastResult ? null : 'hero'),
};

export function createShell(root: HTMLElement, deps: ShellDeps): { start(): void; context: AppContext } {
  let current: Screen | null = null;

  const context: AppContext = {
    route: 'hero',
    storage: deps.storage ?? inMemoryStorage(),
    draft: defaultDraft(),
    navigate(route: Route) {
      if (location.hash === ROUTE_HASH[route]) render(route);
      else location.hash = ROUTE_HASH[route]; // triggers hashchange → render
    },
  };

  function routeFromHash(): Route {
    return HASH_ROUTE.get(location.hash) ?? 'hero';
  }

  function render(route: Route): void {
    const guard = GUARDS[route]?.(context) ?? null;
    if (guard) { context.navigate(guard); return; }
    current?.unmount();
    root.replaceChildren();
    context.route = route;
    const factory = deps.screens[route];
    current = factory(root, context);
    current.mount();
  }

  function start(): void {
    window.addEventListener('hashchange', () => render(routeFromHash()));
    render(routeFromHash());
  }

  return { start, context };
}

/** A no-persistence fallback Storage (used if none injected; the real app injects LocalStorage). */
function inMemoryStorage(): Storage {
  const sessions: Session[] = [];
  const results: Record<string, Result> = {};
  return {
    saveSession(s) { const i = sessions.findIndex((x) => x.id === s.id); i >= 0 ? (sessions[i] = s) : sessions.push(s); },
    loadSessions() { return [...sessions]; },
    saveResult(id, r) { results[id] = r; },
    exportJson() { return JSON.stringify({ version: '1', sessions, results }, null, 2); },
  };
}
```

- [ ] **Step 4: Create `src/styles/shell.css`** — the shell layout system. Provide a real, brand-faithful base (the implementer refines spacing/polish to taste, honoring tokens):

```css
/* src/styles/shell.css */
#app { display: block; min-height: 100%; }
.screen { min-height: 100vh; display: flex; flex-direction: column; }
.screen--shell { background: var(--bone); color: var(--slate); }
.screen--arena { background: var(--ink); color: var(--bone); }

.wrap { width: min(72rem, 92vw); margin-inline: auto; }
.stack > * + * { margin-top: var(--space-3); }

/* the + action mark */
.action { font-family: var(--font-display); background: none; border: 0; cursor: pointer; color: inherit; }
.action--primary { color: var(--gold); font-size: 1.5rem; }
.action--ghost { color: var(--slate-2); font-size: 1rem; }
.action--primary::before, .action--ghost::before { content: '+ '; }
.action:focus-visible { outline: 2px solid var(--gold); outline-offset: 3px; }

/* data type */
.mono { font-family: var(--font-mono); }
.display { font-family: var(--font-display); line-height: .92; }

/* transitions (zeroed under prefers-reduced-motion via tokens) */
.fade-in { animation: fade-in var(--dur-med) var(--ease-out); }
@keyframes fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
```

- [ ] **Step 5: Run shell tests; expect PASS** — `npx vitest run tests/ui/shell.test.ts`. `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/ui/shell.ts src/styles/shell.css tests/ui/shell.test.ts
git commit -m "feat(ui): shell — hash router, AppContext + SessionDraft, screen lifecycle"
```

---

### Task 9: `ui/hero.ts` — the falcon-silhouette landing

**Files:**
- Create: `src/ui/hero.ts`
- Test: `tests/ui/hero.test.ts` (jsdom)

The first impression and the framing of the thesis (one predator, many faculties). Static composition per spec §10 (motion deferred). **Falcon anatomy:** Eye = the ink `ó` in *campeón*; Body = the slate wordmark; Beak = the gold `+ start`; tucked feet = the gold byline; Wing = a scatter of `/ \ ~ < ^` marks. A one-line thesis tagline sits under the wordmark.

**Design spec (the implementer honors this; refine polish to taste):**
- Centered column on bone. Wordmark in Gefalent, `clamp(3.5rem, 12vw, 8rem)`, slate, the `ó` in ink (heavier visual = the eye).
- Tagline (system sans or Gefalent italic, `--slate-2`, ~`1rem`): **"one number. six predators. the sensitivity your hands were built for."**
- Primary action `+ start` (gold, `.action--primary`) → `navigate('setup')`, placed forward-right of the wordmark (the beak).
- Byline `by christopher robin fiore` (Gefalent italic, gold, small) below (the tucked feet).
- Wing: absolutely-positioned `aria-hidden` scatter of marks behind/around the wordmark, `--slate`/`--slate-2`, low opacity, suggesting a swept wing (upper-left to lower-right diagonal).
- Secondary nav (bottom or top-right): `+ case study`, `+ options` (`.action--ghost`) → `navigate('case-study')` / `navigate('options')`.
- Respect reduced-motion (no entrance animation when reduced). Keyboard-focusable actions.

- [ ] **Step 1: Write the failing test**

```typescript
// @vitest-environment jsdom
// tests/ui/hero.test.ts
import { describe, it, expect } from 'vitest';
import { hero } from '../../src/ui/hero';
import type { AppContext, Route } from '../../src/ui/shell';

function fakeCtx(): AppContext & { nav: Route[] } {
  const nav: Route[] = [];
  return {
    nav, route: 'hero',
    navigate(r: Route) { nav.push(r); },
    storage: { saveSession() {}, loadSessions: () => [], saveResult() {}, exportJson: () => '' },
    draft: {} as never,
  } as AppContext & { nav: Route[] };
}

describe('hero', () => {
  it('renders the wordmark with the ó as the eye and a + start action', () => {
    const ctx = fakeCtx();
    const host = document.createElement('div');
    hero(host, ctx).mount();
    expect(host.textContent).toContain('campe');
    expect(host.querySelector('[data-eye]')?.textContent).toBe('ó');
    expect(host.querySelector('[data-action="start"]')).not.toBeNull();
  });

  it('+ start navigates to setup', () => {
    const ctx = fakeCtx();
    const host = document.createElement('div');
    hero(host, ctx).mount();
    (host.querySelector('[data-action="start"]') as HTMLButtonElement).click();
    expect(ctx.nav).toContain('setup');
  });

  it('secondary nav routes to case-study and options', () => {
    const ctx = fakeCtx();
    const host = document.createElement('div');
    hero(host, ctx).mount();
    (host.querySelector('[data-action="case-study"]') as HTMLButtonElement).click();
    (host.querySelector('[data-action="options"]') as HTMLButtonElement).click();
    expect(ctx.nav).toEqual(expect.arrayContaining(['case-study', 'options']));
  });
});
```

- [ ] **Step 2: Run; expect FAIL** — `npx vitest run tests/ui/hero.test.ts`.

- [ ] **Step 3: Implement `src/ui/hero.ts`** (structure shown; the implementer applies the design spec + CSS in `shell.css` or a `hero` block. Use `data-*` hooks exactly as the test expects.)

```typescript
// src/ui/hero.ts
import type { AppContext, Screen } from './shell';

const WING_MARKS = ['/', '\\', '~', '<', '^', '/', '~', '\\'];

export function hero(host: HTMLElement, ctx: AppContext): Screen {
  return {
    mount() {
      const root = document.createElement('section');
      root.className = 'screen screen--shell hero fade-in';
      root.innerHTML = `
        <div class="wrap hero__inner">
          <div class="hero__wing" aria-hidden="true">
            ${WING_MARKS.map((m) => `<span>${m}</span>`).join('')}
          </div>
          <p class="hero__tagline">one number. six predators. the sensitivity your hands were built for.</p>
          <h1 class="display hero__mark">campe<span data-eye class="hero__eye">ó</span>n</h1>
          <button class="action action--primary" data-action="start">start</button>
          <p class="hero__byline">by christopher robin fiore</p>
          <nav class="hero__nav">
            <button class="action action--ghost" data-action="case-study">case study</button>
            <button class="action action--ghost" data-action="options">options</button>
          </nav>
        </div>`;
      root.querySelector('[data-action="start"]')!.addEventListener('click', () => ctx.navigate('setup'));
      root.querySelector('[data-action="case-study"]')!.addEventListener('click', () => ctx.navigate('case-study'));
      root.querySelector('[data-action="options"]')!.addEventListener('click', () => ctx.navigate('options'));
      host.appendChild(root);
    },
    unmount() { host.replaceChildren(); },
  };
}
```

- [ ] **Step 4: Add hero styles** to `src/styles/shell.css` (real CSS realizing the falcon composition; refine to taste):

```css
.hero__inner { flex: 1; display: grid; place-content: center; text-align: center; position: relative; gap: var(--space-2); padding: var(--space-6) 0; }
.hero__mark { font-size: clamp(3.5rem, 12vw, 8rem); color: var(--slate); }
.hero__eye { color: var(--ink); }
.hero__tagline { color: var(--slate-2); font-size: 1rem; letter-spacing: .02em; }
.hero__byline { font-family: var(--font-display); font-style: italic; color: var(--gold); font-size: .9rem; }
.hero__nav { display: flex; gap: var(--space-4); justify-content: center; margin-top: var(--space-4); }
.hero__wing { position: absolute; inset: 0; pointer-events: none; color: var(--slate-2); opacity: .35; font-family: var(--font-mono); }
.hero__wing span { position: absolute; }
/* implementer: position the 8 wing spans along an upper-left→lower-right sweep behind the wordmark */
```

- [ ] **Step 5: Run; expect PASS** — `npx vitest run tests/ui/hero.test.ts`. `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/ui/hero.ts src/styles/shell.css tests/ui/hero.test.ts
git commit -m "feat(ui): hero — falcon-silhouette landing (ó eye, + start beak, wing scatter, thesis tagline)"
```

---

### Task 10: `ui/setup.ts` — DPI + game/sens + goal slider → draft

**Files:**
- Create: `src/ui/setup.ts`
- Test: `tests/ui/setup.test.ts` (jsdom)

Captures DPI, current game + sens (showing "you sit at ~X cm/360 today" via `cmPer360`), and the goal slider (speed↔accuracy → `profile.speedAccuracy`). `+ begin` writes the draft and navigates to `gate`. The slider framing reinforces the single trade-off: one axis from "precision" to "speed."

- [ ] **Step 1: Write the failing test**

```typescript
// @vitest-environment jsdom
// tests/ui/setup.test.ts
import { describe, it, expect } from 'vitest';
import { setup } from '../../src/ui/setup';
import { cmPer360 } from '../../src/convert/cm360';
import { yawFor } from '../../src/convert/yaw-table';
import type { AppContext, Route, SessionDraft } from '../../src/ui/shell';

function fakeCtx(): AppContext & { nav: Route[]; draft: SessionDraft } {
  const nav: Route[] = [];
  return {
    nav, route: 'setup',
    navigate(r: Route) { nav.push(r); },
    storage: { saveSession() {}, loadSessions: () => [], saveResult() {}, exportJson: () => '' },
    draft: { dpi: 800, currentGame: 'cs2', currentSens: 1, bounds: [15, 60],
      profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } } },
  } as AppContext & { nav: Route[]; draft: SessionDraft };
}

describe('setup', () => {
  it('shows the current cm/360 for the entered dpi/game/sens', () => {
    const ctx = fakeCtx();
    const host = document.createElement('div');
    setup(host, ctx).mount();
    const dpi = host.querySelector('[data-field="dpi"]') as HTMLInputElement;
    const sens = host.querySelector('[data-field="sens"]') as HTMLInputElement;
    dpi.value = '1600'; dpi.dispatchEvent(new Event('input'));
    sens.value = '0.5'; sens.dispatchEvent(new Event('input'));
    const expected = cmPer360(1600, 0.5, yawFor('cs2')).toFixed(1);
    expect(host.querySelector('[data-readout="cm360"]')!.textContent).toContain(expected);
  });

  it('+ begin writes dpi/sens/profile to the draft and navigates to gate', () => {
    const ctx = fakeCtx();
    const host = document.createElement('div');
    setup(host, ctx).mount();
    (host.querySelector('[data-field="dpi"]') as HTMLInputElement).value = '400';
    (host.querySelector('[data-field="dpi"]') as HTMLInputElement).dispatchEvent(new Event('input'));
    const goal = host.querySelector('[data-field="goal"]') as HTMLInputElement;
    goal.value = '0.8'; goal.dispatchEvent(new Event('input'));
    (host.querySelector('[data-action="begin"]') as HTMLButtonElement).click();
    expect(ctx.draft.dpi).toBe(400);
    expect(ctx.draft.profile.speedAccuracy).toBeCloseTo(0.8, 6);
    expect(ctx.nav).toContain('gate');
  });
});
```

- [ ] **Step 2: Run; expect FAIL** — `npx vitest run tests/ui/setup.test.ts`.

- [ ] **Step 3: Implement `src/ui/setup.ts`**

```typescript
// src/ui/setup.ts
import type { AppContext, Screen } from './shell';
import type { GameId } from '../types';
import { GAME_YAW, yawFor } from '../convert/yaw-table';
import { cmPer360 } from '../convert/cm360';

export function setup(host: HTMLElement, ctx: AppContext): Screen {
  const d = ctx.draft;
  return {
    mount() {
      const root = document.createElement('section');
      root.className = 'screen screen--shell setup fade-in';
      root.innerHTML = `
        <div class="wrap stack setup__inner">
          <h2 class="display setup__title">+ setup</h2>
          <p class="setup__lead">Tell us your hardware and where you sit today. From the next screen on, everything is <span class="mono">cm/360</span>.</p>
          <label class="field">mouse DPI
            <input class="mono" type="number" min="100" max="32000" step="50" data-field="dpi" value="${d.dpi}">
          </label>
          <label class="field">current game
            <select data-field="game">
              ${GAME_YAW.map((g) => `<option value="${g.id}"${g.id === d.currentGame ? ' selected' : ''}>${g.label}</option>`).join('')}
            </select>
          </label>
          <label class="field">current in-game sensitivity
            <input class="mono" type="number" min="0.01" step="0.01" data-field="sens" value="${d.currentSens}">
          </label>
          <p class="setup__readout">you sit at <span class="mono" data-readout="cm360">—</span> cm/360 today</p>
          <label class="field">goal — precision ↔ speed
            <input type="range" min="0" max="1" step="0.01" data-field="goal" value="${d.profile.speedAccuracy}">
            <span class="setup__goalhint mono" data-readout="goal"></span>
          </label>
          <button class="action action--primary" data-action="begin">begin</button>
        </div>`;

      const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
      const dpiEl = $<HTMLInputElement>('[data-field="dpi"]');
      const gameEl = $<HTMLSelectElement>('[data-field="game"]');
      const sensEl = $<HTMLInputElement>('[data-field="sens"]');
      const goalEl = $<HTMLInputElement>('[data-field="goal"]');
      const cmOut = $<HTMLElement>('[data-readout="cm360"]');
      const goalOut = $<HTMLElement>('[data-readout="goal"]');

      const refresh = (): void => {
        const dpi = Number(dpiEl.value), sens = Number(sensEl.value);
        const yaw = yawFor(gameEl.value as GameId);
        cmOut.textContent = dpi > 0 && sens > 0 ? cmPer360(dpi, sens, yaw).toFixed(1) : '—';
        const g = Number(goalEl.value);
        goalOut.textContent = g >= 0.66 ? 'speed-first' : g <= 0.34 ? 'precision-first' : 'balanced';
      };
      for (const e of [dpiEl, gameEl, sensEl, goalEl]) e.addEventListener('input', refresh);
      refresh();

      $<HTMLButtonElement>('[data-action="begin"]').addEventListener('click', () => {
        d.dpi = Number(dpiEl.value);
        d.currentGame = gameEl.value as GameId;
        d.currentSens = Number(sensEl.value);
        d.profile = { ...d.profile, speedAccuracy: Number(goalEl.value) };
        ctx.navigate('gate');
      });

      host.appendChild(root);
    },
    unmount() { host.replaceChildren(); },
  };
}
```

- [ ] **Step 4: Add setup styles** to `shell.css` (`.field` as a labeled stacked control, `.setup__readout` emphasized in gold). Keep brand-faithful; refine to taste.

- [ ] **Step 5: Run; expect PASS** — `npx vitest run tests/ui/setup.test.ts`. `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/ui/setup.ts src/styles/shell.css tests/ui/setup.test.ts
git commit -m "feat(ui): setup — dpi/game/sens (live cm/360 today) + goal slider → draft"
```

---

### Task 11: `ui/gate.ts` — validity gate (pointer-lock + accel check)

**Files:**
- Create: `src/ui/gate.ts`
- Test: `tests/ui/gate.test.ts` (jsdom — tests the pure state reducer; the lock/accel wiring is runtime-verified)

The make-or-break validity layer (spec §6) as UI. A small explicit state machine drives the steps; the verdict logic is pure and tested. The actual `requestPointerLock`/accel swipe is real DOM wired to `input/pointer-lock` + `input/accel-check` and proven at runtime, not in jsdom.

**Design:** dark (`screen--arena`) full-screen panel. Steps: (1) "Enter the arena" → request pointer lock; show granted mode + Chromium-best stance note. (2) Accel check: swipe the same distance slow, then fast; if `|Δ|` differs > ~10% → **blocked** ("turn off mouse acceleration"); else → ready. (3) "From here, everything is cm/360." → `+ continue` navigates to `session`.

- [ ] **Step 1: Write the failing test** (pure reducer + verdict)

```typescript
// @vitest-environment jsdom
// tests/ui/gate.test.ts
import { describe, it, expect } from 'vitest';
import { gateReducer, type GateState } from '../../src/ui/gate';

describe('gateReducer', () => {
  const start: GateState = { step: 'intro', mode: null, slow: 0, fast: 0, blocked: false };

  it('advances to accel after a lock is granted, recording the mode', () => {
    const s = gateReducer(start, { type: 'locked', mode: 'raw' });
    expect(s.step).toBe('accel');
    expect(s.mode).toBe('raw');
  });

  it('blocks when slow/fast swipe totals differ by more than 10%', () => {
    let s = gateReducer({ ...start, step: 'accel' }, { type: 'accel', slow: 1000, fast: 1200 });
    expect(s.blocked).toBe(true);
    expect(s.step).toBe('blocked');
  });

  it('reaches ready when acceleration is within tolerance', () => {
    const s = gateReducer({ ...start, step: 'accel' }, { type: 'accel', slow: 1000, fast: 1040 });
    expect(s.blocked).toBe(false);
    expect(s.step).toBe('ready');
  });

  it('retry from blocked returns to the accel step', () => {
    const s = gateReducer({ ...start, step: 'blocked', blocked: true }, { type: 'retry' });
    expect(s.step).toBe('accel');
    expect(s.blocked).toBe(false);
  });
});
```

- [ ] **Step 2: Run; expect FAIL** — `npx vitest run tests/ui/gate.test.ts`.

- [ ] **Step 3: Implement `src/ui/gate.ts`** (reducer + screen; reuse `accelVerdict` from `input/accel-check` for the threshold so the rule lives in one place)

```typescript
// src/ui/gate.ts
import type { AppContext, Screen } from './shell';
import type { PointerLockMode } from '../types';
import { createPointerLock } from '../input/pointer-lock';
import { AccelMeter, accelVerdict } from '../input/accel-check';

export type GateStep = 'intro' | 'accel' | 'blocked' | 'ready';
export interface GateState {
  step: GateStep;
  mode: PointerLockMode | null;
  slow: number;
  fast: number;
  blocked: boolean;
}
export type GateAction =
  | { type: 'locked'; mode: PointerLockMode }
  | { type: 'accel'; slow: number; fast: number }
  | { type: 'retry' };

/** Pure transition for the validity gate. The accel rule delegates to accelVerdict (single source). */
export function gateReducer(state: GateState, action: GateAction): GateState {
  switch (action.type) {
    case 'locked':
      return { ...state, step: 'accel', mode: action.mode };
    case 'accel': {
      const blocked = accelVerdict(action.slow, action.fast).accelerated;
      return { ...state, slow: action.slow, fast: action.fast, blocked, step: blocked ? 'blocked' : 'ready' };
    }
    case 'retry':
      return { ...state, step: 'accel', blocked: false, slow: 0, fast: 0 };
  }
}

export function gate(host: HTMLElement, ctx: AppContext): Screen {
  let state: GateState = { step: 'intro', mode: null, slow: 0, fast: 0, blocked: false };
  const pointer = createPointerLock(host);
  let meter: AccelMeter | null = null;
  const offSample = pointer.onSample((s) => meter?.add(s));

  function dispatch(action: GateAction): void { state = gateReducer(state, action); render(); }

  function render(): void {
    // Renders per-step UI using data-step hooks; the implementer writes the markup/copy.
    // intro → "+ enter the arena" (click: pointer.request() → on success dispatch {locked, mode}).
    // accel → "[1] swipe slow [2] stop · [3] swipe fast [4] stop" then dispatch {accel, slow, fast}.
    //         (slow/fast captured via AccelMeter on pointer samples, like the dev harness).
    // blocked → message + "+ retry" (dispatch {retry}); stance note about acceleration.
    // ready → "from here, everything is cm/360" + "+ continue" → ctx.navigate('session').
    host.replaceChildren(buildStepDom(state, {
      onEnter: () => void pointer.request().then(() => dispatch({ type: 'locked', mode: pointer.mode() ?? 'os-adjusted' })).catch(() => dispatch({ type: 'locked', mode: 'os-adjusted' })),
      onStartSlow: () => { meter = new AccelMeter(); },
      onStopSlow: () => { state.slow = meter?.total() ?? 0; meter = null; },
      onStartFast: () => { meter = new AccelMeter(); },
      onStopFast: () => { dispatch({ type: 'accel', slow: state.slow, fast: meter?.total() ?? 0 }); meter = null; },
      onRetry: () => dispatch({ type: 'retry' }),
      onContinue: () => ctx.navigate('session'),
    }));
  }

  return {
    mount() { render(); },
    unmount() { offSample(); pointer.dispose(); host.replaceChildren(); },
  };
}

interface GateHandlers {
  onEnter(): void; onStartSlow(): void; onStopSlow(): void;
  onStartFast(): void; onStopFast(): void; onRetry(): void; onContinue(): void;
}

/** Per-step DOM for the gate. Dark (screen--arena), keyboard-accessible, brand-faithful. */
function buildStepDom(state: GateState, h: GateHandlers): HTMLElement {
  const root = document.createElement('section');
  root.className = 'screen screen--arena gate fade-in';
  const wrap = document.createElement('div');
  wrap.className = 'wrap stack gate__inner';
  const btn = (label: string, onClick: () => void, primary = true): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = `action ${primary ? 'action--primary' : 'action--ghost'}`;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };
  const p = (text: string, cls = ''): HTMLParagraphElement => {
    const el = document.createElement('p'); el.className = cls; el.textContent = text; return el;
  };
  if (state.step === 'intro') {
    wrap.append(
      p('We need true, unaccelerated mouse input. Click to lock the pointer.', 'gate__lead'),
      btn('enter the arena', h.onEnter),
    );
  } else if (state.step === 'accel') {
    wrap.append(
      p(`lock: ${state.mode ?? '—'} ${state.mode === 'raw' ? '(raw — Chromium)' : '(reduced validity — verify acceleration is off)'}`, 'mono'),
      p('Swipe the SAME physical distance slowly, then quickly. We compare the totals.', 'gate__lead'),
      btn('start slow swipe', h.onStartSlow, false), btn('stop slow', h.onStopSlow, false),
      btn('start fast swipe', h.onStartFast, false), btn('stop fast → check', h.onStopFast),
    );
  } else if (state.step === 'blocked') {
    wrap.append(
      p('Mouse acceleration appears to be ON — cm/360 is undefined under acceleration.', 'gate__lead'),
      p('Turn off OS/driver mouse acceleration ("Enhance pointer precision"), then retry.'),
      btn('retry', h.onRetry),
    );
  } else {
    wrap.append(p('From here, everything is cm/360.', 'gate__lead'), btn('continue', h.onContinue));
  }
  root.appendChild(wrap);
  return root;
}
```

> Implementer note: confirm `createPointerLock`'s API (`request()`, `onSample`, `onFire`, `mode()`, `isLocked()`, `dispose()`) against `src/input/pointer-lock.ts` and `AccelMeter`/`accelVerdict` against `src/input/accel-check.ts` before wiring. The slow/fast capture mirrors the dev harness (`AccelMeter` fed from `pointer.onSample`).

- [ ] **Step 4: Run reducer tests; expect PASS** — `npx vitest run tests/ui/gate.test.ts`. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/gate.ts src/styles/shell.css tests/ui/gate.test.ts
git commit -m "feat(ui): validity gate — pointer-lock + accel-check state machine (pure reducer tested)"
```

---

### Task 12: `ui/session-view.ts` — arena + live session + convergence

**Files:**
- Create: `src/ui/session-view.ts`
- Test: `tests/ui/session-view.test.ts` (jsdom — tests the pure `marksFromTrials` + `instructionFor` helpers; the WebGL/session run is runtime-verified)

The heart. Constructs the real `Arena` (mirroring `dev/arena-harness.ts`: `WebGLRenderer`, pointer-lock `InputSource`, RAF loop), drives `runSession` with the draft's `dpi`/`profile`/`bounds`, a `makeBo` engine, the full instrument schedule, and the `onTrialStart`/`onTrial` callbacks → updates the **convergence plot** + per-instrument HUD. On completion: `buildResult` → `storage.saveSession` + `saveResult` → set `ctx.lastResult` → `navigate('result')`. Real player fires with the mouse (no autofire — that was dev-only).

**Pure helpers (tested):**
- `marksFromTrials(trials)` → `PlotMark[]` (map `TrialResult` → `{cm360, score, instrument}`).
- `instructionFor(id)` → short HUD copy that names the organism + the action (reinforces "one system, many faculties").

- [ ] **Step 1: Write the failing test**

```typescript
// @vitest-environment jsdom
// tests/ui/session-view.test.ts
import { describe, it, expect } from 'vitest';
import { marksFromTrials, instructionFor } from '../../src/ui/session-view';
import type { TrialResult } from '../../src/types';

describe('session-view helpers', () => {
  it('maps trials to plot marks preserving cm360/score/instrument', () => {
    const trials: TrialResult[] = [
      { instrument: 'flick', cm360: 30, score: 0.4, raw: {}, at: 0 },
      { instrument: 'track', cm360: 42, score: -0.1, raw: {}, at: 0 },
    ];
    expect(marksFromTrials(trials)).toEqual([
      { cm360: 30, score: 0.4, instrument: 'flick' },
      { cm360: 42, score: -0.1, instrument: 'track' },
    ]);
  });

  it('gives each instrument human instruction copy that names its organism', () => {
    expect(instructionFor('track').toLowerCase()).toMatch(/track|dragonfly|falcon/);
    expect(instructionFor('flick').toLowerCase()).toMatch(/flick|spider|snap/);
    expect(instructionFor('calibrate').toLowerCase()).toMatch(/calibrat|archerfish|bias/);
    expect(instructionFor('strike').toLowerCase()).toMatch(/strike|shrimp|fast/);
  });
});
```

- [ ] **Step 2: Run; expect FAIL** — `npx vitest run tests/ui/session-view.test.ts`.

- [ ] **Step 3: Implement `src/ui/session-view.ts`** (pure helpers + the runtime mount). Model the arena construction on `dev/arena-harness.ts` (reuse the same `WebGLRenderer`/`Arena`/`createPointerLock`/RAF pattern).

```typescript
// src/ui/session-view.ts
import { WebGLRenderer } from 'three';
import { Arena, type InputSource } from '../engine/arena';
import { createPointerLock } from '../input/pointer-lock';
import { makeBo } from '../optimizer/bayesopt';
import { runSession } from '../optimizer/session-controller';
import { buildResult } from '../optimizer/result';
import { INSTRUMENTS } from '../instruments/registry';
import { mulberry32 } from '../stats/rng';
import { plotGeometry, renderConvergencePlot, type PlotMark } from './convergence-plot';
import type { AppContext, Screen } from './shell';
import type { InstrumentId, Report, TrialResult } from '../types';

const SCHEDULE: InstrumentId[] = ['flick', 'track', 'calibrate', 'strike'];
const MAX_TRIALS = 24; // spec §5.4: ~15–30, capped ~20–25

export function marksFromTrials(trials: readonly TrialResult[]): PlotMark[] {
  return trials.map((t) => ({ cm360: t.cm360, score: t.score, instrument: t.instrument }));
}

const COPY: Record<InstrumentId, string> = {
  track: '+track · keep the dot on the mover — dragonfly lead + falcon hold',
  flick: '+flick · snap to each target and settle — spider acquisition + raptor fovea',
  calibrate: '+calibrate · fire center-mass; we separate your bias from your spread — archerfish',
  strike: '+strike · fire as fast as you can — mantis-shrimp speed pole',
};
export function instructionFor(id: InstrumentId): string { return COPY[id]; }

export function sessionView(host: HTMLElement, ctx: AppContext): Screen {
  let raf = 0;
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

      const renderer = new WebGLRenderer({ canvas, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      const size = (): [number, number] => [window.innerWidth, window.innerHeight];
      const pointer = createPointerLock(canvas);
      const input: InputSource = { onSample: (cb) => pointer.onSample(cb), onFire: (cb) => pointer.onFire(cb) };
      const arena = new Arena({ renderer, input, size, cm360: ctx.draft.bounds[0], dpi: ctx.draft.dpi, rng: mulberry32(7) });

      const onResize = (): void => arena.resize();
      window.addEventListener('resize', onResize);
      const loop = (): void => { arena.tick(16); arena.render(); raf = window.requestAnimationFrame(loop); };
      raf = window.requestAnimationFrame(loop);

      const drawPlot = (report: Report, trials: readonly TrialResult[]): void => {
        const g = plotGeometry({
          bounds: ctx.draft.bounds, marks: marksFromTrials(trials),
          curve: report.curve, ci90: report.ci90, peak: report.optimalCm360,
          size: { width: svg.clientWidth || 360, height: svg.clientHeight || 180 },
        });
        renderConvergencePlot(svg, g);
        hudEstimate.textContent = `${report.optimalCm360.toFixed(1)} cm/360  ·  90% CI ${report.ci90[0].toFixed(1)}–${report.ci90[1].toFixed(1)}`;
      };

      const start = (): void => {
        const engine = makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.1 }, acquisition: 'ei' });
        void runSession({
          dpi: ctx.draft.dpi, profile: ctx.draft.profile, bounds: ctx.draft.bounds,
          engine, instruments: INSTRUMENTS, scene: arena, schedule: SCHEDULE,
          maxTrials: MAX_TRIALS, rng: mulberry32(2026), minTrials: 12, ciStopWidth: 6, bootstrapIters: 300,
          onTrialStart: (id, i) => {
            hudInstruction.textContent = instructionFor(id);
            hudProgress.textContent = `trial ${i + 1} / ${MAX_TRIALS}`;
            arena.clearTargets();
          },
          onTrial: (_t, trials, interim) => drawPlot(interim, trials),
        }).then(({ report, trials }) => {
          const sessionId = `s-${trials.length}-${Math.round(report.optimalCm360 * 100)}`;
          const result = buildResult(report, trials, ctx.draft.dpi);
          ctx.storage.saveSession({ id: sessionId, dpi: ctx.draft.dpi, profile: ctx.draft.profile, trials: [...trials], status: 'complete', createdAt: 0 });
          ctx.storage.saveResult(sessionId, result);
          ctx.lastResult = { sessionId, result };
          ctx.navigate('result');
        });
      };

      // Player locks in with a click, then the session runs trial-by-trial.
      canvas.addEventListener('click', () => void pointer.request().then(start).catch(start), { once: true });

      cleanup = () => {
        window.cancelAnimationFrame(raf);
        window.removeEventListener('resize', onResize);
        pointer.dispose();
        arena.dispose();
      };
    },
    unmount() { cleanup?.(); host.replaceChildren(); },
  };
}
```

> Implementer note: confirm the `Arena` constructor + `InputSource` shape against `src/engine/arena.ts` and the dev harness; reuse exactly. Verify `createPointerLock` API. Keep the RAF/dispose discipline (no leaked loops between screens). `ciStopWidth`/`minTrials` are tunable; defaults here aim for a ~12–24-trial real session.

- [ ] **Step 4: Add session styles** to `shell.css` (`.session__canvas` fullscreen, centered gold crosshair like the harness, `.session__hud` top, `.session__plot` a bottom/side panel with a dark translucent backing so the convergence view reads over the arena). Brand-faithful; refine to taste.

- [ ] **Step 5: Run helper tests; expect PASS** — `npx vitest run tests/ui/session-view.test.ts`. `npx tsc --noEmit` clean. (The full session is runtime-verified in Task 14.)

- [ ] **Step 6: Commit**

```bash
git add src/ui/session-view.ts src/styles/shell.css tests/ui/session-view.test.ts
git commit -m "feat(ui): session view — live arena + runSession + one shared convergence plot + per-instrument HUD"
```

---

### Task 13: `ui/result.ts` — one number + CI + per-game table + breakdown

**Files:**
- Create: `src/ui/result.ts`
- Test: `tests/ui/result.test.ts` (jsdom)

The payoff screen. **One number at the apex** (cm/360, large, gold) with the 90% CI as a range and a small CI bar; a per-game table (every game's native sens at the optimum, the user's current game highlighted); the **breakdown as contributions** (bias-zero cm/360 from archerfish, the precision floor, mantis-shrimp TTK + hit-rate — each labeled with its faculty so the unity reads); export JSON + "saved locally"; `+ run again` → hero. `NaN` breakdown fields render as `—` (honest).

- [ ] **Step 1: Write the failing test**

```typescript
// @vitest-environment jsdom
// tests/ui/result.test.ts
import { describe, it, expect } from 'vitest';
import { result as resultScreen } from '../../src/ui/result';
import type { AppContext, Route, SessionDraft } from '../../src/ui/shell';
import type { Result } from '../../src/types';

const RESULT: Result = {
  optimalCm360: 32.4, ci90: [29.1, 36.0],
  perGameSens: { cs2: 1.59, valorant: 0.5, apex: 1.59, ow2: 5.3, cod: 5.3, fortnite: 6.3, r6: 6.1, pubg: 15.7 },
  breakdown: { biasZeroCm360: 31.0, precisionFloorDeg: 0.42, ttkMs: 511, hitRate: 0.86 },
};
function fakeCtx(): AppContext & { nav: Route[] } {
  const nav: Route[] = [];
  const draft: SessionDraft = { dpi: 800, currentGame: 'cs2', currentSens: 1, bounds: [15, 60],
    profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } } };
  return {
    nav, route: 'result', draft,
    navigate(r: Route) { nav.push(r); },
    storage: { saveSession() {}, loadSessions: () => [], saveResult() {}, exportJson: () => '{}' },
    lastResult: { sessionId: 's1', result: RESULT },
  } as AppContext & { nav: Route[] };
}

describe('result screen', () => {
  it('shows the one cm/360 number and the 90% CI range', () => {
    const host = document.createElement('div');
    resultScreen(host, fakeCtx()).mount();
    expect(host.querySelector('[data-result="cm360"]')!.textContent).toContain('32.4');
    const ci = host.querySelector('[data-result="ci"]')!.textContent!;
    expect(ci).toContain('29.1');
    expect(ci).toContain('36.0');
  });

  it('renders a per-game row for every game and highlights the current one', () => {
    const host = document.createElement('div');
    resultScreen(host, fakeCtx()).mount();
    expect(host.querySelectorAll('[data-game]').length).toBe(8);
    expect(host.querySelector('[data-game="cs2"]')!.getAttribute('data-current')).toBe('true');
  });

  it('shows breakdown contributions and renders NaN as —', () => {
    const host = document.createElement('div');
    const ctx = fakeCtx();
    ctx.lastResult!.result = { ...RESULT, breakdown: { ...RESULT.breakdown, precisionFloorDeg: NaN } };
    resultScreen(host, ctx).mount();
    expect(host.querySelector('[data-breakdown="ttkMs"]')!.textContent).toContain('511');
    expect(host.querySelector('[data-breakdown="precisionFloorDeg"]')!.textContent).toContain('—');
  });

  it('+ run again navigates home', () => {
    const host = document.createElement('div');
    const ctx = fakeCtx();
    resultScreen(host, ctx).mount();
    (host.querySelector('[data-action="again"]') as HTMLButtonElement).click();
    expect(ctx.nav).toContain('hero');
  });
});
```

- [ ] **Step 2: Run; expect FAIL** — `npx vitest run tests/ui/result.test.ts`.

- [ ] **Step 3: Implement `src/ui/result.ts`**

```typescript
// src/ui/result.ts
import type { AppContext, Screen } from './shell';
import type { GameId, Result } from '../types';
import { GAME_YAW } from '../convert/yaw-table';
import { buildExportBundle, toJson, triggerDownload } from '../state/export';

const fmt = (v: number, digits = 1): string => (Number.isFinite(v) ? v.toFixed(digits) : '—');

export function result(host: HTMLElement, ctx: AppContext): Screen {
  const r: Result | undefined = ctx.lastResult?.result;
  return {
    mount() {
      if (!r) { ctx.navigate('hero'); return; }
      const root = document.createElement('section');
      root.className = 'screen screen--shell result fade-in';
      const rows = GAME_YAW.map((g) => {
        const sens = r.perGameSens[g.id as GameId];
        const current = g.id === ctx.draft.currentGame;
        return `<tr data-game="${g.id}"${current ? ' data-current="true"' : ''}>
          <td>${g.label}</td><td class="mono">${sens === undefined ? '—' : sens.toFixed(3)}</td></tr>`;
      }).join('');
      root.innerHTML = `
        <div class="wrap stack result__inner">
          <p class="result__lead">your sweet spot</p>
          <h1 class="display result__number"><span data-result="cm360">${fmt(r.optimalCm360)}</span><small> cm/360</small></h1>
          <p class="result__ci mono">90% CI <span data-result="ci">${fmt(r.ci90[0])}–${fmt(r.ci90[1])}</span> cm/360</p>
          <div class="result__breakdown">
            <div><span class="result__bk-label">bias-zero <em>archerfish</em></span><span class="mono" data-breakdown="biasZeroCm360">${fmt(r.breakdown.biasZeroCm360)} cm/360</span></div>
            <div><span class="result__bk-label">precision floor</span><span class="mono" data-breakdown="precisionFloorDeg">${fmt(r.breakdown.precisionFloorDeg, 2)}°</span></div>
            <div><span class="result__bk-label">time-to-kill <em>mantis shrimp</em></span><span class="mono" data-breakdown="ttkMs">${fmt(r.breakdown.ttkMs, 0)} ms</span></div>
            <div><span class="result__bk-label">hit rate</span><span class="mono" data-breakdown="hitRate">${Number.isFinite(r.breakdown.hitRate) ? Math.round(r.breakdown.hitRate * 100) + '%' : '—'}</span></div>
          </div>
          <table class="result__games"><thead><tr><th>game</th><th>sensitivity</th></tr></thead><tbody>${rows}</tbody></table>
          <p class="result__saved mono">saved locally</p>
          <div class="result__actions">
            <button class="action action--ghost" data-action="export">export json</button>
            <button class="action action--primary" data-action="again">run again</button>
          </div>
        </div>`;
      root.querySelector('[data-action="again"]')!.addEventListener('click', () => ctx.navigate('hero'));
      root.querySelector('[data-action="export"]')!.addEventListener('click', () => {
        const sessions = ctx.storage.loadSessions();
        const results = ctx.lastResult ? { [ctx.lastResult.sessionId]: ctx.lastResult.result } : {};
        triggerDownload('campeon-result.json', toJson(buildExportBundle(sessions, results, 0)));
      });
      host.appendChild(root);
    },
    unmount() { host.replaceChildren(); },
  };
}
```

> Implementer note: `exportedAt` is passed `0` here to keep it pure/deterministic (no `Date.now()` in module code per project convention — timestamps are stamped by callers/tests). If a real timestamp is wanted in the downloaded file, read it at the click handler via `Date.now()` (a DOM event handler, not module-load) — acceptable since it's user-triggered glue, but `0` is fine for v1.

- [ ] **Step 4: Add result styles** to `shell.css` — the cm/360 number huge (`clamp(4rem, 16vw, 10rem)`, gold), CI in mono slate-2, a thin CI bar (optional: reuse the plot), breakdown as a 2×2 grid with faculty labels, per-game table clean with the current row highlighted in gold. Brand-faithful; refine to taste.

- [ ] **Step 5: Run; expect PASS** — `npx vitest run tests/ui/result.test.ts`. `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/ui/result.ts src/styles/shell.css tests/ui/result.test.ts
git commit -m "feat(ui): result — one cm/360 + CI, per-game table, breakdown-as-contributions, export"
```

---

### Task 14: `main.ts` rewire + Chromium runtime proof

**Files:**
- Modify: `src/main.ts`
- Create (stubs): inline `case-study` / `options` placeholder screens (in `shell.ts` registration or a tiny `ui/stubs.ts`)

Wire the shell as the app. Keep `#arena` reachable for debugging. Register all routes; `case-study`/`options` get tasteful "coming in the next pass" stubs (a centered note + `+ back`). Then prove the whole flow in Chromium.

- [ ] **Step 1: Create `src/ui/stubs.ts`** (the two deferred screens)

```typescript
// src/ui/stubs.ts
import type { AppContext, Route, Screen } from './shell';

function stub(title: string, note: string) {
  return (host: HTMLElement, ctx: AppContext): Screen => ({
    mount() {
      const root = document.createElement('section');
      root.className = 'screen screen--shell stub fade-in';
      root.innerHTML = `<div class="wrap stack" style="margin:auto;text-align:center">
        <h2 class="display">+ ${title}</h2><p>${note}</p>
        <button class="action action--ghost" data-action="back">back</button></div>`;
      root.querySelector('[data-action="back"]')!.addEventListener('click', () => ctx.navigate('hero'));
      host.appendChild(root);
    },
    unmount() { host.replaceChildren(); },
  });
}

export const caseStudyStub = stub('case study', 'The science page — each organism’s real mechanism, the math, and why it maps to aim — arrives in the polish pass.');
export const optionsStub = stub('options', 'Conversion school, per-game yaw overrides, and search bounds arrive in the polish pass.');
export type { Route };
```

- [ ] **Step 2: Rewrite `src/main.ts`**

```typescript
// src/main.ts
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import { createShell, type Route, type ScreenFactory } from './ui/shell';
import { createStorage } from './state/storage';
import { hero } from './ui/hero';
import { setup } from './ui/setup';
import { gate } from './ui/gate';
import { sessionView } from './ui/session-view';
import { result } from './ui/result';
import { caseStudyStub, optionsStub } from './ui/stubs';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app element missing');

async function boot(): Promise<void> {
  if (window.location.hash === '#arena') {
    const { mountArenaHarness } = await import('./dev/arena-harness');
    mountArenaHarness(app);
    return;
  }
  const screens: Record<Route, ScreenFactory> = {
    hero, setup, gate, session: sessionView, result,
    'case-study': caseStudyStub, options: optionsStub,
  };
  createShell(app, { storage: createStorage(), screens }).start();
}

void boot();
```

> Note: the `#arena` branch must run before the shell so the dev harness stays available. If the hash is `#arena`, we never start the shell. (Switching away from `#arena` requires a reload — acceptable for a dev-only route.)

- [ ] **Step 3: Typecheck + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests green (164 prior + the new Phase-5 tests).

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: `tsc --noEmit` passes and Vite builds with no errors.

- [ ] **Step 5: Runtime proof in Chromium**

Start dev server (`npm run dev`), open in a Chromium browser, and walk the full flow:
1. **Hero** loads on bone; falcon composition reads; `+ start` works. Screenshot.
2. **Setup**: enter DPI 800, game CS2, sens 1.0 → "you sit at ~X cm/360 today" updates live; move the goal slider; `+ begin`. Screenshot.
3. **Gate**: `+ enter the arena` requests pointer lock (granted = raw on Chromium); run the accel check (slow/fast); reach "everything is cm/360"; `+ continue`. Screenshot.
4. **Session**: click to lock; trials run; the **one convergence plot** updates each trial with organism-colored marks + a sharpening CI band; the HUD names the active instrument; reaches completion. Screenshot mid-session.
5. **Result**: one cm/360 number + CI; per-game table with the current game highlighted; breakdown contributions; `export json` downloads a file; "saved locally"; `+ run again` → hero. Screenshot.

Acceptance: no console errors; arena holds ~60fps; the convergence view visibly converges; a finite, bounds-clamped `Result` is shown and persisted (reload → `storage.loadSessions()` non-empty). Capture console + a screenshot of the result.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/ui/stubs.ts
git commit -m "feat(ui): wire the shell as the app (hero→setup→gate→session→result); #arena dev route preserved"
```

---

## Self-review (against the spec + the unified-system goal)

- **Spec §9 flow coverage:** hero (§9.1) → setup with goal slider + "where you sit today" (§9.2) → validity gate (§9.3) → session with live sharpening curve (§9.4) → result with cm/360 + CI + breakdown + per-game table + JSON export (§9.5). `+case study` (§9 / §9.6) and full `+options` (§9.7) are explicitly Phase-6 stubs — flagged so reviewers don't read it as a gap.
- **Spec §8 module boundaries:** `ui/` (shell + screens + plot) and `state/` (storage + export) added; pure additions (`optimizer/breakdown`, `optimizer/result`) keep DOM/Three out of the core; `convergence-plot` geometry is pure. `Storage` interface (§8 data model) implemented behind an injectable backend (cloud-ready).
- **Unified-system goal:** the session screen is ONE shared convergence view (not four meters); the result is one number whose breakdown is framed as each faculty's contribution; the hero frames one predator with many faculties; the goal slider is the single trade-off axis. The CI is shown honestly (wide = disagreement, never hidden).
- **Quality bar (§1.1 / §12):** pure cores TDD'd; DOM logic tested via jsdom + pure helpers extracted for the WebGL-bound screens; `prefers-reduced-motion` honored (tokens + `.fade-in`); keyboard-focusable actions with visible focus; brand tokens/Gefalent/`+`-mark throughout; runtime proof required for the WebGL/session path.
- **Type consistency:** `Route`, `Screen`, `AppContext`, `SessionDraft`, `ScreenFactory` defined once in `shell.ts` and imported by every screen; `Breakdown`/`Result` match `types.ts`; `runSession` callbacks are additive (existing tests untouched); `mulberry32` single source in `stats/rng.ts`. Screen factory names: `hero`, `setup`, `gate`, `sessionView`, `result` (note: `session` route → `sessionView` factory).
- **Determinism preserved:** the new `onTrial` interim bootstrap uses its own per-trial RNG, so the instrument-noise stream — and every existing session-controller test — is unchanged (explicit load-bearing test in Task 4).
- **No placeholders in pure/state/geometry tasks:** full code. UI tasks give complete logic + `data-*` test hooks + a concrete design spec; CSS polish is delegated with brand constraints (the design-engineer judgment call, bounded by tokens + the spec's visual identity).

## Forward notes (Phase 6 — Polish)

- `+case study` science page (per-organism mechanism + math + citations, spec §4 + §13) replacing the stub; full `+options` (conversion school via `schools.ts` monitor-distance, per-game yaw overrides, search-bounds editor).
- Falcon motion (wing flap + parallax sky masked to the wing) and the PSX arena skin — separate deferred tracks.
- Carry-over P4 honesty refinements (independent of UI): per-point Fitts-spread nugget into `Observation.noise`; surface `makeBo`'s posterior-mean argmax and pass it to `finalizeReport`'s `gpPeakCm360` inside `runSession` (the §5.3 GP/curve-disagreement widen).
- Session tuning from real play: revisit `MAX_TRIALS`/`ciStopWidth`/`minTrials`, warm-up down-weighting (§5.4), and per-instrument trial counts.
- a11y/QA pass: full keyboard nav across the flow, focus management on screen change, reduced-motion audit of the convergence animation, empty/error states (no WebGL, lock denied, accel blocked recovery).
```
