# The session record and the equating spine

> Brainstormed 2026-07-28. Sub-project one of turning campeon from a one-sitting tool into a returning
> instrument. It is the foundation the other axes (field of view, aspect ratio, grip) sit on, and it
> delivers its own value first: the tool finally measures its own reliability.

## The finding that has to come first

**campeon fails its own reliability test today.** Repeatability, the spread between two sessions
measuring the same player, is about 1.46x. A typical recommendation is 0.88x. The recommendation is
smaller than the noise on the measurement that produced it, which means a single session's advice is
not currently distinguishable from that session's luck.

That is not a reason to stop. It is the reason this sub-project exists, and it dictates three things.
Until it is fixed the result screen prints the pooled recommendation rather than a single-session one.
The prerequisites in the next section are not optional polish, they are what moves the number. And the
tool says this about itself on screen, because a measurement instrument that hides its own
repeatability is not one.

## Prerequisites that gate everything

Neither of the cross-session measurements below exists until these two land.

**Reserve a fixed fraction of the trial budget for pinned band-edge points** in `bayesopt.ts` and
`evolution.ts`. This moves the per-session measurement noise from 0.124 to about 0.079. Everything in
this document is priced against that improvement, and several claims are only feasible after it.

**Persist raw per-instrument scores on their native absolute scale**, alongside the z-scored
observation. `trialsToObservations` currently z-scores within a session, which destroys the level and
rescales the curvature, so two sessions are already incomparable before any of this starts. This is a
latent defect in the shipped code, not a new requirement.

## What died, and why it is the most interesting part

Two model seats explored this independently and then collided. The central hypothesis, mine, was that
the tool perturbing its own anchor is a free controlled experiment: we apply a known change to the
player's habitual sensitivity, they comply, and the response on return measures how much of the
located optimum is a genuine motor preference rather than familiarity with whatever they arrived using.

It is dead, and the seat that proposed it killed it. Priced at an assumed measurement noise of 0.06 it
looked viable. Re-run at the measured 0.1226, with an honest latent habit and partial compliance rather
than treating the prescribed state as known, the estimator returns a standard deviation of 1.37 to 1.44
on a parameter bounded in [0, 1], with a bias near minus 0.5. At ten percent probes and fourteen
sessions it is still 0.89 to 0.95, and the probes cost fifteen to twenty five percent extra error while
they run. There is no session count a real person will give at which it works.

The reason generalises, and it is the line for the case study:

> The instrument's success destroys its own identifiability. A controller that converges removes the
> variation needed to identify its own parameters. Everything this tool can honestly learn about
> itself, it must learn either inside a single sitting, or from the part of the loop that has not yet
> converged.

So the loop is a **controller, not an experiment**. The deepest reportable object is not a parameter,
it is a picture: the gap between where the player is and where the tool says they should be, shrinking
session over session, inside an interval that never lies about its own width.

## The invariant, in three layers

**1. The x-axis is already absolute.** Counts per 360 is invariant to DPI, to yaw and to game. It
breaks only when `k` breaks, and `k` breaks are detected from a **scale fingerprint** stored every
session: `devicePixelRatio`, screen metrics, whether pointer lock granted `unadjustedMovement`, the
lattice verdict, the acceleration verdict, and the browser major version. A `matchMedia` resolution
listener catches DPR moving mid-session. No new API and no new permission.

**2. An absolute check standard**, frozen for the life of an instrument epoch. One fixed `x_ref` in
counts, set at session one and never moved, with fixed geometry, seed, field of view and aspect, run
even in a session testing a different field of view. Six trials at the top of the session and six at
the bottom. It is the skill meter, the fatigue readout, and the `k`-break detector.

**3. A yoked block**, five trials at the session's just-measured C0. It is explicitly *not* a skill
covariate, which was proposed and refuted. Its jobs are suppressing false alarms in the break
classifier and giving the player an honest, labelled readout of how far the loop has converged.

**Instrument epochs.** A deploy that changes geometry, seeds, scoring or `x_ref` declares a new epoch,
and comparison across the boundary is forbidden rather than adjusted. Both seats derived this
independently, from different starting points, which is the strongest evidence either document
contains. Nobody remembers that the tool's own deploys break its own series.

## What a session measures

About eleven minutes. The ordering is load bearing, not cosmetic.

| when | what |
|---|---|
| 0:00 to 0:20 | Scale fingerprint against the open epoch. A match gets one confirmation line, a mismatch gets one specific question. Once per epoch, one question about what the browser cannot see: mouse, pad, field of view, grip, seating. Never about DPI. |
| 0:20 to 1:10 | Check standard, block one, six trials. |
| 1:10 to 3:00 | The anchor: three blind turn reproductions, alternating direction, **before any screen shows last session's numbers.** |
| 3:00 to 3:40 | Yoked block, five trials at the measured C0. |
| 3:40 to 8:40 | Main battery, thirty trials, band-edge reservation on. On a crossover session, two arms interleaved ABBA, arm order counterbalanced against the previous session. |
| 8:40 to 9:30 | Check standard, block two. The difference against block one is fatigue, on an absolute scale. |
| 9:30 on | Result, then the damped recommendation, stated as a step size rather than as timidity. |

**Why the anchor comes before any number is shown.** Three independent reasons, two of them derived
separately by the two seats. Seeing last session's recommendation re-anchors the player cognitively, so
a turn measured afterwards is measuring our screen and not their hands. The compliance residual is only
a residual if the measurement is uncontaminated by having just seen the prescription. And compliance
being measured rather than assumed is what makes the echo correction computable per transition rather
than merely bounded. This is the same defect as the old spin dial, which measured its own constant, and
it must not come back through the calendar.

