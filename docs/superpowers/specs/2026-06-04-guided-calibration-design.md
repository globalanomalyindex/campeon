# Guided Calibration: Measured DPI + Rendered Turn - Design

> Brainstormed 2026-06-04. Replaces the typed `setup` screen and the opaque slow/fast `gate`
> with a guided, physical calibration. Validated interactively in the visual companion
> (rotation-test feel + end-to-end flow).

**Goal:** Let a player calibrate by *doing* (sweep your pad, do a turn) instead of *knowing*
(type your DPI, your in-game sens, and pass a confusing acceleration test).

---

## The problem

Today the opening is two abstract screens:

- **`setup`** (`src/ui/setup.ts`): you type **mouse DPI**, pick your **game**, type your **in-game sens**.
  cm/360 is computed as `cmPer360 = 914.4 / (dpi * sens * yaw)`.
- **`gate`** (`src/ui/gate.ts` + `src/input/accel-check.ts`): the "swipe slow, then fast, we compare
  the totals" test. Its real job is detecting mouse acceleration (which makes cm/360 undefined), but
  the instruction is opaque and users do not understand why they are doing it.

Both ask you to *know* numbers most players cannot find, and the gate reads as a mystery ritual.

## The core insight (why a 2D strip cannot define a turn)

"Measure my cm/360" hides **two independent unknowns**, and the mousepad only solves one:

- **Distance (cm)** - how far the hand moved. A browser sees mouse **counts**, never centimeters.
  Converting counts to cm needs **DPI**. The mousepad sweep supplies this.
- **Angle (that a sweep is exactly 360 degrees)** - nothing in a blank surface can supply this.
  The app can show cm swept but not degrees turned, because **degrees-per-count is the player's
  in-game sensitivity**, the very unknown we are after, and it lives in their game where the browser
  cannot reach.

So the angle must come from something real. We render a turn: the world rotates with the player and
a **home** marker starts dead ahead; turning until home comes back around **is** one 360, shown by the
world itself. This also removes the need to click a button while the pointer is locked (no visible
cursor) - the completed turn **auto-marks**.

**Honest framing:** a turn rendered inside the app spins at the app's own rate, so the rotation test
is the player *dialing in a comfortable 360 with real feedback*, not reading their current sens off
their hand. For seeding the optimizer this is the better deal, and it is stated plainly. (The only way
to capture a player's *current* number is for them to reproduce their game's 360 from memory with no
reference, which is a guess; we reject it for the guided path.)

## The flow

Four guided steps replace `setup` + `gate`, then the existing four drills run, now seeded.

1. **Your mousepad** - enter pad width in cm (measure once with any ruler, or pick a common size).
   Yields the single physical anchor (cm).
2. **The sweep** - lock the mouse, set it at the pad's left edge, sweep straight to the right edge,
   once slow then once fast. Yields your **effective DPI** (shown back to verify) and, from comparing
   the slow and fast passes, **proof the input is acceleration-free**. A measured sweep captures the
   mouse's true DPI even when its labeled DPI is wrong.
3. **The turn** - turn until **home** comes back around (your 360); nudge slower / faster until a full
   turn feels right in one comfortable swipe. Yields a comfortable **seed cm/360**.
4. **Your game** - pick your game (output only, to translate the final number) and set the
   precision <-> speed goal.

Then: **the four drills** (`track`, `flick`, `calibrate`, `strike`) run unchanged, the optimizer
starting from the seeded window and converging on the true optimum with its 90% CI.

A tucked-away **"I already know my numbers"** fast path lets power users type DPI + sens and skip the
guided steps. It doubles as the graceful fallback when a browser cannot do locked/raw pointer input,
and for reduced-motion users who do not want the rendered turn.

## Measurement model (pure core)

All conversions are pure and unit-tested. Most reuse existing helpers.

- **DPI from the sweep.** `dpiFromSweep(horizontalCounts, padWidthCm) = horizontalCounts / (padWidthCm / 2.54)`.
  Horizontal counts = sum of DPR-normalized `movementX` over the locked sweep (reuse
  `normalizeByDpr`; accumulate the x-component only, so vertical drift does not corrupt the width
  measurement). Validate with `isValidDpi`; reject implausible results (sweep too short, pad-width
  typo) and ask for a redo.
- **Acceleration check.** Reuse `accelVerdict(slowTotal, fastTotal)`. The slow pass measures DPI; the
  fast pass cross-checks. If they disagree beyond tolerance, acceleration (or non-raw input) is
  present: block with the existing "turn off Enhance pointer precision" guidance. With raw pointer
  input (Chromium "unadjusted movement") OS acceleration is bypassed, so this mainly guards
  os-adjusted browsers.
