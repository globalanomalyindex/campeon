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
