# Prop-free calibration: deleting the measurement, not replacing the card

> Brainstormed 2026-07-25. Removes the wallet card from calibration, and with it the entire physical
> unit chain. The tool stops measuring mouse DPI, because DPI cancels out of every number it reports.

## The finding this rests on

The card exists to convert dimensionless mouse counts into centimetres. I traced where DPI actually
reaches the output and it cancels everywhere except a printed label.

```
cm360 = counts360 * 2.54 / dpi
sens  = 914.4 / (dpi * yaw * cm360)
      = 360 / (yaw * counts360)          <- dpi gone
```

Verified numerically rather than trusted algebraically. Feeding the arena a DPI of 400 when the truth
is 800, on the same physical hand motion, leaves `sensFor` returning 2.000 either way,
`degreesPerCount` returning 0.044 either way, and `boundsFromSeed` searching the identical count
range. The card is inert in the arena, inert in the search, and inert in the per-game table. It moves
the label and nothing else.

So the design problem was never "measure DPI better". It was "stop needing a unit we cannot honestly
obtain".

## The three quantities that do matter

**C0**, the counts per 360 the player's hands already believe in. **C\***, the counts per 360 they aim
best at, which the four drills already find. **k**, the factor between a browser movement delta and a
real mouse count, which does not cancel and lands directly on the sensitivity we tell a player to
type.

## Why no physical length is obtainable

Two models explored this across four documents and three adversarial rounds, with the explicit brief
to break the negative result. It survived. The frame that makes it legible:

> The browser sandbox has an absolute clock and no absolute ruler. `performance.now()` is tied to the
> SI second. Nothing in the platform is tied to the metre.

That turns the problem into finding an exchange rate from seconds to metres. There are four at a desk
and none of them ships.

| route | why it dies |
|---|---|
| speed of light | desk distances need picosecond timing; 1 ns is 30 cm |
| gravity | every variant needs the mouse airborne, and an optical sensor stops reporting on lift-off, so the measurement window is exactly the window with no data |
| visible light | sub-micron; every desk-scale diffraction amplifier has an unknown pitch |
| speed of sound | the one that works, and it needs a microphone, which a tower plus a monitor does not have |

And the imports from outside the sandbox all fail the same standard. The keyboard is the best of them,
since key pitch is 19.05 mm across full-size, TKL, 65% and 60% alike (form factor changes the number
of keys, not the spacing) and laptops over 13 inches sit at about 19 mm. But a real minority of
compact boards run 17.05 to 17.5 mm, assuming 19.05 on one of those is an 8% error, and nothing in the
browser can detect which you have. A monitor sweep needs a diagonal the player has to know. The
human-as-ruler family saturates at about 6% mean absolute error, and fusing four anthropometric
channels buys 0.2 points over the best single one, because they are four noisy views of one latent
body size.

Empirically confirmed in Chromium 148 at DPR 2: `ScreenDetailed.prototype` exposes `availHeight,
availLeft, availTop, availWidth, colorDepth, devicePixelRatio, height, isExtended, isInternal,
isPrimary, label, left, orientation, pixelDepth, top, width` and nothing physical, and
`(resolution: 192dpi)` matches at exactly 96 x DPR, which is a definition restating itself.

The forbidden shortcut, named so nobody drifts into it: real DPI values are sparse and 400, 800 and
1600 sit 2x apart, so a crude estimate plus a discrete prior would snap to a clean-looking number.
That is false precision wearing inference as a costume.

## What ships

### Units

Counts per 360 becomes the tool's own unit. The engine takes it directly, so `degreesPerCount` is
`360 / counts360` and `TURN_CM` and the 2.54 leave the engine entirely.

### The result screen, ordered by what each claim assumes

**Tier one, assumes nothing.** "Multiply your in-game sensitivity by 0.88", with its interval. A ratio
of two quantities measured in the same units, so k, yaw and any unit convention cancel exactly.

**Tier two, assumes one measured factor.** The per-game table, unchanged in form, gated on k being
pinned. Its interval is the existing drill bootstrap, unchanged.

k is pinned by exactly two routes and no others. Either the lattice estimator returns `scaled(k)`, or
the player supplied their game and current in-game sensitivity, which gives true counts per 360
exactly and therefore measures k by comparison against what the arena counted. An `indeterminate`
lattice with no typed sensitivity leaves k unpinned, and tier two is withheld.

Note what k does not touch. The arena is self-consistent in browser counts, so the rendered gain, the
searched range and the ratio in tier one are all unaffected by k. It reaches only the absolute numbers
in tier two. That is why an unpinned k costs a tier rather than the answer.

**Tier three, refuses.** "8,240 counts per 360. If you know your mouse's DPI, that is counts divided by
DPI times 2.54 centimetres." An optional field lets a player who knows their DPI see the arithmetic
done, labelled as arithmetic on their input rather than as a measurement.

