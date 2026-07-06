// ── units & identifiers ────────────────────────────────────────────────
export type Cm360 = number;          // physical cm of mouse travel per 360° turn (the optimization variable)
export type Dpi = number;            // mouse counts per inch (user-supplied; not browser-readable)
export type Degrees = number;
export type Ms = number;
export type GameId =
  | 'valorant' | 'cs2' | 'apex' | 'ow2' | 'cod' | 'fortnite' | 'r6' | 'pubg';

// ── conversion (convert/) ──────────────────────────────────────────────
export interface YawEntry { id: GameId; label: string; yaw: number; note?: string; }

// ── raw input (input/) ─────────────────────────────────────────────────
export interface AimSample { t: Ms; dx: number; dy: number; }   // normalized-count deltas (÷ devicePixelRatio)
export type PointerLockMode = 'raw' | 'os-adjusted';

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
export interface TargetHandle { id: string; bearing(): [Degrees, Degrees]; radiusDeg(): Degrees; }

// ── instruments (instruments/) ─────────────────────────────────────────
export type InstrumentId = 'track' | 'flick' | 'calibrate' | 'strike';
export interface TrialContext { cm360: Cm360; dpi: Dpi; rng: () => number; profile: Profile; }
export interface TrialResult {
  instrument: InstrumentId;
  cm360: Cm360;
  score: number;                 // within-trial, higher = better (Phase 4 normalizes across the cm/360 sweep)
  raw: Record<string, number>;   // instrument-specific metrics
  at: Ms;
  /** Optional MEASURED standard error of `score` on its own native scale (Phase 1 heteroscedastic
   *  nugget). When finite > 0 the optimizer maps it through the affine z-score into a per-point GP
   *  noise term so a noisy trial is trusted less; a missing/zero/NaN SE falls back to the flat
   *  `noiseVar`. NEVER fabricated - a trial with no honest within-trial spread (e.g. a track
   *  recording too short to split into batch-means blocks, or with zero block spread) emits none. */
  scoreSE?: number;
}
export interface Instrument {
  id: InstrumentId;
  run(ctx: TrialContext, scene: ArenaScene): Promise<TrialResult>;
}

// ── scoring (scoring/) ─────────────────────────────────────────────────
export interface FittsCondition { amplitude: Degrees; width: Degrees; }
export interface Tap { mt: Ms; endpointErrorAlongAxis: Degrees; }
export interface Shot { error: [Degrees, Degrees]; required: Degrees; }

// ── optimizer (optimizer/) ─────────────────────────────────────────────
import type { GpParams } from './optimizer/gp';
export interface Observation {
  x: number;                     // ln(cm360)
  y: number;                     // blended z-score
  noise?: number;                // per-point GP nugget (P1-1, measured - never fabricated)
  /** Standardized within-instrument trial-order index (A4 drift covariate), set by
   *  `trialsToObservations` consistent with the per-instrument z-scoring: order index 0..n-1 within
   *  the instrument, centered and scaled to unit sample sd. Optional so hand-built/legacy observation
   *  sets carry NO tau signal - the finalize-only ANCOVA detrend then DROPS the b3 column entirely
   *  (plain quadratic path, byte-identical report), never fits a fabricated near-zero drift. */
  tau?: number;
}
export interface SearchEngine {
  suggest(history: Observation[], bounds: [Cm360, Cm360]): Cm360;
  // A self-contained budget signal for engine-driven callers. The Phase-4 session controller owns
  // stopping itself (trial cap + CI-width convergence), so `runSession` does NOT consult isDone.
  isDone(history: Observation[]): boolean;
  /** Optional: the surrogate's posterior-mean argmax - the model's own best-guess optimum, distinct
   *  from `suggest`'s acquisition argmax. The controller passes it to the report so the CI honestly
   *  widens when the flexible surrogate and the global parabola disagree (spec §5.3). */
  posteriorPeak?(history: Observation[], bounds: [Cm360, Cm360]): Cm360;
  /** Optional: the engine's BASE GP hyperparameters. Exposed so the controller can fit sharper
   *  hyperparameters by marginal likelihood at FINALIZE ONLY (never inside `suggest`, which would
   *  desync a stateful lineage). Present only on GP-backed engines. */
  gpParams?: GpParams;
  /** Optional: posterior-mean argmax computed with EXPLICITLY-supplied GP params - the finalize-only
   *  cross-check peak under fitted hyperparameters. Falls back to `posteriorPeak` when absent. */
  posteriorPeakWith?(history: Observation[], bounds: [Cm360, Cm360], params: GpParams): Cm360;
}

