import type { Cm360, GameId, YawEntry } from '../../types';
import { GAME_YAW } from '../../convert/yaw-table';

export const DEFAULT_BOUNDS: [Cm360, Cm360] = [15, 60];
const LO = 5, HI = 150, MIN_SPAN = 5;

export function normalizeBounds(a: number, b: number): [Cm360, Cm360] {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [...DEFAULT_BOUNDS];
  // Order, then clamp BOTH ends into [LO, HI] - lo is also capped at HI - MIN_SPAN so there is
  // always room below the ceiling for the minimum span (this is what prevents an inverted range
  // when both inputs exceed HI). Then guarantee the span by widening hi up to lo + MIN_SPAN.
  const lo = Math.min(Math.max(LO, Math.min(a, b)), HI - MIN_SPAN);
  let hi = Math.min(HI, Math.max(a, b));
  if (hi - lo < MIN_SPAN) hi = lo + MIN_SPAN;
  return [lo, hi];
}

export type YawOverrides = Partial<Record<GameId, number>>;

export function effectiveYaw(id: GameId, overrides: YawOverrides): number {
  const o = overrides[id];
  if (o !== undefined && Number.isFinite(o) && o > 0) return o;
  const base = GAME_YAW.find((e) => e.id === id);
  if (!base) throw new Error(`Unknown game: ${id}`);
  return base.yaw;
}

export function effectiveYawTable(overrides: YawOverrides): YawEntry[] {
  return GAME_YAW.map((e) => ({ ...e, yaw: effectiveYaw(e.id, overrides) }));
}
