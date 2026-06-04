# campeón - Phase 3: Instruments + Scoring - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the pure scoring core (`scoring/`: Fitts effective throughput, constant-velocity Kalman tracker, bias/variance decomposition, sub-movement segmentation) and the four bio-inspired instruments (`instruments/`: track, flick, calibrate, strike) on the shared `Instrument` interface, so each instrument runs a real trial in the arena and returns a scored `TrialResult`.

**Architecture:** Two layers riding the Phase-2 engine. (1) `scoring/` is four pure, formula-tested modules (no DOM/Three). (2) Each instrument is split into a **pure analyzer** (`Recording → {raw, score}`, unit-tested against synthetic players) and a **thin `run()` shell** that drives the arena, records frames + fire events, calls the analyzer, and resolves a `TrialResult`. The arena gains a minimal instrument-driving surface (`onFrame`, `onFire`, `view`) and honors an extended `TargetSpec` (explicit placement + band-limited motion). The shells are node-testable against a scripted fake `ArenaScene`; only the RAF/pointer wiring is runtime-verified.

**Tech Stack:** TypeScript (strict) · Vite · Three.js · Vitest. Pure math implemented from scratch (no ml-matrix needed - the Kalman state is 2×2). Builds on Phase 1 (`stats/`, `convert/`) and Phase 2 (`engine/`, `input/`).

---

## Testing strategy

- **scoring/ (T1–T4):** pure unit tests against published formulas. Pin behavior with (a) one or two hand-computable exact cases derived inline from the formula (not memorized magic numbers) and (b) invariants/orderings (monotonicity, sign, the bias–variance identity, round-trips). Fail loudly (`RangeError`) on degenerate input rather than returning `Infinity`/`NaN`.
- **engine extension (T5–T6):** THREE math classes run headless in Node, so moving-target math and the extended Arena are unit-tested with a spy renderer + a scriptable fake input (the Phase-2 pattern). Only WebGL/RAF stay runtime-only.
- **instruments (T7–T12):** the **analyzer** is unit-tested with synthetic `Recording`s representing distinct player archetypes (perfect / laggy / over-sensitive), asserting metric orderings and the cm/360-sensitive signal each instrument exists to measure. The **`run()` shell** is tested against a shared scripted fake `ArenaScene` (`tests/instruments/fake-scene.ts`) - it must configure the scene, record, resolve with the analyzer's result, and clean up.
- **runtime proof (T13):** one instrument runs end-to-end in real Chromium via Playwright (the Phase-2 T9 pattern), returning a finite-scored `TrialResult`.

## Conventions (carry from Phase 1–2; do not deviate)

- **Commit trailer (every commit):**
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- **Test imports are explicit:** `import { describe, it, expect } from 'vitest';` - never rely on globals.
- **Logical view frame:** yaw 0 = forward (−Z), +yaw = right (+X); pitch 0 = level, +pitch = up (+Y). Bearings are `[yaw, pitch]` in degrees; times in ms; angular speed in deg/s.
- **Task-local error axes (Phase-3 convention):** an endpoint error is expressed in **task-local coordinates where component 0 is along the movement (radial) axis and component 1 is cross-axis (tangential)**. Positive radial = overshoot (past target center along the approach direction). This makes `Tap.endpointErrorAlongAxis` (scalar) and `Shot.error[0]` (radial) consistent.
- **`raw` is `Record<string, number>`:** instruments flatten vectors to scalars (`biasRadial`, `biasMag`, …). Structured scoring outputs (e.g. tuple bias) stay internal to `scoring/`.
- **Within-trial scores only:** each instrument's `score` is a deterministic, monotone (higher = better) function of its own `raw`. Cross-trial normalization across the cm/360 sweep is Phase 4's job; document this at each `score`.
- **No `Date.now()` / `Math.random()` in pure cores.** Randomness comes from `ctx.rng`; `TrialResult.at` is stamped from the arena clock (`nowMs`) by the `run()` shell so tests are deterministic.
- **`noUncheckedIndexedAccess` stays off** for this phase (enabling it would force retrofits across Phase 1–2 code for little gain - the Kalman state is fixed-size tuples). Write Phase-3 dynamic indexing defensively (iterate, length-check) instead.
- **strict TS, no `any` in core.** Reuse `mulberry32` from `src/stats/bootstrap.ts` for seeded randomness in tests.

---

## Task 1: `scoring/fitts.ts` - effective throughput (ISO 9241-9)

**Files:**
- Create: `src/scoring/fitts.ts`
- Test: `tests/scoring/fitts.test.ts`

The flick scorer. Effective-width method: `We = 4.133·SD(endpoint error along axis)`, effective amplitude `Ae = A + mean(error along axis)`, `IDe = log2(Ae/We + 1)`, `TP = IDe / MT_mean` (bits/s). Aggregate across conditions as mean-of-means.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import type { Tap, FittsCondition } from '../../src/types';
import {
  WE_CONST,
  sampleStd,
  conditionThroughput,
  aggregateThroughput,
} from '../../src/scoring/fitts';

describe('WE_CONST', () => {
  it('is the ISO 9241-9 effective-width multiplier √(2πe) ≈ 4.133', () => {
    expect(WE_CONST).toBeCloseTo(Math.sqrt(2 * Math.PI * Math.E), 3);
  });
});

describe('sampleStd', () => {
  it('uses the sample (N−1) denominator', () => {
    expect(sampleStd([2, -2])).toBeCloseTo(Math.sqrt(8), 9); // ((2²+2²)/(2−1)) = 8
    expect(sampleStd([1, 1, 1])).toBe(0);
  });
});

describe('conditionThroughput', () => {
  it('computes Ae/We/IDe/TP from the effective-width formula', () => {
    const condition: FittsCondition = { amplitude: 10, width: 4 };
    // errors along axis: mean 0 (Ae = A = 10), SD = √8
    const taps: Tap[] = [
      { mt: 1000, endpointErrorAlongAxis: 2 },
      { mt: 1000, endpointErrorAlongAxis: -2 },
    ];
    const r = conditionThroughput(taps, condition);
    const we = WE_CONST * Math.sqrt(8);
    const ide = Math.log2(10 / we + 1);
    expect(r.ae).toBeCloseTo(10, 9);
    expect(r.we).toBeCloseTo(we, 9);
    expect(r.ide).toBeCloseTo(ide, 9);
    expect(r.mtMean).toBeCloseTo(1000, 9);
    expect(r.tp).toBeCloseTo(ide / 1.0, 9); // MT mean = 1000ms = 1s
  });

  it('adds mean overshoot into the effective amplitude', () => {
    const taps: Tap[] = [
      { mt: 500, endpointErrorAlongAxis: 1 },
      { mt: 500, endpointErrorAlongAxis: 3 },
    ];
    const r = conditionThroughput(taps, { amplitude: 20, width: 3 });
    expect(r.ae).toBeCloseTo(22, 9); // 20 + mean(1,3)=2
  });

  it('is monotone: more spread → lower TP; faster MT → higher TP', () => {
    const cond: FittsCondition = { amplitude: 15, width: 3 };
    const tight = conditionThroughput(
      [{ mt: 500, endpointErrorAlongAxis: 0.5 }, { mt: 500, endpointErrorAlongAxis: -0.5 }],
      cond,
    );
    const loose = conditionThroughput(
      [{ mt: 500, endpointErrorAlongAxis: 3 }, { mt: 500, endpointErrorAlongAxis: -3 }],
      cond,
    );
    expect(tight.tp).toBeGreaterThan(loose.tp);
    const fast = conditionThroughput(
      [{ mt: 250, endpointErrorAlongAxis: 0.5 }, { mt: 250, endpointErrorAlongAxis: -0.5 }],
      cond,
    );
    expect(fast.tp).toBeGreaterThan(tight.tp);
  });

  it('throws on degenerate input (fewer than 2 taps, or zero spread)', () => {
    expect(() => conditionThroughput([{ mt: 500, endpointErrorAlongAxis: 0 }], { amplitude: 10, width: 3 }))
      .toThrow(RangeError);
    expect(() =>
      conditionThroughput(
        [{ mt: 500, endpointErrorAlongAxis: 1 }, { mt: 500, endpointErrorAlongAxis: 1 }],
        { amplitude: 10, width: 3 },
      ),
    ).toThrow(RangeError);
  });
});

