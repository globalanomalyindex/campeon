# Card-Anchored Calibration: No-Numbers DPI - Design

> Brainstormed 2026-06-05. Refines the guided calibration (shipped 2026-06-04) by removing the
> one remaining "type a number" step: the mousepad width. The user instead sweeps across a wallet
> card of standardized size, so the physical anchor needs no measuring and no knowledge of any number.

**Goal:** Make every calibration step doable by someone who knows none of the numbers - easy enough
for a five-year-old. The only step that still asked for a measured value (mousepad width in cm) is
replaced by sweeping across an object everyone already owns and that is the same size worldwide.

---

## The problem

The guided flow opens by asking the user to measure their mousepad and type its width in cm:

```
mousepad width (cm)  [ 40 ]
```

This is the single hardest ask in the flow. It requires owning a ruler, measuring, knowing what a
centimeter is, and converting if their ruler reads inches. It is exactly the "know a number" friction
the guided redesign set out to remove, and it crept back in as the DPI anchor.

## The core insight (why we need exactly one known length)

The browser only ever sees mouse **counts** - dimensionless ticks. Counts become centimeters only when
tied to **one known real-world length**. `dpiFromSweep(counts, widthCm) = counts / (widthCm / 2.54)`
already expresses this: feed it the counts swept across a known width and it returns effective DPI.

So the design problem is not "avoid the number" - it is "borrow a known length the user already has,
without making them measure anything."

## The solution: sweep across a wallet card

Every payment card, ID card, driver's license, hotel key, gym card, and transit card is the same size
by international standard: **ISO/IEC 7810 ID-1, 85.60 mm wide**. That makes a card a free, universal,
pre-calibrated ruler that the user already owns. We hard-code the width as a constant and ask the user
only to *slide their mouse across the card*.

The measurement math is unchanged - we swap the **source** of the width from a typed field to a
constant. This is the entire conceptual change; everything else is copy and wiring.

```
CARD_WIDTH_CM = 8.56   // ISO/IEC 7810 ID-1 long edge (85.60 mm)
```

**Why a card and not a mousepad-size picker or a multi-object picker:** mousepad sizes are not
standardized (a "medium" pad ranges ~350-450 mm by brand), so a picker is a guess dressed up as a
choice. A multi-object picker (card / dollar bill / ruler) is more precise for some users but
reintroduces a "which one do I have?" decision - against the five-year-old bar. One universal object
is the simplest correct anchor.

**Honest precision note:** a card is shorter than a mousepad, so sloppy edge-alignment yields roughly
3-5% DPI error. That error only seeds the optimizer's +/-70% search window (`boundsFromSeed`) and
converts the comfortable rendered turn to cm - both tolerant. No false precision is claimed.

## The flow (after the change)

1. **intro** - no number input. "grab any card from your wallet - bank card, gym card, hotel key.
   they're all the same size." A **start** button plus the existing **"i already know my numbers"**
   ghost (the typed fast path, unchanged) and the reduced-motion notice.
2. **the sweep** - "lay the card flat. rest your mouse at its left end, slide straight across to the
   right end" (slow pass), then "now do it again, but quick" (fast pass). DPI comes from the slow pass
   over the known card width; the acceleration check rides on the slow-vs-fast comparison exactly as
   today, invisible unless it trips. A light cardiogram-style trail on the canvas grows with the slide
   so the user sees the system registering their movement (visibility of system status).
3. **the turn** - mechanically unchanged. Copy polish: "swipe to spin all the way around - stop when
   you're facing forward again."
4. **your game** - unchanged. Copy polish for plainness.

Then the four drills run, seeded as before.

## Architecture (small, focused change)

**`src/input/dpi-sweep.ts`** - add `export const CARD_WIDTH_CM = 8.56;` with a comment citing
ISO/IEC 7810 ID-1. `dpiFromSweep(counts, widthCm)` stays generic and pure (still takes a width, so it
remains reusable and unit-testable); the shell passes the constant.

**`src/ui/calibrate-flow.ts`** - drop `padWidthCm` from `CalState`; make `start-guided` payload-free.
`initialCalState()` returns `{ step: 'intro', dpi: null, seedCm360: null }`. The reducer's
`start-guided` case becomes `return { ...state, step: 'sweep' }`. `retry` still clears `dpi`.

