# Guided Calibration: One Step At A Time + Visual Cues - Design

> Brainstormed 2026-06-05 (after the accel false-positive fix landed). The calibration advanced through
> hidden state-machine phases with almost no on-screen feedback and crammed whole procedures into single
> sentences. This redesign guides a complete novice: exactly one action on screen at a time, each with a
> literal visual cue, plain language, and a persistent sense of where they are in the journey. Grounded
> in an adversarially-verified UX audit (workflow wwf3i2xpp).

**Goal:** A novice who has never calibrated a mouse can finish by following one cued instruction at a
time. No multi-action sentences, no jargon, no hidden "armed and waiting" states.

---

## Principles

1. **One action visible at a time.** Each state shows a single imperative instruction; it swaps as the
   phase advances. Never chain "go back / click / slide" in one breath.
2. **Every action has a visual cue.** Clicks get a pulsing target; sweeps get an animated direction
   arrow + a finish band + a pace meter; the spin gets a "home" label + a sideways ghost arrow; the
   finish action only appears (and lights up) once it is valid.
3. **Plain language.** "click to begin (hides your cursor - press Esc to stop)" not "lock the pointer".
   "step" not "pass". Demystify, never assume.
4. **Always know where you are.** A persistent 2-segment tracker - **the sweep -> the spin** - sits
   above both views; the current segment is highlighted, finished segments get a checkmark.
5. **Feedback on every transition.** A completed pass shows a brief confirmation/checkmark before
   advancing; a too-early action gets an explanatory nudge instead of a silent no-op.

## Global progress tracker (setup shell)

`setup.ts` renders a persistent header above the view host for the `sweep` and `spin` steps: two
segments, "1 the sweep" and "2 the spin". The active segment is highlighted; once the sweep completes
and we are on the spin, segment 1 shows a checkmark. Implemented as DOM chrome in `setup`'s render (the
canvas views mount below it), so it survives the sweep->spin view swap. Driven by `state.step`.

## Intro (setup, `intro` step)

Replace the one-breath lead with a short preview + a single physical-prep confirm:

- Title `+ calibrate`; lead: "two quick steps, no numbers to look up - we measure how your hand
  actually moves."
- A tiny 2-item preview: "1 - the sweep: drag a card's width so we learn your mouse. 2 - the spin:
  turn all the way around once."
- One prep instruction: "first, grab any card from your wallet - bank card, gym card, hotel key.
  they're all exactly the same size."
- Primary button label doubles as the confirm: **"i've got a card - start"**. Ghost button: "i
  already know my numbers" (unchanged typed fast path). Reduced-motion notice unchanged.

## The sweep (`sweep-view.ts`) - state-driven copy + cues

A small explicit UI phase already exists (`idle-slow` -> `running-slow` -> `idle-fast` ->
`running-fast`) plus a pre-lock state. Drive a single instruction + cue per state. The step pill reads
"step 1 of 2 - the sweep". A `pass` indicator reads "pass 1 of 2 - slow (measures your mouse)" /
"pass 2 of 2 - fast (checks for acceleration)".

| State | Single instruction | Visual cue |
|---|---|---|
| pre-lock (not locked) | "click the box to begin" + sub "hides your cursor so we can read raw motion - press Esc anytime to stop" | pulsing click ring centered on the canvas overlay; bright LEFT-edge marker drawn on canvas |
| idle-slow (locked, armed) | "rest your mouse at the card's LEFT edge, then click once to start" | pulsing "click to start" target near the left edge; start dot at the trail origin |
| running-slow | "slowly drag right, following the card to its RIGHT edge" | looping left->right ghost arrow; pace meter (green = good, amber = "a little slower"); translucent right-edge finish band the trail grows toward |
| running-slow ready (enough swept) | "click to finish pass 1" | pulsing finish target; trail reached the finish band |
| idle-fast (after slow captured) | "now move your mouse back to the card's LEFT edge" then (idle) "click to start the fast pass" | reverse (right->left) ghost arrow for the reposition; pass pill flips to "pass 2 of 2 - fast"; pass-1 checkmark shown |
| running-fast | "now drag FAST to the right edge - one quick motion" | arrow; pace meter inverts (green = fast enough, amber = "a bit faster") |
| running-fast ready | "click to finish calibration" | distinctly-styled FINAL target (green, flag icon) different from mid-flow clicks |

