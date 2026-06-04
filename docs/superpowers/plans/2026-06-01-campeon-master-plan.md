# campeón - Master Implementation Plan (Index)

> **For agentic workers:** This is the architecture + contract index. Each **phase** has its own detailed task plan (`2026-06-01-campeon-phase-N-*.md`) using checkbox (`- [ ]`) steps. REQUIRED SUB-SKILL to execute any phase: `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`.

**Goal:** Build `campeón`, a client-side web app that finds an FPS player's optimal mouse sensitivity (in cm/360) via four bio-inspired aim instruments, a Fitts/Kalman scorer, a Bayesian-optimization search, and a psychometric report - translated to native per-game sensitivities.

**Architecture:** A pure, unit-tested core (`convert`, `scoring`, `optimizer`, `stats`) that knows nothing about the DOM or Three.js, wrapped by an `engine` (Three.js arena + raw input) and a `ui` shell. Everything optimizes one scalar, `cm/360`; the per-game yaw table only converts at the input/output edges. State is local (`localStorage`) behind a `Storage` interface.

**Tech stack:** TypeScript (strict) · Vite · Three.js (arena) · Vitest (tests) · DOM + CSS + SVG (shell, falcon hero, motion). Optional small pure-TS libs: `ml-matrix` (GP/Kalman linear algebra), `ml-levenberg-marquardt` (nonlinear curve fit). No backend, no UI framework.

**Spec:** [docs/superpowers/specs/2026-06-01-campeon-design.md](../specs/2026-06-01-campeon-design.md)

---

## Quality bar (this is a design-engineer portfolio piece)

Every phase is held to both axes - engineering *and* design:
- Pure-core modules are TDD'd against published formulas; tests are meaningful, not coverage theater.
- `strict` TS, no `any` in core, typed boundaries, no dead code, legible commit history (one feature/fix per commit).
- Arena holds 60fps+; input handled per-frame with no lost counts; shell transitions are smooth.
- `prefers-reduced-motion` honored; shell is keyboard-navigable; sensible empty/error states.
- Brand fidelity (bone/slate/gold/ink, Gefalent, the falcon composition) is a deliverable, not an afterthought.

---

## File structure (whole app)

```
campeon/
├─ index.html
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
├─ vitest.config.ts
├─ public/
│  └─ fonts/                       # Gefalent OTF/TTF (Regular, Italic)
├─ src/
│  ├─ main.ts                      # app entry; mounts shell, routes screens
│  ├─ types.ts                     # SHARED CONTRACTS (see below) - single source of truth
│  ├─ convert/                     # PURE · cm/360 math + per-game yaw
│  │  ├─ cm360.ts                  # cmPer360, sensFor, crossGame
│  │  ├─ yaw-table.ts              # GAME_YAW: verified yaw constants + caveats
│  │  └─ schools.ts                # 360-distance (default) · monitor-distance (FOV-aware)
│  ├─ stats/                       # PURE · reporting
│  │  ├─ psychometric.ts           # quadratic-in-ln(s) peak fit → optimal cm/360
│  │  └─ bootstrap.ts              # parametric bootstrap → 90% CI ("the honest swarm")
│  ├─ scoring/                     # PURE · per-trial scores
│  │  ├─ fitts.ts                  # effective throughput (ISO 9241-9, We=4.133σ)
│  │  ├─ kalman.ts                 # CV target model; innovation = tracking error
│  │  ├─ bias-variance.ts          # bias vector, gain, σ_R, MSE decomposition
│  │  └─ submovement.ts            # velocity-trace segmentation (detect/orient/confirm)
│  ├─ optimizer/                   # PURE · search + session control
│  │  ├─ gp.ts                     # Gaussian process (Matérn-5/2), posterior
│  │  ├─ bayesopt.ts               # EI/UCB acquisition over ln(cm/360)
│  │  ├─ bandit.ts                 # UCB1 / Thompson fallback ("simple mode")
│  │  └─ session-controller.ts     # orchestrates trials → suggest → score → report
│  ├─ input/                       # raw mouse capture + validity
│  │  ├─ pointer-lock.ts           # requestPointerLock({unadjustedMovement}), fallback
│  │  ├─ accel-check.ts            # 2-swipe slow/fast acceleration detector
│  │  └─ dpi.ts                    # DPI entry/validation; normalized-count helper
│  ├─ engine/                      # Three.js arena
│  │  ├─ arena.ts                  # scene, renderer, tick/render loop
│  │  ├─ camera-rig.ts             # internal yaw (Y_app) → cm/360 view rotation
│  │  └─ targets.ts                # target spawning/movement (static, moving, grid)
│  ├─ instruments/                 # the four tests on one interface
│  │  ├─ track.ts                  # dragonfly + falcon
│  │  ├─ flick.ts                  # spider + raptor fovea
│  │  ├─ calibrate.ts              # archerfish
│  │  ├─ strike.ts                 # mantis shrimp
│  │  └─ registry.ts               # InstrumentId → Instrument
│  ├─ state/                       # persistence
│  │  ├─ storage.ts                # Storage interface + LocalStorage impl (cloud-ready)
│  │  └─ export.ts                 # session/result → JSON
│  ├─ ui/                          # shell (warm) + arena HUD
│  │  ├─ shell.ts                  # router/layout: hero · setup · session · result · case-study · options
│  │  ├─ hero/                     # the falcon-silhouette landing (HTML/CSS/SVG)
│  │  ├─ setup.ts                  # DPI + current game/sens + goal slider
│  │  ├─ gate.ts                   # validity gate UI (lock, accel check, browser stance)
│  │  ├─ session-view.ts           # live convergence curve + arena HUD
│  │  ├─ result.ts                 # cm/360 + CI + per-game table + breakdown + export
│  │  ├─ case-study/               # the science page (per-organism)
│  │  └─ options.ts                # conversion school, yaw overrides, search bounds
│  └─ styles/
│     ├─ tokens.css                # brand tokens (bone/slate/gold/ink, type, spacing)
│     └─ base.css
└─ tests/                          # mirrors src/ for pure modules (Vitest)
```

