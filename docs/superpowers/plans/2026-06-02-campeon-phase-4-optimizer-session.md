# campeón Phase 4 - Optimizer + Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the search-and-report engine - a Gaussian-process Bayesian optimizer over `ln(cm/360)`, a bandit fallback, and a session controller that runs ~15–30 interleaved instrument trials, blends their scores into one objective, and emits a `Report` (optimal cm/360 + 90% CI + curve) that converges on synthetic players.

**Architecture:** A pure, unit-tested `optimizer/` layer beside the existing `scoring/` and `stats/`. Five focused files: `gp.ts` (exact Matérn-5/2 GP, dependency-free), `bayesopt.ts` (EI/UCB acquisition + the BO `SearchEngine`), `bandit.ts` (UCB1 fallback `SearchEngine`), `objective.ts` (per-instrument z-score blend → `Observation[]`), `session-controller.ts` (cold-start → suggest → run → score → fit → `Report`). The controller depends only on the `SearchEngine`, `Instrument`, and `ArenaScene` interfaces, so it is tested by injecting synthetic instruments + a `FakeScene`. The final report reuses Phase-1 `stats/psychometric` (peak fit) and `stats/bootstrap` (CI).

**Tech Stack:** TypeScript (strict, `verbatimModuleSyntax`, `exactOptionalPropertyTypes`) · Vitest · no new dependencies (GP linear algebra is hand-rolled Cholesky).

---

## Conventions (apply to EVERY task)

- **Tests:** always `import { describe, it, expect } from 'vitest';` - never rely on globals.
- **Type imports:** `verbatimModuleSyntax` is on - import types with `import type { … }` (or inline `import { value, type Type } from …`). A plain `import` of a type-only symbol will fail the build.
- **No `any`** in the core. `noUncheckedIndexedAccess` is **off**, so `arr[i]` is the element type - do not add redundant `!` on plain indexing (match `stats/psychometric.ts` style).
- **Type-check before every commit:** `npx tsc --noEmit` must pass (zero errors).
- **Full suite green before every commit:** `npm test` must pass.
- **Commit message:** one feature per commit, and the body MUST end with this trailer verbatim:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
  Form used throughout: `git commit -m "<subject>" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`
- **Test dirs:** create `tests/optimizer/` (the first `Write` to a path there creates it).
- **No `types.ts` changes this phase** - `Observation`, `SearchEngine`, `Report` already exist and are sufficient. All other types (`GpParams`, `BoConfig`, `SessionConfig`, …) are module-local.

---

## File structure (this phase)

```
src/optimizer/
├─ gp.ts                 # Matérn-5/2 kernel + Cholesky + exact GP posterior (mean, variance)
├─ bayesopt.ts           # normPdf/normCdf, expectedImprovement, ucb, makeBo() SearchEngine
├─ bandit.ts             # makeUcb1Bandit() SearchEngine (the "simple mode" fallback)
├─ objective.ts          # trialsToObservations(): per-instrument z-score blend → Observation[]
└─ session-controller.ts # finalizeReport() + runSession(): the full BO loop → Report
src/dev/arena-harness.ts # MODIFY: add __arenaDebug.runSession() for the Chromium runtime proof
tests/optimizer/
├─ gp.test.ts
├─ bayesopt.test.ts
├─ bandit.test.ts
├─ objective.test.ts
└─ session-controller.test.ts
```

**Layering note:** `objective.ts` imports `mean`/`sampleStd` from `../scoring/stats` (leaf-pure, already shared by the instruments) - intentional DRY reuse, not a layering inversion.

---

### Task 1: `optimizer/gp.ts` - exact Gaussian process (Matérn-5/2)

**Files:**
- Create: `src/optimizer/gp.ts`
- Test: `tests/optimizer/gp.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/optimizer/gp.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { GP, matern52, type GpParams } from '../../src/optimizer/gp';
import type { Observation } from '../../src/types';

const params: GpParams = { signalVar: 1, lengthScale: 0.5, noiseVar: 1e-6 };

describe('matern52', () => {
  it('equals signalVar at zero distance and decays monotonically toward 0', () => {
    expect(matern52(2, 2, 1, 0.5)).toBeCloseTo(1, 12);
    const near = matern52(2, 2.1, 1, 0.5);
    const far = matern52(2, 3, 1, 0.5);
    expect(near).toBeLessThan(1);
    expect(far).toBeLessThan(near);
    expect(far).toBeGreaterThan(0);
  });
});

describe('GP regression', () => {
  it('interpolates training points when noise is tiny', () => {
    const obs: Observation[] = [{ x: 0, y: 1 }, { x: 1, y: -2 }, { x: 2, y: 0.5 }];
    const gp = new GP(params, obs);
    for (const o of obs) expect(gp.predict(o.x).mean).toBeCloseTo(o.y, 3);
  });

  it('reverts to the prior mean and full signal variance far from data', () => {
    const obs: Observation[] = [{ x: 0, y: 5 }, { x: 0.2, y: 5 }];
    const gp = new GP(params, obs);
    const far = gp.predict(100);
    expect(far.mean).toBeCloseTo(5, 6);
    expect(far.variance).toBeCloseTo(params.signalVar, 6);
  });

  it('variance is ~0 at a low-noise training point and grows between points', () => {
    const obs: Observation[] = [{ x: 0, y: 0 }, { x: 2, y: 0 }];
    const gp = new GP(params, obs);
    expect(gp.predict(0).variance).toBeLessThan(1e-3);
    expect(gp.predict(1).variance).toBeGreaterThan(gp.predict(0).variance);
  });

  it('empty history returns the prior', () => {
    const gp = new GP(params, []);
    expect(gp.predict(3)).toEqual({ mean: 0, variance: params.signalVar });
  });

  it('handles replicated x via the noise nugget (no singular matrix)', () => {
    const noisy: GpParams = { signalVar: 1, lengthScale: 0.5, noiseVar: 0.1 };
    const obs: Observation[] = [{ x: 1, y: 0 }, { x: 1, y: 0.4 }, { x: 2, y: -1 }];
    const gp = new GP(noisy, obs);
    expect(Number.isFinite(gp.predict(1).mean)).toBe(true);
    expect(gp.predict(1).variance).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/optimizer/gp.test.ts`
