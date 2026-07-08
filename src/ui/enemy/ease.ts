/**
 * The one shared easing curve for every cosmetic tween in the enemy layer - the quarry poses
 * (spawn / idle / flinch / death / escape), the dust settle, and the impact-spark throw. A single
 * source so a tuning pass to "the brand motion rule" moves all of them together, instead of drifting
 * two hand-copied same-named constants apart. This is a pure leaf module (no THREE, no scored API),
 * imported by both enemy-layer.ts and sparks.ts, so neither has to import the other.
 */

/** Ease-out cubic - strong settle, no bounce (the brand motion rule). Clamps t to [0, 1]. */
export const easeOut = (t: number): number => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
