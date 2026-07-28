import type { Counts360, Observation, SearchEngine } from '../types';
import { counts360 } from '../types';
import { GP, type GpParams } from './gp';
import { mulberry32 } from '../stats/rng';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export interface EvolutionConfig {
  gp: GpParams;
  /** Offspring spawned per generation; the screen picks which one is worth actually playing (default 6). */
  lambda?: number;
  /** Initial mutation step σ in ln(cm/360) space (default 0.3 - a sane spread; ln[15,60] spans ≈1.39). */
  sigma0?: number;
  /** σ clamp [min, max] so a generation neither freezes nor scatters across the whole range (default [0.04, 0.9]). */
  sigmaBounds?: [number, number];
  /** Dense grid resolution for the incumbent (posterior-mean argmax) (default 96). */
  gridSize?: number;
  /** Trust-region success threshold for the 1/5 rule: a generation counts as progress when the located
   *  optimum moves by at least this fraction of the step that was spawned (default 0.25). */
  moveFrac?: number;
  /** Seed for the deterministic mutation RNG (default 0x5eed). */
  seed?: number;
  /** Budget for `isDone` only - the session controller owns stopping in practice (default 24). */
  maxTrials?: number;
}

/** Symmetric 3x3 inverse by the adjugate; null when the matrix is numerically singular. */
function inv3(M: readonly number[][]): number[][] | null {
  const [a, b, c] = M[0];
  const [d, e, f] = M[1];
  const [g, h, i] = M[2];
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * B + c * C;
  // Scale-aware singularity test: compare the determinant against the cube of the largest entry, so
  // the threshold means the same thing whether the design holds 8 points or 30.
  let scale = 0;
  for (const row of M) for (const v of row) scale = Math.max(scale, Math.abs(v));
  if (!Number.isFinite(det) || Math.abs(det) <= 1e-12 * scale * scale * scale) return null;
  return [
    [A / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [C / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

export interface VertexScreen {
  /** Reduction in Var(vertex), in units of the residual variance σ², that a trial at `candidateX`
   *  would buy. Always ≥ 0; larger is a more informative trial. */
  gain(candidateX: number): number;
}

/**
 * The design criterion the reported number actually cares about.
 *
 * campeón reports the VERTEX of a quadratic fitted over x = ln(cm/360), not the argmax of a search.
 * Fit y = b0 + b1·x + b2·x² by ordinary least squares (that is what `fitQuadratic` does, so this
 * targets the estimator that is actually reported) and the vertex is v = −b1/2b2, whose variance by
 * the delta method is σ²·gᵀM⁻¹g with M = Σ f(xᵢ)f(xᵢ)ᵀ, f(x) = (1, x, x²) and g = ∂v/∂b ∝ (0, 1, 2v).
 * Adding one trial at x updates M by the rank-1 term f(x)f(x)ᵀ, so by Sherman-Morrison the variance
 * of the vertex falls by exactly
 *
 *     (gᵀM⁻¹f(x))² / (1 + f(x)ᵀM⁻¹f(x))
 *
 * times σ². The common σ² and the scale of g drop out of any comparison, so only the direction of g
 * matters, and that direction is fixed by the current vertex estimate alone. This is local
 * c-optimality for the vertex (Elfving), which is the same criterion the reported interval divides by.
 *
 * The one property worth reading off the algebra: on a design symmetric about the estimated vertex,
 * gᵀM⁻¹f(v) is exactly zero, so **a trial at the current estimate buys nothing at all about where
 * that estimate is**. ∂y/∂v = −2a(x − v) vanishes at the vertex; a point there constrains the level
 * and the curvature, never the location. Any screen that prefers candidates near the incumbent is
 * therefore spending the player's trials on the least informative sensitivity available.
 *
 * Pure and stateless. Internally x is centred on the design mean for conditioning only: all three
 * quadratic forms above are invariant under an affine change of the polynomial basis, so the returned
 * number does not depend on the centring. Returns null when the design cannot support a quadratic at
 * all (fewer than 3 points, or a singular information matrix); the caller then has no vertex variance
 * to reduce and must fall back on something else.
 */
export function vertexInfoScreen(obs: readonly Observation[], vertexX: number): VertexScreen | null {
  const n = obs.length;
  if (n < 3) return null;
  let c = 0;
  for (const o of obs) c += o.x;
  c /= n;
  let S1 = 0, S2 = 0, S3 = 0, S4 = 0;
  for (const o of obs) {
    const u = o.x - c, u2 = u * u;
    S1 += u; S2 += u2; S3 += u2 * u; S4 += u2 * u2;
  }
  const Mi = inv3([[n, S1, S2], [S1, S2, S3], [S2, S3, S4]]);
  if (Mi === null) return null;
  const g = [0, 1, 2 * (vertexX - c)];
  const gM = [0, 1, 2].map((r) => g[0] * Mi[0][r] + g[1] * Mi[1][r] + g[2] * Mi[2][r]);
  return {
    gain(candidateX: number): number {
      const u = candidateX - c;
      const f = [1, u, u * u];
      const gMf = gM[0] * f[0] + gM[1] * f[1] + gM[2] * f[2];
      let fMf = 0;
      for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) fMf += f[r] * Mi[r][s] * f[s];
      return (gMf * gMf) / (1 + Math.max(0, fMf));
    },
  };
}

/**
 * Evolution-strategy SearchEngine over x = ln(cm/360) - a surrogate-assisted (1+λ)-ES.
 *
 * The search IS the evolution the predators themselves underwent: it keeps a single lineage and, each
 * generation, mutates the **incumbent** (the fittest sensitivity so far) by a Gaussian step σ to spawn
 * λ offspring, then plays the one worth the player's next trial. Selection is elitist - the fittest
 * sensitivity always survives as the next parent - and the step size self-adapts by Rechenberg's
 * **1/5 success rule** (the located optimum keeps moving → widen the search; it settles → narrow in and
 * refine). Over generations the lineage climbs to the optimum: the most-evolved sensitivity for this
 * player.
 *
 * Distinct from Bayesian optimization (which maximizes an acquisition GLOBALLY and may jump anywhere):
 * here every proposal is a LOCAL mutation of the current best - that is what makes it genuinely
 * evolutionary rather than evolution-flavored search. The Gaussian-process surrogate is the lineage's
 * memory of the fitness landscape: it supplies the denoised incumbent, so a lucky-noise trial cannot
 * become the parent.
 *
 * Stateful across `suggest` calls - σ and the success window persist, because generations are a
 * sequence, not independent draws. The controller's cold-start seeds are Generation 0 (the initial
 * gene pool); the first `suggest` selects the fittest of them as the founding parent.
 *
 * What the screen selects FOR (and why it is not expected improvement). The number this product
 * reports is the vertex of a quadratic fit, and the interval around it divides by the spread of the
 * design. Screening the offspring by expected improvement against the parent's posterior mean was
 * measurably the wrong objective, and inverted: the parent IS the posterior-mean grid maximum, so no
 * candidate can improve on it, every EI came out on the σ term alone, and the screen reliably returned
 * the offspring CLOSEST to the parent. Measured on a simulated session, mean rank 5.68 out of 6
 * counting from the farthest, a realised step of 0.072 in ln space against a nominal σ of 0.3
 * (≈ E[min |Z|] over 6 draws, which is the signature of a pure minimum-distance rule), and a realised
 * step that FELL as λ rose (0.165 at λ=2 down to 0.040 at λ=16). A bigger screening budget bought a
 * worse design. Worse than neutral: a trial at the incumbent carries exactly zero information about
 * where the incumbent is (see `vertexInfoScreen`), so the screen was spending the player's scarce
 * trials on the least informative sensitivity on offer, and it was concentrating the smallest
 * adaptation cost of the session exactly on the sensitivity the search was seeded at.
 *
 * The screen is now local c-optimality for the vertex: of the λ offspring, play the one that most
 * reduces the variance of the number that gets reported. It is nested in λ (the offspring share one
 * RNG stream, so raising λ can only widen the set the maximum is taken over), which is what a
 * screening budget is supposed to do.
 *
 * This changes where trials are spent, and nothing else. The interval is still the same bootstrap over
 * whatever data arrived, so a tighter interval here is earned by a better design, never by
 * construction. What it earns, measured over 750 simulated 30-trial sessions against a known optimum:
 * mean absolute error on the reported number falls 22% (1.52 to 1.19 cm) and the reported 90% interval
 * narrows 27% (6.87 to 5.04 cm). The accuracy gain is most of the narrowing but not all of it, and the
 * rest is not earned: empirical coverage of the nominal 90% interval goes 88.0% to 86.8%. That gap
 * belongs to the interval computation, not to this screen. A design that is spread but completely
 * independent of the data (a 30-point uniform grid, no search at all) covers 85.9% on the same
 * simulation, so the residual bootstrap under-covers at any spread; see the leverage-correction item in
 * docs/design/open-measurement-questions.md §3. A wider design exposes it, it does not cause it.
 *
 * Where the accuracy comes from is worth stating, because it is not simply "more spread". Var(vertex)
 * is inflated when the design is asymmetric ABOUT THE VERTEX, and a cold-start grid is symmetric about
 * the middle of the player's declared range, which is almost never where their optimum is. The
 * criterion's directional term re-centres the design on the located optimum. Measured in ln space, the
 * uniform grid's error nearly triples as the true optimum moves from the middle of the range to the
 * edge (0.0275 at 30 cm/360, 0.0712 at 46), while this design stays roughly flat (0.0347, 0.0463). At
 * dead centre the plain grid is the better design and wins, as the algebra says it should. Off centre
 * this one wins by about a third. So the practical gain is that the measurement no longer quietly gets
 * worse for players whose optimum sits near the edge of the range they typed in.
 */
export function makeEvolution(config: EvolutionConfig): SearchEngine {
  const lambda = config.lambda ?? 6;
  const sigma0 = config.sigma0 ?? 0.3;
  const [sigMin, sigMax] = config.sigmaBounds ?? [0.04, 0.9];
  const gridSize = config.gridSize ?? 96;
  const moveFrac = config.moveFrac ?? 0.25;
  const maxTrials = config.maxTrials ?? 24;
  const rng = mulberry32(config.seed ?? 0x5eed);

  // Evolutionary state - one lineage across generations.
  let sigma = sigma0;
  let lastParentX: number | null = null; // where the located optimum sat when the last offspring was spawned
  let lastSpawnSigma = sigma0; // the step that offspring was spawned with
  let winEvals = 0; // generations in the current 1/5-rule adaptation window
  let winSucc = 0; // of those, how many moved the located optimum

  /** Standard normal via Box–Muller from the engine's own seeded stream (deterministic mutation). */
  const gauss = (): number => {
    const u = Math.max(1e-12, rng());
    const v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  /** The incumbent: the sensitivity of highest denoised (GP posterior-mean) fitness - elitist parent. */
  const incumbent = (gp: GP, loX: number, hiX: number): number => {
    let bestX = loX;
    let best = -Infinity;
    for (let i = 0; i <= gridSize; i++) {
      const x = loX + ((hiX - loX) * i) / gridSize;
      const m = gp.predict(x).mean;
      if (m > best) {
        best = m;
        bestX = x;
      }
    }
    return bestX;
  };

  return {
    suggest(history: Observation[], bounds: [Counts360, Counts360]): Counts360 {
      const loX = Math.log(bounds[0]);
      const hiX = Math.log(bounds[1]);
      if (history.length === 0) return counts360(Math.exp((loX + hiX) / 2));
      const gp = new GP(config.gp, history);
      const parentX = incumbent(gp, loX, hiX);

      // 1/5 success rule, read as a trust region. Rechenberg's rule measures the progress a step buys,
      // and under an information-seeking screen the offspring is chosen to be informative rather than
      // fit, so "did it beat the parent's fitness" can never fire and would decay σ on a fixed schedule
      // while calling itself adaptive. What this search is trying to progress is a LOCATION, so the
      // progress signal is movement of the located optimum, measured against the step that produced it:
      // still relocating the peak means keep reaching, a peak that stops moving means narrow in and
      // refine. Same window, same 1/5 threshold, same clamps.
      if (lastParentX !== null) {
        winEvals += 1;
        if (Math.abs(parentX - lastParentX) > moveFrac * lastSpawnSigma) winSucc += 1;
        if (winEvals >= lambda) {
          sigma = clamp(winSucc / winEvals > 0.2 ? sigma * 1.5 : sigma / 1.5, sigMin, sigMax);
          winEvals = 0;
          winSucc = 0;
        }
      }

      // Spawn λ offspring by Gaussian mutation around the parent, then play the one that most sharpens
      // the reported vertex. When the design is too thin to support a quadratic at all there is no
      // vertex variance to reduce yet, so the honest substitute is the offspring that fills the design
      // best (farthest from every point already measured).
      const screen = vertexInfoScreen(history, parentX);
      const score = (x: number): number => {
        if (screen !== null) return screen.gain(x);
        let d = Infinity;
        for (const o of history) d = Math.min(d, Math.abs(o.x - x));
        return d;
      };
      let chosen = parentX;
      let bestScore = -Infinity;
      for (let k = 0; k < lambda; k++) {
        // Offspring outside the range are clamped to the bound, not reflected back inside. Clamping
        // does put an atom on the boundary, and since this screen prefers the outermost offspring an
        // off-centre parent proposes the bound itself repeatedly. Reflection was tried instead, on the
        // grounds that replicated boundary rows carry the design's highest leverage and are the most
        // likely to sit in floor-effect territory: over 750 simulated sessions it made the located
        // vertex LESS accurate (1.29 against 1.19 cm mean absolute error) and did not improve interval
        // coverage (86.9% against 86.8%). Leverage is not what limits calibration here, and reflection
        // only costs spread, so clamping stays.
        const x = clamp(parentX + sigma * gauss(), loX, hiX);
        const s = score(x);
        if (s > bestScore) {
          bestScore = s;
          chosen = x;
        }
      }

      lastParentX = parentX;
      lastSpawnSigma = sigma;
      return counts360(Math.exp(chosen));
    },
    isDone(history: Observation[]): boolean {
      return history.length >= maxTrials;
    },
    /** GP posterior-mean argmax - the most-evolved sensitivity; also the controller's CI cross-check. */
    posteriorPeak(history: Observation[], bounds: [Counts360, Counts360]): Counts360 {
      return this.posteriorPeakWith!(history, bounds, config.gp);
    },
    /** The base GP hyperparameters - exposed so the controller can fit sharper ones at FINALIZE
     *  ONLY. The stateful (1+λ)-ES lineage above always uses `config.gp`, never the fitted set. */
    gpParams: config.gp,
    /** Posterior-mean argmax under EXPLICIT params - the finalize-only cross-check under fitted
     *  hyperparameters. Stateless: reads no lineage state, so calling it never perturbs the search. */
    posteriorPeakWith(history: Observation[], bounds: [Counts360, Counts360], params: GpParams): Counts360 {
      const loX = Math.log(bounds[0]);
      const hiX = Math.log(bounds[1]);
      if (history.length === 0) return counts360(Math.exp((loX + hiX) / 2));
      const gp = new GP(params, history);
      return counts360(Math.exp(incumbent(gp, loX, hiX)));
    },
  };
}
