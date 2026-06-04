# campeón — Bio-Inspired Aim Sensitivity Finder
### Design Specification

**Author:** Christopher Robin Fiore
**Date:** 2026-06-01
**Status:** Approved design → ready for implementation planning

---

## 1. Vision

`campeón` finds an FPS player's optimal mouse aim sensitivity by running short aim drills whose mechanics are taken from **real, published animal targeting systems**, scoring them with an objective metric, and searching for the best value with a sample-efficient optimizer. The answer is delivered in **cm/360** — the hardware- and game-agnostic unit — and translated to native sensitivity for every game the player cares about.

The non-negotiable principle: **the biomechanics are real, not decorative.** Every test maps a documented biological mechanism onto a measurable quantity that genuinely varies with sensitivity. The science is the product, not the theme.

**The whole system optimizes one scalar: `cm/360`** (physical centimeters of mouse travel for one 360° in-game turn). Every instrument, score, and search step tunes that single number. The per-game conversion table is cosmetic translation at the input and output edges only.

### 1.1 Project goal & quality bar

`campeón` is a **portfolio centerpiece aimed at a top-tier design-engineer role**, so it is judged on *both* axes at once: it must read as expertly engineered **and** expertly designed. This raises the bar on every later decision:

- **Craft is a requirement, not optional polish** — brand fidelity, motion quality, typographic and spacing discipline, and interaction feel are first-class deliverables.
- **The code is written to be read** — clean module boundaries, typed interfaces, real tests on the pure core, no dead code, legible commit history.
- **Performance & feel** — 60fps+ arena, sub-frame input handling, no jank in shell transitions; honor `prefers-reduced-motion`.
- **The science is the differentiator** — measurement honesty (CI width, validity gating) and the `+case study` page are what make this memorable, not another aim trainer.
- **Full vision, well-researched, expertly coded** — depth over shortcuts; the deferred showpieces (falcon flap + parallax sky, PSX run-and-gun arena) are part of the vision, sequenced after the core proves out.

---

## 2. Scope

**In scope (v1, "full vision"):**
- All six organisms, reduced to **four test instruments** (track, flick, calibrate, strike), with every organism credited and explained.
- The full algorithm core: Fitts-throughput + Kalman scoring, Bayesian-optimization search, parabolic peak-fit reporting with a confidence interval.
- The input-validity layer (pointer-lock raw input, acceleration detection, DPI handling).
- The cm/360 conversion layer with a verified per-game yaw table.
- 3D first-person engine (Three.js), client-only (localStorage), TypeScript + Vite.
- The full product flow: hero → setup → validity gate → calibrate → result, plus `+case study` (the science) and `+options` (advanced settings).
- The falcon-silhouette hero (static composition) and a clean, functional dark arena.

**Out of scope (v1) — deliberately deferred:**
- Accounts, backend, cloud sync, leaderboards (storage layer is built cloud-ready, but no server in v1).
- The animated falcon (wing flap, parallax-behind-wing sky illusion).
- The PSX run-and-gun arena skin (low-res abyss, 2D-sprite combat, chrome Desert Eagle, ULTRAKILL aesthetic). v1 arena is functional; the PSX skin layers on after the measurement core is proven.
- FOV-aware conversion (monitor-distance / viewspeed) — present as an advanced option, 360-distance is the default.

**Non-goals:** This is not a general aim trainer or a ranked competitive platform. It is a measurement-and-recommendation instrument.

---

## 3. Core principle: everything is cm/360

The app renders its own 3D scene with its **own internal yaw constant** `Y_app` (e.g. 0.022°/count, Source-like). Because

```
cm_per_360 = 914.4 / (DPI · sens · Y)          (914.4 = 360 × 2.54)
```

the app can pick any convenient `Y_app` and solve its internal `sens` to render the scene at any target cm/360. The optimizer searches over **cm/360 directly** (e.g. 15–60 cm/360). The messy, non-portable browser input units cancel out of the *output*, because the only physical anchor needed is the user's stated DPI, and the result is reported as a cm/360 number plus per-game native sensitivities.