**The controller.** `r = V + psi (V - a)`, with the step size floored: `psi = max(0.35, 1/(s+1))`. The
textbook decaying schedule was crowned by a simulation that set skill drift to zero. Turn drift on and
it cannot track a moving target: error diverges to 0.171 by session fourteen where a fixed gain holds
flat at 0.113, and worse at higher drift. The floor costs nothing in the first few sessions and
protects exactly the long-horizon player the skill meter exists for.

**Crossover cadence.** Returns two, three, five, seven and nine run an adaptation crossover, two
adaptation states in one sitting, which is what prices the interval. Plain sessions otherwise, so the
per-session noise is not permanently degraded by a split battery.

## Storage

Per-session keys, never one blob, so a write is O(1) and a quota error cannot corrupt history. Measured
at 2352 bytes per session: 345 KiB at 150 sessions, about 13.5% of a 5 MiB cap. Do not optimise the
encoding. Do enforce that raw pointer sample streams are never persisted, since one session at 1000 Hz
is roughly 6 MB by itself.

```
campeon.v2.index           { v, playerId, epochs[], sessions:[{id, at, ep, ig, kind, bytes}] }
campeon.v2.session.<id>    the session record
campeon.v2.epoch.<id>      { id, openedAt, reason, fingerprint, xRef, geometryHash, closedAt? }
campeon.v2.fit             cached cross-session fit, plus a hash of the session ids it was built from
campeon.v2.quarantine.<ts> a failed migration's original bytes, never deleted
```

Migrations are pure `v_n` to `v_{n+1}`, composed on read, written back only after all of them succeed.
An index whose version exceeds the running build puts the app in read-only mode rather than
downgrading. A throwing migration quarantines the original bytes. Export works at every version,
unconditionally, because a player's history is theirs.

## What the tool reports

**After two sessions.** Both located optima and their difference, as an observation and nothing more.
Both check standard scores side by side with their own standard errors. The within-session split-half
repeatability from session one, refusing when either half is non-concave, which happens about 3.9% of
the time at thirty trials. The scale-break verdict, which only resolves at 2x. The damped
recommendation with its interval, currently about 1.57x while the adaptation parameter is unknown. The
yoked block reported as convergence and labelled as convergence.

**After five returns.** The pooled optimum over the last three sessions. Pooling beats the newest
session by about 32% in error, but the interval narrows only by the echo-corrected factor, never below
a single session's interval. The repeatability coefficient, echo-corrected and reported **only as an
interval**, roughly 1.14x to 1.88x, never as a point. The coverage chart. And the shrinking gap series,
which is the convergence evidence and the thing this instrument is actually for.

**The echo correction, and why it widens.** Consecutive sessions are generated by the loop, so session
`s+1` inherits a share of session `s`'s measurement error and their difference shrinks. Measured inside
the damped loop, the repeatability coefficient reads 1.39x to 1.41x when the truth is 1.46x. That is
the tool being quietly optimistic about its own error, which is the one direction the canon forbids, so
the coefficient is reported as a floor with a simulation-calibrated envelope over it.

## What it refuses, and what triggers each refusal

| refusal | trigger |
|---|---|
| Any reliability coefficient or ICC | Not identified for one player without pooling across players, and there is no server. Permanent. |
| The adaptation parameter as a number | Closed loop with no persistent excitation. Interval unbounded 44 to 62% of the time. Permanent. |
| Familiarity versus preference attribution | The estimator that would have measured it is dead. Permanent, at every session count. |
| Splitting spread into day wobble and measurement noise | Negative variance component, refusing 29 to 48% of the time and biased 2x when it does not. Until the band-edge fix lands. |
| Any skill trend from the check standard | Fewer than eight sessions. Below that the reported rate is the test's own size, not its power. |
| Any between-session setting comparison | Always. Aliased with skill, and the bias reaches 0.31 standard errors by twelve sessions under a decelerating skill curve. Setting effects come from within-session crossovers or not at all. |
| A setting effect below about 1.2x | Needs ten to thirty eight crossover sessions for 80% power. |
| Placing a session on the previous scale | Any fingerprint mismatch, or the break classifier firing. Ask one question, never silently reconcile. If declined, open a new epoch and let only ratio-level claims cross it. |
| A scale-break verdict below 2x | The classifier collapses to 42 to 52% accuracy at 1.25x, and the yoked block does not rescue it. |
| A stable preferred sensitivity, at all | If the fitted adaptation envelope's lower bound exceeds 0.95, the optimum tracks whatever is practised and there is no preference to report. That is a legitimate null result, reported as a finding rather than as an error. |

## What this changes about the roadmap

**The field of view conversion rule is not measurable here, and I proposed it yesterday.** The two
leading candidate rules differ by 0.095 log units, which needs about forty two crossover sessions at
useful power. No real player will give that. So sub-project two is rebuilt rather than cancelled: the
tool should **support** a custom or locked field of view by converting sensitivity through a rule the
player picks, disclosed as a choice rather than presented as measured, and the arena should render at
their field of view so the drills are angularly faithful. Settling which rule is correct is out of
reach for a within-player instrument, and saying so is worth more than a underpowered answer.

Aspect ratio and grip inherit the same arithmetic: a within-session crossover can see a large effect
and cannot see a small one, and the refusal table above gives the threshold.

## Unsolved, and both seats agree

**Anchor practice drift.** The player learns the check standard by playing it, and neither seat found a
within-player design that separates that from general skill improvement. So check standard gains ship
as an **upper bound** on skill gain, labelled as such, and that sentence is the honest floor under the
whole skill meter.
