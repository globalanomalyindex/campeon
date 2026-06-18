# campeón overhaul: sharper measurement + real 3D - design

> Source of truth for the multi-phase improvement effort kicked off 2026-06-18. Derived from a 38-agent diagnostic + adversarial-verification + synthesis workflow (run `wf_808e8d32-eca`). Every task here is TDD'd, reviewed (spec + quality), and verified against the integrity gate.

## Goal

Make campeón **a measurement instrument that looks like the thing it measures.** Two fronts at once:

1. **Accuracy** - wire back the per-trial information the system already measures but throws away, so the fused cm/360 is genuinely sharper and the honesty story is stronger.
2. **Craft / vision** - bring the convergence plot to the result screen as the climax, and replace the flat sprite-sheet billboards + chrome-Deagle 2D overlay with real procedural Three.js 3D that fits the spaghetti-western cinematic brand.

It must still read as ONE unified system: one latent cm/360, four evolution-tuned probes of one motor-control manifold, fused by inference into one number with an honest CI.

## Decisions (locked 2026-06-18)

- **Weapon:** procedural western single-action revolver, rendered in-scene (replaces the 2D chrome-Deagle overlay). Recoil/sway spring math reused unchanged.
- **Quarry:** abstract designed-quarry silhouettes evoking each organism's strategy (darting / coiled-ambush / steady bench-rest / heavy-armored), NOT literal animals, NOT neutral geometry.
- **Accuracy scope:** full Phase 1 (heteroscedastic nugget + GP hyperparameter fit at finalize-only + reliability-aware bootstrap + two-axis latency).
- **Post-FX:** new cinematic film-grade pass becomes default; PSX kept as a selectable "retro" option behind the existing PostProcessor seam.
- **Cross-instrument latency fusion:** stays a REPORTED readout only - never written into any score (moving it into scoring is a separate future spec).

## Hard invariants (any change that violates one is rejected unless it explicitly preserves it)

