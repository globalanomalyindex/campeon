// The blind reference turn: three reproductions of a full 360 by feel, right then left then
// right. Deliberately shows NO dial, NO degree readout and NO arc that completes. The spin this
// replaces computed its dial from a fixed provisional turn distance (30 cm at 800 DPI, 9450
// counts), filled, turned green and invited the finishing click at exactly the counts matching
// that constant, whoever the player was, with overshoot hidden by Math.min(360, deg) - the
// instrument measured its own constant. The machine below cannot: no state in it knows a target
// count. What the screen may show is which pass is up and that recording is live; the copy says
// why it refuses to show more. Nothing moves, so there is no reduced-motion variant to plumb.
import { turnFromPasses, type TurnEstimate } from '../../anchor/reference-turn';
import { accelVerdict } from '../../input/accel-check';
import type { PointerLockMode } from '../../types';

/** Why the turn refused: 'accel' = the fast pass accumulated materially more than the slow ones;
 *  'spread' = four passes never settled close enough to honestly average. */
export type TurnBlockReason = 'accel' | 'spread';

export type TurnPhase =
  | 'idle' | 'recording' | 'fourth-offer' | 'fast-idle' | 'fast-recording' | 'done' | 'blocked';

export interface TurnMachine {
  phase: TurnPhase;
  /** Committed pass magnitudes (path-length counts). The live pass accumulates outside and only
   *  lands here on its finishing tap. */
  passes: readonly number[];
  estimate: TurnEstimate | null;
  blockReason: TurnBlockReason | null;
}

export const NATURAL_PASSES = 3;

/** Floor below which a finishing tap is an accidental click, not a turn. Far under any real 360
 *  (sens 20 at the CS2 yaw is still ~820 counts), so unlike the spin's MIN_DONE_DEG it cannot
 *  steer where a genuine pass ends - it can only reject a double-click. */
export const MIN_PASS_COUNTS = 200;

export function initialTurnMachine(): TurnMachine {
  return { phase: 'idle', passes: [], estimate: null, blockReason: null };
}

/** Pass direction, alternating right-left-right-left. Alternation cancels directional asymmetry
 *  (pad friction, wrist range) out of the estimate instead of averaging it in. */
export function turnDirection(passIdx: number): 'right' | 'left' {
  return passIdx % 2 === 0 ? 'right' : 'left';
}

/**
 * Advance on a classified tap. `pathCounts` is the |dx| path length accumulated since the current
 * pass started; it is read only on a finishing tap. Ignored taps return the SAME object so the
 * shell can detect the refusal by identity and explain the no-op instead of staying silent.
 */
export function turnTap(m: TurnMachine, pathCounts: number, mode: PointerLockMode): TurnMachine {
  switch (m.phase) {
    case 'idle':
    case 'fourth-offer':
      return { ...m, phase: 'recording' };
    case 'fast-idle':
      return { ...m, phase: 'fast-recording' };
    case 'recording': {
      if (pathCounts < MIN_PASS_COUNTS) return m;
      const passes = [...m.passes, pathCounts];
      if (passes.length < NATURAL_PASSES) return { ...m, passes, phase: 'idle' };
      const estimate = turnFromPasses(passes);
      // turnFromPasses refuses on a corrupt series. The floor above bars that path here, but a
      // refusal still maps to a refusal, never to proceeding on a series the estimator rejected.
      if (estimate === null) return { ...m, passes, phase: 'blocked', blockReason: 'spread' };
      if (!estimate.agreed) {
        // Three disagreeing passes earn a fourth; a fourth that still disagrees blocks. Spec error
        // path: "turn passes disagreeing offers a fourth pass before blocking".
        return passes.length === NATURAL_PASSES
          ? { ...m, passes, estimate, phase: 'fourth-offer' }
          : { ...m, passes, estimate, phase: 'blocked', blockReason: 'spread' };
      }
      // Raw pointer input bypasses OS acceleration at the source, so a fast pass would have
      // nothing to detect. Everywhere else the deliberately fast turn IS the accel probe: the
      // lattice cannot substitute, because an accelerated delta is still an integer after
      // rounding (spec, "acceleration").
      return mode === 'raw'
        ? { ...m, passes, estimate, phase: 'done' }
        : { ...m, passes, estimate, phase: 'fast-idle' };
    }
    case 'fast-recording': {
      if (pathCounts < MIN_PASS_COUNTS) return m;
      if (m.estimate === null) return { ...m, phase: 'blocked', blockReason: 'spread' }; // unreachable: fast phases exist only past an agreed estimate
      // accelVerdict's default 10 percent tolerance, tight rather than apologetic: a full turn is
      // 3 to 6 times the 8.56 cm card that forced accelTolForWidth to widen, so edge slop is a
      // proportionally small fraction of the pass (the widener is deleted in this change).
      return accelVerdict(m.estimate.counts, pathCounts).accelerated
        ? { ...m, phase: 'blocked', blockReason: 'accel' }
        : { ...m, phase: 'done' };
    }
    case 'done':
    case 'blocked':
      return m; // terminal states absorb input: nothing after the verdict may move the number
  }
}
