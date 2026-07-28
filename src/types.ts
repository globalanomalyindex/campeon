import type { Prescription } from './optimizer/result';

// ── units & identifiers ────────────────────────────────────────────────
/** Mouse counts of travel for one full 360 turn. The optimisation variable and the tool's own unit.
 *  Branded deliberately: a bare number alias gives the compiler no way to catch a unit swap, and
 *  this migration is exactly a unit swap, so the brand is what makes tsc enumerate every call site.
 *  Pinned by tests/types.test.ts "refuses a bare number where a count total is required". */
export type Counts360 = number & { readonly __unit: 'counts360' };
export const counts360 = (n: number): Counts360 => n as Counts360;
/** A search window in counts. Exists because arithmetic on a branded number widens back to `number`,
 *  so every clamp, exp and geometric midpoint has to re-brand, and a pair of them is the shape that
 *  recurs (bounds, CIs, adopted ranges). */
export const countsBounds = (lo: number, hi: number): [Counts360, Counts360] =>
  [counts360(lo), counts360(hi)];
export type Degrees = number;
export type Ms = number;
export type GameId =
  | 'valorant' | 'cs2' | 'apex' | 'ow2' | 'cod' | 'fortnite' | 'r6' | 'pubg';

// ── conversion (convert/) ──────────────────────────────────────────────
export interface YawEntry { id: GameId; label: string; yaw: number; note?: string; }

// ── raw input (input/) ─────────────────────────────────────────────────
export interface AimSample { t: Ms; dx: number; dy: number; }   // browser movement deltas, untouched
export type PointerLockMode = 'raw' | 'os-adjusted';

