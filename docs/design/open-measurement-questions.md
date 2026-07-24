# Open measurement questions

Things a five-lens measurement audit confirmed, that are NOT fixed yet. They are written
down rather than quietly carried, because the whole argument of this tool is that it says
what it does and does not know.

Fixed already, for contrast: the session-clock stamp bug (commit `5f38086`) and the two
order confounds in cold-start seeding and the shared stop-check RNG (commit `dbdd734`).

---

## 1. The devicePixelRatio seam (highest priority)

**What is true.** `flattenCoalesced` in `src/input/pointer-lock.ts` divides every raw
pointer delta by `devicePixelRatio` before anything downstream sees it. That was added to
make Chrome (which reports device pixels) agree with Firefox (which reports CSS pixels).
The consequence is that every sample downstream is in units of `counts / DPR`, not counts.

`src/input/dpi-sweep.ts` then derives DPI from those same samples. Its comment claims the
samples "are already DPR-normalized counts, so this is true mouse DPI". That is the one
mistaken step: dividing by DPR means the sweep derives `trueDPI / DPR`.

**What that does and does not break.**

- The guided path is *self-consistent*. The measured DPI and the movement stream carry the
  same DPR factor, so `degreesPerCount` cancels it and the sensitivity actually delivered
  in the arena is the sensitivity under test. Every trial in a session shares the factor,
  so **the optimiser's ranking across sensitivities is unaffected and the located optimum
  is still the right optimum.**
- The typed path is *not* self-consistent. A user who types their real mouse DPI gets a
  stream that is DPR times smaller than that DPI implies. On a 2x display the arena
  delivers half the nominal sensitivity.
- The absolute number, and the per-game table that `sensFor` computes from it, can
  therefore be scaled by DPR on a HiDPI display even on the guided path, because the DPI
  it was derived from is not true counts per inch.

**Why it is not fixed here.** There are two ways to resolve it and they disagree about
which unit is canonical. Making the typed path match the guided path is two lines but
propagates a non-physical DPI into the reported in-game sensitivities. Making the stream
carry true counts is the correct model, but it requires knowing per browser whether a
delta arrives in device or CSS pixels, and that cannot be feature-detected reliably. It
needs verification on real hardware at 1x and 2x with a known mouse, which is a
measurement, not a code change. Guessing would risk turning a scaling error into a
wrong-direction error.

**How to settle it.** Measure it. One physical mouse of known CPI, one 1x display and one
2x display, drag a fixed physical distance, and record what `movementX` sums to in each
browser. That single table resolves which branch is right, and then the fix is small.

---

## 2. Adaptation to an unfamiliar gain is uncontrolled

Every trial hands the player a new sensitivity and scores them immediately. Adaptation cost
is therefore a function of how far that trial sits from the sensitivity they arrived with,
and the search is seeded at the sensitivity they arrived with. That places an artifact
minimum exactly on the player's current setting.

This is the finding that matters most for whether the tool is trustworthy, because the
artifact is the one that makes the output feel most persuasive: it tends to tell a player
they were already close to right.

The fix is an unscored acclimation lead-in at the start of each trial, discarded before
scoring. Roughly ten lines per instrument and about forty seconds of session time.

## 3. Confidence intervals are truncated in five places, all narrowing

The canon says intervals widen only. Five places currently do the opposite:

- Residuals are resampled without the leverage correction `1 / sqrt(1 - h_ii)`.
- Non-concave bootstrap resamples are dropped from the numerator but left in the
  denominator, so the 90% label overstates its coverage.
- An extrapolated vertex, and both interval endpoints, are clamped to the search bounds and
  then printed as a measured band.
- The card sweep measures its own scale spread (`spreadPct`) and discards it.
- Facet disagreement is computed and never unioned into the interval.

Each is small on its own. Together they mean the interval is narrower than the evidence
supports, which is the one direction this project is not allowed to be wrong in.

## 4. The allocator optimises the wrong objective

The evolution strategy searches for an argmax. The reported number is the vertex of a
quadratic fit. Those two want opposite designs: an argmax search clusters samples near the
peak, and a vertex estimate needs spread, because its variance divides by `Var(x)`.

The expected-improvement screen makes it worse rather than better. Because the parent
fitness is the posterior-mean grid maximum, every candidate scores a negative improvement,
so the screen reliably picks the *closest* offspring. Measured over a session it selected
rank 5.89 out of 6 counting from the farthest, with a realised step of 0.058 in ln space
against a nominal 0.3.

There are also no replicated (instrument, cm/360) cells anywhere, so there is no pure-error
term and lack of fit cannot be separated from noise.

## 5. Instruments that read something other than what they claim

- flick's movement time includes reaction time, while `fitts.ts` calls the result ISO 9241-9
  effective throughput. Fixing it needs the submovement segmenter to be trustworthy first,
  and it currently runs on an unsmoothed 60 Hz difference trace with an onset threshold
  fixed in deg/s, which makes the threshold itself a function of the variable under test.
- track's gaze slip subtracts two speed magnitudes, so it is blind to direction error. The
  target reverses, which makes direction error the dominant failure mode.
- strike has no deadline and no accuracy criterion, so it reads a self-selected operating
  point rather than a fixed one.
- track is a predictable 0.5 Hz smooth-pursuit task at about 46 deg/s, which gives it very
  little power to discriminate between nearby sensitivities.

## 6. No validity gating

Losing pointer lock does not stop the arena. `src/ui/arena-stage.ts` ticks unconditionally,
so a track trial can run its full six seconds unattended and be scored at full weight.

## 7. Test-retest reliability is never measured

The most important number about a measurement instrument is how far apart two runs of it
land, and this tool has never reported that about itself. Until it does, the confidence
interval describes within-session sampling error and nothing else.

---

## Honest summary

The three defects that were biasing the reported number are fixed. What remains falls into
two groups: intervals that are too narrow, which makes the tool overconfident rather than
wrong, and instruments that measure a noisier or slightly different quantity than they
claim, which costs power rather than introducing a direction. The one unresolved item that
could move the absolute number is the DPR seam in section 1, and it needs a hardware
measurement rather than a code change.
