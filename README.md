# campeón

**find your fps mouse sensitivity (cm/360) by playing drills modeled on how predators evolved to aim**

**live demo: [globalanomalyindex.github.io/campeon](https://globalanomalyindex.github.io/campeon/)**
*(desktop + mouse; the arena uses pointer lock, so click to lock and press `Esc` to release)*

---

## what it is

most sensitivity finders are generic aim/miss engines. campeón **measures** instead. you play four short drills, and each one is a bio-inspired instrument that scores a different facet of your aim. an optimizer then hands you new sensitivities, generation after generation, and converges on the cm/360 where you score best across all four, reported as one number with a 90% confidence interval.

the thesis: **if i treat sensitivity as a lifeform's target-acquisition instincts and put you in environments that force high accuracy for survival, i can find your optimal sensitivity better than a converter or a stranger's config can.** i do not simulate the animals' brains. i recreate the environments that forced evolution to build that accuracy, and treat your sensitivity as the one trait under selection. the same niches that forged a dragonfly's intercept or a mantis shrimp's strike, rebuilt as drills, evolve your number.

## the four instruments (six organisms)

| drill | environment | organisms | measures |
|---|---|---|---|
| **+track** | the open-air intercept | dragonfly · falcon | lag-compensated predictive tracking residual + gaze-stabilization slip |
| **+flick** | the ambush | spider · raptor | two-mode (ballistic × precision) fitts throughput |
| **+calibrate** | shooting through the bend | archerfish | aim↔impact bias / variance decomposition |
| **+strike** | the strike window | mantis shrimp | time-to-kill operating point on the speed↔accuracy curve |

each faculty produces a within-trial score. the four are normalized across the sweep (z-score, so an instrument's own peak never moves) and blended into one curve. a **surrogate-assisted (1+λ) evolution strategy** in `ln(cm/360)` mutates the fittest-so-far sensitivity, lets a gaussian-process surrogate screen offspring for sample efficiency, and self-adapts its step size by rechenberg's 1/5 rule. the result is a parabolic peak fit with a bootstrap 90% ci, cross-checked against the gp's own argmax so the interval widens honestly when the models disagree.

> **the science is the product.** the math is real (ISO 9241-9 effective throughput, a constant-velocity kalman tracker, bias/variance decomposition, matérn-5/2 gp + expected improvement), and the app refuses to fake signal. degenerate trials are dropped rather than smoothed over, and a number you hand-tune in the range is shown without a measured ci. there is an in-app **case study** that walks the whole derivation, with sources tied to the claims they carry.

## try it

1. open the [live demo](https://globalanomalyindex.github.io/campeon/).
2. enter your dpi + current in-game sens, pick your game, set the speed↔accuracy goal.
3. pass the input-validity gate (raw input, no acceleration).
4. play the session. the live plot homes in on your number.
5. read your result, then step into the **range** to feel it out and fine-tune.

## tech

- **typescript** (strict, `exactOptionalPropertyTypes`) + **vite** + **three.js**, fully client-side (no backend, `localStorage` only).
- hash-routed spa with a 3d arena built from **procedural in-repo geometry**: no external dcc pipeline, no baked assets, every quarry made of primitives and palette math, every shader hand-written.
- a **renderer-agnostic seam**: the scored stream is produced by the engine and the cosmetic layers only read it, so a stub renderer never touches webgl and the graphics can never move the number.
- **pure-core / thin-shell** architecture: all the math and logic is pure and unit-tested (vitest), and only the webgl/canvas shells are runtime-verified. 650+ tests, including an **integrity gate** (`tests/engine/arena-enemies.test.ts`) that proves the scored stream is byte-identical with the cosmetic 3d on or off.
- respects `prefers-reduced-motion` throughout.

## notes

- this is a research-grade aim tool and a design-engineering portfolio piece: an exploratory instrument, not clinical or competitive-ranking software.
- the design canon this app is built to lives at [`docs/design/canon.md`](docs/design/canon.md). spec + implementation plans live under [`docs/superpowers/`](docs/superpowers/).

---

designed and engineered by **christopher robin fiore**, design engineer and creative technologist.
