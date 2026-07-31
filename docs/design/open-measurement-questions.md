# Open measurement questions

What a five-lens measurement audit confirmed, and where each item now stands. It is written down
rather than quietly carried, because the argument of this tool is that it says what it does and
does not know.

## Fixed

| what | where |
|---|---|
| The session-clock stamp: three instruments stamped their first target at t=0 while measuring against a clock that never resets, so the opening tap of every trial absorbed the whole elapsed session. flick read a 20,048 ms mean movement time where the truth was 48 ms. | `5f38086` |
| Two order confounds: cold-start seeding swept cm/360 in ascending order, making corr(trial index, sensitivity) exactly 1.0, and the early-stop check drew from the shared instrument RNG. | `dbdd734` |
| The bootstrap band narrowed when resamples failed. Non-concave resamples were dropped from the percentile list *and* the denominator, so a band over the surviving minority was still labelled 90%. | `7e0f6f9` |
| Canon 4.4 was a third applied. The retired brass gold survived in four files outside the stylesheets, including on the scored target sphere, and both focus rings were transparent mixes measuring 2.15:1 and 1.34:1 against a 3:1 requirement. | `10f1323` |
| Adaptation to an unfamiliar gain was uncontrolled, which placed an artifact minimum exactly on the player's current sensitivity. See below. | this round |
| A vertex outside the searched range was clamped to the edge and printed as a measured band. | this round |
| The expected-improvement screen inverted the mutation operator. See below. | this round |
| The residual bootstrap resampled fitted residuals without the leverage correction. | this round |
| Losing pointer lock did not stop the arena, so a track trial could run six seconds unattended and be scored at full weight. Frame deltas were unclamped, so backgrounding a tab injected one enormous frame into a live trial. | this round |
| The camera ran a fixed 90 degree **vertical** field of view, so the horizontal field was a function of window aspect and two players on differently shaped windows were measured on different tasks. | this round |

Three of those were biasing the reported number. The rest were making the tool overconfident.

### Notes on the four largest

**The acclimation lead-in.** Every trial used to score the player from their first movement at an
unfamiliar gain, so adaptation cost was charged to the score, and that cost grows with distance
from the gain they arrived holding. With the search seeded at the player's own setting, that put an
artifact minimum exactly there: the tool leaned toward telling people they were already right,
which is the single most persuasive and least informative thing it could do.

There is now an unscored lead-in at the start of every trial, discarded before scoring, sized
linearly in octaves of gain change and saturating at two octaves. It draws from a private RNG
seeded from the trial's own identity, so scored target geometry is byte-identical to before. The
property the test pins: a simulated gain-adapting player scores the same at the same sensitivity
whether they arrived from a near neighbour or from four times away. Relative gaps went from
0.49 / 0.99 / 0.11 / 0.11 to 0.03 / 0.0003 / 0.00003 / 0.0004, and a non-adapting control keeps
the test honest by still showing a large near/far difference.

**Bounds honesty.** `Report.peakAtBound` records which side the vertex fell past, the flag is
carried to the persisted Result, and the result screen presents an edge as a bound instead of a
located optimum. Absence means located and is never fabricated, so old saved results degrade
gracefully.

**The allocator.** The evolution strategy searched for an argmax while the reported number is a
fitted vertex, and those want opposite designs, because vertex variance divides by the spread of
the design. The expected-improvement screen made it worse: the parent is the posterior-mean grid
maximum, so nothing could improve on it, every score came off the sigma term alone, and the screen
reliably returned the offspring *closest* to the parent. Measured mean rank 5.68 of 6 counting from
the farthest, with the realised step falling as lambda rose, so a larger screening budget bought a
worse design. It is now local c-optimality for the vertex. Over 750 simulated 30-trial sessions
mean absolute error on the reported number fell 22%.

**The leverage correction.** Fitted residuals are smaller than the true errors, hardest at the
high-leverage ends of the range, so resampling them raw understated the noise. Nominal 90%
intervals were achieving about 87% empirical coverage. Each residual is now scaled by
1/sqrt(1 - h_ii), a factor never below 1, so the change can only widen. A no-search control
covering 85.9% established that the shortfall belonged to the interval computation rather than to
how trials were allocated.