---

## 4. The instruments (four environments, six mechanisms)

**Framing (the central hypothesis).** campeón does **not** simulate the animals' brains. A predator's accuracy is the *result* of an **environment** that demanded it; the human equivalent of that evolved internal target-acquisition mechanism is one tunable number — **sensitivity** (cm/360). So each "instrument" is really an **environment**: the niche/selective pressure recreated, in which the player's sensitivity is the trait under selection. The biomechanics (Kalman lead, submovement stages, bias/variance, TTK) are kept only as the *environment-appropriate accuracy ruler* — the right way to score target acquisition in that niche — not as brain-mimicry. Hypothesis: *the same environments that forged these predators' accuracy will, via evolution over generations of sensitivities, forge the player's optimal cm/360.* Each environment isolates one axis of the same **speed↔accuracy / bias↔variance** trade-off. Angular quantities in degrees; times in milliseconds.

### 4.1 `+track` — predictive tracking + gaze-stabilization smoothness
**Organisms:** 🦗 dragonfly · 🦅 peregrine falcon

**Real mechanism.**
- *Dragonfly:* intercepts prey at **~95%** success using a feed-forward internal model. Target-Selective Descending Neurons (TSDNs) decode prey image-direction as a population vector (R = 0.998) at a sensorimotor latency of **29.94 ± 5.75 ms**; an efference-copy forward model predicts self-induced image motion so the head/aim **leads** to where prey *will* be. Trajectory obeys a **constant-bearing / parallel-navigation** law (≈ proportional navigation), driving line-of-sight rate to zero. Foveal acuity 0.24–0.5°.
- *Falcon:* holds the target image still on the fovea via **VOR** (fast, inertial, feed-forward) + **OKR** (slow, visual) gaze stabilization — rotational stabilization gain ≈ 1.0. Terminal guidance also fits proportional navigation (N ≈ 2.6–3.5). The control objective is to **null target angular velocity** smoothly.

**The drill.** Keep the crosshair on a target moving along a band-limited (sum-of-sines, ~0.2–1.5 Hz) / smoothly-turning path; on randomized cues the target step-changes velocity, forcing re-acquisition and lead.

**What we measure.**
- Model the target with a **constant-velocity Kalman filter** (state `[θ, θ̇]` per axis); the optimal lead aim point is `θ*_opt(t+L) = θ̂ + θ̇̂·L`, where `L` = the player's measured reaction latency (lag between a target velocity step and the player's corrective angular-acceleration onset).
- **Predictive residual** `E_pred = sqrt(mean‖θ_aim(t) − θ_tgt(t − L)‖²)` — lag-compensated tracking accuracy: aim against the target the player is actually tracking, `L` ago. Removing the player's pure latency isolates the sensitivity-dependent error (tremor + gain over/undershoot). `L` is the player's OWN latency (measured, below), not a fixed constant.
- **Predictive Index / measured latency** `PI = −ℓ*`, where `ℓ*` = argmax lag of the (zero-mean, sub-sample parabolic-refined) cross-correlation between crosshair and target bearing. `PI > 0` = predictive/feed-forward; `PI < 0` = reactive/lagging. The lag in seconds **is** the player's tracking latency `L` — the dragonfly forward model's horizon, fitted to the player rather than assumed.
- **Jitter** `= RMS of high-pass-filtered aim angular velocity` above a cutoff `f_c ≈ 3–5 Hz` (the VOR/OKR split: task motion is below it, hand tremor ~8–12 Hz is above). Plus sub-movement count and `slip_rate` (RMS of target − aim angular velocity).
- **Time-on-target** `TOT` = fraction of frames within the target's angular radius.
- Composite: `Score = w₁·TOT − w₂·E_pred − w₃·jitter − w₄·slip` (normalize terms across the sweep).

