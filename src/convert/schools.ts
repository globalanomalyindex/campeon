import type { Cm360, Dpi, GameId } from '../types';
import { GAME_YAW } from './yaw-table';
import { sensFor } from './cm360';

/** 360-distance match: emit native in-game sens for every game at a target cm/360 + DPI. */
export function perGameSens(cm360: Cm360, dpi: Dpi): Partial<Record<GameId, number>> {
  const out: Partial<Record<GameId, number>> = {};
  for (const g of GAME_YAW) out[g.id] = sensFor(cm360, dpi, g.yaw);
  return out;
}
