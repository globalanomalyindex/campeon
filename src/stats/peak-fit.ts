import type { Observation } from '../types';

/**
 * Parabolic peak-finding: least-squares quadratic regression of a performance score against
 * x = ln(cm/360), with the optimum at the vertex x* = −b1/2b2.
 *
 * Terminology: this is quadratic peak interpolation - NOT a psychometric function. A psychometric
 * function is a sigmoid mapping stimulus intensity → P(correct), used for *threshold* estimation;
 * here the performance-vs-sensitivity curve is an inverted-U whose *peak* we want, locally
 * well-approximated by a parabola in log-sensitivity.
 */

export interface Quadratic { b0: number; b1: number; b2: number; }

/** Solve an n×n linear system A x = b by Gaussian elimination with partial pivoting. Same pivoting
 *  and elimination order for n = 3 as the original solve3, so the plain quadratic path is bit-for-bit
 *  unchanged (zero-drift byte-identity). */
function solveLin(A: number[][], b: number[]): number[] {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    [m[col], m[piv]] = [m[piv], m[col]];
    const d = m[col][col];
    if (d === 0) throw new Error('singular matrix in quadratic fit');
    for (let c = col; c <= n; c++) m[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row) => row[n]);
}

function solve3(A: number[][], b: number[]): [number, number, number] {
  const [b0, b1, b2] = solveLin(A, b);
  return [b0, b1, b2];
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

/**
 * Leverage (hat-matrix diagonal) per observation for the quadratic design [1, x, x²].
 *
 * A residual bootstrap resamples the FITTED residuals, and fitted residuals are systematically
 * smaller than the true errors: the fit is pulled toward each point, and hardest toward the
 * high-leverage ones at the ends of the range. Resampling them raw therefore understates the
 * noise and produces an interval narrower than the evidence supports. Scaling each residual by
 * 1/sqrt(1 - h_ii) removes exactly that shrinkage.
 *
 * h_ii = z_iᵀ (XᵀX)⁻¹ z_i with z_i = [1, x_i, x_i²]. For a p-parameter fit the diagonals sum to
 * p, so with n points they average p/n: the correction is large when the design is thin and
 * negligible when it is rich, which is the right behaviour.
 *
 * Returns an empty array when the design is too thin for the correction to mean anything
 * (n <= p, where every h_ii is 1) or when the normal equations are singular. Callers treat that
 * as "no correction", never as an error.
 */
export function hatDiagonal(obs: readonly Observation[]): number[] {
  const n = obs.length;
  if (n <= 3) return []; // n == p: every leverage is 1 and the correction is undefined
  let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0;
  for (const { x } of obs) {
    const x2 = x * x;
    S0 += 1; S1 += x; S2 += x2; S3 += x2 * x; S4 += x2 * x2;
  }
  const A = [[S0, S1, S2], [S1, S2, S3], [S2, S3, S4]];
  const out: number[] = [];
  for (const { x } of obs) {
    const z = [1, x, x * x];
    const w = solve3(A.map((row) => [...row]), [...z]);
    const h = z[0]! * w[0] + z[1]! * w[1] + z[2]! * w[2];
    if (!Number.isFinite(h)) return []; // singular design: no honest correction available
    out.push(h);
  }
  return out;
}

/**
 * The factor each residual is scaled by before resampling, one per observation.
 *
 * Always >= 1, so this can only ever WIDEN the resulting interval. That is deliberate and it is
 * the invariant a test pins: the canon allows an interval to widen and never to narrow.
 */
export function leverageScale(obs: readonly Observation[]): number[] {
  const h = hatDiagonal(obs);
  if (h.length !== obs.length) return obs.map(() => 1);
  return h.map((hi) => {
    // Clamp just below 1 so a numerically-saturated leverage cannot divide by zero. A point at
    // h = 1 is fitted exactly and carries no residual information at all.
    const safe = Math.min(Math.max(hi, 0), 1 - 1e-9);
    return 1 / Math.sqrt(1 - safe);
  });
}

export interface PeakFit { optimalCm360: number; coeffs: Quadratic; curve: { x: number; mean: number }[]; }

/** Sample the (detrended) quadratic over the observed x range - shared by the plain and drift fits. */
function sampleCurve(obs: readonly Observation[], q: Quadratic): { x: number; mean: number }[] {
  const xs = obs.map(o => o.x);
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const curve: { x: number; mean: number }[] = [];
  const N = 60;
  for (let i = 0; i <= N; i++) {
    const x = lo + ((hi - lo) * i) / N;
    curve.push({ x, mean: q.b0 + q.b1 * x + q.b2 * x * x });
  }
  return curve;
}

/**
 * Fit the parabola and return the optimum cm/360 (= exp(−b1/2b2)) plus a sampled curve.
 * Requires a concave fit (b2 < 0, a true peak). Throws if the data is convex/linear
 * (no interior maximum) - the Phase-4 session controller decides what to do (gather more
 * trials); the bootstrap CI path filters non-concave resamples rather than calling this.
 */
export function fitPeak(obs: Observation[]): PeakFit {
  const coeffs = fitQuadratic(obs);
  if (coeffs.b2 >= 0) {
    throw new Error(
      `fitPeak: fit is not concave (b2=${coeffs.b2.toFixed(4)}); need more observations or wider spread`,
    );
  }
  const xStar = -coeffs.b1 / (2 * coeffs.b2);
  return { optimalCm360: Math.exp(xStar), coeffs, curve: sampleCurve(obs, coeffs) };
}

/*
 * ── A4: ANCOVA session-drift adjustment ────────────────────────────────
 * Trials are sequential and the optimizer's (1+λ)-ES concentrates late trials near the incumbent, so
 * within-session learning/fatigue loads directly onto the x-curve and biases the peak. The extended
 * model y = b0 + b1·x + b2·x² + b3·τ (τ = standardized within-instrument trial order) partials the
 * trend out; the reported x-peak is −b1/2b2 of the DETRENDED quadratic, and b3 is disclosed as a
 * "session drift - practice or fatigue - removed from the number" readout (the data cannot tell the
 * two apart, so no copy may assert one cause).
 *
 * Honesty guards (all required - falling back means the b3 column is DROPPED, i.e. the plain
 * quadratic path runs bit-for-bit unchanged; b3 is never fit-near-zero and never padded):
 *   1. n ≥ DRIFT_MIN_OBS - a 4-parameter fit on fewer points has no honest drift resolution.
 *   2. Every observation carries a finite τ, and τ has spread - otherwise there is no tau signal.
 *   3. Conditioning check, not just an n threshold: R² of τ regressed on the quadratic design
 *      [1, x, x²] must stay below DRIFT_COLLINEARITY_R2 (VIF = 1/(1−R²) ≤ 10). Under heavy
 *      exploitation the trial order maps onto x and b3 becomes unidentifiable - reporting it then
 *      would be dishonest.
 *   4. The detrended fit must be concave (b2 < 0) with finite coefficients - no interior maximum
 *      means no honest detrended peak to report.
 */

export interface DriftQuadratic extends Quadratic { b3: number; }
export interface DriftPeakFit extends PeakFit { driftZ: number; }

/** Minimum observations for the extended (4-parameter) drift fit. */
export const DRIFT_MIN_OBS = 10;
/** Collinearity ceiling: R² of τ on [1, x, x²] at/above this makes b3 unidentifiable (VIF ≥ 10). */
export const DRIFT_COLLINEARITY_R2 = 0.9;

/** Least-squares fit of y = b0 + b1·x + b2·x² + b3·τ via the 4×4 normal equations. Throws on a
 *  singular design (same "singular matrix" family the plain fit throws). */
export function fitQuadraticDrift(obs: readonly Observation[]): DriftQuadratic {
  const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const rhs = [0, 0, 0, 0];
  for (const o of obs) {
    const cols = [1, o.x, o.x * o.x, o.tau ?? 0];
    for (let r = 0; r < 4; r++) {
      rhs[r] += cols[r] * o.y;
      for (let c = 0; c < 4; c++) A[r][c] += cols[r] * cols[c];
    }
  }
  const [b0, b1, b2, b3] = solveLin(A, rhs);
  return { b0, b1, b2, b3 };
}

/** Identifiability guard for the τ drift column (guards 1-3 above). */
export function driftIdentifiable(obs: readonly Observation[]): boolean {
  if (obs.length < DRIFT_MIN_OBS) return false;
  if (!obs.every((o) => o.tau !== undefined && Number.isFinite(o.tau))) return false;
  const taus = obs.map((o) => o.tau as number);
  const mu = taus.reduce((s, v) => s + v, 0) / taus.length;
  const ssTot = taus.reduce((s, v) => s + (v - mu) * (v - mu), 0);
  if (!(ssTot > 0)) return false; // constant τ → no tau signal
  // Conditioning: regress τ on [1, x, x²]; R² near 1 means the drift column lives inside the
  // quadratic design's span, so b3 (and the peak shift it implies) cannot be told apart from
  // curvature. A singular quadratic design is equally unidentifiable → fall back.
  let ssRes: number;
  try {
    const t = fitQuadratic(obs.map((o) => ({ x: o.x, y: o.tau as number })));
    ssRes = obs.reduce((s, o) => {
      const r = (o.tau as number) - (t.b0 + t.b1 * o.x + t.b2 * o.x * o.x);
      return s + r * r;
    }, 0);
  } catch {
    return false;
  }
  const r2 = 1 - ssRes / ssTot;
  return Number.isFinite(r2) && r2 < DRIFT_COLLINEARITY_R2;
}

/**
 * The guarded extended fit: coefficients when ALL honesty guards pass and the detrended quadratic is
 * concave with finite coefficients, else null (→ the caller runs the plain path with the b3 column
 * dropped). Shared by the finalize peak and the bootstrap so the two can never disagree on the path.
 */
export function fitDrift(obs: readonly Observation[]): DriftQuadratic | null {
  if (!driftIdentifiable(obs)) return null;
  let c: DriftQuadratic;
  try {
    c = fitQuadraticDrift(obs);
  } catch {
    return null; // singular extended design → no honest drift fit
  }
  const finite =
    Number.isFinite(c.b0) && Number.isFinite(c.b1) && Number.isFinite(c.b2) && Number.isFinite(c.b3);
  if (!finite || c.b2 >= 0) return null; // near-singular blow-up or no interior detrended maximum
  return c;
}

/**
 * Extended-fit peak: the vertex of the DETRENDED quadratic (τ partialled out at its zero mean - τ is
 * standardized per instrument, so the curve is the session-average level, not an endpoint's). Returns
 * null whenever `fitDrift` falls back; the caller then reports the plain fit and dashes the drift
 * readout.
 */
export function fitPeakDrift(obs: readonly Observation[]): DriftPeakFit | null {
  const c = fitDrift(obs);
  if (c === null) return null;
  const coeffs: Quadratic = { b0: c.b0, b1: c.b1, b2: c.b2 };
  const xStar = -c.b1 / (2 * c.b2);
  return { optimalCm360: Math.exp(xStar), coeffs, curve: sampleCurve(obs, coeffs), driftZ: c.b3 };
}