**cm/360 signal.** Too-low cm/360 (too sensitive) → tremor multiplied into jitter, overshoot oscillation around `θ*_opt`. Too-high cm/360 → cannot reach `θ*_opt` during velocity steps, crosshair lags (`PI < 0`), slip rises. Optimum jointly minimizes slip + jitter.

**Scorer:** the lag-compensated predictive residual `E_pred` at the player's measured latency `L`. The constant-velocity Kalman filter smooths the *target's* motion (its velocity estimate feeds the slip term, the falcon VOR/OKR analog); the filter's innovation `ν = z − Hx̂⁻` is a *target*-prediction residual — a function of the target and the filter, not the player — so it is **not** the score.

### 4.2 `+flick` — staged acquisition + dual-fovea two-mode
**Organisms:** 🕷️ jumping spider · 🦅 raptor dual fovea

**Real mechanism.**
- *Spider:* divided-labor pipeline — wide-field, low-acuity **secondary eyes DETECT** motion (~100 ms latency) → a **ballistic, pre-programmed body saccade ORIENTs** (810–1300 °/s, amplitude preset from retinal eccentricity, open-loop) → high-acuity **principal eyes CONFIRM** (scan/fixate). Coarse orient error is corrected by the confirm stage — exactly a human flick's structure.
- *Raptor fovea:* two retinal pits per eye — a **deep fovea** (high acuity ~140 cyc/deg in peregrine, line-of-sight ~45° lateral, the "scope") and a **shallow fovea** (wide field, ~15°, fast acquisition). A speed/cost trade governs which is used.

**The drill.** Snap to targets across a grid of distances `A` and sizes `W` (low-ID large flicks → high-ID small precise locks), then settle and fire at a controlled error rate (~4–8%).

**What we measure.**
- **Stage decomposition** of the mouse-velocity trace: `t_D` (detection latency: onset → first movement), `t_O` (primary ballistic orient: to first velocity trough), `t_C` + `N_corr` (corrective sub-movements during confirm). Recorded as diagnostics; the orient/confirm costs (overshoot, corrections) already surface in throughput via inflated `MT` and endpoint SD.
- **Fitts effective throughput** (ISO 9241-9): per condition, `We = 4.133·σ` (σ = endpoint SD), `IDe = log2(Ae/We + 1)`, `TP = IDe / MT_mean`. Conditions are split into **ballistic** (large amplitude) and **precision** (small width) sub-sets, each aggregated by mean-of-means.

**cm/360 signal.** The central tension: **ballistic throughput peaks at lower cm/360** (higher sens, big reorientations cheap), **precision-lock throughput peaks at higher cm/360** (lower sens, fine placement + attenuated tremor). The optimum is the **crossover** of the two curves — realized as the harmonic mean of the two sub-throughputs, which is maximized exactly where the weaker mode is strongest. Too-high sens → `N_corr`/`t_C` inflate (overshoot oscillation); too-low → `t_O` slow, undershoot.

**Scorer:** two-mode crossover — harmonic mean of ballistic (large-amplitude) and precision (small-width) effective throughput.

### 4.3 `+calibrate` — bias vs variance (the calibration metaphor)
**Organism:** 🐟 archerfish

**Real mechanism.** Archerfish shoot aerial prey through the air-water interface and must cancel the **systematic refraction offset** (apparent vs true elevation, up to ~10–15°, angle- and distance-dependent). This is a *learned, updatable internal model*: motor-adaptation experiments show trial-by-trial error reduction and a **negative aftereffect** on removal — the signature of a recalibrated forward model. The predictive C-start aims at the prey's future landing point (heading precision ~6°, latency from 40 ms). The key abstraction: **error = systematic bias (learnable, removable) + random variance (precision floor).**

**The drill.** A burst of shots; separate consistent skew from random spread, then run a live training loop.

