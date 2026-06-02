import type { Cm360, Dpi, GameId } from '../types';
import { GAME_YAW } from './yaw-table';
import { sensFor } from './cm360';

/** 360-distance match: emit native in-game sens for every game at a target cm/360 + DPI. */
export function perGameSens(cm360: Cm360, dpi: Dpi): Record<GameId, number> {
  const out = {} as Record<GameId, number>;
  for (const g of GAME_YAW) out[g.id] = sensFor(cm360, dpi, g.yaw);
  return out;
}

export interface ConversionSchool { id: '360' | 'monitor'; label: string; fovAware: boolean; note: string; }

export const CONVERSION_SCHOOLS: ConversionSchool[] = [
  { id: '360', label: '360 distance', fovAware: false,
    note: 'cm per 360° — FOV-agnostic; exactly what campeón measures.' },
  { id: 'monitor', label: 'monitor distance', fovAware: true,
    note: 'matches on-screen cursor travel for a fraction of the screen; depends on source + target FOV.' },
];

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** cm/360 that preserves "monitor-distance feel" when moving from sourceFov to targetFov,
 *  matching the angle subtended by a fraction `m` (0..1) of the horizontal half-screen.
 *  θ(m, fov) = atan(m·tan(fov/2)); matched cm/360 scales with the ratio of those angles. */
export function monitorDistanceMatchCm360(
  sourceCm360: Cm360, sourceFovDeg: number, targetFovDeg: number, fraction: number,
): Cm360 {
  const m = Math.max(0, Math.min(1, fraction));
  const thetaSrc = Math.atan(m * Math.tan(rad(sourceFovDeg) / 2));
  const thetaTgt = Math.atan(m * Math.tan(rad(targetFovDeg) / 2));
  if (thetaSrc === 0) {
    return sourceCm360 * (Math.tan(rad(targetFovDeg) / 2) / Math.tan(rad(sourceFovDeg) / 2));
  }
  return sourceCm360 * (thetaTgt / thetaSrc);
}
