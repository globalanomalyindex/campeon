import type { Cm360, Dpi, GameId, Profile, Report, Result, TrialResult } from '../types';
import { perGameSens } from '../convert/schools';
import { computeBreakdown } from './breakdown';

/**
 * Assemble the player-facing Result: the one cm/360 answer + CI, the native per-game sensitivities
 * at that answer, and the breakdown of how each facet contributed. `games` optionally restricts the
 * per-game table (default: all games in the yaw table).
 *
 * When `bounds` is supplied, the Report's fitted `curve` is copied VERBATIM and the bounds are
 * persisted so the result screen can redraw the convergence plot with a correct x-axis even after a
 * localStorage reload (this is strictly downstream of scoring - NO smoothing, NO refit). Headless/old
 * callers that omit `bounds` produce a number-only Result.
 *
 * `profile` is the SAME profile the optimizer fused with; when supplied, the breakdown reports each
 * facet's affine-fused contribution (track/flick) at the optimum. Omitting it leaves those NaN (→ dash),
 * so old/headless callers stay number-only.
 */
export function buildResult(
  report: Report,
  trials: readonly TrialResult[],
  dpi: Dpi,
  games?: readonly GameId[],
  bounds?: [Cm360, Cm360],
  profile?: Profile,
): Result {
  const all = perGameSens(report.optimalCm360, dpi);
  const perGameSensOut = games
    ? (Object.fromEntries(games.map((g) => [g, all[g]])) as Partial<Record<GameId, number>>)
    : all;
  return {
    optimalCm360: report.optimalCm360,
    ci90: report.ci90,
    perGameSens: perGameSensOut,
    breakdown: computeBreakdown(trials, report.optimalCm360, profile),
    ...(bounds ? { curve: report.curve, bounds } : {}),
  };
}