Expected: FAIL - `Cannot find module '../../src/optimizer/gp'`.

- [ ] **Step 3: Write the implementation**

Create `src/optimizer/gp.ts`:

```typescript
import type { Observation } from '../types';

/** Matérn-5/2 + exact GP regression in 1-D (here x = ln cm/360). Dependency-free. */

export interface GpParams {
  /** Signal variance σ_f² (prior amplitude). */
  signalVar: number;
  /** Length scale ℓ in x-units. */
  lengthScale: number;
  /** Default observation-noise variance σ_n² (nugget); per-point `Observation.noise` overrides it. */
  noiseVar: number;
}

export interface GpPosterior { mean: number; variance: number; }

const SQRT5 = Math.sqrt(5);

/** Matérn-5/2 covariance between two scalar inputs: σ²(1 + s + s²/3)e^−s, s = √5·|a−b|/ℓ. */
export function matern52(a: number, b: number, signalVar: number, lengthScale: number): number {
  const r = Math.abs(a - b);
  const s = (SQRT5 * r) / lengthScale;
  return signalVar * (1 + s + (s * s) / 3) * Math.exp(-s);
}

/** Cholesky factor L (lower) of a symmetric positive-definite matrix A = L Lᵀ. */
function cholesky(A: number[][]): number[][] {
  const n = A.length;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (sum <= 0) throw new Error('cholesky: matrix is not positive definite');
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  return L;
}

/** Solve L y = b for lower-triangular L (forward substitution). */
function forwardSub(L: number[][], b: number[]): number[] {
  const n = L.length;
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = b[i];
    for (let k = 0; k < i; k++) sum -= L[i][k] * y[k];
    y[i] = sum / L[i][i];
  }
  return y;
}

/** Solve Lᵀ x = b for lower-triangular L (back substitution). */
function backSub(L: number[][], b: number[]): number[] {
  const n = L.length;
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i];
    for (let k = i + 1; k < n; k++) sum -= L[k][i] * x[k];
    x[i] = sum / L[i][i];
  }
  return x;
}

/**
 * Exact Gaussian-process regressor (Matérn-5/2 kernel, constant prior mean = mean(y)).
 * Posterior at x*: mean = m + k*ᵀ K⁻¹ (y − m); var = k(x*,x*) − k*ᵀ K⁻¹ k*.
 * The noisy diagonal (per-point `noise` or `noiseVar`) keeps K positive-definite even with
 * replicated x, so the surrogate replicates near good points instead of chasing noise.
 */
export class GP {
  private readonly xs: number[];
  private readonly L: number[][];
  private readonly alpha: number[];
  private readonly priorMean: number;
  private readonly params: GpParams;

  constructor(params: GpParams, obs: readonly Observation[]) {
    this.params = params;
    this.xs = obs.map((o) => o.x);
    const n = obs.length;
    this.priorMean = n === 0 ? 0 : obs.reduce((s, o) => s + o.y, 0) / n;
    if (n === 0) {
      this.L = [];
      this.alpha = [];
      return;
    }
    const K: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let k = matern52(this.xs[i], this.xs[j], params.signalVar, params.lengthScale);
        if (i === j) k += (obs[i].noise ?? params.noiseVar) + 1e-9 * params.signalVar;
        K[i][j] = k;
      }
    }
    this.L = cholesky(K);
    this.alpha = backSub(this.L, forwardSub(this.L, obs.map((o) => o.y - this.priorMean)));
  }

  predict(x: number): GpPosterior {
    const n = this.xs.length;
    if (n === 0) return { mean: this.priorMean, variance: this.params.signalVar };
    const ks = this.xs.map((xi) => matern52(xi, x, this.params.signalVar, this.params.lengthScale));
    let mean = this.priorMean;
    for (let i = 0; i < n; i++) mean += ks[i] * this.alpha[i];
    const v = forwardSub(this.L, ks);
    let vv = 0;
    for (let i = 0; i < n; i++) vv += v[i] * v[i];
    return { mean, variance: Math.max(0, this.params.signalVar - vv) };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/optimizer/gp.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add src/optimizer/gp.ts tests/optimizer/gp.test.ts
git commit -m "feat(optimizer): exact Matérn-5/2 Gaussian process (Cholesky, dependency-free)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `optimizer/bayesopt.ts` - acquisition functions

**Files:**
- Create: `src/optimizer/bayesopt.ts`
- Test: `tests/optimizer/bayesopt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/optimizer/bayesopt.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { normPdf, normCdf, expectedImprovement, ucb } from '../../src/optimizer/bayesopt';

describe('normal helpers', () => {
  it('normCdf matches known quantiles', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.6448536)).toBeCloseTo(0.95, 4);
    expect(normCdf(-1.6448536)).toBeCloseTo(0.05, 4);
  });

  it('normPdf integrates to ~1 over a fine grid', () => {
    let area = 0;
    const h = 0.01;
    for (let z = -6; z <= 6; z += h) area += normPdf(z) * h;
    expect(area).toBeCloseTo(1, 3);
  });
});

describe('expectedImprovement (maximization)', () => {
  it('is zero when variance is zero', () => {
    expect(expectedImprovement(5, 0, 1, 0.01)).toBe(0);
  });

  it('rises with the posterior mean at equal uncertainty', () => {
    const lo = expectedImprovement(1, 1, 1, 0.01);
    const hi = expectedImprovement(3, 1, 1, 0.01);
    expect(hi).toBeGreaterThan(lo);
  });

  it('rewards uncertainty at the incumbent (exploration)', () => {
    const certain = expectedImprovement(1, 1e-6, 1, 0);
    const uncertain = expectedImprovement(1, 1, 1, 0);
    expect(uncertain).toBeGreaterThan(certain);
  });
});

