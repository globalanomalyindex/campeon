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
