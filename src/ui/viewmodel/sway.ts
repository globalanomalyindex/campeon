/**
 * Weapon-sway spring - a pure, damped harmonic oscillator that lags the viewmodel behind camera
 * motion. When you look, `kick` injects a velocity opposite the look direction; `stepSway` then pulls
 * the offset back toward rest each frame (under-damped → a little overshoot, so it reads as weight).
 * The viewmodel applies the offset (+ a tiny roll) when it blits, so a flat sprite gains a parallax /
 * "almost-3D" feel as the camera moves. Offsets are normalized fractions of the viewmodel size.
 *
 * Pure: no DOM, no time source - the caller supplies dt. Unit-tested for rest-stability + convergence.
 */

export interface SwayState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface SwayParams {
  /** Spring stiffness (rad²/s²-ish) - higher = snappier return. */
  stiffness: number;
  /** Damping - below 2·√stiffness is under-damped (overshoots); at/above is smooth. */
  damping: number;
  /** Velocity injected per degree of look delta. */
  impulseGain: number;
  /** Hard clamp on |offset| so a fast whip can't fling the gun off-anchor. */
  maxOffset: number;
  /** Look deltas below this (deg) are ignored - idle micro-jitter must not move the gun. */
  deadzone: number;
}

export const DEFAULT_SWAY: SwayParams = {
  stiffness: 90,
  damping: 20, // ≥ 2·√90 ≈ 18.97 → over-damped: returns without wandering/oscillating
  impulseGain: 0.005, // gentle - only deliberate flicks visibly sway
  maxOffset: 0.06,
  deadzone: 0.08, // hold still through sub-0.08° micro-corrections
};

export const restSway = (): SwayState => ({ x: 0, y: 0, vx: 0, vy: 0 });

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Inject a look impulse: the gun lags, so velocity kicks opposite the camera's yaw/pitch delta. */
export function kick(s: SwayState, dYawDeg: number, dPitchDeg: number, p: SwayParams = DEFAULT_SWAY): SwayState {
  const dy = Math.abs(dYawDeg) < p.deadzone ? 0 : dYawDeg; // idle micro-jitter → no sway
  const dp = Math.abs(dPitchDeg) < p.deadzone ? 0 : dPitchDeg;
  return { x: s.x, y: s.y, vx: s.vx - dy * p.impulseGain, vy: s.vy - dp * p.impulseGain };
}

/** Advance the damped spring by `dtSec` toward rest (semi-implicit Euler - stable at frame dt). */
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
