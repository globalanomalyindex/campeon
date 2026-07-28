import { counts360 } from '../types';
import type { Counts360 } from '../types';

export interface ConversionSchool { id: '360' | 'monitor'; label: string; fovAware: boolean; note: string; }

export const CONVERSION_SCHOOLS: ConversionSchool[] = [
  { id: '360', label: '360 distance', fovAware: false,
    note: 'counts per 360 - FOV-agnostic; exactly what campeón measures.' },
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
 * D = counts · θ/360, linear in θ. Monitor-distance matching sets D equal across the two FOVs:
 *     counts_tgt · θ(m,fov_tgt) = counts_src · θ(m,fov_src)
 *   ⟹ counts_tgt = counts_src · θ(m,fov_src) / θ(m,fov_tgt).
 * So a WIDER target FOV (larger θ_tgt) needs a SMALLER cm/360 (more sensitive) to keep the feel.
 * As m→0, θ→m·tan(fov/2), so the ratio reduces to the tangent (focal-length) ratio.
 * Stated in counts, unchanged: the match is a ratio of view angles, so it holds in whatever unit
 * the turn distance is measured in.
 */
export function monitorDistanceMatchCounts(
  sourceCounts: Counts360, sourceFovDeg: number, targetFovDeg: number, fraction: number,
): Counts360 {
  const m = Math.max(0, Math.min(1, fraction));
  const tanSrc = Math.tan(rad(sourceFovDeg) / 2);
  const tanTgt = Math.tan(rad(targetFovDeg) / 2);
  if (m === 0) return counts360(sourceCounts * (tanSrc / tanTgt)); // 0% monitor distance: focal-length ratio
  const thetaSrc = Math.atan(m * tanSrc);
  const thetaTgt = Math.atan(m * tanTgt);
  return counts360(sourceCounts * (thetaSrc / thetaTgt));
}
