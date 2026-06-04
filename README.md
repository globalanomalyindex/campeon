# campeón

**Find your optimal FPS mouse sensitivity (cm/360) by playing through drills modeled on how predators evolved to aim.**

🎮 **Live demo → [globalanomalyindex.github.io/campeon](https://globalanomalyindex.github.io/campeon/)**
*(desktop + mouse; the arena uses pointer lock — click to lock, `Esc` to release)*

---

## What it is

Most sensitivity finders ask you to copy a pro or eyeball a feel. campeón **measures** instead. You play four short drills; each one is a bio-inspired *instrument* that scores a different facet of your aim. An optimizer then hands you new sensitivities, generation after generation, and converges on the cm/360 where you score best across all four — reported as one number with a 90% confidence interval.

The thesis: **don't simulate the animals' brains — recreate the *environments* that forced evolution to build such accuracy, and treat your sensitivity as the one trait under selection.** The same niches that forged a dragonfly's intercept or a mantis shrimp's strike, rebuilt as drills, evolve *your* number.

## The four instruments (six organisms)

| Drill | Environment | Organisms | Measures |
|---|---|---|---|
| **+track** | the open-air intercept | dragonfly · falcon | lag-compensated predictive tracking residual + gaze-stabilization slip |
| **+flick** | the ambush | spider · raptor | two-mode (ballistic × precision) Fitts throughput |
| **+calibrate** | shooting through the bend | archerfish | aim↔impact bias / variance decomposition |
| **+strike** | the strike window | mantis shrimp | time-to-kill operating point on the speed↔accuracy curve |

Each faculty produces a within-trial score; the four are normalized across the sweep (z-score, so an instrument's own peak never moves) and blended into one curve. A **surrogate-assisted (1+λ) evolution strategy** in `ln(cm/360)` mutates the fittest-so-far sensitivity, lets a Gaussian-process surrogate screen offspring for sample-efficiency, and self-adapts its step size by Rechenberg's 1/5 rule. The result is a parabolic peak fit with a bootstrap 90% CI, cross-checked against the GP's own argmax so the interval widens honestly when the models disagree.

> **The science is the product.** The math is real (ISO-9241-9 effective throughput, a constant-velocity Kalman tracker, bias/variance decomposition, Matérn-5/2 GP + expected-improvement), and the app refuses to fake signal — degenerate trials are dropped, never smoothed over, and a number you hand-tune in the range is shown *without* a measured CI. There's an in-app **case study** that walks through the whole derivation with citations.

## Try it

1. Open the [live demo](https://globalanomalyindex.github.io/campeon/).
2. Enter your DPI + current in-game sens, pick your game, set the speed↔accuracy goal.
3. Pass the input-validity gate (raw input / no acceleration).
4. Play the session — the live plot homes in on your number.
5. Read your result, then step into the **range** to feel it out and fine-tune.

## Tech

- **TypeScript** (strict, `exactOptionalPropertyTypes`) + **Vite** + **Three.js**, fully client-side (no backend; `localStorage` only).
- Hash-routed SPA; a hand-rolled **PSX/Deadpool visual skin** (low-res render target, ordered dither + posterize, chrome-keyed Desert Eagle viewmodel, merc-prey target billboards).
- **Pure-core / thin-shell** architecture: all the math + logic is pure and unit-tested (vitest); only WebGL/canvas shells are runtime-verified. ~340 tests.
- Respects `prefers-reduced-motion` throughout.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # the pure-core suite
npm run build    # tsc --noEmit && vite build
```

## Notes

- This is a research-grade aim tool and a design-engineering portfolio piece — an exploratory instrument, not clinical or competitive-ranking software.
- Design spec + implementation plans live under [`docs/superpowers/`](docs/superpowers/).

— by Christopher Robin Fiore