**What we measure.**
- **Bias** `b = (1/N) Σ eᵢ` (mean signed error vector); **gain bias** `g = E[r_imp]/E[r_req]` (g > 1 overshoot = sens too high, g < 1 undershoot = too low) — the cleanest cm/360-linked estimator.
- **Variance / precision** `σ_R = sqrt(mean‖eᵢ − b‖²)` (group size after de-biasing).
- **Decomposition** `MSE = |b|² + σ_R²`.
- **Live training:** EWMA bias estimate `b̂ₜ = (1−α)b̂ₜ₋₁ + α·eₜ` (α ∈ [0.05, 0.2]) rendered as a drifting cluster marker + signed corrective cues; the aftereffect on aid-removal is a "calibration locked in" signal.
- **Calibration score** `C(s) = w_b·|b(s)|² + w_v·σ_R(s)² + w_t·(T̄(s)/T_ref)²` (defaults w_b 0.6, w_v 0.3, w_t 0.1 — bias-dominant).

**cm/360 signal.** cm/360 controls bias steeply and monotonically → the **bias-zero sensitivity** `s_b` (where `g = 1`) is the headline number. Variance is the skill/hardware floor, not the recommendation.

### 4.4 `+strike` — the speed pole
**Organism:** 🦐 mantis shrimp

**Real mechanism.** A latch-mediated spring (LaMSA) strike: **~10,400 g**, peak ~14–23 m/s, full discharge in **~1.1 ms**, with no mid-flight correction — pure, uncorrectable speed. The "aim/charge" phase is ~300× longer than the strike. It is the canonical **speed pole** of the speed–accuracy trade-off.

**The drill.** Fire as fast as possible at a target — misses allowed, no settling.

**What we measure.** `t_R` (reaction/commit), `t_S` (ballistic strike), `v_peak`, endpoint scatter `σ_θ`, hit rate `H`. The pair `(TTK_speed = t_R + t_S, H)` is the player's speed-accuracy operating point at each cm/360.

**cm/360 signal.** Locates the player on their speed↔accuracy curve so the global optimizer respects the user's **speed/accuracy preference weight `w`** (set by the goal slider in setup), rather than assuming one. Too-high sens → fast but `σ_θ` explodes, `H` collapses; too-low → tight but slow.

---

## 5. The engine

**Score → Search → Report**, all client-side TypeScript, implementable from scratch (optional tiny pure-TS helpers: `ml-matrix`, `ml-levenberg-marquardt`).

### 5.1 Scorer
- **Fitts effective-throughput** (flicks): `TP = IDe / MT_mean` with effective width `We = 4.133σ` (ISO 9241-9), per-condition; combined as the **two-mode crossover** (harmonic mean of ballistic vs precision throughput) so the flick optimum is a genuine crossover, not a pooled average.
- **Predictive tracker** (tracking): a constant-velocity Kalman filter smooths the *target* (→ slip term); the player's latency `L` is the sub-sample cross-correlation lag, and the score is the **lag-compensated predictive residual** (tremor + gain). The innovation is a target-prediction residual, not the score.
- Blended per profile: each instrument is z-scored across its own sweep (affine, peak-preserving) and summed with the profile weights; the speed↔accuracy preference enters only through the strike pole (see §5.3).

### 5.2 Search engine — surrogate-assisted evolution strategy (primary)
- Optimize in **log-space** `x = ln(s)`; domain e.g. `s ∈ [15, 60]` cm/360.
- **(1+λ) evolution strategy** (`makeEvolution`): keep one lineage; each generation mutate the **incumbent** (fittest sensitivity so far) by a Gaussian step `σ` to spawn λ offspring, play the most promising, and keep it only if it beats the parent — **elitist selection**. Step size self-adapts by Rechenberg's **1/5 success rule**. The conceptual spine: the search IS the evolution that tuned the predators, so the optimizer mirrors it rather than relabeling a different algorithm "evolution."
- **Gaussian-process surrogate** (Matérn-5/2, noisy GP with nugget `σ_n²`) is the lineage's **fitness memory**: it supplies the **denoised fitness** for selection (posterior mean, never the raw noisy max) and **screens** the λ offspring by Expected Improvement `EI(x) = (μ−f⁺−ξ)Φ(Z) + σφ(Z)`, so the player's scarce trials are spent on the single most informative mutation.
- **Cold start:** log-spaced initial trials = **Generation 0** (the initial gene pool); the first generation selects the fittest of them as the founding parent. **Final 1–2 trials:** confirmation replicates at the incumbent.
- **Alternative engine:** `makeBo` — pure global GP-EI/UCB on a dense grid — is retained and tested (the surrogate-assisted ES reuses its GP + EI). **Fallback / "simple mode":** UCB1 bandit over ~10 discretized arms.

