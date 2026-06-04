/**
 * Fire recoil - a pure, snappy damped spring that punches the viewmodel on each shot, then settles.
 * Deliberately separate from sway (sway is slow camera-driven parallax; recoil is a sharp fire-driven
 * snap): `punch` injects an upward + backward impulse, `stepRecoil` pulls both channels back to rest
 * each frame. The viewmodel sums the offset into its blit (kick up + brief scale lunge + a little roll).
 * Offsets are normalized fractions of the viewmodel size. COSMETIC only - never touches the camera/aim.
 *
 * Pure: no DOM, no time source - the caller supplies dt. Unit-tested for rest-stability + convergence.
 */

export interface RecoilState {
  /** Vertical kick (up), normalized fraction of viewmodel height. */
  y: number;
  vy: number;
  /** Backward lunge → a brief scale-up, normalized. */
  back: number;
  vback: number;
}

export interface RecoilParams {
  /** Spring stiffness - high → fast settle (snappy). */
  stiffness: number;
  /** Damping - at/above 2·√stiffness → no wobble. */
  damping: number;
  /** Upward velocity injected per shot. */
  kickUp: number;
  /** Backward (scale) velocity injected per shot. */
  kickBack: number;
  /** Hard clamp on |y| and |back| so rapid fire can't fling the gun off-anchor. */
  max: number;
}

export const DEFAULT_RECOIL: RecoilParams = {
  stiffness: 320, // ≫ sway's 90 → settles in ~150–220ms
  damping: 34, // ≈ 2·√320 ≈ 35.8 → just under critical: a crisp snap, no wobble
  kickUp: 0.9,
  kickBack: 0.6,
  max: 0.14,
};

export const restRecoil = (): RecoilState => ({ y: 0, vy: 0, back: 0, vback: 0 });

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Inject a fire impulse: kick the gun up and lunge it back (velocity only; offset grows once stepped). */
export function punch(s: RecoilState, p: RecoilParams = DEFAULT_RECOIL): RecoilState {
  return { y: s.y, vy: s.vy + p.kickUp, back: s.back, vback: s.vback + p.kickBack };
}

/** Advance both recoil channels toward rest by `dtSec` (semi-implicit Euler - stable at frame dt). */
export function stepRecoil(s: RecoilState, dtSec: number, p: RecoilParams = DEFAULT_RECOIL): RecoilState {
  const ay = -p.stiffness * s.y - p.damping * s.vy;
  const ab = -p.stiffness * s.back - p.damping * s.vback;
  const vy = s.vy + ay * dtSec;
  const vback = s.vback + ab * dtSec;
  return {
    y: clamp(s.y + vy * dtSec, -p.max, p.max),
    vy,
    back: clamp(s.back + vback * dtSec, -p.max, p.max),
    vback,
  };
}