Tier one carries a wider interval than today's headline, because it answers a question today's
headline does not answer and answering it costs the anchor's roughly 4%. Today's interval survives
intact as tier two. This is the fifth place the interval used to be narrower than the evidence.

### The turn, replacing the spin

Today's spin computes its dial from `PROVISIONAL_CM360 = 30`, so it fills, turns green, reads 360 and
invites a finishing click at exactly the counts matching that constant, whoever the player is, with
overshoot hidden by `Math.min(360, deg)` and a floor at `MIN_DONE_DEG = 270`. It substantially
measures its own constant.

The replacement is three blind reproductions of a full turn, alternating direction. No dial, no degree
readout, no arc that completes. The screen shows which pass you are on and that it is recording, and
the copy says why it is refusing to show you more. There is no reduced-motion variant to design
because nothing moves. Afterwards it reports the spread honestly and offers a fourth pass rather than
failing when the three disagree.

Alternating direction cancels directional asymmetry rather than averaging it in. The three passes also
estimate their own spread, which becomes the weight they carry into the reconciliation, and that
matters more than it sounds: it removes the one parameter I could not measure from the critical path.

### The flick anchor

The first flick after a gain change is launched from the internal model before vision can correct it,
so the fraction of the way it lands reads the ratio of rendered gain to believed gain. Each trial
gives `C0 = rho * C_r`, with `C_r` known exactly because we rendered it. The optimiser changes `C_r`
about thirty times a session, so it generates its own replicates.

Players undershoot deliberately, because a corrective submovement in the same direction is cheaper
than a reversal. That persistent bias is what makes the estimator identifiable rather than what breaks
it, because belief washes out with exposure and bias does not. One joint fit over the series recovers
both: the intercept is the belief mismatch, the asymptote is the bias, the curvature is the adaptation
rate. The bias is estimated from the player's own late-session reaches, never borrowed.

Two prerequisites, both already on the open-questions list, which makes fixing them load-bearing
rather than optional. The submovement segmenter must run in count space with a threshold in counts per
second, because a threshold expressed in deg/s moves with the variable under test. And
`flattenCoalesced` must stop dividing by `devicePixelRatio`.

### k, and the mistake worth recording

A characteristic-function estimator over the raw delta stream recovers the lattice spacing. Real counts
are integers, so scaling shows up as a spacing other than 1 or as non-integers.

The design mistake I made and then caught: I specified this as a two-sided test. It is one-sided. A
stream that was scaled and then re-rounded to integers reads as `k = 1` with total confidence and never
refuses. Measured over 200 simulated sweeps per case: k = 0.5 then rounded reads 1.01 in 100% of runs,
k = 1.5 then rounded reads 1.0, k = 2 through acceleration then rounded reads 1.0. Four of five cases
emit a confident wrong k, and k lands on the number the player types.

The collapse is also undetectable. A genuine k = 1 stream and a k = 0.5-then-rounded stream give mean
delta 6.15 versus 6.28, odd fraction 0.515 versus 0.546, ones fraction 0.053 versus 0.059. No statistic
on the stream separates them.

So `lattice.ts` returns `scaled(k)` or `indeterminate`, and can never return `k = 1` as a positive
finding. The upgrade that came free in the same pass: the characteristic-function form recovers k of
0.5, 1.25, 1.5 and 1/3 at 100%, where the integer GCD version refused every one of them.

### In-game sensitivity, and why it is a different kind of ask

Given the game and the player's current in-game sensitivity, true counts per 360 is
`360 / (yaw * sens)` exactly. That does two things: it retires the C0 problem for any player who can
name their game, and by comparison against what the arena counted, it measures k. It is currently the
only reliable route to k.

It is also categorically different from asking for DPI. It is the number they came here to change, in
the game they just closed. So it moves from the fallback path to a first-class offer, phrased as an
offer rather than a gate, and skipping it costs the absolute numbers but never the ratio.

### Acceleration

On raw pointer input nothing changes, because raw input bypasses OS acceleration at the source. On
browsers without it, one extra deliberately-fast pass compared against the natural ones. The tolerance
can be tight rather than apologetic now, because a full turn is three to six times longer than an
8.56 cm card, so `accelTolForWidth` is deleted rather than retuned.

The lattice probe provably cannot substitute for this: an accelerated delta is still an integer after
rounding, so acceleration is invisible to it. The k estimator is therefore hard-gated on the
acceleration check, failing closed when raw mode is unavailable.

## What the simulations established

Monte Carlo, 160 to 200 sessions per condition, scripts under the session scratchpad.

| question | answer |
|---|---|
| flick anchor, first reach of each trial only | 13.7% MAE, not worth building |
| flick anchor, every reach | 4.6% MAE, which is what makes it viable |
| pinning motor bias from the adapted tail | 9.5%, worse than the joint fit, because the tail is never fully adapted and a biased point estimate propagates |
| wider explored band | worse, 4.5% at 1.3x to 11.2% at 4x, a real conflict with the c-optimality design |
| trials needed | plateaus around 22 |
| turn reproductions alone | 4.8% to 15.0% depending on reproduction variability |
| flick anchor alone | 4.3%, insensitive to that variability |
| combined, weights measured from the passes' own spread | 3.1% to 4.2%, matching oracle weighting |
| truth outside the explored band | harmless, 4.7% and unaffected |
| player with no stable belief | 12.7% and still answers, hence the boundary guard |
| no signal at all | 28% MAE and a [-43%, +61%] range, confidently, hence the covariance precondition |

