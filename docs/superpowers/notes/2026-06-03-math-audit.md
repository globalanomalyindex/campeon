# campeón - mathematical audit (2026-06-03)

A from-first-principles review of the math that turns four bio-instruments into one cm/360, asking
two questions: is it **correct**, and is it **efficacious + aligned** with the goal (reliably locate
a player's optimal cm/360, honestly). Verdict, findings, and the fixes applied.

## Verdict

The core is, on the whole, **rigorous and faithful to the published formulas.** Spot-checked and
confirmed correct:

- **Gaussian process** (`optimizer/gp.ts`) - Matérn-5/2 kernel `σ²(1+s+s²/3)e^−s`, exact GP regression
  via Cholesky with forward/back substitution, constant prior mean, `var = k(x*,x*) − ‖L⁻¹k*‖²`, PD
  nugget + jitter. Matches Rasmussen & Williams Alg. 2.1.
- **Kalman CV filter** (`scoring/kalman.ts`) - `F=[[1,dt],[0,1]]`, `H=[1,0]`, continuous white-noise-
  acceleration `Q=q·[[dt³/3,dt²/2],[dt²/2,dt]]`, correct gain and `(I−KH)P` covariance update;
  innovation `ν=z−Hx̂⁻` is the one-step prediction error (the tracking error). Correct.
- **Fitts effective throughput** (`scoring/fitts.ts`) - `We=√(2πe)·SD≈4.133·SD`, `Ae=A+mean(dx)`,
  `IDe=log2(Ae/We+1)`, `TP=IDe/MT`, mean-of-means aggregate. ISO 9241-9 / MacKenzie. Correct.
- **Bias/variance** (`scoring/bias-variance.ts`) - `MSE=|b|²+σ_R²`, `gain=E[impact]/E[required]` (g>1
  overshoot). Correct; matches spec §4.3.
- **Acquisition** (`optimizer/bayesopt.ts`) - EI `(μ−f⁺)Φ(z)+σφ(z)`, UCB `μ+κσ`, incumbent = max
  posterior **mean** (not raw max), erf via A&S 7.1.26. Correct.
- **cm/360 conversion** (`convert/cm360.ts`) - `914.4/(dpi·sens·yaw)` and inverse. Correct.
- **z-score affine peak-invariance** (the keystone) - `z=(y−μ)/σ` is positive-affine in `y`, so each
  instrument's argmax over x is preserved; the parabola's vertex is invariant under affine `y`. The
  claim holds.

## Findings & fixes

**1 - CRITICAL (correctness): monitor-distance conversion was inverted** (`convert/schools.ts`).
Returned `cm360_src·θ_tgt/θ_src`, the reciprocal of the correct match. Monitor-distance matching
equalizes the physical mouse travel to flick the crosshair to a fixed screen point:
`cm360_tgt·θ(m,fov_tgt) = cm360_src·θ(m,fov_src)` ⟹ `cm360_tgt = cm360_src·θ_src/θ_tgt`, so a wider
target FOV needs a **smaller** cm/360 (more sensitive). The unit test had been written to match the
implementation's (inverted) intuition, so it passed on the bug. **Fixed** the formula + the m→0
limit + added a load-bearing *directional* assertion. (Scope: the options-page converter, not the
core optimum.)

**2 - ALIGNMENT (honesty): "psychometric" was a misnomer** (`stats/psychometric.ts`). The module
fits a quadratic in `ln(cm/360)` and returns the vertex - *quadratic peak interpolation*. A
psychometric function is a sigmoid for *threshold* estimation; wrong object for the peak of an
inverted-U. **Fixed:** renamed module + test to `peak-fit`, corrected docstrings, and relabeled the
CI as a **residual** (semi-parametric) bootstrap - it resamples residuals, not a parametric noise
model. Spec §5.3 + case study updated to match.

**3 - EFFICACY: the reported CI ignored model disagreement** (`optimizer/session-controller.ts`).
`finalizeReport` could widen the CI when a GP peak disagreed with the parabola peak (spec §5.3 line
153), but `runSession` never supplied one - so the reported peak, from a single **global quadratic**
(a strong parametric assumption that biases the vertex on a skewed/plateaued curve), was never
cross-checked against the flexible surrogate. **Fixed:** added optional `SearchEngine.posteriorPeak`
(the GP posterior-mean argmax); `makeBo` implements it; `runSession` passes it to the report. The CI
now honestly widens whenever the parabola and the GP disagree about where the optimum is. This is
the audit's one substantive efficacy improvement.

**4 - HONESTY: two case-study claims overstated.** (a) "the blended objective weighted by your
speed↔accuracy preference" - the four instruments blend on **equal** footing; the preference tunes
only the **strike** facet's internal speed/accuracy geometric mean (`speed^w·hit^(1−w)`), which then
enters the blend. (b) "the ci width = how much your faculties concur" - the CI width is the estimate's
**total** uncertainty (sampling noise + fit + facet disagreement); disagreement inflates it, so it is
*correlated with* agreement but is not a pure agreement metric. **Fixed** both in the case study.

## Efficacy & alignment conclusion

The system **does** what it claims: four real, distinct, cm/360-dependent facets → commensurable via
peak-preserving z-scoring → efficiently sampled by GP-BO → fused to one number whose interval honestly
reflects uncertainty. With the GP cross-check now wired (Finding 3), the reported peak is no longer
hostage to the global-quadratic assumption, and the unified-system thesis is now stated *precisely*
rather than aspirationally.

## Remaining honest limitations (documented, not bugs)

- **Non-stationary normalization.** z-scoring uses the empirical μ/σ of the sampled scores, recomputed
  as trials accumulate; BO's non-uniform sampling biases those estimates, so the intermediate objective
  drifts slightly. It washes out on the final balanced fit and is robust to BO's noise tolerance.
  (Documented in `objective.ts`.)
- **Global quadratic.** A parabola in log-sens is a 2nd-order *local* model; the GP cross-check
  (Finding 3) is the safeguard, not a replacement. A future option: report the GP posterior peak
  directly with a GP-derived credible interval.
- **Residual bootstrap** assumes exchangeable residuals across instruments/cm-360; fine for a
  first-order CI, conservative under heteroscedasticity.
- Equal instrument weights are by design (the four faculties are not a matter of taste); only the
  speed↔accuracy pole is user-tunable.
