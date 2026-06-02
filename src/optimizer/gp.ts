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