- **Turn rate <-> cm/360.** The rendered turn maps counts to yaw by
  `degPerCount = TURN_CM / (cm360 * dpi)` (reuses `TURN_CM = 360 * 2.54`). A full turn completes at
  360 degrees and auto-marks; the tuned value is `cm360 = turnCounts * 2.54 / dpi`. New pure helpers
  `degPerCountFor(cm360, dpi)` and `cm360FromTurnCounts(turnCounts, dpi)` (thin wrappers over the
  `cm360.ts` relationships).
- **Seed -> search window.** `boundsFromSeed(seedCm360)` centers the optimizer's search range on the
  player's comfortable number (replacing the fixed `[15, 60]`), clamped to absolute sane limits
  (about `[5, 120]`). This is the entire optimizer integration.

## Integration / data flow

The optimizer is already seeded only by `bounds` (see `src/ui/session-view.ts`: `runSession` receives
`{ dpi, profile, bounds }`; `currentSens` never reaches it). So the wiring is surgical:

- **`SessionDraft`** (`src/ui/shell.ts`): `dpi` is now produced by the sweep; `bounds` is derived from
  the rotation-test seed via `boundsFromSeed`; `currentGame` and `profile.speedAccuracy` come from
  step 4. `currentSens` leaves the guided path (kept only in the typed fast path, which seeds bounds
  through `cmPer360(dpi, sens, yaw)` exactly as today).
- **`runSession`** is unchanged: it still takes `{ dpi, profile, bounds }`. No optimizer-core change.
- **Routes** (`src/ui/shell.ts`): a single guided `setup` route holds the stepped flow as a **pure
  step reducer** (mirroring the existing `gateReducer` pattern: pure transitions, thin DOM). The
  `gate` route is retired because the acceleration check now rides inside the sweep. The typed fast
  path is a sub-state of the same flow.

## Fallbacks and accessibility

- **No pointer lock / reduced-motion** -> route to the typed fast path (DPI + sens), which yields the
  same `{ dpi, bounds }` via existing math. The rendered turn is user-driven (no autoplay), but
  reduced-motion still gets offered the typed path so no one is forced through the spinning view.
- **Validation states** - implausible DPI -> flag and redo; acceleration detected -> block with fix
  steps (existing copy); pointer-lock denied -> fall back to typed path.
- All screens wear the app's PSX skin and Gefalent fonts and remain keyboard-reachable.

## Architecture (pure-core / thin-shell)

**New pure modules (unit-tested):**
- `src/input/dpi-sweep.ts` - `dpiFromSweep`, horizontal-counts accumulator.
- `src/convert/turn-rate.ts` - `degPerCountFor`, `cm360FromTurnCounts`, `boundsFromSeed`.
- A pure step reducer for the guided flow (alongside the `setup` screen, like `gateReducer`).

**Reused:** `input/dpi.ts` (`normalizeByDpr`, `isValidDpi`), `input/accel-check.ts`
(`accelVerdict`, `AccelMeter`), `input/pointer-lock.ts` (raw capture), `convert/cm360.ts`
(`TURN_CM`, `sensFor`). The 2D panorama renders headings directly from `degPerCountFor`, so it needs
no `camera-rig`.

**Thin shells (runtime-verified, not unit-tested):** the sweep canvas screen and the turn canvas
screen. The rendered turn is a **lightweight 2D panorama** (a horizon with a `home` marker plus
scrolling ground for the turn cue), driven by the pure `degPerCountFor` mapping - the exact approach
validated in the companion mock. It is self-contained: no Three.js scene and no `camera-rig`
dependency, which keeps the turn screen cheap and preserves the feel that was approved in brainstorming.

## Testing

- **Pure:** `dpiFromSweep` (independently derived expectations), `accelVerdict` (exists),
  `degPerCountFor` / `cm360FromTurnCounts` round-trips, `boundsFromSeed` (centering + clamping),
  guided step reducer transitions (including the fast-path and blocked branches).
- **Shell (runtime):** locked-pointer counts accumulate; the turn auto-marks at 360; the acceleration
  block path triggers; the typed fast path produces the same draft.

## Non-goals

- No change to the four drills or the optimizer core (only how the search window is seeded).
- We do not claim to measure the player's exact *current* in-game cm/360 (impossible without their
  game); the rendered turn sets a comfortable, honestly-labeled seed.
- Trackpad is unsupported (desktop + mouse only, unchanged).

## Decisions settled during brainstorming

1. DPI is **measured by the mousepad sweep** (not typed) on the guided path.
2. The rotation test is a **rendered turn drawn as a 2D panorama** (world comes back around = 360,
   auto-marks, tune-to-comfort), not a blank 2D strip, not reproduce-from-memory, and not the full
   3D arena.
3. The flow is the four steps above; the acceleration check folds invisibly into the sweep.
4. A **typed DPI + sens fast path** is kept as a power-user shortcut and a11y / no-lock fallback.