**`src/ui/setup.ts`** - intro loses the `<input data-field="pad">` and the "how wide is your mousepad"
copy; the new intro copy names the card. `start-guided` is dispatched with no payload. The sweep view
mounts with `referenceWidthCm: CARD_WIDTH_CM`. Blocked-state copy: "mouse acceleration looks like it's
on (or the card sweep was uneven)" instead of referencing pad width. `commitGuided`/`commitManual`
unchanged (they read `state.dpi` / typed values exactly as today).

**`src/ui/calibrate/sweep-view.ts`** - rename the option `padWidthCm` -> `referenceWidthCm` for
honesty. Card-based copy throughout. Add a lightweight trail: during a running pass, push the live
horizontal count onto a small buffer and draw a growing streak on the canvas (cosmetic feedback; the
DPI math still sums signed dx only, so vertical wobble does not affect the measurement). The trail
clears on `reset()` between passes.

## The cardiogram trail (sweep canvas)

Purpose: feedback, not decoration. A novice needs to see that sliding the mouse is doing something.
- On each `onSample` during a running pass, append the running `acc.total()` (and the sample's `dy`
  for vertical wobble) to a bounded buffer.
- Redraw: a horizontal baseline across the canvas; a polyline whose x advances with accumulated
  horizontal counts (normalized to canvas width by a fixed visual scale, not by DPI - DPI is unknown
  mid-sweep) and whose y deflects slightly with `dy`, leaving a trailing streak.
- Clear the buffer on `reset()` so each pass starts fresh.
- Keep it cheap: a single `requestAnimationFrame`-free redraw inside the existing `onSample` handler,
  or a small rAF loop that the existing `dispose()` cancels. Bounded buffer length (e.g. last ~600
  points) so memory is flat.

This is a thin-shell concern (canvas + pointer), runtime-verified, not unit-tested.

## Testing

**Pure (unit-tested):**
- `dpi-sweep`: `CARD_WIDTH_CM === 8.56`; round-trip - for a chosen DPI, `counts = DPI * 8.56 / 2.54`
  fed to `dpiFromSweep(counts, CARD_WIDTH_CM)` returns that DPI (within float tolerance).
- `calibrate-flow`: `start-guided` (payload-free) moves intro -> sweep; `CalState` has no
  `padWidthCm`; `initialCalState()` shape updated; existing transitions (sweep-done -> turn/blocked,
  turn-done -> game, retry clears dpi, back-to-intro) still pass.
- `setup`: intro renders no `[data-field="pad"]`; the start button dispatches `start-guided`; the
  manual path still writes the draft + bounds and navigates to session.

**Shell (runtime-verified):** locked-pointer counts still accumulate over the card sweep; the trail
grows during a pass and clears between passes; the turn auto-marks at 360; the typed fast path and the
acceleration-block path still work.

## What does not change

- The four drills, the optimizer core, `boundsFromSeed`, the rendered turn's math, the manual typed
  fast path (still DPI + sens - the power-user escape hatch, correctly gated behind "i already know my
  numbers"), and the acceleration check (still invisible; its second pass is now a concrete "do it
  again, quick").

## Non-goals

- No multi-object or mousepad-size picker (rejected above).
- No attempt to capture the player's exact current in-game cm/360 (impossible without their game); the
  rendered turn remains an honestly-labeled comfort seed.
- Trackpad remains unsupported (desktop + mouse only, unchanged).

## Decisions settled during brainstorming

1. The DPI anchor is a **standardized wallet card (ISO/IEC 7810 ID-1, 85.60 mm)**, hard-coded as
   `CARD_WIDTH_CM = 8.56`. No measuring, no typing, no number knowledge required.
2. The measurement math is unchanged; only the source of the width changes (typed field -> constant).
3. A light cardiogram-style trail is added to the sweep canvas as system-status feedback (minimal,
   cosmetic, runtime-verified).
4. The typed "i already know my numbers" fast path is retained unchanged as the power-user shortcut
   and the no-pointer-lock / reduced-motion fallback.
