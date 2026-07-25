import type { InstrumentId, Ms, TrialContext } from '../types';
import { mulberry32 } from '../stats/rng';

/**
 * The unscored acclimation lead-in (open-measurement-questions §2).
 *
 * Every trial hands the player a new sensitivity. Before this existed, scoring began on the
 * first movement, so the cost of adapting to the unfamiliar gain was charged to the trial's
 * score - and that cost grows with how far the trial sits from the sensitivity the player
 * arrived with. Because the search is seeded at the player's own setting, the artifact put a
 * minimum exactly there: the tool tended to tell a player they were already right. Each
 * instrument now runs a short lead-in it discards before scoring, so the scored movements
 * start from a (mostly) re-adapted state whatever direction the trial was approached from.
 *
 * Sizing, from the motor-adaptation literature rather than taste: adaptation to a visuomotor
 * gain change is two-timescale. The fast process removes most of the error within the first
 * handful of discrete reaches (two-state models put its time constant at a few movements;
 * pointing studies of control-display gain changes see near-baseline movement times by about
 * the third reach). The slow process runs over hundreds of movements and cannot be bought at
 * any per-trial price a 30-trial session can afford - but it is also roughly the same residual
 * for every trial, so it shifts the whole curve rather than bending it toward the arrival
 * point. The lead-in therefore buys out the fast transient and only the fast transient.
 *
 * The budget adapts to the size of the gain change, because the transient it exists to absorb
 * does: cost scales with |ln(new) - ln(prev)|, and the geometric decay of the fast process
 * means each extra octave of change needs a roughly CONSTANT number of extra reaches to burn
 * back down. So the budget is linear in octaves: one reach (or 800 ms of tracking, several
 * visual-correction cycles at 150-250 ms each) at zero distance, three reaches at one octave,
 * saturating at five reaches (2400 ms) at two octaves - the realistic worst case, a cold-start
 * seed across the whole search range. The floor is deliberately not zero: every trial opens
 * with a task-onset transient (re-engaging after the between-trial pause) that would otherwise
 * land in the scored set, and one discarded reach absorbs it for every trial equally. With the
 * arrival gain unknown (`ctx.prevCm360` absent) the full budget is spent - an unknown is
 * treated as a far jump, never a near one.
 *
 * Determinism: lead-in target geometry draws from a PRIVATE rng seeded from the trial's own
 * identity (cm/360, dpi, instrument), never from the shared `ctx.rng` session stream. Drawing
 * from the shared stream would shift every scored draw after it, changing target geometry the
 * player would otherwise have seen - which the determinism suite pins.
 */

/** Reaches discarded at the far end (two octaves or more of gain change, or unknown arrival). */
export const LEAD_REACHES_MAX = 5;
/** Reaches discarded at zero gain change - absorbs the task-onset transient, not adaptation. */
export const LEAD_REACHES_MIN = 1;
/** Continuous-tracking lead-in at the far end. */
export const LEAD_MS_MAX: Ms = 2400;
/** Continuous-tracking lead-in at zero gain change. */
export const LEAD_MS_MIN: Ms = 800;
/** The budget saturates here: a two-octave jump is the realistic worst case (cold start). */
const SATURATION_OCTAVES = 2;

export interface AcclimationPlan {
  /** Unscored lead-in reaches for the discrete instruments (flick, calibrate, strike). */
  reaches: number;
  /** Unscored lead-in duration for the continuous instrument (track). */
  ms: Ms;
  /** Private deterministic rng for lead-in target geometry. NEVER the shared ctx.rng. */
  rng: () => number;
}

/**
 * Normalized gain-change distance in [0, 1]: octaves of change |ln(new/prev)| / ln 2, over the
 * two-octave saturation point. 0 = same sensitivity, 0.5 = one octave, 1 = two octaves or more.
 * Unknown or degenerate arrival → 1 (a far jump, never a near one).
 */
export function acclimationScale(ctx: TrialContext): number {
  const prev = ctx.prevCm360;
  if (prev === undefined || !(prev > 0) || !(ctx.cm360 > 0)) return 1;
  const octaves = Math.abs(Math.log(ctx.cm360 / prev)) / Math.LN2;
  return Math.min(1, octaves / SATURATION_OCTAVES);
}

/** Deterministic private seed from the trial's identity - independent of the session stream. */
function leadSeed(ctx: TrialContext, id: InstrumentId): number {
  let h = 0x9e3779b9;
  const mix = (v: number): void => {
    h ^= Math.imul(v | 0, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  };
  mix(Math.round(ctx.cm360 * 1e4));
  mix(Math.round(ctx.dpi));
  for (let i = 0; i < id.length; i++) mix(id.charCodeAt(i));
  return h >>> 0;
}

export function planAcclimation(ctx: TrialContext, id: InstrumentId): AcclimationPlan {
  const s = acclimationScale(ctx);
  return {
    reaches: Math.round(LEAD_REACHES_MIN + (LEAD_REACHES_MAX - LEAD_REACHES_MIN) * s),
    ms: Math.round(LEAD_MS_MIN + (LEAD_MS_MAX - LEAD_MS_MIN) * s),
    rng: mulberry32(leadSeed(ctx, id)),
  };
}
