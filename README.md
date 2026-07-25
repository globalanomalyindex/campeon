# campeón

**Find your FPS mouse sensitivity (cm/360) by playing drills modeled on how predators evolved to aim.**

**Live demo: [globalanomalyindex.github.io/campeon](https://globalanomalyindex.github.io/campeon/)**
*(desktop and mouse; the arena uses pointer lock, and `Esc` releases the cursor)*

---

## What it is

campeón measures one number. You play four short drills, and each one is a bio-inspired instrument that scores a different facet of your aim. An optimizer hands you new sensitivities, generation after generation, and converges on the cm/360 where you score best across all four, reported as one number with a 90% confidence interval.

The thesis: **if I treat sensitivity as a lifeform's target-acquisition instincts and put you in environments that force high accuracy for survival, I can find your optimal sensitivity better than a converter or a stranger's config can.** I recreate the environments that forced evolution to build that accuracy, and I treat your sensitivity as the one trait under selection. The same niches that forged a dragonfly's intercept or a mantis shrimp's strike, rebuilt as drills, evolve your number.

## The four instruments (six organisms)

| Drill | Environment | Organisms | Measures |
|---|---|---|---|
| **Track** | The open-air intercept | Dragonfly · falcon | Lag-compensated predictive tracking residual + gaze-stabilization slip |
| **Flick** | The ambush | Spider · raptor | Two-mode (ballistic × precision) Fitts throughput |
| **Calibrate** | Shooting through the bend | Archerfish | Aim-to-impact bias / variance decomposition |
| **Strike** | The strike window | Mantis shrimp | Time-to-kill operating point on the speed / accuracy curve |

Each faculty produces a within-trial score. The four are normalized across the sweep (z-score, so an instrument's own peak never moves) and blended into one curve. A **surrogate-assisted (1+λ) evolution strategy** in `ln(cm/360)` mutates the fittest-so-far sensitivity, lets a Gaussian-process surrogate screen offspring for sample efficiency, and self-adapts its step size by Rechenberg's 1/5 rule. The result is a parabolic peak fit with a bootstrap 90% CI, cross-checked against the GP's own argmax so the interval widens honestly when the models disagree.

> **The science is the product.** The math is real (ISO 9241-9 effective throughput, a constant-velocity Kalman tracker, bias / variance decomposition, Matérn-5/2 GP + expected improvement), and the app refuses to fake signal. Degenerate trials are dropped outright, and a number you hand-tune in the range is shown without a measured CI. An in-app **case study** walks the whole derivation, with sources tied to the claims they carry.

## Try it

1. Open the [live demo](https://globalanomalyindex.github.io/campeon/).
2. Enter your DPI and current in-game sens, pick your game, set the speed / accuracy goal.
3. Pass the input-validity gate (raw input, no acceleration).
4. Press begin and play the session. The live plot homes in on your number.
5. Read your result, then step into the **range** to feel it out and fine-tune.

## Tech

- **TypeScript** (strict, `exactOptionalPropertyTypes`) + **Vite** + **Three.js**, fully client-side (no backend, `localStorage` only).
- A hash-routed SPA with a 3D arena built from **procedural in-repo geometry**: every quarry is made of primitives and palette math, and every shader is hand-written.
- A **renderer-agnostic seam**: the engine produces the scored stream and the cosmetic layers only read it, so a stub renderer never touches WebGL and the graphics can never move the number.
- **Pure-core / thin-shell** architecture: all the math and logic is pure and unit-tested (Vitest), and only the WebGL and canvas shells are runtime-verified. 775 tests, including an **integrity gate** (`tests/engine/arena-enemies.test.ts`) that proves the scored stream is byte-identical with the cosmetic 3D on or off.
- Respects `prefers-reduced-motion` throughout.

## Notes

- This is an exploratory measurement instrument and a design-engineering portfolio piece; it makes no clinical or competitive-ranking claims.
- The design canon this app is built to lives at [`docs/design/canon.md`](docs/design/canon.md). Spec and implementation plans live under [`docs/superpowers/`](docs/superpowers/).

---

Designed and engineered by **Christopher Robin Fiore**, design engineer and creative technologist.