### 5.3 Reporter — parabolic peak fit + CI
- Fit a peaked curve in log-sens: `y = β0 + β1·x + β2·x²` (β2 < 0); peak `x* = −β1/(2β2)` → `s* = exp(x*)`. (This is quadratic peak-finding — a parabola, **not** a psychometric function.)
- **Confidence interval** via **residual bootstrap** (resample residuals → refit → 5th/95th percentile of `s*`); delta method as a check. 90% → `x* ± 1.645·SE`. The CI **width is the honesty mechanism** — a flat curve yields a wide CI, correctly reported as a range (e.g. "32–40 cm/360").
- If GP-peak and curve-peak disagree, widen the reported CI.

### 5.4 Session design (the human-factors reality)
- **~15–30 trials, capped at ~20–25** — beyond that, fatigue noise overwhelms information gain.
- **Randomize/interleave** sensitivities (BO already does); never test monotonically (confounds sensitivity with learning).
- **1–2 warm-up trials** down-weighted to absorb the learning transient.
- Expect a **broad optimum** — report a range, distrust a suspiciously narrow CI.

### 5.5 The honest note — evolution strategy vs. naive GA/PSO
A **naive** population GA/PSO — many free agents, each costing a real player trial — remains the wrong tool for a 1D, noisy, ≤30-evaluation budget; it would burn trials on a whole population per generation. That caution (original to this spec) stands. The production engine (§5.2) is deliberately **not** that: it is a **surrogate-assisted (1+λ) ES** in which the GP screens offspring and only **one** trial is spent per generation on the most informative mutation — so it keeps BO's sample-efficiency *and* is genuinely evolutionary (lineage, mutation, elitist selection, self-adapting step). The honest trade vs. pure global GP-EI: the ES samples **locally** around the incumbent instead of globally, so it is marginally less exploratory on a multimodal landscape — acceptable here because the sensitivity↔performance curve is a single **broad** optimum (§5.4), and Generation 0 seeds the lineage across the whole range. Free-evaluation evolutionary/PSO work (the **bootstrap-ensemble** CI — "a swarm of fits" — and hyperparameter fitting) still routes **in-silico**, never to real player trials.

---

## 6. Input-validity layer (the make-or-break)

A browser exposes only *relative* mouse deltas, warped by OS pointer acceleration. The validity protocol, run every session before measurement:

1. **DPI is user-entered** (mandatory — no browser API exposes it; WebHID is not viable for mice).
2. **`requestPointerLock({ unadjustedMovement: true })`** to bypass OS acceleration → fall back to plain lock. **Chromium-only** (Chrome/Edge give true raw input; Firefox/Safari ignore the flag). **Stance: Chromium-best, graceful elsewhere** — still runs on other browsers but flags "reduced measurement validity — verify acceleration is off."
3. **Acceleration check:** the user swipes the same physical distance slow vs fast; if accumulated `|Δ|` differs > ~10%, **block measurement** (cm/360 is undefined under acceleration).
4. **Normalize by `devicePixelRatio`** — `movementX` is device-px in Chrome (no DPR scaling) but CSS-px in Firefox (÷DPR); normalization makes them agree.
5. **High-refresh capture:** accumulate `pointerrawupdate` + `getCoalescedEvents()` so no counts are lost at 1000 Hz.
6. Convert immediately to cm/360 via the user's DPI + the app's internal yaw; all ambiguity cancels out of the output (given accel is off, proportionality holds).

