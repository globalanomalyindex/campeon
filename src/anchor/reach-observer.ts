import type { ArenaScene, Counts360, Ms, TargetHandle } from '../types';
import { countTrace, missComponents, type Frame } from '../instruments/recording';
import { ONSET_COUNTS_PER_SEC, segment } from '../scoring/submovement';
import type { FirstReach } from './flick-anchor';

/**
 * A trough must have dropped to half the running peak before it is taken as the end of the
 * open-loop reach. See SegmentOptions.troughDrop: the default rule ends the primary orient at the
 * first strict local minimum, and on an unsmoothed 60 Hz difference trace that is routinely a
 * single jittery frame inside the acceleration ramp. Truncating there shortens the measured extent,
 * which biases landedFraction and therefore C0 LOW - a one-directional error, not noise.
 */
export const PRIMARY_TROUGH_DROP = 0.5;

/**
 * A reach as the anchor sees it, plus the label the scorer's own decision supplies.
 * `leadIn` is the disclosure, not an input to the fit: the estimator uses every reach and cares only
 * about the ordinal (see anchorFromReaches). It exists so the result screen can say how many of the
 * reaches the anchor read were reaches the scorer threw away.
 */
export interface ObservedReach extends FirstReach {
  leadIn: boolean;
}

/**
 * The observational channel. Subscribes to the arena's frame stream exactly as TrialRecorder does,
 * reconstructs every reach a trial contained, and reads the fraction of the way its OPEN-LOOP
 * submovement landed.
 *
 * Stateful by necessity and read-only by construction: it accumulates its own buffer and touches
 * nothing else. It needs no cooperation from the instruments, and that is deliberate. The lead-in
 * reaches spawn and clear real targets on the same scene, so watching target identity change is
 * enough to see them - including the ones acclimation.ts discards, which are the reaches that carry
 * the belief signal. A hook inside the instruments' lead-in branch would have put the measurement
 * inside the scoring path, and the integrity invariant is that the anchor reads and never writes the
 * scored Recording.
 * Regression: tests/anchor/reach-observer.test.ts ('the scored recording is byte-identical ...').
 *
 * Every reach it cannot read honestly is DROPPED rather than defaulted. There is no imputation here:
 * a reach with no onset, or with no trough strictly inside its trace, would read as a landedFraction
 * near 1 and therefore as a C0 near the gain we rendered, which is a fabricated agreement the fit
 * cannot tell from a real one.
 */
export class ReachObserver {
  private readonly out: ObservedReach[] = [];
  private readonly offFrame: () => void;
  private rendered: Counts360 | null = null;
  private leadIn = 0;
  private index = -1;
  private openId: string | null = null;
  private frames: Frame[] = [];

  constructor(
    private readonly scene: ArenaScene,
    private readonly currentTarget: () => TargetHandle | null,
  ) {
    this.offFrame = scene.onFrame((_dt, now) => this.onFrame(now));
  }

  /**
   * Open a trial at the gain the arena is about to render, and the lead-in reach count the scorer
   * will discard (src/instruments/acclimation.ts leadInReaches). Closes any reach still open, so a
   * trial that ended mid-reach contributes that reach to the trial it belonged to. Call it BEFORE
   * the instrument spawns its first lead-in target: until it is called `rendered` is null and every
   * reach is dropped, which is silent by design (no gain, no arithmetic) and therefore easy to get
   * wrong at the call site.
   */
  beginTrial(rendered: Counts360, leadIn: number): void {
    this.close();
    this.rendered = rendered;
    this.leadIn = leadIn;
    this.index = -1;
    this.openId = null;
  }

  stop(): void {
    this.close();
    this.offFrame();
  }

  /** Every readable reach, in order. `index` restarts at 0 on each trial. */
  observed(): readonly ObservedReach[] {
    return this.out;
  }

  /** The contract-shaped view the estimator consumes. */
  reaches(): FirstReach[] {
    return this.out.map((r) => ({ rendered: r.rendered, landedFraction: r.landedFraction, index: r.index }));
  }

  /** How many of the reaches read here were reaches the scorer discarded. A disclosure. */
  discardedByScoring(): number {
    let n = 0;
    for (const r of this.out) if (r.leadIn) n += 1;
    return n;
  }

  private onFrame(now: Ms): void {
    const tgt = this.currentTarget();
    if (tgt === null) {
      this.close();
      this.openId = null;
      return;
    }
    if (tgt.id !== this.openId) {
      this.close();
      this.openId = tgt.id;
      this.index += 1;
    }
    this.frames.push({
      t: now,
      aim: this.scene.view(),
      target: tgt.bearing(),
      targetRadius: tgt.radiusDeg(),
    });
  }

  /**
   * The clock stamp of the trough that ended the open-loop reach, or null when the trace cannot say.
   * Its own function so the segmenter's throw and the no-trough case are one control path: both mean
   * "nothing readable here" and both drop the reach, and neither leaves a possibly-unassigned local
   * behind for the caller to reason about.
   */
  private static primaryTroughTime(frames: readonly Frame[], rendered: Counts360): Ms | null {
    try {
      const seg = segment(countTrace(frames, rendered), {
        onsetThresh: ONSET_COUNTS_PER_SEC,
        troughDrop: PRIMARY_TROUGH_DROP,
      });
      // tC is the confirm stage. 0 means the segmenter fell back to the last sample because no
      // trough qualified, so the open-loop extent is unknown. Dropped, never defaulted.
      return seg.tC > 0 ? seg.troughTime : null;
    } catch {
      return null; // never crossed the onset floor: no reach here to read
    }
  }

  private close(): void {
    const frames = this.frames;
    this.frames = []; // taken first, so a second close is a no-op rather than a duplicate reach
    const rendered = this.rendered;
    if (rendered === null || frames.length < 3) return;
    const first = frames[0]!;
    const target = first.target;
    if (target === null) return;

    const troughTime = ReachObserver.primaryTroughTime(frames, rendered);
    if (troughTime === null) return;

    // EXACT clock equality on purpose: SubmovementSeg.troughTime is the sample's own stamp, and
    // recomputing it as onsetTime + tO is a float addition that can miss the stamp by one ulp and
    // then silently read the wrong aim. Pinned by tests/anchor/clock-stamp.test.ts, which runs this
    // on a fractional clock origin.
    const landed = frames.find((f) => f.t === troughTime);
    if (landed === undefined) return;

    // The intended reach is start → target; the primary submovement's along-axis extent is that
    // amplitude plus the signed radial miss at the trough. missComponents carries the ±180 seam
    // handling, so a reach across the seam is a small miss and not a fabricated ~360 outlier.
    const m = missComponents(first.aim, target, landed.aim);
    if (!(m.reach > 0)) return;
    const landedFraction = (m.reach + m.radial) / m.reach;
    // Only non-positive and non-finite fractions are rejected, because ln is undefined there. No
    // outlier trimming: the response variable IS the measurement, and trimming it would shrink the
    // residual spread the interval is built from, narrowing an interval on nothing.
    if (!Number.isFinite(landedFraction) || landedFraction <= 0) return;

    this.out.push({ rendered, landedFraction, index: this.index, leadIn: this.index < this.leadIn });
  }
}
