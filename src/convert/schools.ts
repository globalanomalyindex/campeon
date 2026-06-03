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

/**
 * cm/360 that preserves "monitor-distance feel" when moving from sourceFov to targetFov,
 * matching the physical mouse travel to flick the crosshair to a fraction `m` (0..1) of the
 * horizontal half-screen.
 *
 * Derivation. The on-screen point at fraction m subtends view-angle θ(m,fov) = atan(m·tan(fov/2))
 * (flat projection: half-width = tan(fov/2) focal units). The physical travel to rotate there is
 * D = cm360 · θ/360, linear in θ. Monitor-distance matching sets D equal across the two FOVs:
 *     cm360_tgt · θ(m,fov_tgt) = cm360_src · θ(m,fov_src)
 *   ⟹ cm360_tgt = cm360_src · θ(m,fov_src) / θ(m,fov_tgt).
 * So a WIDER target FOV (larger θ_tgt) needs a SMALLER cm/360 (more sensitive) to keep the feel.
 * As m→0, θ→m·tan(fov/2), so the ratio reduces to the tangent (focal-length) ratio.
 */
export function monitorDistanceMatchCm360(
  sourceCm360: Cm360, sourceFovDeg: number, targetFovDeg: number, fraction: number,
): Cm360 {
  const m = Math.max(0, Math.min(1, fraction));
  const tanSrc = Math.tan(rad(sourceFovDeg) / 2);
  const tanTgt = Math.tan(rad(targetFovDeg) / 2);
  if (m === 0) return sourceCm360 * (tanSrc / tanTgt); // 0% monitor distance: focal-length ratio
  const thetaSrc = Math.atan(m * tanSrc);
  const thetaTgt = Math.atan(m * tanTgt);
  return sourceCm360 * (thetaSrc / thetaTgt);
}