---

## 7. Conversion layer (cm/360 ↔ per-game)

**Math.**
- `cm_per_360 = 914.4 / (DPI · sens · Y)` where `Y` = yaw (°/count at sens 1).
- Inverse (output edge): `sens_game = 914.4 / (DPI · Y_game · cm360*)`.
- Cross-game: `sens_target = sens_source · (Y_source · DPI_source) / (Y_target · DPI_target)`.

**Per-game yaw table** (community-derived effective values — internally consistent, not official; expose an override):

| Game | Yaw Y | Caveats |
|---|---|---|
| CS2 / CS:GO | 0.022 | Source standard; rock-solid |
| Apex Legends | 0.022 | Source-derived; 1:1 with CS2; ADS per-zoom multiplier |
| Valorant | 0.07 (effective) | = 0.0066 × ~10.6 scale folded in |
| Overwatch 2 | 0.0066 | ADS relative/legacy toggles |
| Call of Duty (MW/Warzone/BO6) | 0.0066 | 1:1 with OW2; ADS + monitor-distance coeff; smoothing off |
| Fortnite | 0.005555 | Slider is ×100 (a "7" = 0.07); per-axis X/Y; per-scope ADS |
| Rainbow Six Siege | 0.00573 | **FOV literally changes cm/360**; visuomotor-gain model |
| PUBG | 0.002222 | Hipfire/General only; per-scope sliders separate |

**Conversion schools.** Default = **360-distance / cm-per-360** (FOV-agnostic, what we measure, no FOV input). Advanced = **monitor-distance 0%** (FOV-aware, needs source+target FOV); viewspeed noted as a future option.

---

## 8. Architecture

**Stack:** TypeScript + Vite SPA · Three.js · 100% client-side · no backend.

**Module boundaries** — a pure, unit-tested core wrapped by an engine and a UI (so measurement validity can be *proven*, not hoped):

| Module | Responsibility | Tested |
|---|---|---|
| `convert/` | cm/360 math, per-game yaw table, conversion schools | Pure unit tests |
| `scoring/` | Fitts throughput, Kalman tracker, bias/variance, sub-movement segmentation | Pure unit tests |
| `optimizer/` | GP Bayesian opt (EI/UCB), bandit fallback, session controller | Pure unit tests |
| `stats/` | parabolic peak fit + bootstrap CI | Pure unit tests |
| `input/` | pointer-lock + unadjustedMovement, DPR-normalize, accel check, DPI | Integration |
| `engine/` | Three.js arena, camera, internal-yaw→cm/360, target spawning, tick/render loop | Integration |
| `instruments/` | track / flick / calibrate / strike on one `Instrument` interface | Per-instrument |
| `ui/` | shell (hero · setup · result · case-study · options) + in-arena HUD | Integration |
| `state/` | localStorage behind a storage interface (cloud-ready), session/result model, JSON export | Unit |

**`Instrument` interface (sketch):** each instrument runs a trial at a given cm/360 and emits raw samples + a per-trial score, so instruments are interchangeable and independently testable.

**Data model:**
- `Trial { cm360, instrument, rawSamples, score, timestamp }`
- `Session { id, dpi, profileWeights, trials[], status }`
- `Result { optimalCm360, ci, perGameSens, breakdown:{bias, precision, speed} }`
- Persisted to `localStorage` behind a `Storage` interface; exportable as JSON.

**Testing:** TDD for the pure core (`convert`, `scoring`, `optimizer`, `stats`) against published formulas; integration tests for engine/input/UI.

---

## 9. Product flow & information architecture

**Shell (warm editorial) wraps arena (focused dark).**

