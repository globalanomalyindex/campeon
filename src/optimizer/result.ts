import type { Dpi, GameId, Report, Result, TrialResult } from '../types';
import { perGameSens } from '../convert/schools';
import { computeBreakdown } from './breakdown';

/**
 * Assemble the player-facing Result: the one cm/360 answer + CI, the native per-game sensitivities
 * at that answer, and the breakdown of how each facet contributed. `games` optionally restricts the
 * per-game table (default: all games in the yaw table).
 */
export function buildResult(
  report: Report,
  trials: readonly TrialResult[],
  dpi: Dpi,
  games?: readonly GameId[],
): Result {
  const all = perGameSens(report.optimalCm360, dpi);
  const perGameSensOut = games
    ? (Object.fromEntries(games.map((g) => [g, all[g]])) as Partial<Record<GameId, number>>)
    : all;
  return {
    optimalCm360: report.optimalCm360,
    ci90: report.ci90,
    perGameSens: perGameSensOut,
    breakdown: computeBreakdown(trials, report.optimalCm360),
  };
}
