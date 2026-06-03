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
  // Phase 3 — the instrument-driving surface (the contract anticipated this):
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
export interface Observation { x: number; y: number; noise?: number; }  // x = ln(cm360)
export interface SearchEngine {
  suggest(history: Observation[], bounds: [Cm360, Cm360]): Cm360;
  // A self-contained budget signal for engine-driven callers. The Phase-4 session controller owns
  // stopping itself (trial cap + CI-width convergence), so `runSession` does NOT consult isDone.
  isDone(history: Observation[]): boolean;
  /** Optional: the surrogate's posterior-mean argmax — the model's own best-guess optimum, distinct
   *  from `suggest`'s acquisition argmax. The controller passes it to the report so the CI honestly
   *  widens when the flexible surrogate and the global parabola disagree (spec §5.3). */
  posteriorPeak?(history: Observation[], bounds: [Cm360, Cm360]): Cm360;
}

// ── reporting (stats/) ─────────────────────────────────────────────────
export interface Report {
  optimalCm360: Cm360;
  ci90: [Cm360, Cm360];
  curve: { x: number; mean: number }[];
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