describe('ucb', () => {
  it('adds kappa standard deviations to the mean', () => {
    expect(ucb(2, 4, 2)).toBeCloseTo(2 + 2 * 2, 9); // sd = 2
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/optimizer/bayesopt.test.ts`
Expected: FAIL - `Cannot find module '../../src/optimizer/bayesopt'`.

- [ ] **Step 3: Write the implementation**

Create `src/optimizer/bayesopt.ts`:

```typescript
import type { Cm360, Observation, SearchEngine } from '../types';
import { GP, type GpParams } from './gp';

/** Standard-normal pdf. */
export function normPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

/** erf via Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - poly * Math.exp(-ax * ax));
}

/** Standard-normal cdf. */
export function normCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Expected Improvement for maximization; `best` = incumbent (best posterior mean), `xi` = exploration. */
export function expectedImprovement(mean: number, variance: number, best: number, xi: number): number {
  const sigma = Math.sqrt(Math.max(0, variance));
  if (sigma < 1e-12) return 0;
  const d = mean - best - xi;
  const z = d / sigma;
  return d * normCdf(z) + sigma * normPdf(z);
}

/** Upper Confidence Bound for maximization: μ + κσ. */
export function ucb(mean: number, variance: number, kappa: number): number {
  return mean + kappa * Math.sqrt(Math.max(0, variance));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/optimizer/bayesopt.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add src/optimizer/bayesopt.ts tests/optimizer/bayesopt.test.ts
git commit -m "feat(optimizer): EI/UCB acquisition + normal pdf/cdf (A&S erf)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `optimizer/bayesopt.ts` - the BO `SearchEngine`

**Files:**
- Modify: `src/optimizer/bayesopt.ts` (append `BoConfig` + `makeBo`)
- Test: `tests/optimizer/bayesopt.test.ts` (append a `makeBo` describe block)

- [ ] **Step 1: Write the failing test**

Append to `tests/optimizer/bayesopt.test.ts`:

```typescript
import { makeBo } from '../../src/optimizer/bayesopt';
import type { Observation } from '../../src/types';

const bounds: [number, number] = [15, 60];

describe('makeBo', () => {
  // Observations from a concave objective peaked at ln(32).
  const peak = Math.log(32);
  const obs: Observation[] = [12, 18, 26, 32, 40, 52].map((cm) => {
    const x = Math.log(cm);
    return { x, y: -(x - peak) * (x - peak) };
  });

  it('returns the domain midpoint when there is no data', () => {
    const bo = makeBo({ gp: { signalVar: 1, lengthScale: 0.5, noiseVar: 0.2 } });
    const s = bo.suggest([], bounds);
    expect(s).toBeCloseTo(Math.sqrt(15 * 60), 6); // exp((ln15+ln60)/2)
  });

  it('UCB with kappa 0 suggests near the objective peak', () => {
    const bo = makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 1e-3 }, acquisition: 'ucb', kappa: 0 });
    const s = bo.suggest(obs, bounds);
    expect(s).toBeGreaterThan(26);
    expect(s).toBeLessThan(40);
  });

  it('EI proposes a finite cm/360 within bounds', () => {
    const bo = makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 1e-3 }, acquisition: 'ei' });
    const s = bo.suggest(obs, bounds);
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(15);
    expect(s).toBeLessThanOrEqual(60);
  });

  it('isDone at the trial budget', () => {
    const bo = makeBo({ gp: { signalVar: 1, lengthScale: 0.5, noiseVar: 0.2 }, maxTrials: 5 });
    expect(bo.isDone(obs.slice(0, 4))).toBe(false);
    expect(bo.isDone([...obs, ...obs])).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/optimizer/bayesopt.test.ts`
Expected: FAIL - `makeBo` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/optimizer/bayesopt.ts`:

```typescript
export interface BoConfig {
  gp: GpParams;
  /** Acquisition function (default 'ei'). */
  acquisition?: 'ei' | 'ucb';
  /** EI exploration offset ξ (default 0.01). */
  xi?: number;
  /** UCB width κ (default 2). */
  kappa?: number;
  /** Dense 1-D acquisition grid resolution (default 96). */
  gridSize?: number;
  /** isDone budget (default 20). */
  maxTrials?: number;
}

/**
 * Bayesian-optimization SearchEngine over x = ln(cm/360). Given the observed history it fits a GP
 * and returns the cm/360 maximizing the acquisition over a dense grid. Empty history → domain
 * midpoint (the session controller owns the cold-start design-of-experiments, so BO is never asked
 * to seed from nothing in practice).
 */
export function makeBo(config: BoConfig): SearchEngine {
  const acq = config.acquisition ?? 'ei';
  const xi = config.xi ?? 0.01;
  const kappa = config.kappa ?? 2;
  const gridSize = config.gridSize ?? 96;
  const maxTrials = config.maxTrials ?? 20;

  return {
    suggest(history: Observation[], bounds: [Cm360, Cm360]): Cm360 {
      const loX = Math.log(bounds[0]);
      const hiX = Math.log(bounds[1]);
      if (history.length === 0) return Math.exp((loX + hiX) / 2);
      const gp = new GP(config.gp, history);
      // Incumbent = best posterior mean over the grid (not the raw noisy max).
      let best = -Infinity;
      for (let i = 0; i <= gridSize; i++) {
        const x = loX + ((hiX - loX) * i) / gridSize;
        const m = gp.predict(x).mean;
        if (m > best) best = m;
      }
      let bestX = loX;
      let bestAcq = -Infinity;
      for (let i = 0; i <= gridSize; i++) {
        const x = loX + ((hiX - loX) * i) / gridSize;
        const { mean, variance } = gp.predict(x);
        const a = acq === 'ucb' ? ucb(mean, variance, kappa) : expectedImprovement(mean, variance, best, xi);
        if (a > bestAcq) {
          bestAcq = a;
          bestX = x;
        }
      }
      return Math.exp(bestX);
    },
    isDone(history: Observation[]): boolean {
      return history.length >= maxTrials;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/optimizer/bayesopt.test.ts`
Expected: PASS (10 tests total in the file).

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add src/optimizer/bayesopt.ts tests/optimizer/bayesopt.test.ts
git commit -m "feat(optimizer): GP Bayesian-opt SearchEngine over ln(cm/360)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `optimizer/bandit.ts` - UCB1 fallback `SearchEngine`

**Files:**
- Create: `src/optimizer/bandit.ts`
- Test: `tests/optimizer/bandit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/optimizer/bandit.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { makeUcb1Bandit } from '../../src/optimizer/bandit';
import type { Observation } from '../../src/types';

const bounds: [number, number] = [15, 60];
const arms = [16, 24, 32, 44, 58];

describe('makeUcb1Bandit', () => {
  it('plays each unplayed arm once before repeating', () => {
    const b = makeUcb1Bandit({ arms });
    const hist: Observation[] = [];
    const picks: number[] = [];
    for (let i = 0; i < arms.length; i++) {
      const s = b.suggest(hist, bounds);
      picks.push(s);
      hist.push({ x: Math.log(s), y: 0 });
    }
    expect([...picks].sort((a, c) => a - c)).toEqual([...arms].sort((a, c) => a - c));
  });

  it('favors the arm with the best observed mean once all are played', () => {
    const b = makeUcb1Bandit({ arms });
    const hist: Observation[] = [];
    for (const a of arms) {
      const y = a === 32 ? 10 : 0;
      hist.push({ x: Math.log(a), y });
      hist.push({ x: Math.log(a), y });
    }
    expect(b.suggest(hist, bounds)).toBe(32);
  });

  it('maps observations to the nearest arm', () => {
    const b = makeUcb1Bandit({ arms });
    const hist: Observation[] = [];
    for (const a of arms) {
      hist.push({ x: Math.log(a), y: 0 });
      hist.push({ x: Math.log(a), y: 0 });
    }
    hist.push({ x: Math.log(33), y: 100 }); // nearest arm is 32
    expect(b.suggest(hist, bounds)).toBe(32);
  });

  it('isDone at the pull budget', () => {
    const b = makeUcb1Bandit({ arms, maxPulls: 6 });
    expect(b.isDone(new Array<Observation>(5).fill({ x: 0, y: 0 }))).toBe(false);
    expect(b.isDone(new Array<Observation>(6).fill({ x: 0, y: 0 }))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/optimizer/bandit.test.ts`
Expected: FAIL - `Cannot find module '../../src/optimizer/bandit'`.

- [ ] **Step 3: Write the implementation**

Create `src/optimizer/bandit.ts`:

```typescript
import type { Cm360, Observation, SearchEngine } from '../types';

export interface BanditConfig {
  /** Discretized cm/360 arms. */
  arms: Cm360[];
  /** isDone budget (default arms.length × 3). */
  maxPulls?: number;
}

/** Index of the arm whose ln(cm/360) is nearest to x. */
function nearestArm(x: number, armX: number[]): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < armX.length; i++) {
    const d = Math.abs(armX[i] - x);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * UCB1 bandit fallback ("simple mode") over discretized cm/360 arms: x̄_i + √(2 ln t / n_i).
 * Reconstructs per-arm counts/means from the observation history (each observation is mapped to its
 * nearest arm), plays every unplayed arm first, then exploits with the UCB1 bonus.
 */
export function makeUcb1Bandit(config: BanditConfig): SearchEngine {
  const arms = config.arms;
  const armX = arms.map((a) => Math.log(a));
  const maxPulls = config.maxPulls ?? arms.length * 3;

  return {
    suggest(history: Observation[]): Cm360 {
      const n = arms.map(() => 0);
      const sum = arms.map(() => 0);
      for (const o of history) {
        const k = nearestArm(o.x, armX);
        n[k] += 1;
        sum[k] += o.y;
      }
      for (let i = 0; i < arms.length; i++) if (n[i] === 0) return arms[i];
      const t = history.length;
      let bestI = 0;
      let bestU = -Infinity;
      for (let i = 0; i < arms.length; i++) {
        const u = sum[i] / n[i] + Math.sqrt((2 * Math.log(t)) / n[i]);
        if (u > bestU) {
          bestU = u;
          bestI = i;
        }
      }
      return arms[bestI];
    },
    isDone(history: Observation[]): boolean {
      return history.length >= maxPulls;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/optimizer/bandit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add src/optimizer/bandit.ts tests/optimizer/bandit.test.ts
git commit -m "feat(optimizer): UCB1 bandit fallback over discretized cm/360 arms" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `optimizer/objective.ts` - blended objective (per-instrument z-score)

**Files:**
- Create: `src/optimizer/objective.ts`
- Test: `tests/optimizer/objective.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/optimizer/objective.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { trialsToObservations } from '../../src/optimizer/objective';
import { fitPeak } from '../../src/stats/psychometric';
import type { InstrumentId, Profile, TrialResult } from '../../src/types';

const prof = (weights: Partial<Record<InstrumentId, number>>): Profile => ({
  speedAccuracy: 0.5,
  instrumentWeights: { track: 0, flick: 0, calibrate: 0, strike: 0, ...weights },
});

function trial(instrument: InstrumentId, cm360: number, score: number): TrialResult {
  return { instrument, cm360, score, raw: {}, at: 0 };
}

describe('trialsToObservations', () => {
  it('recovers a single instrument peak through z-scoring (affine-invariant)', () => {
    const peak = Math.log(35);
    const trials = [16, 22, 28, 35, 44, 55].map((cm) => {
      const x = Math.log(cm);
      return trial('flick', cm, -(x - peak) * (x - peak) * 5 + 3); // arbitrary scale + offset
    });
    const obs = trialsToObservations(trials, prof({ flick: 1 }));
    expect(obs.length).toBe(6);
    expect(fitPeak(obs).optimalCm360).toBeCloseTo(35, 0);
  });

  it('drops instruments with no spread (≤1 trial or all-equal) - no NaN', () => {
    const trials = [trial('flick', 30, 5), trial('track', 25, 9), trial('track', 40, 9)];
    const obs = trialsToObservations(trials, prof({ flick: 1, track: 1 }));
    expect(obs).toEqual([]);
  });

  it('skips weight-0 instruments', () => {
    const trials = [trial('strike', 20, 1), trial('strike', 50, 9)];
    expect(trialsToObservations(trials, prof({ strike: 0 }))).toEqual([]);
    expect(trialsToObservations(trials, prof({ strike: 1 })).length).toBe(2);
  });

  it('blends two instruments toward a peak between their individual peaks', () => {
    const mk = (id: InstrumentId, cm: number, peakCm: number): TrialResult => {
      const x = Math.log(cm);
      const c = Math.log(peakCm);
      return trial(id, cm, -(x - c) * (x - c));
    };
    const sweep = [16, 22, 30, 40, 52];
    const trials = [
      ...sweep.map((cm) => mk('flick', cm, 24)),
      ...sweep.map((cm) => mk('track', cm, 48)),
    ];
    const peak = fitPeak(trialsToObservations(trials, prof({ flick: 1, track: 1 }))).optimalCm360;
    expect(peak).toBeGreaterThan(27);
    expect(peak).toBeLessThan(45);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/optimizer/objective.test.ts`
Expected: FAIL - `Cannot find module '../../src/optimizer/objective'`.

- [ ] **Step 3: Write the implementation**

Create `src/optimizer/objective.ts`:

```typescript
import type { InstrumentId, Observation, Profile, TrialResult } from '../types';
import { mean, sampleStd } from '../scoring/stats';

/**
 * Blend raw per-trial scores into Bayesian-opt observations (x = ln cm/360, y = blended score).
 * Each instrument is z-scored across its own trials, so heterogeneous score scales (bits/s, (0,1],
 * strikes/s) become comparable; the z-score is affine, so it never moves an instrument's own peak.
 * Each contribution is weighted by the player's profile and emitted as one observation per trial.
 * This is the spec's "normalize terms across the sweep."
 *
 * Honesty: an instrument with no spread (≤1 trial, or all-equal scores → sampleStd 0) contributes
 * nothing rather than a fabricated value; weight-0 (or missing) instruments are skipped.
 */
export function trialsToObservations(trials: readonly TrialResult[], profile: Profile): Observation[] {
  const byId = new Map<InstrumentId, number[]>();
  for (const t of trials) {
    const arr = byId.get(t.instrument) ?? [];
    arr.push(t.score);
    byId.set(t.instrument, arr);
  }
  const stats = new Map<InstrumentId, { mu: number; sd: number }>();
  for (const [id, scores] of byId) stats.set(id, { mu: mean(scores), sd: sampleStd(scores) });

  const out: Observation[] = [];
  for (const t of trials) {
    const w = profile.instrumentWeights[t.instrument];
    if (!w) continue; // weight 0 or missing → no contribution
    const s = stats.get(t.instrument);
    if (!s || s.sd === 0) continue; // no spread yet → no information (no fabricated signal)
    out.push({ x: Math.log(t.cm360), y: w * ((t.score - s.mu) / s.sd) });
  }
  return out.sort((a, b) => a.x - b.x);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/optimizer/objective.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add src/optimizer/objective.ts tests/optimizer/objective.test.ts
git commit -m "feat(optimizer): blended objective - per-instrument z-score across the sweep" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `optimizer/session-controller.ts` - `finalizeReport`

**Files:**
- Create: `src/optimizer/session-controller.ts`
- Test: `tests/optimizer/session-controller.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/optimizer/session-controller.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { finalizeReport } from '../../src/optimizer/session-controller';
import { mulberry32 } from '../../src/stats/bootstrap';
import type { Observation } from '../../src/types';

const bounds: [number, number] = [15, 60];

const concave = (peakCm: number, noise = 0): Observation[] => {
  const c = Math.log(peakCm);
  const rng = mulberry32(5);
  return [15, 19, 24, 30, 38, 48, 60].map((cm) => {
    const x = Math.log(cm);
    return { x, y: -(x - c) * (x - c) + (rng() * 2 - 1) * noise };
  });
};

describe('finalizeReport', () => {
  it('reports the curve peak with a CI that contains it', () => {
    const r = finalizeReport(concave(34, 0.02), bounds, mulberry32(1), { bootstrapIters: 200 });
    expect(r.optimalCm360).toBeGreaterThan(28);
    expect(r.optimalCm360).toBeLessThan(40);
    expect(r.ci90[0]).toBeLessThanOrEqual(r.optimalCm360);
    expect(r.ci90[1]).toBeGreaterThanOrEqual(r.optimalCm360);
    expect(r.curve.length).toBeGreaterThan(0);
  });

  it('clamps the optimum and CI to the bounds', () => {
    const r = finalizeReport(concave(34, 0.02), bounds, mulberry32(2), { bootstrapIters: 200 });
    expect(r.optimalCm360).toBeGreaterThanOrEqual(15);
    expect(r.optimalCm360).toBeLessThanOrEqual(60);
    expect(r.ci90[0]).toBeGreaterThanOrEqual(15);
    expect(r.ci90[1]).toBeLessThanOrEqual(60);
  });

  it('falls back to a full-bounds CI when the curve is not concave (flat data)', () => {
    const flat: Observation[] = [15, 25, 35, 45, 60].map((cm, i) => ({ x: Math.log(cm), y: 0.1 * i }));
    const r = finalizeReport(flat, bounds, mulberry32(3));
    expect(r.ci90).toEqual([15, 60]);
    expect(Number.isFinite(r.optimalCm360)).toBe(true);
  });

  it('widens the CI when a supplied GP peak disagrees with the curve peak', () => {
    const base = finalizeReport(concave(34, 0.02), bounds, mulberry32(4), { bootstrapIters: 200 });
    const widened = finalizeReport(concave(34, 0.02), bounds, mulberry32(4), {
      bootstrapIters: 200,
      gpPeakCm360: 55,
    });
    expect(widened.ci90[1]).toBeGreaterThanOrEqual(55 - 1e-9);
    expect(widened.ci90[1]).toBeGreaterThanOrEqual(base.ci90[1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/optimizer/session-controller.test.ts`
Expected: FAIL - `Cannot find module '../../src/optimizer/session-controller'`.

- [ ] **Step 3: Write the implementation**

Create `src/optimizer/session-controller.ts`:

```typescript
import type { Cm360, Observation, Report } from '../types';
import { fitPeak } from '../stats/psychometric';
import { bootstrapCi } from '../stats/bootstrap';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export interface FinalizeOptions {
  /** Bootstrap resamples for the CI (default 400). */
  bootstrapIters?: number;
  /** If set, widen the CI when the GP peak and the curve peak disagree (spec §5.3). */
  gpPeakCm360?: number;
  /** Log-space disagreement threshold for the GP/curve widen (default 0.15 ≈ 16% relative). */
  disagreeLogThreshold?: number;
}

/**
 * Observations → Report. Fits the peaked psychometric curve, bootstraps the 90% CI, clamps to
 * bounds. If the curve is not concave (flat/ambiguous data), honestly reports the best-observed
 * cm/360 with the FULL bounds as the CI - a wide CI is the honesty signal, never hidden. If a GP
 * peak is supplied and disagrees with the curve peak, the CI is widened to span both.
 */
export function finalizeReport(
  obs: readonly Observation[],
  bounds: [Cm360, Cm360],
  rng: () => number,
  opts: FinalizeOptions = {},
): Report {
  const [lo, hi] = bounds;
  const iters = opts.bootstrapIters ?? 400;
  try {
    const fit = fitPeak([...obs]);
    const peak = clamp(fit.optimalCm360, lo, hi);
    let ci: [Cm360, Cm360];
    try {
      const raw = bootstrapCi([...obs], iters, rng);
      ci = [clamp(Math.min(raw[0], raw[1]), lo, hi), clamp(Math.max(raw[0], raw[1]), lo, hi)];
    } catch {
      ci = [lo, hi]; // bootstrap could not bound it → honest wide range
    }
    if (opts.gpPeakCm360 !== undefined) {
      const gp = clamp(opts.gpPeakCm360, lo, hi);
      const thresh = opts.disagreeLogThreshold ?? 0.15;
      if (Math.abs(Math.log(gp) - Math.log(peak)) > thresh) {
        ci = [Math.min(ci[0], gp, peak), Math.max(ci[1], gp, peak)];
      }
    }
    return { optimalCm360: peak, ci90: ci, curve: fit.curve };
  } catch {
    // Non-concave: report the best-observed point with the full range as the CI.
    let best = { x: Math.log((lo + hi) / 2), y: -Infinity };
    for (const o of obs) if (o.y > best.y) best = o;
    return {
      optimalCm360: clamp(Math.exp(best.x), lo, hi),
      ci90: [lo, hi],
      curve: [...obs].map((o) => ({ x: o.x, mean: o.y })).sort((a, b) => a.x - b.x),
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/optimizer/session-controller.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add src/optimizer/session-controller.ts tests/optimizer/session-controller.test.ts
git commit -m "feat(optimizer): finalizeReport - psychometric peak + bootstrap CI + honest fallback" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `optimizer/session-controller.ts` - `runSession` (the full loop)

**Files:**
- Modify: `src/optimizer/session-controller.ts` (update imports; append `SessionConfig`, `SessionOutcome`, `runSession`)
- Test: `tests/optimizer/session-controller.test.ts` (append the convergence describe block)

- [ ] **Step 1: Write the failing test**

Append to `tests/optimizer/session-controller.test.ts`:

```typescript
import { runSession } from '../../src/optimizer/session-controller';
import { makeBo } from '../../src/optimizer/bayesopt';
import { FakeScene } from '../instruments/fake-scene';
import type { Cm360, Instrument, InstrumentId, Profile, TrialResult } from '../../src/types';

const sessionBounds: [Cm360, Cm360] = [15, 60];

const profile = (weights: Partial<Record<InstrumentId, number>>): Profile => ({
  speedAccuracy: 0.5,
  instrumentWeights: { track: 0, flick: 0, calibrate: 0, strike: 0, ...weights },
});

/** A deterministic synthetic player whose score peaks (in ln cm/360) at `peakCm`. */
function synthetic(id: InstrumentId, peakCm: number): Instrument {
  const c = Math.log(peakCm);
  return {
    id,
    run(ctx) {
      const x = Math.log(ctx.cm360);
      const noise = (ctx.rng() * 2 - 1) * 0.04;
      const score = -(x - c) * (x - c) + noise;
      return Promise.resolve<TrialResult>({ instrument: id, cm360: ctx.cm360, score, raw: {}, at: 0 });
    },
  };
}

function instruments(map: Partial<Record<InstrumentId, Instrument>>): Record<InstrumentId, Instrument> {
  return {
    track: map.track ?? synthetic('track', 30),
    flick: map.flick ?? synthetic('flick', 30),
    calibrate: map.calibrate ?? synthetic('calibrate', 30),
    strike: map.strike ?? synthetic('strike', 30),
  };
}

describe('runSession - convergence on synthetic players', () => {
  it('finds a single instrument latent optimum, with a sub-bounds CI containing the estimate', async () => {
    const bo = makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.05 }, acquisition: 'ei', maxTrials: 22 });
    const { report, trials } = await runSession({
      dpi: 800,
      profile: profile({ flick: 1 }),
      bounds: sessionBounds,
      engine: bo,
      instruments: instruments({ flick: synthetic('flick', 40) }),
      scene: new FakeScene(),
      schedule: ['flick'],
      maxTrials: 22,
      rng: mulberry32(123),
      bootstrapIters: 300,
    });
    expect(trials.length).toBe(22);
    expect(report.optimalCm360).toBeGreaterThan(33);
    expect(report.optimalCm360).toBeLessThan(47);
    expect(report.ci90[0]).toBeLessThanOrEqual(report.optimalCm360);
    expect(report.ci90[1]).toBeGreaterThanOrEqual(report.optimalCm360);
    expect(report.ci90[1] - report.ci90[0]).toBeLessThan(45); // tighter than the full bounds
  });

  it('blends two instruments toward an optimum between their peaks', async () => {
    const bo = makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.05 }, acquisition: 'ei', maxTrials: 24 });
    const { report } = await runSession({
      dpi: 800,
      profile: profile({ flick: 1, track: 1 }),
      bounds: sessionBounds,
      engine: bo,
      instruments: instruments({ flick: synthetic('flick', 24), track: synthetic('track', 48) }),
      scene: new FakeScene(),
      schedule: ['flick', 'track'],
      maxTrials: 24,
      rng: mulberry32(7),
      bootstrapIters: 300,
    });
    expect(report.optimalCm360).toBeGreaterThan(27);
    expect(report.optimalCm360).toBeLessThan(45);
  });

  it('stops early once the CI is tight enough', async () => {
    const bo = makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.05 }, acquisition: 'ei', maxTrials: 40 });
    const { trials } = await runSession({
      dpi: 800,
      profile: profile({ flick: 1 }),
      bounds: sessionBounds,
      engine: bo,
      instruments: instruments({ flick: synthetic('flick', 33) }),
      scene: new FakeScene(),
      schedule: ['flick'],
      maxTrials: 40,
      rng: mulberry32(99),
      minTrials: 8,
      ciStopWidth: 35,
      bootstrapIters: 200,
    });
    expect(trials.length).toBeLessThan(40);
    expect(trials.length).toBeGreaterThanOrEqual(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/optimizer/session-controller.test.ts`
Expected: FAIL - `runSession` is not exported.

- [ ] **Step 3: Update the imports**

Replace the import block at the top of `src/optimizer/session-controller.ts`:

```typescript
import type { Cm360, Observation, Report } from '../types';
import { fitPeak } from '../stats/psychometric';
import { bootstrapCi } from '../stats/bootstrap';
```

with:

```typescript
import type {
  ArenaScene,
  Cm360,
  Dpi,
  Instrument,
  InstrumentId,
  Observation,
  Profile,
  Report,
  SearchEngine,
  TrialResult,
} from '../types';
import { fitPeak } from '../stats/psychometric';
import { bootstrapCi } from '../stats/bootstrap';
import { trialsToObservations } from './objective';
```

- [ ] **Step 4: Write the implementation**

Append to `src/optimizer/session-controller.ts`:

```typescript
export interface SessionConfig {
  dpi: Dpi;
  profile: Profile;
  bounds: [Cm360, Cm360];
  engine: SearchEngine;
  instruments: Record<InstrumentId, Instrument>;
  scene: ArenaScene;
  /** Cycled one-per-trial; e.g. ['track','flick','calibrate','strike']. */
  schedule: InstrumentId[];
  maxTrials: number;
  rng: () => number;
  /** Log-spaced design-of-experiments seeds run before the engine is consulted
   *  (default max(4, 2×schedule.length) - each scheduled instrument needs ≥2 trials
   *  before its z-score has any spread). */
  coldStart?: number;
  /** Earliest trial index at which CI early-stop is allowed (default 8). */
  minTrials?: number;
  /** Stop early once the 90% CI (in cm/360) is narrower than this. */
  ciStopWidth?: Cm360;
  /** Bootstrap resamples for early-stop checks and the final report (default 400). */
  bootstrapIters?: number;
}

export interface SessionOutcome {
  report: Report;
  trials: TrialResult[];
}

/**
 * Run a full Bayesian-optimization session: cold-start log-spaced seeds → suggest cm/360 → run the
 * next scheduled instrument → append → rebuild the blended objective → (optionally) stop early on a
 * tight CI → finalize a Report. Cold-start is the controller's job (not the engine's) because the
 * blended objective is undefined until each instrument has ≥2 trials.
 */
export async function runSession(config: SessionConfig): Promise<SessionOutcome> {
  const { engine, schedule, bounds, profile, rng } = config;
  const [lo, hi] = bounds;
  const loX = Math.log(lo);
  const hiX = Math.log(hi);
  const coldStart = config.coldStart ?? Math.max(4, 2 * schedule.length);
  const minTrials = config.minTrials ?? 8;
  const iters = config.bootstrapIters ?? 400;
  const seedAt = (k: number): Cm360 => Math.exp(loX + ((k + 0.5) / coldStart) * (hiX - loX));

  const trials: TrialResult[] = [];
  while (trials.length < config.maxTrials) {
    const obs = trialsToObservations(trials, profile);
    const cm360 =
      trials.length < coldStart ? seedAt(trials.length) : clamp(engine.suggest(obs, bounds), lo, hi);
    const id = schedule[trials.length % schedule.length];
    const result = await config.instruments[id].run(
      { cm360, dpi: config.dpi, rng, profile },
      config.scene,
    );
    trials.push(result);

    if (config.ciStopWidth !== undefined && trials.length >= minTrials) {
      try {
        const ci = bootstrapCi([...trialsToObservations(trials, profile)], iters, rng);
        if (Math.abs(ci[1] - ci[0]) <= config.ciStopWidth) break;
      } catch {
        // not yet concave-fittable → keep gathering
      }
    }
  }

  const report = finalizeReport(trialsToObservations(trials, profile), bounds, rng, {
    bootstrapIters: iters,
  });
  return { report, trials };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/optimizer/session-controller.test.ts`
Expected: PASS (7 tests total in the file).

If a convergence bracket fails, do NOT merely widen it - the seeded run is deterministic, so a miss signals a real issue in the objective/GP/loop wiring. Investigate first; only adjust the bracket if the estimate is genuinely correct and the bracket was set too tight.

- [ ] **Step 6: Full suite, type-check, and commit**

```bash
npm test
npx tsc --noEmit
git add src/optimizer/session-controller.ts tests/optimizer/session-controller.test.ts
git commit -m "feat(optimizer): runSession - cold-start → BO loop → blended objective → Report" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: dev-harness wiring + Chromium runtime proof

**Files:**
- Modify: `src/dev/arena-harness.ts`

This proves the full pipeline runs end-to-end through the REAL WebGL arena + REAL instruments + RAF loop in a browser (mirroring Phase 3's `runInstrument` proof). A short auto-fire pulse drives the fire-gated instruments (flick/calibrate/strike) to completion without a human - the recorded misses are genuine (no fabricated measurements), so the resulting `Report` is a real (if low-skill) pipeline output.

- [ ] **Step 1: Extend the `ArenaDebug` interface and imports**

In `src/dev/arena-harness.ts`, change the type import line:

```typescript
import type { AimSample, PointerLockMode, InstrumentId, TrialResult } from '../types';
```

to:

```typescript
import type { AimSample, PointerLockMode, InstrumentId, TrialResult, Report } from '../types';
```

Then add one line to the `ArenaDebug` interface (after `runInstrument`):

```typescript
  runSession(): Promise<Report>;
```

- [ ] **Step 2: Add the `runSession` method to `__arenaDebug`**

In the `window.__arenaDebug = { … }` object literal, add this method immediately after the existing `runInstrument` method:

```typescript
    async runSession(): Promise<Report> {
      const { runSession } = await import('../optimizer/session-controller');
      const { makeBo } = await import('../optimizer/bayesopt');
      const { INSTRUMENTS } = await import('../instruments/registry');
      arena.clearTargets();
      const engine = makeBo({
        gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.1 },
        acquisition: 'ei',
        maxTrials: 8,
      });
      // Auto-fire pulse so the fire-gated instruments progress without a human (dev proof only).
      const autofire = window.setInterval(() => pushFire(), 220);
      try {
        const { report } = await runSession({
          dpi: DPI,
          profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
          bounds: [18, 50],
          engine,
          instruments: INSTRUMENTS,
          scene: arena,
          schedule: ['flick', 'strike', 'calibrate', 'track'],
          maxTrials: 8,
          rng: mulberry32(2026),
          bootstrapIters: 300,
        });
        console.log('[campeón] session report', report);
        return report;
      } finally {
        window.clearInterval(autofire);
      }
    },
```

- [ ] **Step 3: Type-check and dev-build**

Run: `npx tsc --noEmit`
Expected: zero errors.

Run: `npm run build`
Expected: build succeeds (the optimizer modules are reachable via the dynamic imports; Three.js stays code-split).

- [ ] **Step 4: Runtime proof in Chromium**

Start the dev server (`npm run dev`), open the app in Chromium at `/#arena` (or whatever route mounts the harness), click once to focus, then in the DevTools console:

```js
const report = await window.__arenaDebug.runSession();
report;
```

Expected (the proof - takes ~20–30s as 8 real trials run):
- Resolves to a `Report` object with:
  - `optimalCm360` finite and within `[18, 50]`,
  - `ci90` a `[lo, hi]` pair within `[18, 50]` (likely wide - the auto-fire "player" is unskilled, which is honest),
  - `curve` a non-empty array of `{ x, mean }`.
- No exceptions in the console; targets visibly spawn/clear across the run.

Record the returned `Report` in the task notes as evidence.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add src/dev/arena-harness.ts
git commit -m "feat(dev): run a full optimizer session in the arena harness (runtime proof)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (against the spec, run after writing - fixes applied inline)

**1. Spec coverage (§5 The engine):**
- §5.2 GP surrogate, Matérn-5/2, noisy nugget → `gp.ts` (Task 1) ✓
- §5.2 EI `(μ−f⁺−ξ)Φ(Z)+σφ(Z)`, UCB `μ+κσ`, dense 1-D grid, posterior-mean `f⁺` → `bayesopt.ts` (Tasks 2–3) ✓
- §5.2 cold start 3–5 log-spaced trials → controller `coldStart` (Task 7) ✓ (moved from engine to controller, justified)
- §5.2 fallback UCB1/Thompson bandit over discretized arms → `bandit.ts` (Task 4); UCB1 implemented, Thompson intentionally omitted (one fallback algorithm suffices - YAGNI; noted here, not silently dropped) ✓
- §5.3 peaked curve fit + parametric bootstrap CI + "wide CI is the honesty signal" → `finalizeReport` reuses `stats/psychometric` + `stats/bootstrap`, flat-data fallback = full-bounds CI (Task 6) ✓
- §5.3 "If GP-peak and curve-peak disagree, widen the CI" → `finalizeReport` `gpPeakCm360` widen (Task 6) ✓
- §5.4 ~15–30 trials, interleave sensitivities, broad-optimum expectation → `runSession` loop + `maxTrials` + BO interleaving (Task 7) ✓
- §4.1 "normalize terms across the sweep" / §5.1 blended `y(s)` → `objective.ts` per-instrument z-score + profile weights (Task 5) ✓
- §5.5 PSO/GA only in-silico for the CI swarm → already satisfied: the bootstrap ensemble IS the only "swarm"; no PSO/GA touches real trials. No code needed ✓
- Success criterion "converges to a stable optimum (or honestly-wide CI) within ~20–25 trials" → Task 7 convergence tests on synthetic players ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code step is complete. ✓

**3. Type consistency:**
- `GpParams { signalVar, lengthScale, noiseVar }` - identical in `gp.ts`, `bayesopt.ts` (`BoConfig.gp`), tests, harness ✓
- `SearchEngine.suggest(history, bounds) → Cm360`, `isDone(history) → boolean` - `makeBo` and `makeUcb1Bandit` both conform; bandit omits the unused `bounds` param (assignable) ✓
- `trialsToObservations(trials, profile) → Observation[]` - same call in `runSession` and tests ✓
- `finalizeReport(obs, bounds, rng, opts?) → Report` - same in Task 6/7 and tests ✓
- `Report { optimalCm360, ci90:[lo,hi], curve:{x,mean}[] }` - matches `types.ts` exactly ✓
- `clamp` defined once (Task 6), reused by `runSession` (Task 7, same file) ✓
- `Instrument.run(ctx, scene)` - synthetic test instruments implement `run(ctx)` (fewer params, assignable); real path passes `arena` ✓

**4. Forward notes for Phase 5 (Shell + flow + state):**
- The shell wires `setup` (DPI + goal slider → `Profile.speedAccuracy` + `instrumentWeights`) → `runSession(config)` with the real `INSTRUMENTS`, real `Arena` scene, and a live `onFrame`-driven convergence plot reading `report.curve` (x = ln cm/360 → `Math.exp` for display).
- `runSession` currently `await`s instruments back-to-back; Phase 5 may want per-trial progress callbacks (`onTrial(result)`) for the live HUD - add an optional `onTrial?` to `SessionConfig` rather than changing the return shape.
- `Result` (in `types.ts`) needs the per-game table + breakdown `{ biasZeroCm360, precisionFloorDeg, ttkMs, hitRate }`. Source estimators from `trials`: `biasZeroCm360` = calibrate `gain` crossing 1 (interpolate the gain-vs-ln(cm360) trials); `precisionFloorDeg` = min calibrate `sigmaR`; `ttkMs`/`hitRate` = strike `raw` at the reported optimum. Build a `optimizer/breakdown.ts` (pure) in Phase 5.
- The GP/curve disagreement widen is plumbed but unused by `runSession` (no `gpPeakCm360` passed). Phase 5 (or a Task-7 follow-up) can compute the GP grid-argmax over the final objective and pass it for a more honest CI; kept optional to keep the core loop decoupled from the GP.
- Tunables that may want per-profile adaptation later: GP `{signalVar, lengthScale, noiseVar}`, `coldStart`, `ciStopWidth`, `maxTrials`, bandit `arms`. All are config, no magic constants buried in logic.
- `noUncheckedIndexedAccess` still OFF (this phase used plain indexing + explicit guards, matching `stats/`).
```
