import type { Cm360, Dpi, Result } from '../types';
import { perGameSens } from '../convert/schools';

/**
 * Build a "tuned by feel" Result from a measured one at a hand-picked cm/360. Recomputes the native
 * per-game sensitivities for the new number; KEEPS the measured breakdown (it characterizes the measured
 * run, not the hand-picked value). The measured CI is carried unchanged; the result screen drops it when
 * the result is flagged `tuned` - a hand-picked number has no measured CI (honesty). Pure: returns a new
 * object, never mutates the input.
 */
export function adoptResult(measured: Result, adoptedCm360: Cm360, dpi: Dpi): Result {
  return {
    ...measured,
    optimalCm360: adoptedCm360,
    perGameSens: perGameSens(adoptedCm360, dpi),
    tuned: true,
  };
}