The existing cardiogram trail stays as the live motion feedback. "Speed" for the pace meter is derived
from per-sample timing already available (sample `t`); a coarse counts/ms estimate over a short window
suffices (slow vs fast is a soft hint, not a gate - the accel detection is handled in `finish()`).

## The spin (`spin-view.ts`) - state-driven copy + cues

The step pill reads "step 2 of 2 - the spin". Reveal exactly one instruction per state; never state the
tap/hold/reposition mechanics up front.

| State | Single instruction | Visual cue |
|---|---|---|
| pre-lock | "we'll measure one full turn. click the box to begin." | pulsing click ring |
| spinning (< MIN_DONE_DEG) | "drag your mouse sideways to turn - the ring fills as you go" | "home" label on the red top marker; a horizontal double-arrow / ghost-hand beside the dial showing a SIDEWAYS drag (explicitly not circular) |
| near-done (>= MIN_DONE_DEG) | "facing forward? quick-click to finish" + small "quick click, don't move" hint | dial arc turns green; home marker glows; pulsing center finish prompt (only now) |
| too-early tap (tap below threshold) | brief "almost - keep turning" flash | the dial flashes so the failed tap is acknowledged (no silent no-op) |
| repositioning (hold active) | "slide your mouse back to where you started, then let go" | dial dims + a pause glyph (counting visibly frozen); amber arc retained |

A persistent calm helper card sits below the dial the whole time: "out of room? press and HOLD the
button, slide your mouse back, then let go - the ring won't move while you hold." So the recovery
gesture is discoverable BEFORE it is needed, not only reactively.

## Plain-language blocked screen

Already split by `blockReason` in the accel fix (`accel` vs `invalid`) with plain copy and a single
clear retry. This redesign keeps that; no further change required beyond what shipped.

## Architecture / files

- `src/ui/setup.ts` - intro preview + the persistent 2-segment progress tracker above the view host
  (rendered for `sweep`/`spin`).
- `src/ui/calibrate/sweep-view.ts` - per-state single-instruction copy; canvas cues (left-edge marker,
  finish band, direction arrow, pace meter, start dot); a pulsing click-target overlay; pass pill +
  checkmark; a coarse pace estimate from sample timing. The `finish()` accel logic (raw-skip +
  width-scaled tol) is unchanged from the fix.
- `src/ui/calibrate/spin-view.ts` - per-state single-instruction copy; canvas cues (home label,
  sideways ghost arrow, green near-done glow, freeze/pause visual); a persistent out-of-room helper;
  an "almost - keep turning" flash on a too-early tap.
- `src/styles/calibrate.css` - new primitives: `.cal-step` pill, `.cal-progress` 2-segment tracker,
  `.cal-pulse` click ring, `.cal-helper` card, `.cal-pace` meter. Canvas-drawn cues (arrow, finish
  band, markers, glow, freeze) need no CSS.

## Testing

- **Pure / jsdom:** the reducer (`blockReason`, steps) is already covered. `setup` jsdom test: intro
  shows the preview + the "i've got a card - start" primary + the typed fast path + no pad field; the
  progress tracker renders for the sweep step. (The canvas cue drawing + pointer-lock interaction are
  runtime-verified, not unit-tested.)
- **Shell (runtime-verified):** each state shows exactly one instruction + its cue; the pulsing target
  marks where to click; the sweep arrow/finish-band/pace-meter render; the spin shows "home", the
  sideways arrow, the green near-done glow, the freeze-on-hold, and the out-of-room helper; the
  too-early-tap flash fires. Flagged for the user's hands-on feel pass (pointer lock cannot be
  automated).

## Non-goals

- No change to the accel detection logic (shipped in the fix), the optimizer/session, the DPI/cm360
  math, or the spin's tap/hold classification thresholds.
- No new framework/animation library - cues are canvas 2D + small CSS keyframes only.
- Trackpad still unsupported; reduced-motion still routes to the typed fast path.

## Decisions settled during brainstorming

1. One action visible at a time, each with a literal visual cue; plain language throughout.
2. A persistent 2-segment "the sweep -> the spin" tracker frames the whole journey.
3. The out-of-room hold-to-reposition recovery is taught proactively (a persistent helper), not only
   reactively, because running out of pad is the novice's most likely failure on a full 360.
