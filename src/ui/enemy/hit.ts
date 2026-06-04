import { separation } from '../../engine/targets';
import type { Degrees } from '../../types';

export type HitClass = 'kill' | 'graze' | 'miss';

/** A graze counts out to this multiple of the target's angular radius (cosmetic only). */
export const GRAZE_FACTOR = 2.5;

/**
 * COSMETIC hit classification for the enemy pop / flinch animation. Compares the player's current
 * view (crosshair bearing) to a target's true bearing using the SAME great-circle metric the
 * instruments use — but strictly READ-ONLY: it drives only the sprite animation and never writes a
 * sample or a score. The cm/360 measurement is computed entirely from the recorded aim stream and is
 * untouched by this function, so the cosmetic skin can never bias the result.
 *
 *   sep ≤ radius            → 'kill'  (crosshair inside the target's angular disc → POP)
 *   sep ≤ GRAZE_FACTOR×r    → 'graze' (clipped it → flinch, stays alive)
 *   else                    → 'miss'  (no reaction)
 */
export function classifyHit(
  view: [Degrees, Degrees],
  bearing: [Degrees, Degrees],
  radiusDeg: Degrees,
): HitClass {
  const sep = separation(view, bearing);
  if (sep <= radiusDeg) return 'kill';
  if (sep <= GRAZE_FACTOR * radiusDeg) return 'graze';
  return 'miss';
}