// ── arena (engine/) ────────────────────────────────────────────────────
export interface ArenaScene {
  setSensitivity(counts: Counts360): void;
  spawnTarget(spec: TargetSpec): TargetHandle;
  onAim(cb: (sample: AimSample, viewYawPitch: [Degrees, Degrees]) => void): () => void;
  clearTargets(): void;
  /** The target being presented right now, or null between presentations.
   *
   *  Target lifetime belongs to the instruments: each one spawns a target, clears it, and spawns the
   *  next, holding the handle in a local nobody else sees. So nothing outside an instrument could
   *  answer this question, which is why the anchor's observational channel
   *  (src/anchor/reach-observer.ts) asks the scene rather than the session config: it is the only
   *  place the answer exists. Newest wins when several are up, which is the free-play range's case
   *  and never the scored one. Read-only, and safe to call on every frame.
   *  Regression: tests/engine/arena-active-target.test.ts. */
  activeTarget(): TargetHandle | null;
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
export interface TrialContext {
  counts: Counts360;
  rng: () => number;
  profile: Profile;
  /** The counts per 360 the player arrived at this trial adapted to - normally the previous trial's
   *  value, or the setting they walked in with on the first trial. Consumed ONLY by the unscored
   *  acclimation lead-in (src/instruments/acclimation.ts) to size how much practice the player
   *  gets before scoring starts: adaptation cost grows with |ln(new) - ln(prev)|, so a near
   *  neighbour needs less than a jump across the range. Absent = arrival gain unknown, and the
   *  lead-in then spends its FULL budget (treat an unknown as a far jump, never as a near one).
   *  It never touches scoring, geometry, or the shared rng stream. */
  prevCounts?: Counts360;
}
export interface TrialResult {
  instrument: InstrumentId;
  counts: Counts360;
  score: number;                 // within-trial, higher = better (Phase 4 normalizes across the counts sweep)
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
  x: number;                     // ln(counts)
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
  suggest(history: Observation[], bounds: [Counts360, Counts360]): Counts360;
  // A self-contained budget signal for engine-driven callers. The Phase-4 session controller owns
  // stopping itself (trial cap + CI-width convergence), so `runSession` does NOT consult isDone.
  isDone(history: Observation[]): boolean;
  /** Optional: the surrogate's posterior-mean argmax - the model's own best-guess optimum, distinct
   *  from `suggest`'s acquisition argmax. The controller passes it to the report so the CI honestly
   *  widens when the flexible surrogate and the global parabola disagree (spec §5.3). */
  posteriorPeak?(history: Observation[], bounds: [Counts360, Counts360]): Counts360;
  /** Optional: the engine's BASE GP hyperparameters. Exposed so the controller can fit sharper
   *  hyperparameters by marginal likelihood at FINALIZE ONLY (never inside `suggest`, which would
   *  desync a stateful lineage). Present only on GP-backed engines. */
  gpParams?: GpParams;
  /** Optional: posterior-mean argmax computed with EXPLICITLY-supplied GP params - the finalize-only
   *  cross-check peak under fitted hyperparameters. Falls back to `posteriorPeak` when absent. */
  posteriorPeakWith?(history: Observation[], bounds: [Counts360, Counts360], params: GpParams): Counts360;
}

// ── reporting (stats/) ─────────────────────────────────────────────────
export interface Report {
  optimalCounts: Counts360;
  ci90: [Counts360, Counts360];
  curve: { x: number; mean: number }[];
  /** MEASURED session-drift coefficient b3 from the finalize-only ANCOVA detrend (A4): blended-σ of
   *  score per 1 sd of within-instrument trial order, partialled OUT of the reported optimum. The
   *  data cannot distinguish practice from fatigue, so copy built on this must name both and never
   *  assert one cause. Present ONLY when the extended fit was identifiable (n ≥ 10, tau carried, tau
   *  not collinear with the quadratic design); absent → the readout renders dashed, never padded. */
  driftZ?: number;
  /** Set when the fitted vertex landed OUTSIDE the searched range and was clamped to that edge. The
   *  reported optimum is then a BOUND on the answer with the evidence pointing past it: 'high' means
   *  the fit peaked above the range (the number is at least the edge), 'low' below it (at most the
   *  edge). Absent means the vertex was interior (a located optimum) or no peak was fittable at all
   *  (the full-bounds fallback is its own honesty signal). Never inferred, never fabricated. */
  peakAtBound?: 'low' | 'high';
}

// ── facet concordance (A5: is "one latent cm/360" true, or four numbers we averaged?) ──────────
/** How well the fittable facets' OWN peaks agree - a geometric observation over measured peaks, never
 *  a cause. `concordant` = the views converge on one answer; `divergent` = they genuinely disagree
 *  (shown as honest doubt, the thesis being tested rather than assumed). Undefined tier = inconclusive. */
export type Concordance = 'concordant' | 'some-spread' | 'divergent';
export interface FacetPeak {
  instrument: InstrumentId;
  /** The facet's OWN concave-fit peak (counts per 360) from its own trials, or undefined when they cannot
   *  support one (< the minimum points, non-concave, or an unstable bootstrap) - dashed, never faked. */
  peakCounts?: Counts360;
  /** Half-width of a reduced-iter residual bootstrap in ln space - a SPREAD, deliberately NOT reported
   *  as a 90% CI (a ~6-point facet fit cannot earn that coverage claim), floored so small-sample
   *  optimism cannot manufacture a false disagreement. Undefined exactly when `peakCounts` is. */
  spreadLn?: number;
  /** strike's peak is speed↔accuracy TASTE-conditioned (it blends by `profile.speedAccuracy`), so it is
   *  not a fourth estimate of the same latent constant: shown as a labeled marker, EXCLUDED from the tier. */
  laneConditioned: boolean;
}
export interface FacetConcordance {
  facets: FacetPeak[];
  /** The agreement tier over the fittable NON-strike facets, or undefined when fewer than two are
   *  fittable (inconclusive) - never a fabricated verdict. */
  tier?: Concordance;
}

// ── session & result ───────────────────────────────────────────────────
export interface Profile { speedAccuracy: number; instrumentWeights: Record<InstrumentId, number>; }
export type SessionStatus = 'setup' | 'validating' | 'running' | 'complete';
export interface Session {
  id: string; profile: Profile;
  trials: TrialResult[]; status: SessionStatus; createdAt: Ms;
}
export interface Result {
  optimalCounts: Counts360;
  /** The measured 90 percent interval. ABSENT means the value was tuned by feel rather than located,
   *  and a hand-picked value carries no measured interval. Never fabricated, never widened to fill. */
  ci90?: [Counts360, Counts360];
  breakdown: {
    biasZeroCounts: Counts360; precisionFloorDeg: Degrees; ttkMs: Ms; hitRate: number;
    /** Affine-fused track/flick contribution at the optimum (z-score σ units), the SAME quantity
     *  objective.ts fuses. Optional + NaN-when-unmeasurable so OLD saved Results render number-only and a
     *  tuned-by-feel value (which has no measured contribution) renders/plots none. */
    trackContribZ?: number; flickContribZ?: number;
  };
  /** Set when the number was hand-picked in the range, not measured. The result screen drops the 90% CI
   *  (a hand-picked value has no measured CI) and the exported JSON is self-describing (honesty). */
  tuned?: boolean;
  /** The three-tier prescription: the multiply factor, its interval, the located optimum, and (only
   *  behind a pinned count convention) the per-game table. Optional because a phase-1 build can
   *  finish a session with no anchor at all, and because an anchor interval that spans a ratio of 1
   *  has no factor to report. Absent means the screen renders its honest fallback rather than a
   *  fabricated multiplier. Phase 1b owns the shape and the builder; the field lives here because
   *  the Result is what gets persisted and exported. */
  prescription?: Prescription;
  /** The fitted performance curve, copied VERBATIM from `Report.curve` (x = ln(counts/360)). Optional so OLD
   *  saved Results (which lack it) render number-only; a `tuned`-by-feel Result carries none (honesty -
   *  `adoptResult` drops it). The result screen reuses it to redraw the convergence plot as the climax. */
  curve?: { x: number; mean: number }[];
  /** The search bounds [lo, hi] cm/360 the curve was fit over - persisted so the plot's x-axis is correct
   *  after a localStorage reload (the in-memory draft bounds are gone by then). Optional + dropped on
   *  `tuned`, exactly like `curve`. */
  bounds?: [Counts360, Counts360];
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
  /** A5: the per-facet peaks + concordance tier - the "one latent cm/360" thesis tested as a claim.
   *  Each facet's own concave-fit peak (dashed when unfittable) + a conservative tier over the fittable
   *  non-strike facets, so the result screen can SHOW four markers triangulating (or honestly disagreeing
   *  on) one answer. Optional so OLD saved Results render without it; dropped on `tuned` (a hand-picked
   *  value has no measured concordance) and gated behind `!tuned` at the screen. */
  facetConcordance?: FacetConcordance;
  /** Copied verbatim from `Report.peakAtBound`: the reported number sits on a clamped EDGE of the
   *  searched window and is a bound on the answer, with the evidence pointing past it. The result
   *  screen swaps the measured-CI line for bound copy and offers the wider-search route. Optional so
   *  OLD saved Results (which lack it) render as before; absence carries no claim either way and the
   *  flag is never inferred from the optimum happening to sit on an edge. */
  peakAtBound?: 'low' | 'high';
}

// ── persistence (state/) ───────────────────────────────────────────────
/**
 * The remembered calibration + presentation preferences (campeon.prefs.v1): what a returning
 * visitor should NOT have to redo. Everything here is either user-chosen (game, sens, taste) or
 * measured once (the seeded search window in counts) - never a scored outcome; results live in
 * their own store and `lastSessionId` is only a POINTER into it.
 */
export interface PersistedPrefs {
  currentGame: GameId;
  currentSens: number;
  /** The speed/accuracy taste knob (profile.speedAccuracy). */
  speedAccuracy: number;
  bounds: [Counts360, Counts360];
  /** The session whose result was last shown, so a reload lands back on the number. */
  lastSessionId?: string;
}

export interface Storage {
  saveSession(s: Session): void;
  loadSessions(): Session[];
  saveResult(sessionId: string, r: Result): void;
  exportJson(): string;
  /** Optional (newer backends): saved results keyed by sessionId, for restoring the last result. */
  loadResults?(): Record<string, Result>;
  /** Optional (newer backends): remember calibration prefs. Consumers must feature-check. */
  savePrefs?(p: PersistedPrefs): void;
  /** Optional: the remembered prefs, or null when absent/invalid (validated on read, never thrown). */
  loadPrefs?(): PersistedPrefs | null;
}
