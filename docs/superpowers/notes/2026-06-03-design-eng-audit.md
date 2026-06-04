# Design-engineering audit - bio-inspiration authenticity (2026-06-03)

**Lens (the /goal):** review campeón *as a design engineer* asking one question of each faculty -
is the process **genuinely designed from the animal's mechanism**, or is it a generic aim test with
an animal label? The four instruments must be real probes of one latent cm/360, woven holistically.

This is a different audit than the 2026-06-03 *math* review. That one checked each formula in
isolation and found the core formula-faithful. A formula can be correct yet **not be the thing the
narrative says it is, or not be wired into the score at all.** Tracing claim → spec → code is what
surfaces that, and it is where the two real failures lived.

## Verdict

Two of four faculties were genuine and load-bearing as built; two oversold the code. Both gaps were
cases where the **spec specified a mechanism, the case study sold it, and the implementation shipped
something simpler** - drift, not fraud. Fixed both so the code now does what the animal story claims.
The fusion (four z-scored probes → one curve, CI widens on disagreement) is genuine triangulation and
was left intact; production runs all four at equal weight with the speed↔accuracy slider entering
**only** the strike pole, which is the right objective-vs-taste split.

## Findings & fixes (branch `audit/design-eng-review`, merged to main)

1. **track - the scorer was misattributed AND under-realized (the core finding).**
   - The spec said `score = −mean‖ν‖²` (the Kalman *innovation*); the case study said "the innovation
     IS the instantaneous tracking error." Both are false: the CV-Kalman tracks the **target** from
     target observations, so ν = z − Hx̂⁻ is a function of the target's motion and the filter - **the
     player's aim never enters it.** It cannot be a player score. The code quietly did something sane
     instead (separation from a fixed-150 ms lead point) but kept the wrong story, and hard-coded the
     lead horizon L for everyone while computing - and discarding - the player's actual tracking lag.
   - **Fix:** track now measures the player's OWN latency L as the sub-sample aim↔target
     cross-correlation lag (zero-mean covariance + parabolic peak refinement - integer-frame lag has a
     parity artifact that would inject noise into the score), and scores the **lag-compensated
     predictive residual**: aim(t) vs. the target where the player was actually tracking, L ago.
     Subtracting pure latency isolates the sensitivity-dependent error (tremor + gain over/undershoot),
     which is what the cm/360 sweep is meant to move. The CV-Kalman now earns its place as the smoothed
     target-velocity estimate driving the falcon slip-nulling term. "L = your measured latency" is now
     literally true. (`src/instruments/track.ts`; `src/scoring/kalman.ts` docstring corrected.)

2. **flick - the "two-mode crossover" the spec promised was never implemented.**
   - Spec §4.2 ("staged acquisition + dual-fovea two-mode") and the case study both said the flick
     optimum is "the crossover of two curves" - ballistic-acquisition vs precision-lock throughput.
     The code pooled **all** Fitts conditions into one mean-of-means throughput; no crossover existed,
     and the spider/raptor two-mode story was decoration. The named "gain G = covered/required" was
     never computed.
   - **Fix:** flick now splits conditions into ballistic (amplitude ≥ 24°, the spider's open-loop
     orient) and precision (width ≤ 2°, the raptor's deep-fovea confirm) sub-throughputs and scores
     their **harmonic mean** - maximized exactly at the crossover where the weaker mode is strongest,
     so a sensitivity good at only one mode is penalized. Load-bearing test: a balanced player now beats
     a flick-specialist whom the old pooled metric ranked higher. Dropped "gain G" as a *scored*
     quantity (overshoot/corrections already surface through inflated MT and endpoint σ in throughput).
     (`src/instruments/flick.ts`.)

3. **Narrative honesty.** Corrected the case study, the spec (§4.1, §4.2, §5.1), and the kalman.ts
   docstring so the track and flick scorer claims match the code; clarified that only the strike pole
   bends to the speed/accuracy slider (the other three are objective skill/hardware facets).

## What was genuine and left alone

- **calibrate (archerfish):** error = systematic bias + random variance, with EWMA trial-by-trial bias
  adaptation (the recalibration analog) and the gain-=-1 zero-crossing as the bias-zero headline
  (genuinely interpolated in `breakdown.ts`). Faithful.
- **strike (mantis shrimp):** the (TTK = t_R + t_S, hit-rate) operating point with a Cobb-Douglas
  speed/accuracy weight `w` from the slider - the canonical speed pole, genuinely the taste dial.
- **The fusion:** each instrument z-scored across its own sweep (affine ⇒ peak-preserving), pooled into
  one point-cloud, one parabola fit cross-checked against the GP argmax, CI widened on disagreement.
  This is real triangulation of one latent constant, not an arbitrary average.

## Honest residual limitations

- **Tracking latency precision.** The cross-correlation lag is accurate to within ~½ frame on smooth
  motion even after sub-sample refinement; predErr therefore sits on a small constant floor. Harmless
  to the optimizer (a constant offset is washed out by the affine z-score - the same invariance the
  whole fusion rests on), but L should be read as ±~1 frame.
- **No cross-instrument latency sharing yet.** The dragonfly horizon L is measured within the track
  trial; a more holistic design would feed the strike instrument's reaction t_R into it. Deferred
  (trials are independent/interleaved; the architecture would need cross-trial plumbing) - a genuine
  future improvement, flagged rather than faked.
- **Two-mode split thresholds** (24°, 2°) are sensible for the current condition grid but are design
  constants, not learned.

## Runtime proof (Chromium, dev harness)

- Full `__arenaDebug.runSession()` → optimal 29.08 cm/360, CI [27.85, 30.20], 61-pt curve (pipeline
  intact; identical to the math-audit baseline because 2 cold-start trials/instrument standardize to
  ±0.707 regardless of the score's magnitude).
- `runInstrument('track')` raw exposes `latencySec` + `predErr` (no `eLead`/`leadSec`) - the new code
  is live, score finite.
- `#/case-study` renders the corrected copy: track "lag-compensated / fitted to you / measured
  latency", flick "harmonic mean / crossover / ballistic"; both false claims ("innovation IS the
  tracking error", "gain G = covered/required") are gone.
- 251 tests green (was 247; +4 new load-bearing); `tsc --noEmit` + `vite build` clean.
