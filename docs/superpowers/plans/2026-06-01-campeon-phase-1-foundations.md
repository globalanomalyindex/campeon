# campeón Phase 1 - Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Vite/TS/Vitest project with the brand tokens + Gefalent, and build the pure, fully-tested `convert/` (cm/360 + per-game yaw) and `stats/` (psychometric peak + bootstrap CI) libraries.

**Architecture:** Pure functions only this phase - no DOM, no Three.js. `convert` and `stats` are dependency-free TypeScript validated by Vitest against the worked examples in the spec. The app boots to a branded placeholder so the visual foundation is visible.

**Tech Stack:** TypeScript (strict) · Vite · Vitest. No runtime dependencies yet.

**Spec:** [../specs/2026-06-01-campeon-design.md](../specs/2026-06-01-campeon-design.md) · **Index:** [./2026-06-01-campeon-master-plan.md](./2026-06-01-campeon-master-plan.md)

---

### Task 1: Project scaffold (Vite + TS strict + Vitest)

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/main.ts`, `tests/smoke.test.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "campeon",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "vite": "^5.4.0",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`** (strict, no `any` allowed)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `vite.config.ts` and `vitest.config.ts`**

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';
export default defineConfig({ server: { port: 5173 } });
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globals: true, environment: 'node' } });
```

- [ ] **Step 4: Create `index.html` and `src/main.ts`**

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>campeón - aim sensitivity tool</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/main.ts`:
```ts
const app = document.querySelector<HTMLDivElement>('#app');
if (app) app.textContent = 'campeón';
```

- [ ] **Step 5: Create `tests/smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest';