describe('aggregateThroughput', () => {
  it('is the mean of per-condition throughputs (mean-of-means)', () => {
    const a = conditionThroughput(
      [{ mt: 500, endpointErrorAlongAxis: 1 }, { mt: 500, endpointErrorAlongAxis: -1 }],
      { amplitude: 10, width: 3 },
    );
    const b = conditionThroughput(
      [{ mt: 800, endpointErrorAlongAxis: 1 }, { mt: 800, endpointErrorAlongAxis: -1 }],
      { amplitude: 30, width: 3 },
    );
    expect(aggregateThroughput([a, b])).toBeCloseTo((a.tp + b.tp) / 2, 9);
  });
  it('throws on an empty condition list', () => {
    expect(() => aggregateThroughput([])).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scoring/fitts.test.ts`
Expected: FAIL - `Cannot find module '../../src/scoring/fitts'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { Degrees, Ms, Tap, FittsCondition } from '../types';

/** Effective-width multiplier √(2πe) (ISO 9241-9): We = WE_CONST · SD(endpoint error). */
export const WE_CONST = Math.sqrt(2 * Math.PI * Math.E); // ≈ 4.1327

function mean(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample standard deviation (N−1 denominator). Returns 0 for ≤1 element. */
export function sampleStd(xs: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  let ss = 0;
  for (const x of xs) ss += (x - m) * (x - m);
  return Math.sqrt(ss / (n - 1));
}

export interface ConditionThroughput {
  ae: Degrees; // effective amplitude = nominal A + mean signed along-axis error
  we: Degrees; // effective width = WE_CONST · SD(along-axis error)
  ide: number; // index of difficulty (bits) = log2(Ae/We + 1)
  mtMean: Ms;
  tp: number; // throughput (bits/s) = IDe / (MT_mean in seconds)
}

/**
 * Effective-throughput for one (amplitude, width) condition.
 * Throws on <2 taps or zero endpoint spread (We = 0 → undefined IDe): a degenerate
 * condition is a measurement failure, not a TP of Infinity.
 */
export function conditionThroughput(taps: readonly Tap[], condition: FittsCondition): ConditionThroughput {
  if (taps.length < 2) {
    throw new RangeError(`conditionThroughput: need ≥2 taps, got ${taps.length}`);
  }
  const errs = taps.map((t) => t.endpointErrorAlongAxis);
  const mts = taps.map((t) => t.mt);
  const we = WE_CONST * sampleStd(errs);
  if (!(we > 0)) {
    throw new RangeError('conditionThroughput: zero endpoint spread (We = 0)');
  }
  const ae = condition.amplitude + mean(errs);
  const ide = Math.log2(ae / we + 1);
  const mtMean = mean(mts);
  const tp = ide / (mtMean / 1000);
  return { ae, we, ide, mtMean, tp };
}

/** Mean-of-means aggregate throughput across conditions (ISO 9241-9). */
export function aggregateThroughput(conditions: readonly ConditionThroughput[]): number {
  if (conditions.length === 0) {
    throw new RangeError('aggregateThroughput: no conditions');
  }
  return mean(conditions.map((c) => c.tp));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scoring/fitts.test.ts`
Expected: PASS (all assertions).

- [ ] **Step 5: Commit**

```bash
git add src/scoring/fitts.ts tests/scoring/fitts.test.ts
git commit -m "feat(scoring): Fitts effective throughput (ISO 9241-9 effective-width)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `scoring/kalman.ts` - constant-velocity Kalman tracker

**Files:**
- Create: `src/scoring/kalman.ts`
- Test: `tests/scoring/kalman.test.ts`

The track scorer. A 1-D (per-axis) constant-velocity Kalman filter on state `[pos, vel]`. The **innovation** `ν = z − Ĥx⁻` is the instantaneous tracking error; the optimal lead point is `pos + vel·L`. The track instrument runs one filter per axis (yaw, pitch).

🎓 *Why CV-Kalman is the honest tracking score:* the innovation is what the model **didn't predict** - feed it a target moving at constant velocity and a good filter drives ν→0; feed it a velocity step and ν spikes, then decays as the estimate re-converges. That spike-and-decay is exactly the re-acquisition the dragonfly/falcon mechanism is about, so `mean‖ν‖²` is a principled tracking-error metric rather than raw position error.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { KalmanCV } from '../../src/scoring/kalman';

describe('KalmanCV - constant-velocity tracking', () => {
  it('converges to the true velocity on clean CV data', () => {
    const k = new KalmanCV({ q: 1e-3, r: 1e-2 });
    let pos = 0;
    for (let i = 0; i < 30; i++) {
      k.predict(1); // dt = 1s
      k.update(pos); // measurement = true position
      pos += 1; // true velocity = 1 deg/s
    }
    expect(k.vel).toBeCloseTo(1, 1); // recovered velocity
    expect(k.pos).toBeCloseTo(pos - 1, 0); // tracks the last measured position
  });

  it('predicts a lead point ahead of the current estimate', () => {
    const k = new KalmanCV({ q: 1e-3, r: 1e-2 });
    let pos = 0;
    for (let i = 0; i < 30; i++) {
      k.predict(1);
      k.update(pos);
      pos += 1;
    }
    // lead by 0.5s at v≈1 → ≈ pos + 0.5
    expect(k.lead(0.5)).toBeCloseTo(k.pos + k.vel * 0.5, 9);
    expect(k.lead(0.5)).toBeGreaterThan(k.pos);
  });

  it('innovation is small on CV data but spikes at a velocity step', () => {
    const k = new KalmanCV({ q: 1e-3, r: 1e-2 });
    let pos = 0;
    let lastSteady = 0;
    for (let i = 0; i < 20; i++) {
      k.predict(1);
      lastSteady = Math.abs(k.update(pos));
      pos += 1;
    }
    // velocity doubles (step) - first post-step innovation should jump
    k.predict(1);
    const spike = Math.abs(k.update(pos + 1)); // jumped ahead by an extra degree
    expect(lastSteady).toBeLessThan(0.2);
    expect(spike).toBeGreaterThan(lastSteady * 3);
  });

  it('large R trusts the model: a single outlier barely moves the estimate', () => {
    const k = new KalmanCV({ q: 1e-4, r: 100 }, { pos: 0, vel: 0 });
    k.predict(1);
    k.update(50); // wild outlier
    expect(Math.abs(k.pos)).toBeLessThan(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scoring/kalman.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
/** Constant-velocity Kalman filter parameters. */
export interface KalmanCVParams {
  /** Process-noise spectral density (deg²/s³) - how much the model lets velocity drift. */
  q: number;
  /** Measurement-noise variance (deg²). */
  r: number;
}

export interface KalmanCVInit {
  pos?: number;
  vel?: number;
  posVar?: number;
  velVar?: number;
}

/**
 * 1-D constant-velocity Kalman filter on state x = [pos, vel].
 *   F(dt) = [[1, dt], [0, 1]], H = [1, 0]
 *   Q = q · [[dt³/3, dt²/2], [dt²/2, dt]]  (continuous white-noise-acceleration model)
 * Covariance P stored as the four scalars p00 p01 p10 p11.
 * `update(z)` returns the innovation ν = z − pos⁻ (the instantaneous tracking error).
 */
export class KalmanCV {
  private x0: number;
  private x1: number;
  private p00: number;
  private p01 = 0;
  private p10 = 0;
  private p11: number;
  private readonly q: number;
  private readonly r: number;

  constructor(params: KalmanCVParams, init: KalmanCVInit = {}) {
    this.q = params.q;
    this.r = params.r;
    this.x0 = init.pos ?? 0;
    this.x1 = init.vel ?? 0;
    this.p00 = init.posVar ?? 1e3;
    this.p11 = init.velVar ?? 1e3;
  }

  get pos(): number {
    return this.x0;
  }
  get vel(): number {
    return this.x1;
  }

  /** Predicted position `dt` seconds further ahead at the current velocity estimate. */
  lead(leadSec: number): number {
    return this.x0 + this.x1 * leadSec;
  }

  predict(dtSec: number): void {
    const dt = dtSec;
    // x⁻ = F x
    this.x0 = this.x0 + dt * this.x1;
    // P⁻ = F P Fᵀ + Q
    const { p00, p01, p10, p11 } = this;
    const a00 = p00 + dt * p10;
    const a01 = p01 + dt * p11;
    const n00 = a00 + dt * a01;
    const n01 = a01;
    const n10 = p10 + dt * p11;
    const n11 = p11;
    const dt2 = dt * dt;
    const dt3 = dt2 * dt;
    this.p00 = n00 + this.q * (dt3 / 3);
    this.p01 = n01 + this.q * (dt2 / 2);
    this.p10 = n10 + this.q * (dt2 / 2);
    this.p11 = n11 + this.q * dt;
  }

  /** Fuse a position measurement; returns the innovation ν = z − pos⁻. */
  update(z: number): number {
    const y = z - this.x0; // innovation
    const s = this.p00 + this.r; // innovation covariance
    const k0 = this.p00 / s;
    const k1 = this.p10 / s;
    this.x0 = this.x0 + k0 * y;
    this.x1 = this.x1 + k1 * y;
    // P = (I − K H) P, H = [1, 0]
    const { p00, p01, p10, p11 } = this;
    this.p00 = (1 - k0) * p00;
    this.p01 = (1 - k0) * p01;
    this.p10 = p10 - k1 * p00;
    this.p11 = p11 - k1 * p01;
    return y;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scoring/kalman.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scoring/kalman.ts tests/scoring/kalman.test.ts
git commit -m "feat(scoring): constant-velocity Kalman tracker (innovation = tracking error)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `scoring/bias-variance.ts` - bias/variance decomposition

**Files:**
- Create: `src/scoring/bias-variance.ts`
- Test: `tests/scoring/bias-variance.test.ts`

The calibrate scorer (archerfish). `bias b = mean(error)`; `gain g = mean(required + e_radial)/mean(required)` (g>1 overshoot → sens too high); `σ_R = sqrt(mean‖e−b‖²)` (de-biased spread); `MSE = |b|² + σ_R²`. Plus a live-training EWMA bias estimate and the composite calibration cost.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import type { Shot } from '../../src/types';
import {
  decompose,
  ewmaBias,
  calibrationCost,
} from '../../src/scoring/bias-variance';

describe('decompose', () => {
  it('separates a pure systematic bias (zero spread)', () => {
    const shots: Shot[] = [
      { error: [2, 0], required: 10 },
      { error: [2, 0], required: 10 },
    ];
    const d = decompose(shots);
    expect(d.bias[0]).toBeCloseTo(2, 9);
    expect(d.bias[1]).toBeCloseTo(0, 9);
    expect(d.sigmaR).toBeCloseTo(0, 9);
    expect(d.mse).toBeCloseTo(4, 9); // |b|² = 4, σ_R = 0
    expect(d.gain).toBeCloseTo(1.2, 9); // (10+2)/10
  });

  it('separates pure variance (zero mean)', () => {
    const shots: Shot[] = [
      { error: [1, 0], required: 10 },
      { error: [-1, 0], required: 10 },
    ];
    const d = decompose(shots);
    expect(d.bias[0]).toBeCloseTo(0, 9);
    expect(d.sigmaR).toBeCloseTo(1, 9);
    expect(d.mse).toBeCloseTo(1, 9);
    expect(d.gain).toBeCloseTo(1, 9);
  });

  it('satisfies the bias–variance identity MSE = mean‖e‖²', () => {
    const shots: Shot[] = [
      { error: [1.5, -0.5], required: 12 },
      { error: [-0.5, 0.5], required: 12 },
      { error: [0.5, 1.5], required: 12 },
      { error: [2.0, -1.0], required: 12 },
    ];
    const d = decompose(shots);
    const meanSq =
      shots.reduce((s, sh) => s + sh.error[0] ** 2 + sh.error[1] ** 2, 0) / shots.length;
    expect(d.mse).toBeCloseTo(meanSq, 9);
    expect(d.mse).toBeCloseTo(d.bias[0] ** 2 + d.bias[1] ** 2 + d.sigmaR ** 2, 9);
  });

  it('gain < 1 for systematic undershoot', () => {
    const d = decompose([
      { error: [-2, 0], required: 10 },
      { error: [-2, 0], required: 10 },
    ]);
    expect(d.gain).toBeLessThan(1);
  });

  it('throws on empty input', () => {
    expect(() => decompose([])).toThrow(RangeError);
  });
});

describe('ewmaBias', () => {
  it('tracks toward the steady bias', () => {
    const shots: Shot[] = Array.from({ length: 40 }, () => ({ error: [3, -1] as [number, number], required: 10 }));
    const b = ewmaBias(shots, 0.2);
    expect(b[0]).toBeCloseTo(3, 1);
    expect(b[1]).toBeCloseTo(-1, 1);
  });
  it('starts from the provided seed', () => {
    const b = ewmaBias([{ error: [0, 0], required: 10 }], 0.5, [4, 4]);
    expect(b[0]).toBeCloseTo(2, 9); // (1−.5)·4 + .5·0
  });
});

describe('calibrationCost', () => {
  it('is bias-dominant with the default weights', () => {
    const biasy = calibrationCost({ bias: [2, 0], gain: 1.2, sigmaR: 0, mse: 4 }, 500, 500);
    const noisy = calibrationCost({ bias: [0, 0], gain: 1, sigmaR: 2, mse: 4 }, 500, 500);
    // same |b|²+σ_R² magnitude, but bias weighted 0.6 vs variance 0.3 → biasy costs more
    expect(biasy).toBeGreaterThan(noisy);
  });
  it('adds a time penalty relative to the reference', () => {
    const fast = calibrationCost({ bias: [0, 0], gain: 1, sigmaR: 1, mse: 1 }, 500, 500);
    const slow = calibrationCost({ bias: [0, 0], gain: 1, sigmaR: 1, mse: 1 }, 1000, 500);
    expect(slow).toBeGreaterThan(fast);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scoring/bias-variance.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { Degrees, Ms, Shot } from '../types';

export interface Decomposition {
  /** Mean signed error [radial, tangential] (degrees). */
  bias: [Degrees, Degrees];
  /** Gain bias = mean(required + e_radial) / mean(required). >1 overshoot, <1 undershoot. */
  gain: number;
  /** De-biased RMS spread sqrt(mean‖e − b‖²) - the precision floor. */
  sigmaR: Degrees;
  /** |b|² + σ_R² (equals mean‖e‖²). */
  mse: number;
}

/** Bias/variance decomposition of a burst of shots (errors in task-local [radial, tangential]). */
export function decompose(shots: readonly Shot[]): Decomposition {
  const n = shots.length;
  if (n === 0) throw new RangeError('decompose: no shots');
  let bx = 0;
  let by = 0;
  let reqSum = 0;
  let impSum = 0;
  for (const s of shots) {
    bx += s.error[0];
    by += s.error[1];
    reqSum += s.required;
    impSum += s.required + s.error[0]; // achieved radial amplitude
  }
  bx /= n;
  by /= n;
  let varSum = 0;
  for (const s of shots) {
    const dx = s.error[0] - bx;
    const dy = s.error[1] - by;
    varSum += dx * dx + dy * dy;
  }
  const sigmaR = Math.sqrt(varSum / n);
  const gain = reqSum > 0 ? impSum / reqSum : NaN;
  const mse = bx * bx + by * by + sigmaR * sigmaR;
  return { bias: [bx, by], gain, sigmaR, mse };
}

/** Live-training EWMA bias estimate: b̂ₜ = (1−α)·b̂ₜ₋₁ + α·eₜ. */
export function ewmaBias(
  shots: readonly Shot[],
  alpha: number,
  init: [Degrees, Degrees] = [0, 0],
): [Degrees, Degrees] {
  let bx = init[0];
  let by = init[1];
  for (const s of shots) {
    bx = (1 - alpha) * bx + alpha * s.error[0];
    by = (1 - alpha) * by + alpha * s.error[1];
  }
  return [bx, by];
}

export interface CalibrationWeights {
  wb: number;
  wv: number;
  wt: number;
}

const DEFAULT_WEIGHTS: CalibrationWeights = { wb: 0.6, wv: 0.3, wt: 0.1 };

/** Composite calibration cost C(s) = w_b·|b|² + w_v·σ_R² + w_t·(meanMt/tRef)². Lower = better. */
export function calibrationCost(
  d: Decomposition,
  meanMt: Ms,
  tRef: Ms,
  w: CalibrationWeights = DEFAULT_WEIGHTS,
): number {
  const biasSq = d.bias[0] * d.bias[0] + d.bias[1] * d.bias[1];
  const tRatio = meanMt / tRef;
  return w.wb * biasSq + w.wv * d.sigmaR * d.sigmaR + w.wt * tRatio * tRatio;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scoring/bias-variance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scoring/bias-variance.ts tests/scoring/bias-variance.test.ts
git commit -m "feat(scoring): bias/variance decomposition + EWMA + calibration cost

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `scoring/submovement.ts` - velocity-trace segmentation

**Files:**
- Create: `src/scoring/submovement.ts`
- Test: `tests/scoring/submovement.test.ts`

Decompose an angular-speed trace into the spider/raptor stages: detection latency `t_D`, primary ballistic orient `t_O` (to the first trough), corrective sub-movements `N_corr` + `t_C`, and `v_peak`. Used by flick (corrections) and strike (reaction/commit).

- [ ] **Step 1: Write the failing test**

```typescript
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
    expect(s.vPeak).toBeCloseTo(600, -1); // within ~tens of deg/s of the true peak
    expect(s.tD).toBeGreaterThan(0);
    expect(s.tD).toBeLessThan(250);
    expect(s.onsetTime).toBeCloseTo(s.tD, 9); // cueTime defaults to 0
  });

  it('counts one correction for a primary reach + one secondary bump', () => {
    const trace = bumps([
      { mu: 200, sigma: 40, amp: 600 },
      { mu: 430, sigma: 35, amp: 220 },
    ]);
    const s = segment(trace, { onsetThresh: 30 });
    expect(s.nCorr).toBe(1);
    expect(s.tO).toBeGreaterThan(0); // onset → first trough between the bumps
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scoring/submovement.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { Ms } from '../types';

export interface VelSample {
  t: Ms;
  speed: number; // |angular velocity|, deg/s
}

export interface SubmovementSeg {
  tD: Ms; // detection latency: cueTime → movement onset
  tO: Ms; // primary orient: onset → first trough after the primary peak
  tC: Ms; // confirm: first trough → end of trace
  nCorr: number; // corrective sub-movements (local maxima after the first trough, above onsetThresh)
  vPeak: number; // peak speed of the primary orient
  onsetTime: Ms; // absolute time of movement onset
}

export interface SegmentOptions {
  cueTime?: Ms; // default 0
  onsetThresh?: number; // deg/s, movement-onset threshold; also the floor for counting corrections
}

/**
 * Segment an angular-speed trace into detect / orient / confirm stages.
 * Onset = first sample crossing `onsetThresh`. Primary peak = first local maximum after onset.
 * First trough = first local minimum after that peak. Corrective sub-movements = local maxima
 * after the first trough whose speed exceeds `onsetThresh`.
 * Throws if the trace never crosses the onset threshold (no movement to segment).
 */
export function segment(trace: readonly VelSample[], opts: SegmentOptions = {}): SubmovementSeg {
  const cueTime = opts.cueTime ?? 0;
  const onsetThresh = opts.onsetThresh ?? 30;

  let onsetIdx = -1;
  for (let i = 0; i < trace.length; i++) {
    if (trace[i]!.speed >= onsetThresh) {
      onsetIdx = i;
      break;
    }
  }
  if (onsetIdx === -1) {
    throw new RangeError('segment: trace never crosses the onset threshold');
  }
  const onsetTime = trace[onsetIdx]!.t;

  // Primary peak: first local maximum at or after onset.
  let peakIdx = onsetIdx;
  for (let i = onsetIdx + 1; i < trace.length - 1; i++) {
    if (trace[i]!.speed >= trace[i - 1]!.speed && trace[i]!.speed > trace[i + 1]!.speed) {
      peakIdx = i;
      break;
    }
    peakIdx = i; // fall through to the global descent if no interior max found yet
  }
  const vPeak = trace[peakIdx]!.speed;

  // First trough after the primary peak (local minimum).
  let troughIdx = trace.length - 1;
  for (let i = peakIdx + 1; i < trace.length - 1; i++) {
    if (trace[i]!.speed <= trace[i - 1]!.speed && trace[i]!.speed < trace[i + 1]!.speed) {
      troughIdx = i;
      break;
    }
  }

  // Corrective sub-movements: local maxima after the trough exceeding the onset floor.
  let nCorr = 0;
  for (let i = troughIdx + 1; i < trace.length - 1; i++) {
    const s = trace[i]!.speed;
    if (s > trace[i - 1]!.speed && s >= trace[i + 1]!.speed && s > onsetThresh) {
      nCorr += 1;
    }
  }

  const troughTime = trace[troughIdx]!.t;
  const endTime = trace[trace.length - 1]!.t;
  return {
    tD: onsetTime - cueTime,
    tO: troughTime - onsetTime,
    tC: endTime - troughTime,
    nCorr,
    vPeak,
    onsetTime,
  };
}
```

> **Implementer note:** the primary-peak loop is intentionally simple (clean synthetic traces). If a real trace is noisy, the caller should pre-smooth; do not add smoothing here without a test that pins it. Verify the three-bump test lands `nCorr === 2` - if the trough detection picks the wrong local min, tighten the peak loop to break only on a strict local max.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scoring/submovement.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scoring/submovement.ts tests/scoring/submovement.test.ts
git commit -m "feat(scoring): velocity-trace sub-movement segmentation (detect/orient/confirm)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Extend `types.ts` + `engine/targets.ts` - placement, motion, separation

**Files:**
- Modify: `src/types.ts` (extend `TargetSpec`; add the instrument-driving surface to `ArenaScene`)
- Modify: `src/engine/targets.ts` (add `separation`, `motionOffset`, `MovingTarget`; extract `createTargetMesh`)
- Test: `tests/engine/targets.test.ts` (extend)

This unlocks instruments: targets can be placed explicitly and can move along a deterministic band-limited path, and the scene exposes angular separation for hit/TOT math.

- [ ] **Step 1: Extend the contract in `types.ts`**

Replace the `TargetSpec` interface and extend `ArenaScene`:

```typescript
// ── arena (engine/) ────────────────────────────────────────────────────
export interface ArenaScene {
  setSensitivity(cm360: Cm360, dpi: Dpi): void;
  spawnTarget(spec: TargetSpec): TargetHandle;
  onAim(cb: (sample: AimSample, viewYawPitch: [Degrees, Degrees]) => void): () => void;
  clearTargets(): void;
  // Phase 3 - the instrument-driving surface (the contract anticipated this):
  /** Per-frame tick: dt since the previous frame and the arena clock, both in ms. */
  onFrame(cb: (dtMs: Ms, nowMs: Ms) => void): () => void;
  /** Fire (primary-button) events, with the arena clock in ms. */
  onFire(cb: (nowMs: Ms) => void): () => void;
  /** Current aim bearing [yaw, pitch] in degrees. */
  view(): [Degrees, Degrees];
}
export interface TargetMotion {
  /** Sum-of-sines yaw/pitch amplitudes (degrees) about the base placement. */
  yawAmp?: Degrees;
  pitchAmp?: Degrees;
  /** Base angular frequency (Hz); the second sine runs at ~1.7× this. */
  baseFreq?: number;
  /** Seed for the deterministic phase offsets. */
  seed?: number;
}
export interface TargetSpec {
  kind: 'static' | 'moving' | 'grid';
  // Phase 3: optional explicit placement (else a random forward-cone static target).
  yaw?: Degrees;
  pitch?: Degrees;
  distance?: number;
  worldRadius?: number;
  // Phase 3 'moving': band-limited path about the placement.
  motion?: TargetMotion;
}
```

(`Ms` and `Degrees` are already imported within `types.ts`'s own declarations - they are defined at the top of the file, so no import is needed.)

- [ ] **Step 2: Write the failing tests (append to `tests/engine/targets.test.ts`)**

```typescript
import { separation, motionOffset, MovingTarget } from '../../src/engine/targets';

describe('separation', () => {
  it('is the great-circle angle between two bearings', () => {
    expect(separation([0, 0], [0, 0])).toBeCloseTo(0, 9);
    expect(separation([0, 0], [90, 0])).toBeCloseTo(90, 6);
    expect(separation([0, 0], [0, 90])).toBeCloseTo(90, 6);
    expect(separation([10, 5], [10, 5])).toBeCloseTo(0, 9);
  });
  it('is symmetric and bounded by 180', () => {
    expect(separation([30, 10], [-40, -5])).toBeCloseTo(separation([-40, -5], [30, 10]), 9);
    expect(separation([0, 0], [180, 0])).toBeLessThanOrEqual(180 + 1e-6);
  });
});

describe('motionOffset', () => {
  it('is deterministic from the seed and bounded by the amplitudes', () => {
    const motion = { yawAmp: 8, pitchAmp: 3, baseFreq: 0.5, seed: 7 };
    for (let t = 0; t <= 5; t += 0.25) {
      const [dy, dp] = motionOffset(motion, t);
      expect(Math.abs(dy)).toBeLessThanOrEqual(8 + 1e-9);
      expect(Math.abs(dp)).toBeLessThanOrEqual(3 + 1e-9);
    }
    expect(motionOffset(motion, 1.3)).toEqual(motionOffset(motion, 1.3)); // pure
  });
  it('actually moves over time', () => {
    const motion = { yawAmp: 8, pitchAmp: 3, baseFreq: 0.5, seed: 1 };
    const a = motionOffset(motion, 0);
    const b = motionOffset(motion, 0.6);
    expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])).toBeGreaterThan(0.1);
  });
});

describe('MovingTarget', () => {
  it('updates its bearing as time advances along the path', () => {
    const t = new MovingTarget(
      'm1',
      { yaw: 0, pitch: 0, distance: 20, worldRadius: 0.6 },
      { yawAmp: 10, pitchAmp: 4, baseFreq: 0.5, seed: 3 },
      0,
    );
    const b0 = t.bearing();
    t.update(1500); // 1.5s later (ms)
    const b1 = t.bearing();
    expect(separation(b0, b1)).toBeGreaterThan(0.5);
    expect(t.radiusDeg()).toBeGreaterThan(0);
    t.dispose();
  });
});
```

- [ ] **Step 3: Implement in `engine/targets.ts`**

Add the imports/helpers and classes. First, extract the mesh factory and reuse it in `Target`:

```typescript
import { mulberry32 } from '../stats/bootstrap';
import type { TargetMotion } from '../types';

/** Build the standard gold target mesh (shared by static + moving targets). */
export function createTargetMesh(worldRadius: number): Mesh {
  const geometry = new SphereGeometry(worldRadius, 24, 16);
  const material = new MeshStandardMaterial({
    color: new Color('#FFC400'),
    emissive: new Color('#3a2a00'),
    roughness: 0.4,
    metalness: 0,
  });
  return new Mesh(geometry, material);
}

/** Great-circle angular distance (degrees) between two bearings. */
export function separation(a: [Degrees, Degrees], b: [Degrees, Degrees]): Degrees {
  const ua = positionAt(a[0], a[1], 1);
  const ub = positionAt(b[0], b[1], 1);
  const dot = Math.max(-1, Math.min(1, ua.dot(ub)));
  return Math.acos(dot) * RAD2DEG;
}

/** Deterministic band-limited (two-sine) offset [Δyaw, Δpitch] in degrees at time `tSec`. */
export function motionOffset(motion: TargetMotion, tSec: number): [Degrees, Degrees] {
  const yawAmp = motion.yawAmp ?? 10;
  const pitchAmp = motion.pitchAmp ?? 4;
  const f = motion.baseFreq ?? 0.5;
  const rng = mulberry32((motion.seed ?? 1) >>> 0);
  const phiY1 = rng() * Math.PI * 2;
  const phiY2 = rng() * Math.PI * 2;
  const phiP1 = rng() * Math.PI * 2;
  const TAU = Math.PI * 2;
  // Two incommensurate sines per axis, normalized so the sum stays within the amplitude.
  const dy = (yawAmp / 1.5) * (Math.sin(TAU * f * tSec + phiY1) + 0.5 * Math.sin(TAU * f * 1.7 * tSec + phiY2));
  const dp = pitchAmp * Math.sin(TAU * f * 0.8 * tSec + phiP1);
  return [dy, dp];
}
```

Refactor `Target`'s constructor to use `createTargetMesh` (behavior unchanged):

```typescript
  constructor(id: string, placement: Placement) {
    this.id = id;
    this.placement = placement;
    this.mesh = createTargetMesh(placement.worldRadius);
    this.mesh.position.copy(positionAt(placement.yaw, placement.pitch, placement.distance));
  }
```

Then add `MovingTarget`:

```typescript
/** A target that orbits a base placement along a deterministic band-limited path. */
export class MovingTarget implements TargetHandle {
  readonly id: string;
  readonly mesh: Mesh;
  private readonly base: Placement;
  private readonly motion: TargetMotion;
  private readonly spawnMs: number;

  constructor(id: string, base: Placement, motion: TargetMotion, spawnMs: number) {
    this.id = id;
    this.base = base;
    this.motion = motion;
    this.spawnMs = spawnMs;
    this.mesh = createTargetMesh(base.worldRadius);
    this.update(spawnMs);
  }

  /** Reposition for the arena clock `nowMs`. */
  update(nowMs: number): void {
    const [dy, dp] = motionOffset(this.motion, (nowMs - this.spawnMs) / 1000);
    this.mesh.position.copy(positionAt(this.base.yaw + dy, this.base.pitch + dp, this.base.distance));
  }

  bearing(): [Degrees, Degrees] {
    return bearingOf(this.mesh.position);
  }

  radiusDeg(): Degrees {
    return angularRadius(this.base.worldRadius, this.base.distance);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/engine/targets.test.ts`
Expected: PASS (existing + new). Also run `npx tsc --noEmit` - the `types.ts` contract change must compile cleanly (Phase-2 `Arena` will not yet implement the new methods; **that is expected to fail tsc until Task 6** - note it and proceed; the targets test itself passes under vitest's esbuild transpile).

> **Sequencing note:** because Task 5 widens `ArenaScene` but Task 6 implements it, `tsc --noEmit` over the whole project will report `Arena` missing `onFrame/onFire/view` between these tasks. Run the *targets* test in isolation here; the full-project typecheck is restored green at the end of Task 6.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/engine/targets.ts tests/engine/targets.test.ts
git commit -m "feat(engine): extend TargetSpec/ArenaScene; add separation, motion, MovingTarget

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Extend `engine/arena.ts` - tick, onFrame, onFire, view, spec-honoring spawn

**Files:**
- Modify: `src/engine/arena.ts`
- Test: `tests/engine/arena.test.ts` (extend the harness + cases)

The Arena gains a clock (`tick(dtMs)`), per-frame and fire subscriptions, a `view()` accessor, and `spawnTarget` now honors explicit placement and motion. Moving targets advance each tick.

- [ ] **Step 1: Extend the test harness + write failing tests**

Update the `harness()` helper in `tests/engine/arena.test.ts` so the fake input can also fire, then add cases:

```typescript
// --- replace the input fake inside harness() with one that also emits fire ---
  let emit: (s: AimSample) => void = () => {};
  let fire: (now: number) => void = () => {};
  let unsubs = 0;
  const input: InputSource = {
    onSample(cb) {
      emit = cb;
      return () => {
        emit = () => {};
        unsubs += 1;
      };
    },
    onFire(cb) {
      fire = cb;
      return () => {
        fire = () => {};
      };
    },
  };
// --- expose them on the returned object ---
  return {
    arena,
    send: (s: AimSample) => emit(s),
    fire: (now: number) => fire(now),
    renders: () => renders,
    unsubs: () => unsubs,
    disposes: () => disposes,
  };
```

```typescript
describe('Arena instrument surface', () => {
  it('onFrame fires with dt and an advancing clock', () => {
    const h = harness();
    const ticks: Array<[number, number]> = [];
    h.arena.onFrame((dt, now) => ticks.push([dt, now]));
    h.arena.tick(16);
    h.arena.tick(16);
    expect(ticks).toHaveLength(2);
    expect(ticks[0][0]).toBe(16);
    expect(ticks[1][1]).toBeGreaterThan(ticks[0][1]); // now advanced
  });

  it('view() reflects the integrated aim', () => {
    const h = harness();
    const dpc = degreesPerCount(34, 800);
    h.send({ t: 0, dx: 12 / dpc, dy: 0 });
    expect(h.arena.view()[0]).toBeCloseTo(12, 4);
  });

  it('onFire delivers the arena clock on a fire event', () => {
    const h = harness();
    const fires: number[] = [];
    h.arena.onFire((now) => fires.push(now));
    h.arena.tick(100);
    h.fire(h.arena.now());
    expect(fires).toHaveLength(1);
    expect(fires[0]).toBeCloseTo(100, 6);
  });

  it('spawnTarget honors explicit placement', () => {
    const h = harness();
    const t = h.arena.spawnTarget({ kind: 'static', yaw: 18, pitch: -7, distance: 25, worldRadius: 0.5 });
    const [y, p] = t.bearing();
    expect(y).toBeCloseTo(18, 4);
    expect(p).toBeCloseTo(-7, 4);
  });

  it('a moving target changes bearing as the clock advances', () => {
    const h = harness();
    const t = h.arena.spawnTarget({
      kind: 'moving',
      yaw: 0,
      pitch: 0,
      distance: 20,
      worldRadius: 0.6,
      motion: { yawAmp: 10, pitchAmp: 4, baseFreq: 0.5, seed: 2 },
    });
    const b0 = t.bearing();
    h.arena.tick(800);
    const b1 = t.bearing();
    expect(separation(b0, b1)).toBeGreaterThan(0.3);
  });

  it('dispose() unsubscribes frame/fire callbacks too (idempotent)', () => {
    const h = harness();
    let frames = 0;
    h.arena.onFrame(() => (frames += 1));
    h.arena.dispose();
    h.arena.dispose();
    h.arena.tick(16); // after dispose, no callbacks fire
    expect(frames).toBe(0);
    expect(h.disposes()).toBe(1);
  });
});
```

Add the imports the new cases need at the top of the test file:

```typescript
import { separation } from '../../src/engine/targets';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/arena.test.ts`
Expected: FAIL - `arena.tick`, `arena.now`, `arena.onFrame`, `arena.onFire`, `arena.view` are not functions; moving spawn ignored.

- [ ] **Step 3: Implement in `engine/arena.ts`**

Extend `InputSource`, add clock + callback sets + moving-target tracking, and rewrite `spawnTarget`:

```typescript
import { Target, MovingTarget, placeStatic, type Placement } from './targets';
import type { AimSample, ArenaScene, Cm360, Degrees, Dpi, Ms, TargetHandle, TargetSpec } from '../types';

/** A source of pointer deltas + fire events - satisfied by the pointer-lock controller. */
export interface InputSource {
  onSample(cb: (sample: AimSample) => void): () => void;
  /** Optional fire (primary-button) events. Absent in headless tests that don't fire. */
  onFire?(cb: () => void): () => void;
}

type FrameCallback = (dtMs: Ms, nowMs: Ms) => void;
type FireCallback = (nowMs: Ms) => void;
```

Inside the class add fields:

```typescript
  private readonly frameCbs = new Set<FrameCallback>();
  private readonly fireCbs = new Set<FireCallback>();
  private readonly moving = new Set<MovingTarget>();
  private readonly unsubFire: () => void;
  private nowMs = 0;
```

In the constructor, after `unsubInput`:

```typescript
    this.unsubFire = opts.input.onFire
      ? opts.input.onFire(() => this.handleFire())
      : () => {};
```

Add methods:

```typescript
  /** Current arena clock (ms since construction). */
  now(): Ms {
    return this.nowMs;
  }

  view(): [Degrees, Degrees] {
    return this.rig.view();
  }

  /** Advance the clock by `dtMs`, move targets, and emit the frame to subscribers. */
  tick(dtMs: Ms): void {
    if (this.disposed) return;
    this.nowMs += dtMs;
    for (const t of this.moving) t.update(this.nowMs);
    for (const cb of this.frameCbs) cb(dtMs, this.nowMs);
  }

  onFrame(cb: FrameCallback): () => void {
    this.frameCbs.add(cb);
    return () => {
      this.frameCbs.delete(cb);
    };
  }

  onFire(cb: FireCallback): () => void {
    this.fireCbs.add(cb);
    return () => {
      this.fireCbs.delete(cb);
    };
  }

  private handleFire(): void {
    for (const cb of this.fireCbs) cb(this.nowMs);
  }
```

Rewrite `spawnTarget` to honor the spec:

```typescript
  spawnTarget(spec: TargetSpec): TargetHandle {
    const id = `t${this.nextId++}`;
    const hasPlacement = spec.yaw !== undefined || spec.pitch !== undefined;
    const placement: Placement = hasPlacement
      ? {
          yaw: spec.yaw ?? 0,
          pitch: spec.pitch ?? 0,
          distance: spec.distance ?? 20,
          worldRadius: spec.worldRadius ?? 0.6,
        }
      : placeStatic(this.rng, {
          ...(spec.distance !== undefined ? { distance: spec.distance } : {}),
          ...(spec.worldRadius !== undefined ? { worldRadius: spec.worldRadius } : {}),
        });

    if (spec.kind === 'moving') {
      const target = new MovingTarget(id, placement, spec.motion ?? {}, this.nowMs);
      this.moving.add(target);
      this.targets.set(id, target);
      this.scene.add(target.mesh);
      return target;
    }
    const target = new Target(id, placement);
    this.targets.set(id, target);
    this.scene.add(target.mesh);
    return target;
  }
```

Update `targets` map type to hold both kinds and fix `clearTargets`/`dispose` to also clear `moving`:

```typescript
  private readonly targets = new Map<string, Target | MovingTarget>();
```

```typescript
  clearTargets(): void {
    for (const target of this.targets.values()) {
      this.scene.remove(target.mesh);
      target.dispose();
    }
    this.targets.clear();
    this.moving.clear();
  }
```

In `dispose()`, after `this.unsubInput();` add `this.unsubFire();` and clear the callback sets:

```typescript
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubInput();
    this.unsubFire();
    this.clearTargets();
    this.frameCbs.clear();
    this.fireCbs.clear();
    for (const d of this.envDisposables) d.dispose();
    this.renderer.dispose();
  }
```

(`Target` must export its `mesh` accessibly to `MovingTarget` typing - both already expose `readonly mesh: Mesh`; the union `Target | MovingTarget` is structurally fine for `scene.remove`/`dispose`.)

- [ ] **Step 4: Run the tests + full typecheck**

Run: `npx vitest run tests/engine/arena.test.ts tests/engine/targets.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: clean (the contract widened in Task 5 is now fully implemented).

- [ ] **Step 5: Commit**

```bash
git add src/engine/arena.ts tests/engine/arena.test.ts
git commit -m "feat(engine): arena clock/tick, onFrame/onFire/view, spec-honoring spawnTarget

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `instruments/recording.ts` - shared trial recorder + fake scene

**Files:**
- Create: `src/instruments/recording.ts`
- Create: `tests/instruments/fake-scene.ts` (test helper - a scriptable `ArenaScene`)
- Test: `tests/instruments/recording.test.ts`

The DRY core every `run()` shell uses: subscribe to a scene's frames/fires, buffer them with the active target's bearing + angular radius, and expose pure helpers (`speedTrace`, `timeOnTarget`).

- [ ] **Step 1: Write the fake scene helper**

```typescript
// tests/instruments/fake-scene.ts
import type {
  AimSample,
  ArenaScene,
  Cm360,
  Degrees,
  Dpi,
  Ms,
  TargetHandle,
  TargetSpec,
} from '../../src/types';

/** A scriptable ArenaScene for testing instrument run() shells in Node. */
export class FakeScene implements ArenaScene {
  view_: [Degrees, Degrees] = [0, 0];
  now = 0;
  spawned: TargetSpec[] = [];
  cleared = 0;
  private frameCbs = new Set<(dt: Ms, now: Ms) => void>();
  private fireCbs = new Set<(now: Ms) => void>();
  private targets: FakeTarget[] = [];

  setSensitivity(_c: Cm360, _d: Dpi): void {}
  view(): [Degrees, Degrees] {
    return this.view_;
  }
  spawnTarget(spec: TargetSpec): TargetHandle {
    this.spawned.push(spec);
    const t = new FakeTarget(`t${this.spawned.length}`, [spec.yaw ?? 0, spec.pitch ?? 0], spec);
    this.targets.push(t);
    return t;
  }
  clearTargets(): void {
    this.cleared += 1;
    this.targets = [];
  }
  onAim(_cb: (s: AimSample, v: [Degrees, Degrees]) => void): () => void {
    return () => {};
  }
  onFrame(cb: (dt: Ms, now: Ms) => void): () => void {
    this.frameCbs.add(cb);
    return () => this.frameCbs.delete(cb);
  }
  onFire(cb: (now: Ms) => void): () => void {
    this.fireCbs.add(cb);
    return () => this.fireCbs.delete(cb);
  }

  // --- test drivers ---
  /** Set the current aim and advance the clock by `dt`, emitting one frame. */
  tick(dt: Ms, aim?: [Degrees, Degrees]): void {
    if (aim) this.view_ = aim;
    this.now += dt;
    for (const cb of [...this.frameCbs]) cb(dt, this.now);
  }
  /** Emit a fire event at the current clock. */
  fire(aim?: [Degrees, Degrees]): void {
    if (aim) this.view_ = aim;
    for (const cb of [...this.fireCbs]) cb(this.now);
  }
  /** Move the most-recently-spawned target's bearing (simulates a moving/relocated target). */
  moveTarget(bearing: [Degrees, Degrees], radiusDeg?: Degrees): void {
    const t = this.targets[this.targets.length - 1];
    if (t) t.set(bearing, radiusDeg);
  }
}

class FakeTarget implements TargetHandle {
  constructor(
    public readonly id: string,
    private b: [Degrees, Degrees],
    private spec: TargetSpec,
  ) {}
  set(b: [Degrees, Degrees], radiusDeg?: Degrees): void {
    this.b = b;
    if (radiusDeg !== undefined) this.r = radiusDeg;
  }
  private r = 2;
  bearing(): [Degrees, Degrees] {
    return this.b;
  }
  radiusDeg(): Degrees {
    return this.spec.worldRadius !== undefined ? this.r : this.r;
  }
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// tests/instruments/recording.test.ts
import { describe, it, expect } from 'vitest';
import { TrialRecorder, speedTrace, timeOnTarget } from '../../src/instruments/recording';
import { FakeScene } from './fake-scene';

describe('TrialRecorder', () => {
  it('buffers frames with the active target bearing + radius, and fire snapshots', () => {
    const scene = new FakeScene();
    const target = scene.spawnTarget({ kind: 'static', yaw: 10, pitch: 0, worldRadius: 0.6 });
    const rec = new TrialRecorder(scene, () => target);
    scene.tick(16, [0, 0]);
    scene.moveTarget([10, 0], 2);
    scene.tick(16, [5, 0]);
    scene.fire([10, 0]);
    const r = rec.recording();
    expect(r.frames).toHaveLength(2);
    expect(r.frames[1].aim).toEqual([5, 0]);
    expect(r.frames[1].target).toEqual([10, 0]);
    expect(r.fires).toHaveLength(1);
    expect(r.fires[0].aim).toEqual([10, 0]);
    rec.stop();
    scene.tick(16);
    expect(rec.recording().frames).toHaveLength(2); // stopped: no new frames
  });
});

describe('speedTrace', () => {
  it('is angular speed (deg/s) between consecutive frames', () => {
    const trace = speedTrace([
      { t: 0, aim: [0, 0], target: null, targetRadius: null },
      { t: 100, aim: [9, 0], target: null, targetRadius: null }, // 9° in 0.1s = 90 deg/s
    ]);
    expect(trace).toHaveLength(1);
    expect(trace[0].speed).toBeCloseTo(90, 4);
  });
});

describe('timeOnTarget', () => {
  it('is the fraction of frames whose aim is within the target radius', () => {
    const frames = [
      { t: 0, aim: [0, 0] as [number, number], target: [3, 0] as [number, number], targetRadius: 2 },
      { t: 16, aim: [2.5, 0] as [number, number], target: [3, 0] as [number, number], targetRadius: 2 },
      { t: 32, aim: [3, 0] as [number, number], target: [3, 0] as [number, number], targetRadius: 2 },
    ];
    expect(timeOnTarget(frames)).toBeCloseTo(2 / 3, 6); // frame 0 is 3° off (> 2); 1 and 2 within
  });
});
```

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/instruments/recording.ts
import type { ArenaScene, Degrees, Ms, TargetHandle } from '../types';
import { separation } from '../engine/targets';

export interface Frame {
  t: Ms;
  aim: [Degrees, Degrees];
  target: [Degrees, Degrees] | null;
  targetRadius: Degrees | null;
}
export interface FireSnap {
  t: Ms;
  aim: [Degrees, Degrees];
  target: [Degrees, Degrees] | null;
  targetRadius: Degrees | null;
}
export interface Recording {
  frames: Frame[];
  fires: FireSnap[];
}

/** Subscribes to a scene's frames + fires, buffering each with the active target's geometry. */
export class TrialRecorder {
  private readonly frames: Frame[] = [];
  private readonly fires: FireSnap[] = [];
  private readonly offFrame: () => void;
  private readonly offFire: () => void;

  constructor(scene: ArenaScene, currentTarget: () => TargetHandle | null) {
    const snap = (t: Ms): Frame => {
      const tgt = currentTarget();
      return {
        t,
        aim: scene.view(),
        target: tgt ? tgt.bearing() : null,
        targetRadius: tgt ? tgt.radiusDeg() : null,
      };
    };
    this.offFrame = scene.onFrame((_dt, now) => this.frames.push(snap(now)));
    this.offFire = scene.onFire((now) => this.fires.push(snap(now)));
  }

  stop(): void {
    this.offFrame();
    this.offFire();
  }

  recording(): Recording {
    return { frames: this.frames, fires: this.fires };
  }
}

/** Angular speed (deg/s) between consecutive frames. */
export function speedTrace(frames: readonly Frame[]): Array<{ t: Ms; speed: number }> {
  const out: Array<{ t: Ms; speed: number }> = [];
  for (let i = 1; i < frames.length; i++) {
    const dtSec = (frames[i]!.t - frames[i - 1]!.t) / 1000;
    if (dtSec <= 0) continue;
    out.push({ t: frames[i]!.t, speed: separation(frames[i - 1]!.aim, frames[i]!.aim) / dtSec });
  }
  return out;
}

/** Fraction of frames whose aim lies within the target's angular radius. */
export function timeOnTarget(frames: readonly Frame[]): number {
  let on = 0;
  let total = 0;
  for (const f of frames) {
    if (f.target === null || f.targetRadius === null) continue;
    total += 1;
    if (separation(f.aim, f.target) <= f.targetRadius) on += 1;
  }
  return total === 0 ? 0 : on / total;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/instruments/recording.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/instruments/recording.ts tests/instruments/recording.test.ts tests/instruments/fake-scene.ts
git commit -m "feat(instruments): shared TrialRecorder + speed/TOT helpers + fake scene

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `instruments/track.ts` - dragonfly + falcon (Kalman tracking)

**Files:**
- Create: `src/instruments/track.ts`
- Test: `tests/instruments/track.test.ts`

Pure analyzer (`analyzeTrack`) + `track` Instrument. Metrics: time-on-target, lead RMSE via the CV-Kalman lead point, predictive index (cross-correlation lag), jitter (high-pass aim-speed RMS), slip. Score is within-trial higher=better.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { analyzeTrack, track } from '../../src/instruments/track';
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

// Build a recording where the target moves smoothly and the aim follows it with a given lag (frames).
function tracking(lagFrames: number, jitterAmp = 0): Frame[] {
  const frames: Frame[] = [];
  const N = 240;
  const targetAt = (i: number): [number, number] => [10 * Math.sin(i * 0.05), 3 * Math.sin(i * 0.04)];
  for (let i = 0; i < N; i++) {
    const tgt = targetAt(i);
    const src = targetAt(Math.max(0, i - lagFrames));
    const jit = jitterAmp * Math.sin(i * 1.9); // ~high-frequency wobble
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

  it('flags reactive lag with a negative predictive index', () => {
    const laggy = analyzeTrack({ frames: tracking(8), fires: [] }, ctx());
    expect(laggy.raw.pi).toBeLessThan(0);
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

describe('track.run', () => {
  it('drives a moving target for the trial duration and resolves a scored result', async () => {
    const scene = new FakeScene();
    const p = track.run(ctx(), scene);
    // drive frames; aim follows target
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/instruments/track.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { ArenaScene, Degrees, InstrumentId, Ms, TrialContext, TrialResult } from '../types';
import { KalmanCV } from '../scoring/kalman';
import { speedTrace, timeOnTarget, type Frame, type Recording } from './recording';
import { separation } from '../engine/targets';

const ID: InstrumentId = 'track';
const DURATION_MS = 6000;
const LEAD_SEC = 0.15; // ~150 ms feed-forward lead (dragonfly/falcon latency band)
const FC_HZ = 4; // jitter cutoff: task motion below, tremor above

function rms(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x * x;
  return Math.sqrt(s / xs.length);
}

/** Lag (in samples) of peak cross-correlation between aim and target along an axis. >0 = aim trails. */
function bestLag(aim: readonly number[], target: readonly number[], maxLag: number): number {
  let best = 0;
  let bestScore = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let dot = 0;
    let n = 0;
    for (let i = 0; i < aim.length; i++) {
      const j = i - lag;
      if (j < 0 || j >= target.length) continue;
      dot += aim[i]! * target[j]!;
      n += 1;
    }
    if (n > 0) {
      const score = dot / n;
      if (score > bestScore) {
        bestScore = score;
        best = lag;
      }
    }
  }
  return best;
}

/** Pure tracking analysis over a recorded trial. */
export function analyzeTrack(rec: Recording, ctx: TrialContext): TrialResult {
  const frames = rec.frames.filter((f) => f.target !== null);
  const tot = timeOnTarget(frames);

  // Per-axis CV-Kalman on the TARGET bearing → lead point at LEAD_SEC.
  const kfYaw = new KalmanCV({ q: 50, r: 1 });
  const kfPitch = new KalmanCV({ q: 50, r: 1 });
  const leadErr: number[] = [];
  const aimYaw: number[] = [];
  const tgtYaw: number[] = [];
  const aimSpeeds: number[] = [];
  const slip: number[] = [];

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!;
    const tgt = f.target!;
    const dt = i === 0 ? 0.016 : Math.max(1e-3, (f.t - frames[i - 1]!.t) / 1000);
    kfYaw.predict(dt);
    kfYaw.update(tgt[0]);
    kfPitch.predict(dt);
    kfPitch.update(tgt[1]);
    const lead: [Degrees, Degrees] = [kfYaw.lead(LEAD_SEC), kfPitch.lead(LEAD_SEC)];
    leadErr.push(separation(f.aim, lead));
    aimYaw.push(f.aim[0]);
    tgtYaw.push(tgt[0]);
    if (i > 0) {
      const pf = frames[i - 1]!;
      const aimVel = separation(pf.aim, f.aim) / dt;
      const tgtVel = separation(pf.target!, tgt) / dt;
      aimSpeeds.push(aimVel);
      slip.push(aimVel - tgtVel);
    }
  }

  // Predictive index: −lag of peak cross-correlation (positive = leads, negative = trails).
  const lag = bestLag(aimYaw, tgtYaw, Math.min(20, frames.length - 1));
  const pi = -lag;

  // Jitter = RMS of the high-pass of aim speed (speed − EWMA-smoothed speed).
  const jitterResid: number[] = [];
  let lp = aimSpeeds[0] ?? 0;
  const alpha = Math.min(1, (2 * Math.PI * FC_HZ) / 60); // ~60fps reference
  for (const v of aimSpeeds) {
    lp = lp + alpha * (v - lp);
    jitterResid.push(v - lp);
  }
  const jitter = rms(jitterResid);
  const eLead = rms(leadErr);
  const slipRms = rms(slip);

  // Within-trial score (higher = better); Phase 4 normalizes across the cm/360 sweep.
  const score = tot - 0.02 * eLead - 0.01 * jitter - 0.01 * slipRms;

  return {
    instrument: ID,
    cm360: ctx.cm360,
    score,
    raw: { tot, eLead, pi, jitter, slip: slipRms, leadSec: LEAD_SEC },
    at: frames.length > 0 ? frames[frames.length - 1]!.t : 0,
  };
}

export const track = {
  id: ID,
  run(ctx: TrialContext, scene: ArenaScene): Promise<TrialResult> {
    scene.setSensitivity(ctx.cm360, ctx.dpi);
    const seed = Math.floor(ctx.rng() * 1e9);
    const handle = scene.spawnTarget({
      kind: 'moving',
      yaw: 0,
      pitch: 0,
      distance: 20,
      worldRadius: 0.6,
      motion: { yawAmp: 12, pitchAmp: 5, baseFreq: 0.5, seed },
    });
    const frames: Frame[] = [];
    return new Promise<TrialResult>((resolve) => {
      let elapsed = 0;
      const offFrame = scene.onFrame((dt, now) => {
        frames.push({
          t: now,
          aim: scene.view(),
          target: handle.bearing(),
          targetRadius: handle.radiusDeg(),
        });
        elapsed += dt;
        if (elapsed >= DURATION_MS) {
          offFrame();
          scene.clearTargets();
          resolve(analyzeTrack({ frames, fires: [] }, ctx));
        }
      });
    });
  },
};
```

> **Implementer note:** the `track.run` shell records frames directly (it needs the target handle's live bearing) rather than via `TrialRecorder` - that's fine, `TrialRecorder` is for the fire-driven instruments. Confirm the laggy-vs-good ordering holds; if `pi` sign is inverted, re-check the `bestLag` convention (positive lag = aim trails target → `pi = −lag < 0`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/instruments/track.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/instruments/track.ts tests/instruments/track.test.ts
git commit -m "feat(instruments): track - Kalman lead, predictive index, jitter, slip

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `instruments/flick.ts` - spider + raptor fovea (Fitts throughput)

**Files:**
- Create: `src/instruments/flick.ts`
- Test: `tests/instruments/flick.test.ts`

Pure analyzer (`analyzeFlick`) + `flick` Instrument. A sequence of (amplitude, width) conditions; per fire record MT + along-axis endpoint error; Fitts effective throughput is the primary score; sub-movement counts annotate the reach.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { analyzeFlick, flick, FLICK_CONDITIONS, type FlickTap } from '../../src/instruments/flick';
import type { TrialContext } from '../../src/types';
import { mulberry32 } from '../../src/stats/bootstrap';
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
    const e = (i % 2 === 0 ? 1 : -1) * errSd; // alternating ± → mean 0, SD ≈ errSd
    out.push({ amplitude: 20, width: 3, mt, errAlong: e, errCross: 0, nCorr: 0, hit: Math.abs(e) <= 1.5 });
  }
  return out;
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

  it('throws if a condition has too few taps to estimate spread', () => {
    expect(() => analyzeFlick([{ amplitude: 20, width: 3, mt: 400, errAlong: 0.5, errCross: 0, nCorr: 0, hit: true }], ctx()))
      .toThrow();
  });
});

describe('FLICK_CONDITIONS', () => {
  it('spans a grid of amplitudes and widths (ID range)', () => {
    expect(FLICK_CONDITIONS.length).toBeGreaterThanOrEqual(4);
  });
});

describe('flick.run', () => {
  it('presents targets, records fires, and resolves a scored result', async () => {
    const scene = new FakeScene();
    const p = flick.run(ctx(), scene);
    // For each presented target, tick a couple frames then fire roughly on target.
    for (let k = 0; k < 40; k++) {
      const spec = scene.spawned[scene.spawned.length - 1];
      const aim: [number, number] = [spec?.yaw ?? 0, spec?.pitch ?? 0];
      scene.tick(120, aim);
      scene.tick(120, aim);
      scene.fire(aim);
    }
    const r = await p;
    expect(r.instrument).toBe('flick');
    expect(scene.spawned.length).toBeGreaterThan(1);
    expect(Number.isFinite(r.score)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/instruments/flick.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type {
  ArenaScene,
  Degrees,
  FittsCondition,
  InstrumentId,
  Ms,
  Tap,
  TargetHandle,
  TrialContext,
  TrialResult,
} from '../types';
import { conditionThroughput, aggregateThroughput, type ConditionThroughput } from '../scoring/fitts';
import { segment } from '../scoring/submovement';
import { speedTrace, type Frame } from './recording';
import { separation } from '../engine/targets';

const ID: InstrumentId = 'flick';

/** A grid of (amplitude, width) conditions - low-ID big flicks → high-ID small locks. */
export const FLICK_CONDITIONS: FittsCondition[] = [
  { amplitude: 12, width: 3 },
  { amplitude: 12, width: 1.5 },
  { amplitude: 28, width: 3 },
  { amplitude: 28, width: 1.5 },
  { amplitude: 40, width: 2.2 },
];

export interface FlickTap {
  amplitude: Degrees;
  width: Degrees;
  mt: Ms;
  errAlong: Degrees;
  errCross: Degrees;
  nCorr: number;
  hit: boolean;
}

function key(c: FittsCondition): string {
  return `${c.amplitude}|${c.width}`;
}

/** Pure flick analysis: group taps by condition → effective throughput + correction/hit stats. */
export function analyzeFlick(taps: readonly FlickTap[], ctx: TrialContext): TrialResult {
  const byCond = new Map<string, FlickTap[]>();
  for (const t of taps) {
    const k = key({ amplitude: t.amplitude, width: t.width });
    const arr = byCond.get(k) ?? [];
    arr.push(t);
    byCond.set(k, arr);
  }
  const perCondition: ConditionThroughput[] = [];
  for (const arr of byCond.values()) {
    const condition: FittsCondition = { amplitude: arr[0]!.amplitude, width: arr[0]!.width };
    const fittsTaps: Tap[] = arr.map((t) => ({ mt: t.mt, endpointErrorAlongAxis: t.errAlong }));
    perCondition.push(conditionThroughput(fittsTaps, condition));
  }
  const throughput = aggregateThroughput(perCondition);
  const hitRate = taps.length === 0 ? 0 : taps.filter((t) => t.hit).length / taps.length;
  const nCorrMean = taps.length === 0 ? 0 : taps.reduce((s, t) => s + t.nCorr, 0) / taps.length;
  const mtMean = taps.length === 0 ? 0 : taps.reduce((s, t) => s + t.mt, 0) / taps.length;

  return {
    instrument: ID,
    cm360: ctx.cm360,
    score: throughput, // bits/s; higher = better. Phase 4 normalizes across the sweep.
    raw: { throughput, hitRate, nCorrMean, mtMean, conditions: perCondition.length },
    at: 0,
  };
}

const REPS = 3; // repetitions per condition

export const flick = {
  id: ID,
  run(ctx: TrialContext, scene: ArenaScene): Promise<TrialResult> {
    scene.setSensitivity(ctx.cm360, ctx.dpi);
    // Build the randomized presentation order (deterministic from ctx.rng).
    const order: FittsCondition[] = [];
    for (let r = 0; r < REPS; r++) for (const c of FLICK_CONDITIONS) order.push(c);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.rng() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }

    const taps: FlickTap[] = [];
    let idx = 0;
    let handle: TargetHandle | null = null;
    let presentedAt = 0;
    let prevAim: [Degrees, Degrees] = [0, 0];
    let reachFrames: Frame[] = [];

    return new Promise<TrialResult>((resolve) => {
      const present = (now: Ms): void => {
        const c = order[idx]!;
        // Place the target `amplitude` degrees from current view in a rng direction.
        const view = scene.view();
        const dir = ctx.rng() * Math.PI * 2;
        const yaw = view[0] + c.amplitude * Math.cos(dir);
        const pitch = Math.max(-40, Math.min(40, view[1] + c.amplitude * Math.sin(dir)));
        const worldRadius = 20 * Math.tan((c.width / 2) * (Math.PI / 180)); // W = angular diameter at d=20
        handle = scene.spawnTarget({ kind: 'static', yaw, pitch, distance: 20, worldRadius });
        presentedAt = now;
        prevAim = view;
        reachFrames = [];
      };

      const offFrame = scene.onFrame((_dt, now) => {
        if (handle) {
          reachFrames.push({ t: now, aim: scene.view(), target: handle.bearing(), targetRadius: handle.radiusDeg() });
        }
        prevAim = scene.view();
      });

      const offFire = scene.onFire((now) => {
        if (!handle) return;
        const c = order[idx]!;
        const aim = scene.view();
        const tgt = handle.bearing();
        // Decompose endpoint error into along/cross relative to the presentation axis.
        const along = separation(aim, [tgt[0], aim[1]]) * Math.sign(aim[0] - tgt[0] || 1);
        const radial = separation(aim, tgt);
        const errAlong = radial * (aim[0] >= tgt[0] ? 1 : -1); // signed radial proxy
        const errCross = Math.sqrt(Math.max(0, radial * radial - errAlong * errAlong));
        const sub = (() => {
          const tr = speedTrace(reachFrames);
          try {
            return segment(tr.map((s) => ({ t: s.t, speed: s.speed })), { onsetThresh: 20 }).nCorr;
          } catch {
            return 0;
          }
        })();
        taps.push({
          amplitude: c.amplitude,
          width: c.width,
          mt: now - presentedAt,
          errAlong,
          errCross,
          nCorr: sub,
          hit: radial <= handle.radiusDeg(),
        });
        scene.clearTargets();
        handle = null;
        idx += 1;
        if (idx >= order.length) {
          offFrame();
          offFire();
          const result = analyzeFlick(taps, ctx);
          resolve({ ...result, at: now });
        } else {
          present(now);
        }
      });

      present(0);
    });
  },
};
```

> **Implementer note:** the along/cross error split in `run()` is a runtime proxy (the fake-scene tests fire on-target so errors ≈ 0); the *analyzer* is what's rigorously tested via `FlickTap`. Keep the analyzer pure and well-tested; the `run()` split only needs to be reasonable. Drop the unused `along`/`prevAim` if the reviewer flags dead code - keep `errAlong`/`errCross`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/instruments/flick.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/instruments/flick.ts tests/instruments/flick.test.ts
git commit -m "feat(instruments): flick - Fitts effective throughput across an A×W grid

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: `instruments/calibrate.ts` - archerfish (bias/variance)

**Files:**
- Create: `src/instruments/calibrate.ts`
- Test: `tests/instruments/calibrate.test.ts`

Pure analyzer (`analyzeCalibrate`) + `calibrate` Instrument. A burst of shots → bias/gain/σ_R/MSE; EWMA bias; calibration cost. The headline cm/360 signal is **gain** (g=1 ⇒ bias-zero sensitivity).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { analyzeCalibrate, calibrate, type CalibrateShot } from '../../src/instruments/calibrate';
import type { TrialContext } from '../../src/types';
import { mulberry32 } from '../../src/stats/bootstrap';
import { FakeScene } from './fake-scene';

const ctx = (): TrialContext => ({
  cm360: 34,
  dpi: 800,
  rng: mulberry32(11),
  profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
});

function shots(biasRadial: number, spread: number, n = 8): CalibrateShot[] {
  const out: CalibrateShot[] = [];
  for (let i = 0; i < n; i++) {
    const s = (i % 2 === 0 ? 1 : -1) * spread;
    out.push({ errAlong: biasRadial + s, errCross: 0, required: 15, mt: 500 });
  }
  return out;
}

describe('analyzeCalibrate', () => {
  it('recovers a systematic overshoot as gain > 1', () => {
    const r = analyzeCalibrate(shots(3, 0.5), ctx());
    expect(r.raw.gain).toBeGreaterThan(1);
    expect(r.raw.biasRadial).toBeCloseTo(3, 1);
  });

  it('undershoot reads as gain < 1', () => {
    const r = analyzeCalibrate(shots(-3, 0.5), ctx());
    expect(r.raw.gain).toBeLessThan(1);
  });

  it('lower bias + spread scores higher', () => {
    const clean = analyzeCalibrate(shots(0.2, 0.3), ctx());
    const messy = analyzeCalibrate(shots(3, 1.5), ctx());
    expect(clean.score).toBeGreaterThan(messy.score);
    expect(clean.instrument).toBe('calibrate');
  });

  it('score is in (0, 1] and finite', () => {
    const r = analyzeCalibrate(shots(1, 1), ctx());
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });
});

describe('calibrate.run', () => {
  it('fires a burst and resolves a scored result', async () => {
    const scene = new FakeScene();
    const p = calibrate.run(ctx(), scene);
    for (let i = 0; i < 30; i++) {
      const spec = scene.spawned[scene.spawned.length - 1];
      const aim: [number, number] = [(spec?.yaw ?? 0) + 1, spec?.pitch ?? 0]; // small consistent overshoot
      scene.tick(200, aim);
      scene.fire(aim);
    }
    const r = await p;
    expect(r.instrument).toBe('calibrate');
    expect(Number.isFinite(r.raw.gain)).toBe(true);
    expect(Number.isFinite(r.score)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/instruments/calibrate.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { ArenaScene, Degrees, InstrumentId, Ms, Shot, TargetHandle, TrialContext, TrialResult } from '../types';
import { decompose, ewmaBias, calibrationCost } from '../scoring/bias-variance';
import { separation } from '../engine/targets';

const ID: InstrumentId = 'calibrate';
const SHOTS = 12;
const T_REF: Ms = 500;

export interface CalibrateShot {
  errAlong: Degrees;
  errCross: Degrees;
  required: Degrees;
  mt: Ms;
}

/** Pure calibration analysis: bias/variance decomposition + EWMA + calibration cost. */
export function analyzeCalibrate(shots: readonly CalibrateShot[], ctx: TrialContext): TrialResult {
  const asShots: Shot[] = shots.map((s) => ({ error: [s.errAlong, s.errCross], required: s.required }));
  const d = decompose(asShots);
  const ewma = ewmaBias(asShots, 0.15);
  const meanMt = shots.length === 0 ? T_REF : shots.reduce((s, x) => s + x.mt, 0) / shots.length;
  const cost = calibrationCost(d, meanMt, T_REF);
  const biasMag = Math.hypot(d.bias[0], d.bias[1]);

  return {
    instrument: ID,
    cm360: ctx.cm360,
    score: 1 / (1 + cost), // (0,1], higher = better. Phase 4 finds where gain crosses 1.
    raw: {
      biasRadial: d.bias[0],
      biasCross: d.bias[1],
      biasMag,
      gain: d.gain,
      sigmaR: d.sigmaR,
      mse: d.mse,
      ewmaRadial: ewma[0],
      cost,
    },
    at: 0,
  };
}

export const calibrate = {
  id: ID,
  run(ctx: TrialContext, scene: ArenaScene): Promise<TrialResult> {
    scene.setSensitivity(ctx.cm360, ctx.dpi);
    const shots: CalibrateShot[] = [];
    let handle: TargetHandle | null = null;
    let presentedAt = 0;

    const present = (now: Ms): void => {
      const yaw = (ctx.rng() * 2 - 1) * 18;
      const pitch = (ctx.rng() * 2 - 1) * 9;
      handle = scene.spawnTarget({ kind: 'static', yaw, pitch, distance: 20, worldRadius: 0.6 });
      presentedAt = now;
    };

    return new Promise<TrialResult>((resolve) => {
      const offFire = scene.onFire((now) => {
        if (!handle) return;
        const aim = scene.view();
        const tgt = handle.bearing();
        const radial = separation(aim, tgt);
        const required = separation([0, 0], tgt) || 1;
        shots.push({
          errAlong: radial * (aim[0] >= tgt[0] ? 1 : -1),
          errCross: 0,
          required,
          mt: now - presentedAt,
        });
        scene.clearTargets();
        handle = null;
        if (shots.length >= SHOTS) {
          offFire();
          resolve({ ...analyzeCalibrate(shots, ctx), at: now });
        } else {
          present(now);
        }
      });
      present(0);
    });
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/instruments/calibrate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/instruments/calibrate.ts tests/instruments/calibrate.test.ts
git commit -m "feat(instruments): calibrate - archerfish bias/variance + gain estimator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: `instruments/strike.ts` - mantis shrimp (speed pole)

**Files:**
- Create: `src/instruments/strike.ts`
- Test: `tests/instruments/strike.test.ts`

Pure analyzer (`analyzeStrike`) + `strike` Instrument. Fastest shot: reaction `t_R`, strike `t_S`, `v_peak`, endpoint scatter `σ_θ`, hit rate `H`; TTK = mean(t_R + t_S). Score is a speed↔accuracy blend weighted by `profile.speedAccuracy`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { analyzeStrike, strike, type StrikeShot } from '../../src/instruments/strike';
import type { TrialContext } from '../../src/types';
import { mulberry32 } from '../../src/stats/bootstrap';
import { FakeScene } from './fake-scene';

const ctx = (sa = 0.5): TrialContext => ({
  cm360: 34,
  dpi: 800,
  rng: mulberry32(13),
  profile: { speedAccuracy: sa, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
});

function strikes(ttk: number, scatter: number, hitRate: number, n = 8): StrikeShot[] {
  const out: StrikeShot[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      tR: ttk * 0.6,
      tS: ttk * 0.4,
      vPeak: 800,
      endpointError: (i % 2 === 0 ? 1 : -1) * scatter,
      hit: i / n < hitRate,
    });
  }
  return out;
}

describe('analyzeStrike', () => {
  it('faster TTK at equal accuracy scores higher (speed-leaning profile)', () => {
    const slow = analyzeStrike(strikes(500, 1, 1), ctx(0.8));
    const fast = analyzeStrike(strikes(250, 1, 1), ctx(0.8));
    expect(fast.raw.ttkMs).toBeLessThan(slow.raw.ttkMs);
    expect(fast.score).toBeGreaterThan(slow.score);
  });

  it('with an accuracy-leaning profile, hit rate dominates', () => {
    const accurateSlow = analyzeStrike(strikes(500, 0.5, 1), ctx(0.0));
    const sloppyFast = analyzeStrike(strikes(250, 3, 0.4), ctx(0.0));
    expect(accurateSlow.score).toBeGreaterThan(sloppyFast.score);
  });

  it('reports scatter (σ_θ), hit rate, and instrument id', () => {
    const r = analyzeStrike(strikes(300, 2, 0.75), ctx());
    expect(r.instrument).toBe('strike');
    expect(r.raw.sigmaTheta).toBeGreaterThan(0);
    expect(r.raw.hitRate).toBeCloseTo(0.75, 6);
    expect(Number.isFinite(r.score)).toBe(true);
  });
});

describe('strike.run', () => {
  it('drives fast shots and resolves a scored result', async () => {
    const scene = new FakeScene();
    const p = strike.run(ctx(), scene);
    for (let i = 0; i < 20; i++) {
      const spec = scene.spawned[scene.spawned.length - 1];
      const aim: [number, number] = [spec?.yaw ?? 0, spec?.pitch ?? 0];
      scene.tick(60, [0, 0]);
      scene.tick(60, aim);
      scene.fire(aim);
    }
    const r = await p;
    expect(r.instrument).toBe('strike');
    expect(Number.isFinite(r.raw.ttkMs)).toBe(true);
    expect(Number.isFinite(r.score)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/instruments/strike.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { ArenaScene, Degrees, InstrumentId, Ms, TargetHandle, TrialContext, TrialResult } from '../types';
import { segment } from '../scoring/submovement';
import { speedTrace, type Frame } from './recording';
import { separation } from '../engine/targets';

const ID: InstrumentId = 'strike';
const SHOTS = 10;

export interface StrikeShot {
  tR: Ms; // reaction/commit: target onset → movement onset
  tS: Ms; // ballistic strike: onset → fire
  vPeak: number; // peak angular speed (deg/s)
  endpointError: Degrees; // signed scatter about the mean
  hit: boolean;
}

function sampleStd(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  let ss = 0;
  for (const x of xs) ss += (x - m) * (x - m);
  return Math.sqrt(ss / (xs.length - 1));
}

/** Pure strike analysis: TTK operating point + scatter, scored by the speed/accuracy weight. */
export function analyzeStrike(shots: readonly StrikeShot[], ctx: TrialContext): TrialResult {
  if (shots.length === 0) throw new RangeError('analyzeStrike: no shots');
  const tR = shots.reduce((s, x) => s + x.tR, 0) / shots.length;
  const tS = shots.reduce((s, x) => s + x.tS, 0) / shots.length;
  const vPeak = shots.reduce((s, x) => s + x.vPeak, 0) / shots.length;
  const ttkMs = tR + tS;
  const sigmaTheta = sampleStd(shots.map((s) => s.endpointError));
  const hitRate = shots.filter((s) => s.hit).length / shots.length;

  // Speed↔accuracy blend: w = speedAccuracy (1 = pure speed, 0 = pure accuracy).
  const w = Math.max(0, Math.min(1, ctx.profile.speedAccuracy));
  const ttkSec = Math.max(1e-3, ttkMs / 1000);
  const speedTerm = 1 / ttkSec; // strikes per second
  const score = Math.pow(speedTerm, w) * Math.pow(Math.max(0, hitRate), 1 - w);

  return {
    instrument: ID,
    cm360: ctx.cm360,
    score,
    raw: { ttkMs, tR, tS, vPeak, sigmaTheta, hitRate },
    at: 0,
  };
}

export const strike = {
  id: ID,
  run(ctx: TrialContext, scene: ArenaScene): Promise<TrialResult> {
    scene.setSensitivity(ctx.cm360, ctx.dpi);
    const shots: StrikeShot[] = [];
    let handle: TargetHandle | null = null;
    let presentedAt = 0;
    let frames: Frame[] = [];

    const present = (now: Ms): void => {
      const yaw = (ctx.rng() * 2 - 1) * 20;
      const pitch = (ctx.rng() * 2 - 1) * 10;
      handle = scene.spawnTarget({ kind: 'static', yaw, pitch, distance: 20, worldRadius: 0.7 });
      presentedAt = now;
      frames = [];
    };

    return new Promise<TrialResult>((resolve) => {
      const offFrame = scene.onFrame((_dt, now) => {
        if (handle) frames.push({ t: now, aim: scene.view(), target: handle.bearing(), targetRadius: handle.radiusDeg() });
      });
      const offFire = scene.onFire((now) => {
        if (!handle) return;
        const aim = scene.view();
        const tgt = handle.bearing();
        const radial = separation(aim, tgt);
        const tr = speedTrace(frames).map((s) => ({ t: s.t, speed: s.speed }));
        let onsetTime = presentedAt;
        let vPeak = 0;
        try {
          const seg = segment(tr, { onsetThresh: 20, cueTime: presentedAt });
          onsetTime = seg.onsetTime;
          vPeak = seg.vPeak;
        } catch {
          // no movement detected (instant fire) - reaction = full interval
        }
        shots.push({
          tR: onsetTime - presentedAt,
          tS: now - onsetTime,
          vPeak,
          endpointError: radial,
          hit: radial <= handle.radiusDeg(),
        });
        scene.clearTargets();
        handle = null;
        if (shots.length >= SHOTS) {
          offFrame();
          offFire();
          // Re-center endpointError about its mean so σ_θ is a scatter, not a bias.
          const mean = shots.reduce((s, x) => s + x.endpointError, 0) / shots.length;
          const centered = shots.map((s) => ({ ...s, endpointError: s.endpointError - mean }));
          resolve({ ...analyzeStrike(centered, ctx), at: now });
        } else {
          present(now);
        }
      });
      present(0);
    });
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/instruments/strike.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/instruments/strike.ts tests/instruments/strike.test.ts
git commit -m "feat(instruments): strike - mantis-shrimp speed pole (TTK operating point)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: `instruments/registry.ts` - InstrumentId → Instrument

**Files:**
- Create: `src/instruments/registry.ts`
- Test: `tests/instruments/registry.test.ts`

The lookup the Phase-4 session controller uses to fetch an instrument by id.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { INSTRUMENTS, getInstrument } from '../../src/instruments/registry';
import type { InstrumentId } from '../../src/types';

describe('instrument registry', () => {
  const ids: InstrumentId[] = ['track', 'flick', 'calibrate', 'strike'];

  it('contains all four instruments, keyed by their own id', () => {
    for (const id of ids) {
      expect(INSTRUMENTS[id]).toBeDefined();
      expect(INSTRUMENTS[id].id).toBe(id);
      expect(typeof INSTRUMENTS[id].run).toBe('function');
    }
    expect(Object.keys(INSTRUMENTS)).toHaveLength(4);
  });

  it('getInstrument returns the matching instrument', () => {
    expect(getInstrument('flick').id).toBe('flick');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/instruments/registry.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { Instrument, InstrumentId } from '../types';
import { track } from './track';
import { flick } from './flick';
import { calibrate } from './calibrate';
import { strike } from './strike';

/** All instruments keyed by id. Phase 4's session controller dispatches through this. */
export const INSTRUMENTS: Record<InstrumentId, Instrument> = {
  track,
  flick,
  calibrate,
  strike,
};

export function getInstrument(id: InstrumentId): Instrument {
  return INSTRUMENTS[id];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/instruments/registry.test.ts`
Expected: PASS. Then run the full suite + typecheck: `npx vitest run && npx tsc --noEmit` - all green.

- [ ] **Step 5: Commit**

```bash
git add src/instruments/registry.ts tests/instruments/registry.test.ts
git commit -m "feat(instruments): registry (InstrumentId → Instrument)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Wire fire events + run an instrument in the browser; runtime-verify

**Files:**
- Modify: `src/input/pointer-lock.ts` (add `onFire`)
- Modify: `src/dev/arena-harness.ts` (RAF→`tick`, click→fire, run an instrument, show the result)
- Runtime check (Playwright), no committed test file

Close the loop: the harness drives `arena.tick(dt)` each RAF frame, routes locked clicks to `onFire`, and can run an instrument end-to-end, surfacing the `TrialResult` in the HUD.

- [ ] **Step 1: Add `onFire` to the pointer-lock controller**

In `src/input/pointer-lock.ts`, add to the `PointerLockController` interface:

```typescript
  /** Subscribe to fire (primary-button) events while locked. Returns an unsubscribe fn. */
  onFire(cb: () => void): () => void;
```

In `createPointerLock`, add a fire-callback set + a `mousedown` listener gated on lock, and return `onFire`:

```typescript
  const fireCbs = new Set<() => void>();
  const onMouseDown = (ev: MouseEvent): void => {
    if (!locked || ev.button !== 0) return;
    for (const cb of fireCbs) cb();
  };
  document.addEventListener('mousedown', onMouseDown);
```

Add to the returned object:

```typescript
    onFire(cb): () => void {
      fireCbs.add(cb);
      return () => {
        fireCbs.delete(cb);
      };
    },
```

And in `dispose()`, remove the listener + clear the set:

```typescript
      document.removeEventListener('mousedown', onMouseDown);
      fireCbs.clear();
```

- [ ] **Step 2: Drive `tick` + fire + an instrument run in the harness**

In `src/dev/arena-harness.ts`:

1. The composite `input` object should forward `onFire` from the pointer controller:

```typescript
  const input: InputSource = {
    onSample(cb) {
      const off = pointer.onSample(cb);
      manual.add(cb);
      return () => {
        off();
        manual.delete(cb);
      };
    },
    onFire(cb) {
      return pointer.onFire(cb);
    },
  };
```

2. The RAF loop should advance the arena clock with real dt:

```typescript
  let raf = 0;
  let last = 0;
  const loop = (ts: number): void => {
    const dt = last === 0 ? 16 : ts - last;
    last = ts;
    arena.tick(dt);
    arena.render();
    refreshHud();
    raf = window.requestAnimationFrame(loop);
  };
  raf = window.requestAnimationFrame(loop);
```

3. Expose an instrument runner on `window.__arenaDebug` (and a synthetic fire) for runtime verification:

```typescript
  // inside __arenaDebug:
    fire() {
      // synthetic fire for headless verification
      for (const cb of fireCbsForDebug) cb();
    },
    async runInstrument(id: InstrumentId) {
      const { getInstrument } = await import('../instruments/registry');
      arena.clearTargets();
      return getInstrument(id).run(
        { cm360: CM360, dpi: DPI, rng: mulberry32(42), profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } } },
        arena,
      );
    },
```

To make synthetic fire work alongside the real pointer, register a debug fire set the same way `manual` works for samples: add `const fireCbsForDebug = new Set<() => void>();`, include it in `input.onFire` (subscribe both `pointer.onFire(cb)` and `fireCbsForDebug.add(cb)`), and update the `ArenaDebug` interface with `fire(): void` and `runInstrument(id: InstrumentId): Promise<TrialResult>`. Import `InstrumentId`, `TrialResult` types.

> **Implementer note:** keep the existing accel-check keys and HUD. The instrument run is a dev affordance; Phase 5's session view replaces it. Ensure `npx tsc --noEmit` stays clean and the existing `#arena` mouse-look still works (don't regress Phase 2).

- [ ] **Step 3: Build + runtime-verify in Chromium**

Run: `npm run build` (expect: `tsc --noEmit` clean + vite build succeeds).
Then start the dev server and verify with Playwright (the Phase-2 T9 pattern):

```bash
npm run dev &
```

Using the Playwright MCP: navigate to `http://localhost:5173/#arena`, then in the page evaluate a synthetic trial:

```js
// drive a flick trial headlessly: feed a few samples + fires via the debug API
const dbg = window.__arenaDebug;
const p = dbg.runInstrument('strike');
// emulate frames+fires by nudging aim and firing a handful of times
for (let i = 0; i < 12; i++) { dbg.feed(50, 0); dbg.fire(); }
const result = await p;     // { instrument:'strike', score, raw, at }
```

**Expected:** `runInstrument` resolves to a `TrialResult` with `instrument:'strike'`, a finite `score`, and a populated `raw`. Capture a screenshot of the HUD showing lock + a target. (A favicon 404 in the console is benign, as in Phase 2.)

- [ ] **Step 4: Commit**

```bash
git add src/input/pointer-lock.ts src/dev/arena-harness.ts
git commit -m "feat(engine): route locked clicks to onFire; run instruments in the dev harness

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage (§4 instruments, §5.1 scorer, §8 module table):**
- §4.1 track → T2 (Kalman) + T8 (TOT, lead RMSE, PI, jitter, slip). ✓
- §4.2 flick → T1 (Fitts) + T4 (submovement) + T9 (A×W grid, throughput, N_corr, hit rate). ✓
- §4.3 calibrate → T3 (bias/variance, gain, EWMA, cost) + T10. ✓
- §4.4 strike → T4 (submovement onset/vPeak) + T11 (t_R, t_S, σ_θ, H, TTK, speed/accuracy weight). ✓
- §5.1 scorer (Fitts effective throughput + Kalman innovation) → T1, T2. ✓
- §8 `scoring/` four files → T1–T4; `instruments/` five files (track/flick/calibrate/strike/registry) → T7 (shared recorder) + T8–T12. ✓
- Engine support the instruments need (moving targets, frame clock, fire) → T5, T6, T13. ✓
- Deliverable "each of the 4 instruments runs a trial in the arena and returns a scored TrialResult; scorers unit-tested" → T8–T11 run() shells + T13 runtime proof; T1–T4 scorer unit tests. ✓

**2. Placeholder scan:** every code step contains complete, runnable code (implementations + full test bodies). No TBD/TODO. The two acknowledged proxies (flick along/cross split, calibrate radial sign) are explicitly flagged as runtime proxies whose *rigorous* testing lives in the pure analyzers - not placeholders.

**3. Type consistency (against `src/types.ts`):**
- `Tap { mt; endpointErrorAlongAxis }` - used by T1 `conditionThroughput`. ✓
- `Shot { error:[Degrees,Degrees]; required }` - used by T3 `decompose`. ✓
- `FittsCondition { amplitude; width }` - T1, T9. ✓
- `Instrument { id; run(ctx, scene): Promise<TrialResult> }` - T8–T12 `track/flick/calibrate/strike` objects match (`id` + `run`). ✓
- `TrialResult { instrument; cm360; score; raw: Record<string,number>; at }` - every analyzer returns exactly these; `raw` holds only numbers (vectors flattened). ✓
- `TrialContext { cm360; dpi; rng; profile }` and `Profile { speedAccuracy; instrumentWeights }` - used in T8–T11. ✓
- `ArenaScene` extended (onFrame/onFire/view) in T5, implemented in T6, consumed by T7–T11, satisfied by `FakeScene` in tests. ✓
- `TargetSpec` extended (yaw/pitch/distance/worldRadius/motion + `TargetMotion`) in T5, honored by `spawnTarget` in T6. ✓
- Method names stable across tasks: `conditionThroughput`/`aggregateThroughput` (T1, T9), `KalmanCV.predict/update/lead/pos/vel` (T2, T8), `decompose`/`ewmaBias`/`calibrationCost` (T3, T10), `segment` (T4, T9, T11), `separation`/`motionOffset`/`MovingTarget` (T5, T6, T7), `TrialRecorder`/`speedTrace`/`timeOnTarget` (T7, T8). ✓

**4. Sequencing:** the only cross-task hazard is the `ArenaScene` widening in T5 vs its implementation in T6 - explicitly called out (run the targets test in isolation in T5; full `tsc` restored green at the end of T6). Instruments (T8–T12) depend only on the pure scorers (T1–T4) + the recorder/fake-scene (T7) and the extended scene (T5–T6), all earlier. T13 depends on everything.

**Forward notes for Phase 4 (optimizer + session):**
- Each instrument's `score` is within-trial only; the session controller must normalize per-instrument across the cm/360 sweep before fitting the psychometric curve (it has all trials).
- The cm/360-sensitive headline estimators to feed the search: flick `throughput` (peak), calibrate `gain` (find where it crosses 1 → bias-zero `s_b`), track `tot`/`slip`/`jitter` (joint min), strike `(TTK, hitRate)` operating point weighted by `profile.speedAccuracy`.
- `KalmanCV` `q`/`r` and the track `LEAD_SEC`, jitter `FC_HZ`, and instrument durations are tuned constants - expose them if Phase 4 wants per-profile adaptation.
