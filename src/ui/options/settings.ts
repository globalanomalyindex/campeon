import type { Cm360, GameId, YawEntry } from '../../types';
import { GAME_YAW } from '../../convert/yaw-table';

export const DEFAULT_BOUNDS: [Cm360, Cm360] = [15, 60];
const LO = 5, HI = 150, MIN_SPAN = 5;

export function normalizeBounds(a: number, b: number): [Cm360, Cm360] {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [...DEFAULT_BOUNDS];
  let lo = Math.min(a, b), hi = Math.max(a, b);
  const degenerate = hi - lo < MIN_SPAN;
  lo = Math.max(LO, lo);
  hi = Math.min(HI, hi);
  if (degenerate) hi = Math.min(HI, lo + MIN_SPAN);
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
