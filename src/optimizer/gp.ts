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

/**
 * Exact log marginal likelihood of the data under `params` (constant prior mean = mean(y)):
 *   logML = −½ yᵀ K⁻¹ y − Σ log diag(L) − (n/2) log 2π,  K = L Lᵀ.
 * Throws (via `cholesky`) when the candidate kernel is not positive-definite. Per-point
 * `Observation.noise` overrides the flat `noiseVar` on the diagonal, exactly as `GP` does, so the
 * heteroscedastic nugget is honoured in the fit.
 */
function logMarginalLikelihood(params: GpParams, obs: readonly Observation[]): number {
  const n = obs.length;
  const priorMean = obs.reduce((s, o) => s + o.y, 0) / n;
  const K: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let k = matern52(obs[i].x, obs[j].x, params.signalVar, params.lengthScale);
      if (i === j) k += (obs[i].noise ?? params.noiseVar) + 1e-9 * params.signalVar;
      K[i][j] = k;
    }
  }
  const L = cholesky(K); // throws on non-PD; the caller treats that as an honest fallback
  const y = obs.map((o) => o.y - priorMean);
  const alpha = backSub(L, forwardSub(L, y));
  let yKy = 0;
  for (let i = 0; i < n; i++) yKy += y[i] * alpha[i];
  let logDet = 0;
  for (let i = 0; i < n; i++) logDet += Math.log(L[i][i]);
  return -0.5 * yKy - logDet - 0.5 * n * Math.log(2 * Math.PI);
}

/**
 * Fit the GP `lengthScale` and `noiseVar` by maximizing the exact log marginal likelihood over a
 * COARSE DETERMINISTIC grid (no RNG, no calculus - pure and reproducible). `signalVar` is PINNED to
 * `base.signalVar` (the prior amplitude is set by the affine z-score, not re-estimated here); only:
 *   - lengthScale ∈ [0.1·L, 1.0·L]   where L = ln(hi/lo) from `bounds` (the search-space span)
 *   - noiseVar    ∈ [1e-3, 1]·signalVar
 * are tuned. This is wired at FINALIZE ONLY (never inside `evolution.suggest`, which would desync the
 * stateful (1+λ)-ES lineage). Honest fallbacks that return `base` UNCHANGED:
 *   - fewer than 8 observations (not enough data to fit two hyperparameters honestly),
 *   - any candidate kernel is non-PD (Cholesky throws) at the best point, or
 *   - the best grid logML does not beat `base`'s logML by at least a small epsilon.
 * Because the fit can only ever sharpen the surrogate's cross-check peak (it never rescales y and
 * never replaces the conservative bootstrap CI), it can only WIDEN the honest CI, never narrow it.
 */
export function fitGpParams(
  obs: readonly Observation[],
  base: GpParams,
  bounds: [number, number],
): GpParams {
  if (obs.length < 8) return base;

  const L = Math.log(bounds[1] / bounds[0]);
  const lengthGrid = [0.1, 0.2, 0.35, 0.5, 0.7, 0.85, 1.0].map((f) => f * L);
  const noiseGrid = [1e-3, 3e-3, 1e-2, 3e-2, 0.1, 0.3, 1].map((f) => f * base.signalVar);

  // Baseline: the data's likelihood under the unchanged base params. A non-PD base (should not
  // happen with a positive nugget) means we cannot honestly compare, so keep base.
  let baseLogML: number;
  try {
    baseLogML = logMarginalLikelihood(base, obs);
  } catch {
    return base;
  }

  let bestLogML = -Infinity;
  let bestLength = base.lengthScale;
  let bestNoise = base.noiseVar;
  for (const lengthScale of lengthGrid) {
    for (const noiseVar of noiseGrid) {
      let logML: number;
      try {
        logML = logMarginalLikelihood({ signalVar: base.signalVar, lengthScale, noiseVar }, obs);
      } catch {
        continue; // non-PD candidate → skip it (honest: never accept an unstable kernel)
      }
      if (logML > bestLogML) {
        bestLogML = logML;
        bestLength = lengthScale;
        bestNoise = noiseVar;
      }
    }
  }

  const EPS = 1e-6; // require a real (not numerical-noise) improvement to move off base
  if (!Number.isFinite(bestLogML) || bestLogML < baseLogML + EPS) return base;
  return { signalVar: base.signalVar, lengthScale: bestLength, noiseVar: bestNoise };
}