1. **Hero** — the falcon landing; `+ start` · `+ case study` · `+ options`.
2. **`+setup`** — enter DPI + current game/sens (shows where you sit today in cm/360) + goal slider (speed↔accuracy → the `w` weight).
3. **Validity gate** — pointer-lock raw input, accel check, DPR-normalize. "From here, everything is cm/360."
4. **`+calibrate`** — the 4 instruments as ~15–30 Bayesian-driven trials (~10–15 min); a live curve sharpens the sweet-spot estimate.
5. **`+result`** — `your sweet spot: X cm/360` + 90% CI; bias/precision/speed breakdown; per-game sens table; JSON export; saved locally.
- **`+case study`** — the science page: each organism's real mechanism, the math, and why it maps to aim (the authenticity mandate, made legible).
- **`+options`** — conversion school, per-game yaw overrides, cm/360 search bounds.

---

## 10. Visual identity

**Palette:** bone `#EAE7DC` · slate `#4A5A66` · gold `#FFC400` · ink `#0D0D0D` (+ parchment tints `#EFDEA5`/`#EDE3C0`).
**Type:** **Gefalent** (OTF/TTF, supplied) for the wordmark and display headings; a clean system sans for body and data.
**Motif:** the `+` prefix is the menu/action mark.

**The hero IS a peregrine falcon silhouette** (stooping), composed from the layout:
- **Eye** = the dark `ó` in *campeón*.
- **Body** = the slate wordmark.
- **Beak** = the gold `+ start`.
- **Tucked feet** = the gold byline (*by christopher robin fiore*).
- **Wing** = the scatter of `/ \ ~ < ^` marks.

**Motion vision (deferred, post-core):**
- The **wing flaps**.
- Sky elements **parallax past behind the wing**, occluded by its silhouette and **never bleeding through its edges** (wing = opaque foreground layer; parallax sky strictly behind, masked to the wing shape) — the illusion of flying.

**Arena (v1 functional → PSX skin SHIPPING):** v1 shipped a clean dark arena; the **PSX skin now layers on** (cosmetic, never gating the measurement core). Done: a **low-res PSX-abyss post pass** (`engine/psx-pass.ts` — 1/3-res render target, 4×4 Bayer ordered dither, posterize to ~6 levels, scanlines + vignette; injected as an optional `Arena.postProcessor` so the renderer-agnostic test seam stays intact), and the **chrome Desert Eagle viewmodel** (`ui/viewmodel/` — the supplied `public/sprites/deagle.png` 8×7 sheet, magenta-keyed, anchored lower-right CS:Source-style, animation state machine: smoking→flick+draw→fire→idle, wired into the session). Both verified in Chromium. **ULTRAKILL** energy. Targets stay angularly exact — the skin owns only the final draw + an overlay canvas, never geometry/pointer/cm-360. **Enemy/"prey" billboards now SHIPPING** (`ui/enemy/` — four Chris-supplied sheets `public/sprites/{track,flick,calibrate,strike}.png`, an over-the-top fourth-wall-breaking "merc-prey" with a gold weak-spot, one per environment): clean uniform **8×5** grids whose rows are the engine's animation **state contract** (spawn · idle · flinch · death · escape). Pure-core/thin-shell again — `enemy/{atlas,controller,hit}.ts` are pure + unit-tested (uniform-grid UV math, the auto-advancing state machine, and a **cosmetic** great-circle hit-classifier), `enemy/enemy-layer.ts` is the runtime WebGL shell (magenta-keyed `THREE.Sprite` billboards, NearestFilter, pinned at each target's world position, one cloned texture per sprite for independent UV). Wired as `Arena.attachEnemies` (async load) + cosmetic `?.` hooks (spawn/clear/update/fire) mirroring `postProcessor`; the arena **hides the gold sphere but keeps its transform**, so `bearing()`/`radiusDeg()` — and the cm/360 — are byte-identical with or without the skin (load-bearing integrity test). Click-to-pop: on fire, `classifyHit(view, bearing, radius)` reads the live aim+target and plays death (clean hit → confetti/ghost/"GG") or flinch (graze) — **read-only, never writes a sample or score**. Verified in Chromium across all four environments. **Remaining:** `brush_shoulders` (the *Deagle* sheet dropped that row), and look-tuning (key-fringe cleanup, plot/viewmodel z-overlap, arena brightness, enemy billboard size).

