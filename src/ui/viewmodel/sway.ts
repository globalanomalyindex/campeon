/**
 * Weapon-sway spring — a pure, damped harmonic oscillator that lags the viewmodel behind camera
 * motion. When you look, `kick` injects a velocity opposite the look direction; `stepSway` then pulls
 * the offset back toward rest each frame (under-damped → a little overshoot, so it reads as weight).
 * The viewmodel applies the offset (+ a tiny roll) when it blits, so a flat sprite gains a parallax /
 * "almost-3D" feel as the camera moves. Offsets are normalized fractions of the viewmodel size.
 *
 * Pure: no DOM, no time source — the caller supplies dt. Unit-tested for rest-stability + convergence.
 */

export interface SwayState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface SwayParams {
  /** Spring stiffness (rad²/s²-ish) — higher = snappier return. */
  stiffness: number;
  /** Damping — below 2·√stiffness is under-damped (overshoots); at/above is smooth. */
  damping: number;
  /** Velocity injected per degree of look delta. */
  impulseGain: number;
  /** Hard clamp on |offset| so a fast whip can't fling the gun off-anchor. */
  maxOffset: number;
}

export const DEFAULT_SWAY: SwayParams = {
  stiffness: 80,
  damping: 13, // < 2·√80 ≈ 17.9 → lively, slightly under-damped
  impulseGain: 0.010,
  maxOffset: 0.1,
};

export const restSway = (): SwayState => ({ x: 0, y: 0, vx: 0, vy: 0 });

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Inject a look impulse: the gun lags, so velocity kicks opposite the camera's yaw/pitch delta. */
export function kick(s: SwayState, dYawDeg: number, dPitchDeg: number, p: SwayParams = DEFAULT_SWAY): SwayState {
  return { x: s.x, y: s.y, vx: s.vx - dYawDeg * p.impulseGain, vy: s.vy - dPitchDeg * p.impulseGain };
}

/** Advance the damped spring by `dtSec` toward rest (semi-implicit Euler — stable at frame dt). */
export function stepSway(s: SwayState, dtSec: number, p: SwayParams = DEFAULT_SWAY): SwayState {
  const ax = -p.stiffness * s.x - p.damping * s.vx;
  const ay = -p.stiffness * s.y - p.damping * s.vy;
  const vx = s.vx + ax * dtSec;
  const vy = s.vy + ay * dtSec;
  return {
    x: clamp(s.x + vx * dtSec, -p.maxOffset, p.maxOffset),
    y: clamp(s.y + vy * dtSec, -p.maxOffset, p.maxOffset),
    vx,
    vy,
  };
}