---

## Still open

### 1. The count convention, mostly closed

**The division is gone.** `flattenCoalesced` no longer divides by `devicePixelRatio`. That code
carried a comment claiming the division reconciled Chrome reporting device pixels with Firefox
reporting CSS pixels, and dividing two streams that differ by a factor by that same factor cannot
reconcile them: it makes one correct and leaves the other wrong by exactly the factor. Pointer lock
now exposes the raw stream untouched.

What remains is one honest unknown, k, the factor between a browser delta and a real mouse count. It
does not cancel and it lands on the number a player types into their game, so it is pinned by three
routes and never guessed:

1. **Typed game and sensitivity.** Exact: true counts per 360 is `360 / (yaw * sens)`, so comparing
   against what the arena counted measures k directly.
2. **The integer lattice.** A characteristic-function estimator over the raw deltas. One-sided by
   construction: it can prove scaling happened and can never prove it did not, because a stream
   scaled by a fraction and re-rounded reads as a spacing of 1 in 100 percent of runs and no
   statistic on the stream separates that from a genuine 1.
3. **A plain-density display.** At a `devicePixelRatio` of exactly 1 there is nothing to scale by, so
   a corroborating spacing of 1 is a deduction rather than an inference.

The third route needed real interrogation before it shipped, and it found a hole worth recording.
Desktop Safari holds `devicePixelRatio` flat through page zoom, so a zoomed Safari page can report 1
while scaling. That is closed by a gate already present rather than by luck: Safari ships no
`onpointerrawupdate`, so raw mode is never granted there and the lattice never runs, which means the
deduction is only ever evaluated where zoom does register in DPR. Scaling upstream of the browser, a
driver multiplier or an injected mouse in a VM, is not k at all, because it applies equally to the
game the number is typed into.

The route carries a log sd of 0.02 rather than zero, because the check that corroborates it treats
anything within 2 percent of 1 as a unit lattice, and that band is exactly the width a scaling could
hide in.

**Still genuinely open:** a stream that is scaled and re-rounded on a HiDPI display, where all three
routes decline. The tool withholds the typeable number there and says why. Settling it still needs
hardware: one mouse of known CPI, a 1x and a 2x display, and a record of what `movementX` sums to per
browser.

### 2. Intervals that are still narrower than the evidence

- The card sweep measures its own scale spread (`spreadPct`) and discards it, so a calibration that
  disagreed with itself by 5% reports the same confidence as one that agreed to 0.5%.
- Facet disagreement is computed and never unioned into the interval.

### 3. Design gaps in the allocator

No replicated (instrument, cm/360) cell exists anywhere, so there is no pure-error term and lack of
fit cannot be separated from noise.

### 4. Instruments that read something other than what they claim

- flick's movement time includes reaction time while `fitts.ts` calls the result ISO 9241-9
  effective throughput. Fixing it needs a trustworthy submovement onset first, and the segmenter
  currently runs on an unsmoothed 60 Hz difference trace with a threshold fixed in deg/s, which
  makes the threshold itself a function of the variable under test.
- track's gaze slip subtracts two speed magnitudes, so it is blind to direction error. The target
  reverses, which makes direction error the dominant failure mode.
- strike has no deadline and no accuracy criterion, so it reads a self-selected operating point.
- track is a predictable 0.5 Hz smooth-pursuit task at about 46 deg/s, which gives it little power
  to discriminate between nearby sensitivities.

### 5. Test-retest reliability is never measured

The most important number about a measurement instrument is how far apart two runs of it land, and
this tool has never reported that about itself. Until it does, the interval describes within-session
sampling error and nothing else.

---

## Where that leaves it

Every defect known to bias the reported number is fixed, and the interval now widens in the four
places it used to narrow. What remains is one unresolved unit question that needs hardware to
settle, two remaining sources of uncertainty that are computed and then not carried into the
interval, and a set of instruments that measure noisier or slightly different quantities than they
claim, which costs power rather than introducing a direction.