---

## 11. Build phasing

Built in dependency order so the app is always runnable; highest-risk piece (input fidelity) proven early.

1. **Foundations** — Vite/TS scaffold, brand tokens + Gefalent, `convert/` + `stats/` (pure, TDD).
2. **Input fidelity + engine** — pointer-lock raw capture, accel gate, Three.js arena, internal-yaw→cm/360. *(Highest risk.)*
3. **Instruments + scoring** — track / flick / calibrate / strike on the common interface.
4. **Optimizer + session** — Bayesian loop, live convergence, session controller.
5. **Shell / UI + flow** — hero → setup → session → result → case-study → options; storage + export.
6. **Polish** — micro-motion, the `+case study` science page, QA. *(Falcon animation + PSX combat skin are separate, later tracks.)*

The build is **agent-driven**: the implementation plan decomposes each phase into discrete, verifiable tasks for dispatch.

---

## 12. Success criteria

- A player completes a session and receives a cm/360 value with a meaningful confidence interval, translated correctly to their games (verifiable against mouse-sensitivity.com for the yaw table).
- Each instrument's scoring matches its published formula (unit-tested).
- Measurement is valid: raw input confirmed, acceleration detected and blocked, DPR-normalized; results reproducible across browsers for the same physical input (within raw-input availability).
- The optimizer converges to a stable optimum (or honestly-wide CI) within ~20–25 trials.
- The `+case study` page accurately represents the real biology with citations.
- **Portfolio bar:** the arena holds 60fps+, shell transitions are smooth, the falcon hero lands with impact and respects `prefers-reduced-motion`, the pure core has real passing tests, and the code reads cleanly enough for a hiring engineer to review.

---

## 13. Key references

- Mischiati et al., *Internal models direct dragonfly interception steering*, Nature 517 (2015).
- Gonzalez-Bellido et al., *Eight pairs of descending visual neurons…population vector of prey direction*, PNAS 110(2) (2013).
- Brighton, Thomas & Taylor, *Terminal attack trajectories of peregrine falcons…proportional navigation*, PNAS 114(51) (2017).
- Mills et al., *Physics-based simulations of aerial attacks by peregrine falcons*, PLoS Comp Biol (2018).
- Tucker, *The deep fovea, sideways vision and spiral flight paths in raptors*, J. Exp. Biol. 203 (2000).
- Land, *Movements of the retinae of jumping spiders*, J. Exp. Biol. 51 (1969); Zurek & Nelson, *Saccadic tracking…anterior-lateral eyes*, J. Comp. Physiol. A 198 (2012).
- Patek et al., *Deadly strike mechanism of a mantis shrimp*, Nature 428 (2004); deVries & Patek, ICB 59(6) (2019).
- Reinel & Schuster, *The archerfish predictive C-start*, J. Comp. Physiol. A (2023); Volotsky et al., *The archerfish uses motor adaptation…*, eLife 13 (2024).
- MacKenzie, *Fitts' law* (ISO 9241-9 effective throughput), HHCI (2018).
- Auer, Cesa-Bianchi & Fischer, *Finite-time Analysis of the Multiarmed Bandit Problem* (2002); Russo et al., *A Tutorial on Thompson Sampling* (Stanford).
- MDN Pointer Lock API & `pointerrawupdate`; W3C Pointer Lock 2.0; web.dev *Disable mouse acceleration* (`unadjustedMovement`).
- mouse-sensitivity.com (yaw table, conversion schools); 3D Aim Trainer, aiming.pro, Aimlabs, Kovaak's (browser/native sensitivity handling).