---

## Shared type contracts (`src/types.ts`)

All phases import from here. Defined once; never redefined. (Signatures are the contract; bodies live in their modules.)

```typescript
// ── units & identifiers ────────────────────────────────────────────────
export type Cm360 = number;          // physical cm of mouse travel per 360° turn (the optimization variable)
export type Dpi = number;            // mouse counts per inch (user-supplied; not browser-readable)
export type Degrees = number;
export type Ms = number;
export type GameId =
  | 'valorant' | 'cs2' | 'apex' | 'ow2' | 'cod' | 'fortnite' | 'r6' | 'pubg';

// ── conversion (convert/) ──────────────────────────────────────────────
export interface YawEntry { id: GameId; label: string; yaw: number; note?: string; }
//  cmPer360(dpi, sens, yaw): Cm360            = 914.4 / (dpi * sens * yaw)
//  sensFor(cm360, dpi, yaw): number           = 914.4 / (dpi * yaw * cm360)
//  crossGame(sens, dpiFrom, yawFrom, dpiTo, yawTo): number

// ── raw input (input/) ─────────────────────────────────────────────────
export interface AimSample { t: Ms; dx: number; dy: number; }   // normalized-count deltas (÷ devicePixelRatio)
export type PointerLockMode = 'raw' | 'os-adjusted';            // unadjustedMovement granted? (Chromium) or not

// ── arena (engine/) ────────────────────────────────────────────────────
export interface ArenaScene {
  setSensitivity(cm360: Cm360, dpi: Dpi): void;  // applies via internal yaw Y_app
  spawnTarget(spec: TargetSpec): TargetHandle;
  onAim(cb: (sample: AimSample, viewYawPitch: [Degrees, Degrees]) => void): () => void;
  clearTargets(): void;
}
export interface TargetSpec { kind: 'static' | 'moving' | 'grid'; /* phase-3 extends */ }
export interface TargetHandle { id: string; bearing(): [Degrees, Degrees]; radiusDeg(): Degrees; }

// ── instruments (instruments/) ─────────────────────────────────────────
export type InstrumentId = 'track' | 'flick' | 'calibrate' | 'strike';
export interface TrialContext { cm360: Cm360; dpi: Dpi; rng: () => number; profile: Profile; }
export interface TrialResult {
  instrument: InstrumentId;
  cm360: Cm360;
  score: number;                 // normalized, higher = better
  raw: Record<string, number>;   // instrument-specific metrics (E_lead, jitter, TP, bias, ttk, …)
  at: Ms;
}
export interface Instrument {
  id: InstrumentId;
  run(ctx: TrialContext, scene: ArenaScene): Promise<TrialResult>;
}

// ── scoring (scoring/) ─────────────────────────────────────────────────
export interface FittsCondition { amplitude: Degrees; width: Degrees; }
export interface Tap { mt: Ms; endpointErrorAlongAxis: Degrees; }
//  throughput(taps, condition): number               // bits/s, effective-width method
export interface Shot { error: [Degrees, Degrees]; required: Degrees; }
//  decompose(shots): { bias:[Degrees,Degrees]; gain:number; sigmaR:Degrees; mse:number }

// ── optimizer (optimizer/) ─────────────────────────────────────────────
export interface Observation { x: number; y: number; noise?: number; }  // x = ln(cm360)
export interface SearchEngine {
  suggest(history: Observation[], bounds: [Cm360, Cm360]): Cm360;
  isDone(history: Observation[]): boolean;
}

// ── reporting (stats/) ─────────────────────────────────────────────────
export interface Report {
  optimalCm360: Cm360;
  ci90: [Cm360, Cm360];
  curve: { x: number; mean: number }[];   // for the live plot
}

// ── session & result ───────────────────────────────────────────────────
export interface Profile { speedAccuracy: number; instrumentWeights: Record<InstrumentId, number>; }
export type SessionStatus = 'setup' | 'validating' | 'running' | 'complete';
export interface Session {
  id: string; dpi: Dpi; profile: Profile;
  trials: TrialResult[]; status: SessionStatus; createdAt: Ms;
}
export interface Result {
  optimalCm360: Cm360;
  ci90: [Cm360, Cm360];
  perGameSens: Partial<Record<GameId, number>>;
  breakdown: { biasZeroCm360: Cm360; precisionFloorDeg: Degrees; ttkMs: Ms; hitRate: number };
}

// ── persistence (state/) ───────────────────────────────────────────────
export interface Storage {
  saveSession(s: Session): void;
  loadSessions(): Session[];
  saveResult(sessionId: string, r: Result): void;
  exportJson(): string;
}
```

