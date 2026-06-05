# Auto-Refining Calibration: Click-Only Flow - Design

> Brainstormed 2026-06-05 (after card-anchored calibration shipped). Strips manual input off the
> front of calibration, adds a lift-to-continue spin, and turns the optimizer session into a
> watch-it-converge-then-lock-in experience. Goal: almost no manual input besides clicking, almost
> no reading; the computer refines your cm/360 until you can see it is genuinely settled.

**Goal:** A calibration a five-year-old could finish with clicks and aiming alone. Slide across a
card (DPI), spin once (a click-only starting point, lift when you run out of room), then aim while
the computer evolves your cm/360 generation after generation and you watch it settle and lock it in.

---

## What already exists (do not rebuild)

The evolutionary optimizer already does "trials/generations until it finds the best": `runSession`
(`src/optimizer/session-controller.ts`) runs a cold-start gene pool then evolutionary generations,
calling `onTrial` each trial with a live interim `Report` (estimate + 90% CI + curve). The session
screen already renders the live convergence plot and an estimate readout. The result screen already
lists **every game's** per-game sensitivity in a table. So most of the user's vision is present; the
work is (1) remove manual input from the front, (2) add the lift mechanic, (3) make convergence a
visible, user-controlled "lock it in" moment, (4) defer the game pick, (5) cut reading.

## The honest measurement model (the crux the user raised)

You cannot read a player's *current* in-game cm/360 from a browser - their in-game sensitivity
(degrees turned per mouse count) lives in their game config, invisible to the page. No clicking or
spinning can reveal it. What the browser *can* do, correctly: the card sweep measures true **DPI**
(cm per count, a real physical quantity); the app then renders its own targets at any cm/360 it
chooses (in real centimeters, anchored by DPI), watches the player aim, scores them, and evolves
toward the cm/360 where they perform best. That converged number is correct and well-defined - a
*prescription* of the player's optimal sensitivity, not a readout of their current one. The spin does
not measure the player's number; it only produces a rough personalized starting point so the search
window brackets their real range. This framing is stated plainly in the copy; no false precision.

## The flow (after the change)

`intro -> sweep (card) -> spin -> session (refine + lock in) -> result`

The `game` step and the precision/speed `goal` slider leave the guided flow (deferred / defaulted).

1. **intro** - unchanged: "grab any card from your wallet..." plus **start** and the
   **"i already know my numbers"** typed fast path (kept as the power-user shortcut and the
   no-pointer-lock / reduced-motion fallback).
2. **the sweep** - unchanged (card sweep -> true DPI; acceleration check folded in).
3. **the spin** (replaces the arrow-tuned turn) - a click-only full turn that produces a
   personalized seed cm/360. See below.
4. **the session** - the existing evolutionary drills, now framed as watch-and-lock-in. See below.
5. **the result** - unchanged number/CI/breakdown, plus a small "your game" selector that highlights
   one row of the already-present per-game table. Defaults to a balanced profile and a default game.

## The spin (new): click-only, lift-aware, personalized seed

A thin canvas shell (`src/ui/calibrate/spin-view.ts`) replacing `turn-view.ts`. Pointer locks; a
radial dial shows turn progress; a `home` marker sits dead ahead. The player swipes to spin. The
dial advances by `degPerCountFor(provisionalCm360, dpi)` purely as a visual cue (`provisionalCm360`
is a fixed display constant, NOT the measured seed).

**Two click gestures on the primary button (tap vs hold):**

- **Tap** (quick press-release, negligible movement during the press) = **done**: the player has
  come full circle. Records the seed: `seedCm360 = cm360FromTurnCounts(totalSweptCounts, dpi)` where
  `totalSweptCounts` is the magnitude of accumulated horizontal counts across the whole spin (the
  swipe distance the player treats as one 360). Guard: a tap only completes once a minimum has been
  swept (>= ~270 degrees at the provisional rate) so an early accidental click is a no-op (counting
  resumes).
- **Hold** (press, then lift/move, then release) = **reposition**: counting **suspends** on
  mousedown and **resumes** on mouseup, so the player can pick up and reset the mouse mid-spin
  without the repositioning movement corrupting the count. This is the user's "click/tap when you
  run out of mousepad space and continue" - hold to lift, release to keep going. (Natural lifts also
  read ~0 counts under pointer lock, so the hold is a robustness guard, not the only way.)

Classification: on `mousedown` suspend counting and start a timer; on `mouseup`, if elapsed <
`TAP_MS` (~220 ms) AND movement during the press was negligible -> it was a **tap**; otherwise it was
a **hold** (reposition) -> resume counting. A tap with sufficient sweep completes; a tap without it
is a no-op that resumes counting.

`seedCm360` feeds `boundsFromSeed` (unchanged) to center the optimizer window. Because the seed is
the player's own full-turn distance, the window brackets their real range (covering low-sens players
the fixed default would miss) and keeps drill motions within their pad.

Copy (one or two lines, honest framing): "spin all the way around once - the way you'd whip around
in game. tap when you're facing forward again. ran out of room? hold the button, reset your mouse,
let go." Reduced-motion users take the typed fast path (offered on intro) instead of the spin.

This pointer-lock interaction (tap vs hold feel) is a thin shell: runtime-verified, not unit-tested,
and explicitly flagged for the user's hands-on tuning (`TAP_MS`, the sweep-completion threshold, the
provisional rate, dial sensitivity are all reasoned constants to feel-tune).

## The session (watch + lock in)

`runSession` gains one additive seam: an optional **`shouldStop?: () => boolean`** in `SessionConfig`,
checked once per loop iteration after `onTrial` (and after the existing CI check); when it returns
true the loop breaks and the session finalizes from the trials gathered so far. Nothing else in the
loop, the engine, the cold-start, or the objective changes. Pure-testable (a fake instrument +
`shouldStop` flipping true mid-run asserts the loop stops and finalizes).