describe('toolchain', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Install and verify**

Run: `npm install`
Run: `npm test`
Expected: 1 passed (`tests/smoke.test.ts`).
Run: `npm run build`
Expected: type-check + build succeed, `dist/` produced.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts index.html src/main.ts tests/smoke.test.ts
git commit -m "chore: scaffold Vite + TS (strict) + Vitest"
```

---

### Task 2: Shared type contracts (`src/types.ts`)

**Files:**
- Create: `src/types.ts`
- Test: `tests/types.test.ts`

- [ ] **Step 1: Write the failing test** (a usage test - proves the contracts compile and are shaped right)

```ts
import { describe, it, expect } from 'vitest';
import type { Cm360, GameId, TrialResult, YawEntry } from '../src/types';

describe('types', () => {
  it('contract objects are constructible', () => {
    const cm: Cm360 = 34;
    const game: GameId = 'valorant';
    const yaw: YawEntry = { id: game, label: 'Valorant', yaw: 0.07 };
    const trial: TrialResult = { instrument: 'track', cm360: cm, score: 0.8, raw: { eLead: 1.2 }, at: 0 };
    expect(yaw.yaw).toBe(0.07);
    expect(trial.instrument).toBe('track');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/types.test.ts`
Expected: FAIL - `Cannot find module '../src/types'`.

- [ ] **Step 3: Create `src/types.ts`** (copy the full contract block from the master plan's "Shared type contracts" section verbatim)

Paste the entire `src/types.ts` contract block defined in [the master plan](./2026-06-01-campeon-master-plan.md#shared-type-contracts-srctypests). It defines: `Cm360, Dpi, Degrees, Ms, GameId, YawEntry, AimSample, PointerLockMode, ArenaScene, TargetSpec, TargetHandle, InstrumentId, TrialContext, TrialResult, Instrument, FittsCondition, Tap, Shot, Observation, SearchEngine, Report, Profile, SessionStatus, Session, Result, Storage`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "feat: shared type contracts (src/types.ts)"
```

---

### Task 3: Brand tokens + Gefalent fonts

**Files:**
- Create: `src/styles/tokens.css`, `src/styles/base.css`, `public/fonts/Gefalent-Regular.otf`, `public/fonts/Gefalent-Italic.otf`
- Modify: `index.html` (link CSS), `src/main.ts` (apply brand)
- Test: `tests/tokens.test.ts`

- [ ] **Step 1: Copy the supplied fonts into the repo**

```bash
mkdir -p public/fonts
cp "/Users/chrisfiore/Downloads/Techno Font Bundle/Gefalent-Regular.otf" public/fonts/Gefalent-Regular.otf
cp "/Users/chrisfiore/Downloads/Techno Font Bundle/Gefalent-Italic.otf" public/fonts/Gefalent-Italic.otf
```

- [ ] **Step 2: Write the failing test** (guards the brand palette against drift)

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('brand tokens', () => {
  const css = readFileSync('src/styles/tokens.css', 'utf8');
  it('defines the exact campeón palette', () => {
    expect(css).toContain('--bone: #EAE7DC');
    expect(css).toContain('--slate: #4A5A66');
    expect(css).toContain('--gold: #FFC400');
    expect(css).toContain('--ink: #0D0D0D');
  });
  it('declares the Gefalent face', () => {
    expect(css).toMatch(/@font-face[\s\S]*Gefalent/);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/tokens.test.ts`
Expected: FAIL - `ENOENT ... tokens.css`.

- [ ] **Step 4: Create `src/styles/tokens.css`**

```css
@font-face {
  font-family: 'Gefalent';
  src: url('/fonts/Gefalent-Regular.otf') format('opentype');
  font-weight: 400; font-style: normal; font-display: swap;
}
@font-face {
  font-family: 'Gefalent';
  src: url('/fonts/Gefalent-Italic.otf') format('opentype');
  font-weight: 400; font-style: italic; font-display: swap;
}
:root {
  /* palette (sampled from the hero) */
  --bone: #EAE7DC;
  --slate: #4A5A66;
  --slate-2: #6C7A85;
  --gold: #FFC400;
  --ink: #0D0D0D;
  --parchment: #EFDEA5;
  /* type */
  --font-display: 'Gefalent', system-ui, sans-serif;
  --font-body: system-ui, -apple-system, sans-serif;
  --font-mono: ui-monospace, 'SFMono-Regular', Menlo, monospace;
  /* spacing scale (4px base) */
  --space-1: 0.25rem; --space-2: 0.5rem; --space-3: 1rem;
  --space-4: 1.5rem; --space-5: 2.5rem; --space-6: 4rem;
  /* motion */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-fast: 140ms; --dur-med: 280ms;
}
@media (prefers-reduced-motion: reduce) {
  :root { --dur-fast: 0ms; --dur-med: 0ms; }
}
```

- [ ] **Step 5: Create `src/styles/base.css`**

```css
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
body {
  background: var(--bone);
  color: var(--slate);
  font-family: var(--font-body);
  -webkit-font-smoothing: antialiased;
}
#app { min-height: 100%; display: flex; }
```

- [ ] **Step 6: Wire CSS + a branded placeholder**

In `index.html`, add inside `<head>`:
```html
    <link rel="stylesheet" href="/src/styles/tokens.css" />
    <link rel="stylesheet" href="/src/styles/base.css" />
```

Replace `src/main.ts` with:
```ts
import './styles/tokens.css';
import './styles/base.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  app.innerHTML = `
    <main style="margin:auto;text-align:center">
      <p style="font-family:var(--font-display);font-style:italic;color:var(--slate-2)">aim sensitivity tool</p>
      <h1 style="font-family:var(--font-display);font-size:5rem;line-height:.9">campe<span style="color:var(--ink)">ó</span>n</h1>
    </main>`;
}
```

- [ ] **Step 7: Run tests + visual check**

Run: `npx vitest run tests/tokens.test.ts`
Expected: PASS (both assertions).
Run: `npm run dev` → open http://localhost:5173 → expect bone background, slate "campeón" in Gefalent with a dark `ó`.

- [ ] **Step 8: Commit**

```bash
git add public/fonts src/styles index.html src/main.ts tests/tokens.test.ts
git commit -m "feat: brand tokens + Gefalent fonts + branded placeholder"
```

---

### Task 4: cm/360 conversion math (`src/convert/cm360.ts`)

**Files:**
- Create: `src/convert/cm360.ts`
- Test: `tests/convert/cm360.test.ts`

- [ ] **Step 1: Write the failing test** (worked examples from spec §7)

```ts
import { describe, it, expect } from 'vitest';
import { cmPer360, sensFor, crossGame, TURN_CM } from '../../src/convert/cm360';

describe('cm360 conversion', () => {
  it('TURN_CM = 360 × 2.54 = 914.4', () => expect(TURN_CM).toBeCloseTo(914.4, 5));

  it('CS2 @800 DPI, sens 1.0 → ≈51.95 cm/360', () =>
    expect(cmPer360(800, 1, 0.022)).toBeCloseTo(51.95, 1));

  it('sensFor is the exact inverse of cmPer360', () => {
    const cm = cmPer360(800, 1.7, 0.022);
    expect(sensFor(cm, 800, 0.022)).toBeCloseTo(1.7, 6);
  });

  it('34 cm/360 @800 DPI → native sens per game', () => {
    expect(sensFor(34, 800, 0.07)).toBeCloseTo(0.480, 2);   // Valorant
    expect(sensFor(34, 800, 0.022)).toBeCloseTo(1.528, 2);  // CS2 / Apex
    expect(sensFor(34, 800, 0.0066)).toBeCloseTo(5.09, 2);  // OW2 / CoD
  });

  it('crossGame CS2(1.0)→Valorant = 0.022/0.07 ≈ 0.314', () =>
    expect(crossGame(1, 800, 0.022, 800, 0.07)).toBeCloseTo(0.314, 3));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/convert/cm360.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement `src/convert/cm360.ts`**

```ts
/** cm/360 conversion. yaw = degrees turned per mouse count at in-game sens 1. */
export const TURN_CM = 360 * 2.54; // 914.4

/** Physical cm of mouse travel for one 360° turn. */
export function cmPer360(dpi: number, sens: number, yaw: number): number {
  return TURN_CM / (dpi * sens * yaw);
}

/** In-game sensitivity that yields the target cm/360 at this DPI and game yaw. */
export function sensFor(cm360: number, dpi: number, yaw: number): number {
  return TURN_CM / (dpi * yaw * cm360);
}

/** Convert a sens between games preserving cm/360 (360-distance match). */
export function crossGame(
  sens: number, dpiFrom: number, yawFrom: number, dpiTo: number, yawTo: number,
): number {
  return (sens * (yawFrom * dpiFrom)) / (yawTo * dpiTo);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/convert/cm360.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/convert/cm360.ts tests/convert/cm360.test.ts
git commit -m "feat(convert): cm/360 math (cmPer360, sensFor, crossGame)"
```

---

### Task 5: Per-game yaw table (`src/convert/yaw-table.ts`)

**Files:**
- Create: `src/convert/yaw-table.ts`
- Test: `tests/convert/yaw-table.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { GAME_YAW, yawFor } from '../../src/convert/yaw-table';
import { sensFor, cmPer360 } from '../../src/convert/cm360';

describe('yaw table', () => {
  it('has all eight supported games', () => {
    expect(GAME_YAW.map(g => g.id).sort()).toEqual(
      ['apex', 'cod', 'cs2', 'fortnite', 'ow2', 'pubg', 'r6', 'valorant']
    );
  });
  it('has the verified constants', () => {
    expect(yawFor('cs2')).toBe(0.022);
    expect(yawFor('valorant')).toBe(0.07);
    expect(yawFor('ow2')).toBe(0.0066);
  });
  it('round-trips cm/360 → sens → cm/360 for every game', () => {
    for (const g of GAME_YAW) {
      const sens = sensFor(34, 800, g.yaw);
      expect(cmPer360(800, sens, g.yaw)).toBeCloseTo(34, 6);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/convert/yaw-table.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement `src/convert/yaw-table.ts`**

```ts
import type { GameId, YawEntry } from '../types';

/** Community-derived effective yaw constants (mouse-sensitivity.com / Voltaic). Overridable in options. */
export const GAME_YAW: YawEntry[] = [
  { id: 'cs2',      label: 'CS2 / CS:GO',              yaw: 0.022,    note: 'Source standard' },
  { id: 'apex',     label: 'Apex Legends',             yaw: 0.022,    note: '1:1 with CS2; ADS per-zoom multiplier' },
  { id: 'valorant', label: 'Valorant',                 yaw: 0.07,     note: 'effective (0.0066 × ~10.6 scale)' },
  { id: 'ow2',      label: 'Overwatch 2',              yaw: 0.0066,   note: 'ADS relative/legacy toggles' },
  { id: 'cod',      label: 'Call of Duty (MW/WZ/BO6)', yaw: 0.0066,   note: '1:1 with OW2; mouse smoothing off' },
  { id: 'fortnite', label: 'Fortnite',                 yaw: 0.005555, note: 'slider is ×100 (a "7" = 0.07)' },
  { id: 'r6',       label: 'Rainbow Six Siege',        yaw: 0.00573,  note: 'FOV literally changes cm/360' },
  { id: 'pubg',     label: 'PUBG',                     yaw: 0.002222, note: 'hipfire / General only' },
];

const BY_ID = new Map<GameId, YawEntry>(GAME_YAW.map(e => [e.id, e]));

export function yawFor(id: GameId): number {
  const entry = BY_ID.get(id);
  if (!entry) throw new Error(`Unknown game: ${id}`);
  return entry.yaw;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/convert/yaw-table.test.ts`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add src/convert/yaw-table.ts tests/convert/yaw-table.test.ts
git commit -m "feat(convert): verified per-game yaw table"
```

---

### Task 6: Per-game output map (`src/convert/schools.ts`)

> The 360-distance school is the default (FOV-agnostic). Monitor-distance (FOV-aware) is deferred to the options phase; this file ships the default + the per-game emit the result screen needs.

**Files:**
- Create: `src/convert/schools.ts`
- Test: `tests/convert/schools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { perGameSens } from '../../src/convert/schools';

describe('per-game output (360-distance)', () => {
  const out = perGameSens(34, 800);
  it('emits a sens for every game', () => {
    expect(Object.keys(out).sort()).toEqual(
      ['apex', 'cod', 'cs2', 'fortnite', 'ow2', 'pubg', 'r6', 'valorant']
    );
  });
  it('matches the spec worked examples', () => {
    expect(out.valorant!).toBeCloseTo(0.480, 2);
    expect(out.cs2!).toBeCloseTo(1.528, 2);
    expect(out.ow2!).toBeCloseTo(5.09, 2);
    expect(out.fortnite!).toBeCloseTo(6.05, 2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/convert/schools.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement `src/convert/schools.ts`**

```ts
import type { Cm360, Dpi, GameId } from '../types';
import { GAME_YAW } from './yaw-table';
import { sensFor } from './cm360';

/** 360-distance match: emit native in-game sens for every game at a target cm/360 + DPI. */
export function perGameSens(cm360: Cm360, dpi: Dpi): Partial<Record<GameId, number>> {
  const out: Partial<Record<GameId, number>> = {};
  for (const g of GAME_YAW) out[g.id] = sensFor(cm360, dpi, g.yaw);
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/convert/schools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/convert/schools.ts tests/convert/schools.test.ts
git commit -m "feat(convert): per-game sens output (360-distance default)"
```

---

### Task 7: Psychometric peak fit (`src/stats/psychometric.ts`)

**Files:**
- Create: `src/stats/psychometric.ts`
- Test: `tests/stats/psychometric.test.ts`

- [ ] **Step 1: Write the failing test** (recover a known peak)

```ts
import { describe, it, expect } from 'vitest';
import { fitQuadratic, fitPeak } from '../../src/stats/psychometric';
import type { Observation } from '../../src/types';

describe('psychometric peak fit', () => {
  // y = -2 (x - ln35)^2 + 5  → peak at x = ln(35)
  const peakX = Math.log(35);
  const obs: Observation[] = [];
  for (const s of [18, 24, 30, 35, 42, 50, 58]) {
    const x = Math.log(s);
    obs.push({ x, y: -2 * (x - peakX) ** 2 + 5 });
  }

  it('recovers quadratic coefficients (β2 < 0)', () => {
    const { b2 } = fitQuadratic(obs);
    expect(b2).toBeLessThan(0);
  });

  it('recovers the optimal cm/360 ≈ 35', () => {
    expect(fitPeak(obs).optimalCm360).toBeCloseTo(35, 1);
  });

  it('returns a curve for plotting', () => {
    expect(fitPeak(obs).curve.length).toBeGreaterThan(10);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/stats/psychometric.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement `src/stats/psychometric.ts`**

```ts
import type { Observation } from '../types';

export interface Quadratic { b0: number; b1: number; b2: number; }

/** Solve a 3×3 linear system A x = b by Gaussian elimination with partial pivoting. */
function solve3(A: number[][], b: number[]): [number, number, number] {
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    [m[col], m[piv]] = [m[piv], m[col]];
    const d = m[col][col];
    if (d === 0) throw new Error('singular matrix in quadratic fit');
    for (let c = col; c < 4; c++) m[col][c] /= d;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = m[r][col];
      for (let c = col; c < 4; c++) m[r][c] -= f * m[col][c];
    }
  }
  return [m[0][3], m[1][3], m[2][3]];
}

/** Least-squares fit of y = b0 + b1·x + b2·x² (x = ln cm/360). */
export function fitQuadratic(obs: Observation[]): Quadratic {
  let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, T0 = 0, T1 = 0, T2 = 0;
  for (const { x, y } of obs) {
    const x2 = x * x;
    S0 += 1; S1 += x; S2 += x2; S3 += x2 * x; S4 += x2 * x2;
    T0 += y; T1 += x * y; T2 += x2 * y;
  }
  const [b0, b1, b2] = solve3([[S0, S1, S2], [S1, S2, S3], [S2, S3, S4]], [T0, T1, T2]);
  return { b0, b1, b2 };
}

export interface PeakFit { optimalCm360: number; coeffs: Quadratic; curve: { x: number; mean: number }[]; }

/** Fit the peaked curve and return the optimum cm/360 (= exp(−b1/2b2)) plus a sampled curve. */
export function fitPeak(obs: Observation[]): PeakFit {
  const coeffs = fitQuadratic(obs);
  const xStar = -coeffs.b1 / (2 * coeffs.b2);
  const xs = obs.map(o => o.x);
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const curve: { x: number; mean: number }[] = [];
  const N = 60;
  for (let i = 0; i <= N; i++) {
    const x = lo + ((hi - lo) * i) / N;
    curve.push({ x, mean: coeffs.b0 + coeffs.b1 * x + coeffs.b2 * x * x });
  }
  return { optimalCm360: Math.exp(xStar), coeffs, curve };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/stats/psychometric.test.ts`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add src/stats/psychometric.ts tests/stats/psychometric.test.ts
git commit -m "feat(stats): psychometric peak fit (quadratic in ln cm/360)"
```

---

### Task 8: Bootstrap confidence interval (`src/stats/bootstrap.ts`)

**Files:**
- Create: `src/stats/bootstrap.ts`
- Test: `tests/stats/bootstrap.test.ts`

- [ ] **Step 1: Write the failing test** (seeded RNG → deterministic; CI brackets truth and widens with noise)

```ts
import { describe, it, expect } from 'vitest';
import { mulberry32, bootstrapCi } from '../../src/stats/bootstrap';
import type { Observation } from '../../src/types';

function dataset(noise: number, rng: () => number): Observation[] {
  const peakX = Math.log(35);
  const obs: Observation[] = [];
  for (const s of [18, 22, 26, 30, 35, 40, 46, 52, 58]) {
    const x = Math.log(s);
    const clean = -2 * (x - peakX) ** 2 + 5;
    obs.push({ x, y: clean + (rng() - 0.5) * noise });
  }
  return obs;
}

describe('bootstrap CI', () => {
  it('90% CI brackets the true optimum (low noise)', () => {
    const [lo, hi] = bootstrapCi(dataset(0.2, mulberry32(1)), 400, mulberry32(99));
    expect(lo).toBeLessThan(35);
    expect(hi).toBeGreaterThan(35);
  });

  it('CI widens as noise grows', () => {
    const tight = bootstrapCi(dataset(0.2, mulberry32(7)), 400, mulberry32(7));
    const loose = bootstrapCi(dataset(2.0, mulberry32(7)), 400, mulberry32(7));
    expect(loose[1] - loose[0]).toBeGreaterThan(tight[1] - tight[0]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/stats/bootstrap.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement `src/stats/bootstrap.ts`**

```ts
import type { Observation } from '../types';
import { fitQuadratic } from './psychometric';

/** Deterministic seeded PRNG (mulberry32) - used for reproducible bootstrap + tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const peakCm360 = (o: Observation[]): number => {
  const { b1, b2 } = fitQuadratic(o);
  return Math.exp(-b1 / (2 * b2));
};

/**
 * Parametric bootstrap 90% CI on the optimal cm/360.
 * Resamples residuals around the fitted curve, refits, and takes the 5th/95th percentiles.
 */
export function bootstrapCi(obs: Observation[], iters: number, rng: () => number): [number, number] {
  const fit = fitQuadratic(obs);
  const resid = obs.map(o => o.y - (fit.b0 + fit.b1 * o.x + fit.b2 * o.x * o.x));
  const peaks: number[] = [];
  for (let i = 0; i < iters; i++) {
    const resampled: Observation[] = obs.map(o => ({
      x: o.x,
      y: fit.b0 + fit.b1 * o.x + fit.b2 * o.x * o.x + resid[Math.floor(rng() * resid.length)],
    }));
    const p = peakCm360(resampled);
    if (Number.isFinite(p) && p > 0) peaks.push(p);
  }
  peaks.sort((a, b) => a - b);
  const at = (q: number) => peaks[Math.min(peaks.length - 1, Math.floor(q * peaks.length))];
  return [at(0.05), at(0.95)];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/stats/bootstrap.test.ts`
Expected: PASS (both).

- [ ] **Step 5: Run the full suite + commit**

Run: `npm test`
Expected: all suites pass (smoke, types, tokens, convert ×3, stats ×2).

```bash
git add src/stats/bootstrap.ts tests/stats/bootstrap.test.ts
git commit -m "feat(stats): parametric bootstrap CI on optimal cm/360"
```

---

## Phase 1 self-review

- **Spec coverage:** conversion math + yaw table + per-game output (spec §7) ✓; psychometric peak + CI (spec §5.3) ✓; brand tokens + Gefalent (spec §10) ✓; strict-TS + pure-core + Vitest foundation (spec §8 quality bar) ✓.
- **No placeholders:** every step has complete code, exact commands, and expected output.
- **Type consistency:** `GameId`, `YawEntry`, `Observation` come from `src/types.ts` (Task 2); `fitQuadratic` is defined in Task 7 and imported by Task 8 under the same name; `perGameSens` returns `Partial<Record<GameId, number>>` matching `Result.perGameSens`.
- **Deliverable:** `npm test` green; `npm run dev` shows the branded placeholder; `convert/` and `stats/` are ready for the optimizer/result phases to consume.
```