## Modules

**New, pure.** `src/input/lattice.ts`, `src/anchor/reference-turn.ts`, `src/anchor/flick-anchor.ts`,
`src/anchor/reconcile.ts`, `src/convert/counts.ts`.

**Changed.** `pointer-lock.ts` exposes raw deltas and stops dividing by DPR. `camera-rig.ts` takes
counts per 360. `acclimation.ts` records the lead-in reaches into an observational channel before
discarding them from scoring, which stays inside the integrity invariant because the anchor reads and
never writes the scored `Recording`. `session-controller.ts` carries count bounds and the first-reach
record. `result.ts` gains the three tiers.

**Deleted.** `CARD_WIDTH_CM`, `dpiFromSweep`, `dpiFromPasses`, `SweepAccumulator`,
`isPlausibleSweepDpi`, `accelTolForWidth`, `normalizeByDpr`, the DPI bounds and parser, the DPI field
on the typed path, and `sweep-view.ts` entire. `spin-view.ts` is replaced rather than edited, because
the dial is the defect.

A live bug fixed on the way: `dpi.ts` says Chrome reports device pixels, Firefox reports CSS pixels,
and dividing by DPR makes them agree. Dividing two streams that differ by a factor by that same factor
cannot reconcile them. It makes one correct and leaves the other wrong by DPR.

## Error paths

Every one ends in a refusal rather than a number.

- Pointer lock denied routes to the typed path, which also pins k.
- Lattice indeterminate and no typed sensitivity means tier one only, with the reason stated.
- Turn passes disagreeing offers a fourth pass before blocking.
- Acceleration detected blocks, same screen shape as today, no card references.
- The flick anchor failing its covariance precondition, or pinning its adaptation rate at a boundary,
  falls back to gesture-only and widens.
- An anchor interval spanning a ratio of 1 drops the "change from where you are" framing rather than
  reporting a change it cannot distinguish from none.

## Tests

The one that carries the thesis: take a recorded session, multiply every count by an arbitrary factor,
and assert the reported ratio is byte-identical. Verified at k of 1, 2, 1.5, 0.5 and 7.3.

Then: lattice property tests across k of 1, 2, 3, 0.5, 1.25, 1.5 and 1/3, plus the collapse cases
pinned as tests in their own right, so a future reader who thinks returning `k = 1` looks tidier finds
a red test explaining why it is not. Anchor recovery against a simulated adapting player with known
parameters, and `identifiable: false` on the no-signal and no-stable-belief cases. Widen-only property
on the reconciliation. Clock-offset invariance extended to the new instruments, following
`tests/instruments/clock-stamp.test.ts`. Integrity: the scored `Recording` byte-identical with the
anchor recorder attached. Canon: no cm/360 string in user-facing copy outside the conditional
conversion line.

## Sequencing

This is larger than one sitting and the pieces are not independent, because changing the unit forces
the result screen and the engine together. Four phases, each ending green:

1. The unit change and the deletions. `counts.ts`, `camera-rig.ts`, `pointer-lock.ts`, the removal of
   the DPI vocabulary, and the result screen rewritten onto counts with tier one and tier three only.
   Shippable on its own: at this point the tool is honest and has lost nothing but the card.
2. The turn, replacing the spin. Blind passes, self-measured spread, the acceleration pass, the
   deletion of `sweep-view.ts`.
3. k. The lattice estimator with its one-sided contract and collapse tests, the typed-sensitivity
   route, and tier two behind the gate.
4. The flick anchor. The segmenter fix in count space, the observational channel through acclimation,
   the joint fit and its guards, and the reconciliation.

Phase 1 is the one that cannot be deferred, because every later phase assumes the unit.

## What this does not settle

Whether `movementX` arrives as an integer in real Chrome under `unadjustedMovement`. The probe reports
indeterminate rather than guessing, so the design is safe either way, but the answer would tell us how
often tier two can be shown.

Whether the player's internal model maps world rotation to hand travel, or screen offset to hand
travel. If it is the latter, the flick anchor only transfers when the arena's field of view matches
their game's, which is the usual explanation for why changing FOV feels like changing sensitivity. The
blind turn has no such exposure, because turning until you face forward involves no visual angle
judgement. That is the strongest reason to keep both routes, and it makes their disagreement a
measurement of the mismatch rather than an embarrassment.

The real values of the flick noise, the feedback contamination, the adaptation rate and the motor bias.
The simulations show the estimator is well posed and adequately precise across a plausible range of
them, not that real players land in that range.