The session screen (`src/ui/session-view.ts`) drives it in **segments**. Pointer lock has to be
released for the player to click the panel (the cursor is captured while aiming), so the panel is
shown only between segments, never mid-run:

- A segment is one `runSession` call (sharing one persistent evolution `engine` instance and the
  accumulated `initialTrials`). The first segment runs cold-start + up to ~12 generations with
  `ciStopWidth = FIRST_STOP_CI` (6 cm/360), so it stops itself when the 90% CI is tight, or at its
  cap. During the segment the live plot updates every trial (this is the "watch").
- When a segment ends, the session **releases pointer lock** and reveals the **"dialed in"** panel:
  the settled number, the 90% CI, and two actions - **"lock it in"** and **"keep refining"**.
- **lock it in** -> builds the result and navigates to `result` (sets `shouldStop` too, fencing any
  in-flight work).
- **keep refining** -> re-requests lock and runs another segment of `REFINE_GENS` (6) more
  generations from the accumulated trials (no `ciStopWidth`, so it always advances), then shows the
  panel again with the tightened number.
- `MAX_TRIALS = 30` is the hard cap across all segments. Once reached, "keep refining" force-finalizes
  to `result`.

So the player watches the estimate settle and the band tighten during each segment, then decides at
the natural unlocked pause when it is "genuinely perfect" - with the existing convergence math
untouched. (This segment-based approach replaced an earlier idea of mid-run convergence detection: a
panel cannot be clicked while the pointer is locked for aiming, so the decision must happen at a
released-lock boundary.)

## Deferred game pick + default profile

The guided flow no longer asks for game or speed/accuracy goal:

- `commitGuided` writes `dpi` (from the sweep), `bounds = boundsFromSeed(seedCm360)`, a **balanced**
  `profile.speedAccuracy = 0.5`, and leaves `currentGame` at the draft default, then navigates to
  `session`. (No game/goal params.)
- The result screen already renders every game's sensitivity; add a small `your game` `<select>`
  that updates which row is highlighted (`data-current`) - a pure client-side highlight, no
  recompute (all per-game sens are already shown). The speed/accuracy preference stays a balanced
  default; advanced tuning remains available on the existing options screen.

## Architecture / files

- `src/optimizer/session-controller.ts` - add `shouldStop?: () => boolean` to `SessionConfig`; check
  it in the loop. (Pure, unit-tested.)
- `src/ui/calibrate-flow.ts` - rename step `turn` -> `spin`; `sweep-done` (non-accelerated) ->
  `spin`. Remove the `game` step and the `turn-done` action (commit happens in the screen via the
  spin's `onSeed` callback). `CalState` keeps `{ step, dpi }` (drop `seedCm360` - passed straight to
  commit). (Pure, unit-tested.)
- `src/ui/calibrate/spin-view.ts` - NEW thin shell (the tap/hold spin). Reuses
  `createPointerLock`, `degPerCountFor`, `cm360FromTurnCounts` (all existing). Runtime-verified.
- `src/ui/calibrate/turn-view.ts` - **removed** (replaced by spin-view).
- `src/ui/setup.ts` - mount `spin-view` for the `spin` step (onSeed -> commitGuided(seedCm360));
  remove the `game` stepHtml branch + wiring; `commitGuided` no longer takes game/goal. Trim copy.
  The typed manual path is unchanged (still types dpi/game/sens/goal).
- `src/ui/session-view.ts` - the watch + lock-in overlay + `shouldStop` wiring + convergence
  detection; `MAX_TRIALS = 30`, drop `ciStopWidth`.
- `src/ui/result.ts` - add the `your game` highlight selector (no recompute).
- Styles: a small block for the spin dial + the dialed-in panel (in `styles/calibrate.css` and/or
  the session styles), brand gold accent.

## Testing

- **Pure (unit):** `session-controller` - `shouldStop` returning true mid-loop stops the session and
  finalizes from gathered trials (fake instrument + scripted scene). `calibrate-flow` - `sweep-done`
  (clean) -> `spin`; no `game` step exists; `retry` still clears dpi; manual reachable. `setup` -
  intro renders start + manual + no pad field; the guided spin path commits dpi + `boundsFromSeed`
  seed + balanced profile and navigates to session; the manual path unchanged.
- **Shell (runtime-verified):** the spin tap completes and seeds, hold repositions without
  corrupting the count, lifts read ~0; the session shows the dialed-in panel on convergence, lock-it-in
  navigates to result, keep-refining continues; the result `your game` selector re-highlights.

## Non-goals

- No change to the four drills, the objective blend, the evolution engine, `boundsFromSeed`, the
  card sweep, or DPI math.
- No re-running drills to change the speed/accuracy preference (balanced default; options screen for
  advanced tuning). A live result-screen re-blend from stored trials is a possible later enhancement,
  not in scope.
- The spin does not claim to measure the player's current in-game cm/360 (impossible from a browser);
  it is an honestly-labeled personalized starting point.
- Trackpad unsupported (desktop + mouse only, unchanged).

## Decisions settled during brainstorming

1. The starting-point spin is **click-only with lift-to-continue** (tap = done, hold = reposition),
   producing a personalized seed; no arrow keys, no typing.
2. Convergence is **watch + lock in**: the player sees it settle and chooses when it is perfect
   (or keeps refining); a hard cap forces a finish. The convergence math is unchanged.
3. The **game pick is deferred to the result** (the per-game table already shows all games; add a
   highlight selector); the speed/accuracy goal defaults to balanced.