---

## Phase roadmap

Each phase is an independent, working, testable increment. Detailed task plans are written **just-in-time** before each phase executes (so each is planned with the fresh context of the prior phase's reality), unless the whole set is requested up front.

| # | Phase | Builds | Deliverable (working + testable) | Depends on |
|---|---|---|---|---|
| **1** | **Foundations** | scaffold, brand tokens + Gefalent, `convert/`, `stats/` | Vite app boots with brand tokens; `convert` + `stats` pass full unit tests against published formulas | - |
| **2** | **Input fidelity + engine** *(highest risk)* | `input/`, `engine/` | A pointer-locked Three.js arena you can mouse-look in at a set cm/360; accel-check gate works; raw vs os-adjusted detected; DPR-normalized | 1 |
| **3** | **Instruments + scoring** | `scoring/`, `instruments/` | Each of the 4 instruments runs a trial in the arena and returns a scored `TrialResult`; scorers unit-tested | 1, 2 |
| **4** | **Optimizer + session** | `optimizer/` | A full ~15–30-trial session: suggest cm/360 → run instrument → score → fit → `Report` with CI; converges on synthetic players in tests | 1, 3 |
| **5** | **Shell + flow** | `ui/`, `state/` | End-to-end product: hero → setup → gate → session (live curve) → result (cm/360 + CI + per-game table + export); persisted locally | 2, 4 |
| **6** | **Polish** | motion, `case-study/`, QA | 60fps pass, micro-interactions, the science page with citations, a11y + reduced-motion, error/empty states | 5 |

**Deferred tracks (post-core, separate plans):**
- **Falcon motion** - wing flap + parallax sky occluded by the wing silhouette (reduced-motion aware).
- **PSX arena skin** - low-res abyss → 2D-sprite run-and-gun (chrome Desert Eagle, ULTRAKILL), driven by supplied sprites.

---

## Execution model

- Build on a feature branch (not `main`); each phase may use a git worktree (`superpowers:using-git-worktrees`) when run by parallel agents.
- Per-phase: dispatch via `superpowers:subagent-driven-development` - fresh subagent per task, two-stage review between tasks, TDD throughout.
- After each phase: verify the deliverable runs, commit, then write the next phase's detailed plan.

---

## Self-review (index level)

- **Spec coverage:** every spec section maps to a phase - instruments §4→P3, engine §5→P4, input §6→P2, conversion §7→P1, architecture §8→all, flow §9→P5, visual identity §10→P5/P6, phasing §11→this roadmap, success criteria §12→P6 + per-phase tests. No section uncovered.
- **Contract consistency:** all phase plans import names from `src/types.ts`; this index is the single source for type/signature names.
- Detailed per-phase plans follow; each is self-reviewed against the spec when written.