// ── reporting (stats/) ─────────────────────────────────────────────────
export interface Report {
  optimalCm360: Cm360;
  ci90: [Cm360, Cm360];
  curve: { x: number; mean: number }[];
  /** MEASURED session-drift coefficient b3 from the finalize-only ANCOVA detrend (A4): blended-σ of
   *  score per 1 sd of within-instrument trial order, partialled OUT of the reported optimum. The
   *  data cannot distinguish practice from fatigue, so copy built on this must name both and never
   *  assert one cause. Present ONLY when the extended fit was identifiable (n ≥ 10, tau carried, tau
   *  not collinear with the quadratic design); absent → the readout renders dashed, never padded. */
  driftZ?: number;
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
  breakdown: {
    biasZeroCm360: Cm360; precisionFloorDeg: Degrees; ttkMs: Ms; hitRate: number;
    /** Affine-fused track/flick contribution at the optimum (z-score σ units), the SAME quantity
     *  objective.ts fuses. Optional + NaN-when-unmeasurable so OLD saved Results render number-only and a
     *  tuned-by-feel value (which has no measured contribution) renders/plots none. */
    trackContribZ?: number; flickContribZ?: number;
  };
  /** Set when the number was hand-picked in the range, not measured. The result screen drops the 90% CI
   *  (a hand-picked value has no measured CI) and the exported JSON is self-describing (honesty). */
  tuned?: boolean;
  /** The fitted performance curve, copied VERBATIM from `Report.curve` (x = ln(cm/360)). Optional so OLD
   *  saved Results (which lack it) render number-only; a `tuned`-by-feel Result carries none (honesty -
   *  `adoptResult` drops it). The result screen reuses it to redraw the convergence plot as the climax. */
  curve?: { x: number; mean: number }[];
  /** The search bounds [lo, hi] cm/360 the curve was fit over - persisted so the plot's x-axis is correct
   *  after a localStorage reload (the in-memory draft bounds are gone by then). Optional + dropped on
   *  `tuned`, exactly like `curve`. */
  bounds?: [Cm360, Cm360];
  /** The speed↔accuracy lean the optimizer actually fused with (`Profile.speedAccuracy`, 0 = pure
   *  accuracy, 1 = pure speed) - the REAL taste knob, NOT the hardcoded `instrumentWeights.strike` (=1).
   *  Copied verbatim so the result screen can label the strike rows as the user's chosen lean. Optional so
   *  OLD saved Results (which lack it) render number-only; carried unchanged through `adoptResult` (the lean
   *  is the user's stated taste, not a measurement). */
  speedAccuracy?: number;
  /** The measured session-drift readout, copied verbatim from `Report.driftZ` (A4). A first-class
   *  honesty disclosure: the within-session trend - practice or fatigue, the data cannot say which -
   *  that was REMOVED from the reported number. Optional so OLD saved Results (and sessions where the
   *  extended fit fell back) render the readout dashed; the result screen gates it behind `!tuned`
   *  (a hand-picked value makes no drift-removal claim). */
  driftZ?: number;
}

// ── persistence (state/) ───────────────────────────────────────────────
export interface Storage {
  saveSession(s: Session): void;
  loadSessions(): Session[];
  saveResult(sessionId: string, r: Result): void;
  exportJson(): string;
}