1. **Measurement integrity (sacred):** the hidden gold sphere stays the SOLE owner of `bearing()`/`radiusDeg()`/cm360, byte-identical with or without any 3D skin or weapon. Cosmetic 3D objects are children/siblings that only READ the sphere transform + camera; they never enter the `targets` map and never replace the scored instrument. The arena INTEGRITY test stays green and is EXTENDED (never weakened) to pin the full scored `Recording {frames, fires}`.
2. **Cosmetic reads-never-writes:** enemies, the revolver, the post pass, every result/HUD overlay may READ `view()`/bearings/report/trials to react, but NEVER write a sample/score/Observation into the scored stream. `classifyHit` stays cosmetic; `handleFire`'s classify-before-instrument ordering is preserved.
3. **Measurement honesty:** never fabricate noise/signal. The per-trial nugget is measured variance with BOTH a floor (no interpolating spike from a lucky-quiet trial) and a ceiling (no silencing a disastrous-but-honest trial). Fitted GP hyperparameters and any GP-band CI may only WIDEN the honest bootstrap CI, never narrow it or replace the full-bounds fallback. A tuned-by-feel value carries NO measured CI/curve/peak/concord claim. CI-width copy never asserts a cause (disagreement vs sampling noise) the data cannot distinguish.
4. **Pure-core / thin-shell + renderer-agnostic seam:** `gp.ts`, `objective.ts`, `peak-fit.ts`, `bootstrap.ts`, `evolution.ts`, the instruments, `dpi`/`dpi-sweep`/`settings`, `submovement`, `plotGeometry` stay PURE, deterministic (injected RNG), unit-tested. Arena keeps injected `RendererLike`/`InputSource`/optional `PostProcessor`; new 3D layers attach through the existing `EnemyLayer` hook and a NEW injected viewmodel-attach seam mirroring it. WebGL/image-decode stays runtime-verified in Chromium, never in unit tests. The z-score per-instrument standardization stays AFFINE (reliability enters via the GP nugget, not by rescaling y, so no instrument's own optimum moves).
5. **Conventions + stack:** ln(cm/360) is the single search/fit space. NO em dashes (U+2014) or `--` anywhere (use ` - `); OKLCH tinted neutrals, no pure #000/#fff; canvas/WebGL colors ONLY from `src/palette.ts`. Animate ONLY transform/opacity/filter (+ shader uniforms), strong ease-out, no bounce, no layout animation; reduced-motion plumbed end to end. Client-only, GitHub Pages subpath (runtime asset paths use `import.meta.env.BASE_URL`). Tests stay green; every change TDD'd.

## Phases

### Phase 1 - Sharpen the measurement core (pure logic, zero rendering risk)
- **P1-1** Wire per-trial reliability into `Observation.noise` (heteroscedastic nugget). Each `analyze*` emits an optional `scoreSE`; `trialsToObservations` sets `Observation.noise = clamp((w*scoreSE/sd)^2, floorFrac*noiseVar, ceilFrac*noiseVar)` only when `scoreSE` is finite > 0, else leaves noise undefined (flat-path observations stay byte-identical). track emits no `scoreSE`. Files: `objective.ts`, `flick.ts`, `strike.ts`, `calibrate.ts`, `types.ts`, `fitts.ts`.
- **P1-2** Fit GP `lengthScale` + `noiseVar` by exact log marginal likelihood over a coarse deterministic grid; pin `signalVar` to base; honest fallback (obs<8 / Cholesky throw / no logML gain). Wire at FINALIZE ONLY (never inside `evolution.suggest`). Files: `gp.ts`, `session-controller.ts`. Depends P1-1.
- **P1-3** Make the bootstrap CI reliability-aware (stratify/weight residuals by per-point `Observation.noise` instead of one pooled bag); deterministic under seeded RNG; never narrows below the conservative bound. Files: `bootstrap.ts`, `session-controller.ts`. Depends P1-1.
- **P1-4** Estimate tracking latency from yaw AND pitch via a single combined covariance `cov(lag)=yawCov+pitchCov` (amplitude-weighted), then the existing integer search + parabolic refine. Files: `track.ts`.

### Phase 2 - The result climax (report-layer / UI, pure-downstream of scoring)
- **P2-1** Bring the convergence plot to the result screen (optional `Result.curve`+`bounds` copied verbatim from `Report`; marks via existing pure `marksFromTrials` over persisted trials; fixed viewBox; old results render number-only). `adoptResult` drops curve/bounds for tuned values.
- **P2-2** Reframe the breakdown as four facets contributing to ONE answer + unify mixed units (affine-fused contribution per facet on the shared ln axis; two tiers: "where the number comes from" vs "readings at that sensitivity"; keep every `data-breakdown`/`data-result` attribute byte-identical).
- **P2-3** Surface CI concord readout (`ciConcord` tight|moderate|wide by thresholds, copy never asserts a cause, gated `!tuned`) + the strike speed/accuracy lean (sourced from `profile.speedAccuracy`, the real taste knob).

### Phase 3 - Harden the integrity gate, then migrate to real 3D (the headline)
- **P3-1** (do FIRST, test-only) Harden the INTEGRITY test: run an identical scripted session twice (with a FakeEnemyLayer and without), deepEqual the full `Recording {frames, fires}`; add an adversarial fake layer whose `update()`/`fire()` attempt to mutate handles and assert the recording is unchanged. Named regression gate for every migration PR.
- **P3-2** Replace the four merc-sprite billboards with procedural 3D quarry meshes (`enemy/meshes.ts` factory per `InstrumentId` from primitives + emissive weak-spot at LOCAL ORIGIN; materials from `palette.ts`). Rewrite ONLY `enemy-layer.ts` (pool a `THREE.Group` per spawn, scale to `ENEMY_SIZE_K x` hitbox from `worldRadius=dist*tan(radiusDeg)`, keep `target.mesh.visible=false`, reuse `EnemyController` verbatim, drive states via transform/opacity/emissive tweens). Depends P3-1.
- **P3-3** Replace the chrome-Deagle 2D overlay with an in-scene 3D single-action revolver: `Arena.attachViewmodel(vm)` mirroring `attachEnemies`; revolver Group parented to `rig.camera`, `depthTest:false` + late renderOrder; reuse `recoil.ts`/`sway.ts` springs unchanged (re-point to drive the Group, re-tune gains, verify feel in Chromium). Depends P3-1.
- **P3-4** Death/escape as real 3D motion downstream of `classifyHit` only (kill = topple+sink+fade + pooled dust; cleared-without-kill = lateral sprint-and-fade); transform/opacity/filter only, ease-out, pooled, reduced-motion = instant static fade. NO TTK channel into the cosmetic `fire()`. Depends P3-2.
- **P3-5** Add `createFilmPass` (same PostProcessor interface): warm filmic/ACES-ish tone-map preserving the gold #FFC400 anchor, animated grain, soft vignette, optional mild edge chroma; drop the hard downscale + scanlines; thread `reducedMotion` to freeze grain. Keep `createPsxPass` selectable as "retro". THEN (gated on P3-2+P3-3 verified in Chromium) delete the sprite PNGs + dead chroma-key/dither/atlas/2D-controller modules; keep pure `sway`/`recoil`/`hit` + tests. Depends P3-2, P3-3, P3-4.

### Phase 4 - Calibration precision + whole-flow UX polish
- **P4-1** Median DPI over multiple sweep passes with outlier rejection (`dpiFromPasses`, `spreadPct` is a consistency indicator only, never a CI); feed combined slow magnitude to `accelVerdict`; seed the spin from horizontal PATH-LENGTH (`SpinSeedAccumulator`), keep signed swept only for the dial visual.
- **P4-2** Add an exit/abort affordance + a legible pre-lock "begin" state to the session (abort scrim gated only when lock dropped AND running AND panel hidden AND !lockedIn; resume calls `requestLock` only; quit calls `navigate('hero')` only; reword "click to lock in" -> "click to begin").
- **P4-3** Announce the narrative layer to assistive tech (plot `aria-hidden`, estimate figcaption `aria-live=polite` at meaningful moments only; result `sr-only` summary) + honest calibration tolerance copy + intro/hero copy fixes (reconcile the 6-predators/4-environments count; global Escape skip).

## Sequencing notes
- Phase 1 + Phase 2 are pure-core / report-layer and independent of the 3D work; they can land before or alongside Phase 3.
- Phase 3 is strictly ordered: P3-1 (integrity hardening) before any 3D code; deletions (P3-5) hard-gated on both 3D replacements verified in Chromium (the unit suite uses a FakeEnemyLayer and cannot see a blank real render).
- Within a phase, tasks that share a file (P1-2 & P1-3 share `session-controller.ts`) are implemented sequentially.
