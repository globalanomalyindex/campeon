// Turn-rate math for the rendered calibration turn. cm/360 is the physical turn distance;
// the panorama maps mouse counts to view degrees so one full 360 spans exactly that distance.
import { TURN_CM } from './cm360';
/** Local to this module, which computes in a unit the tool no longer uses. `Cm360` and `Dpi` left
 *  types.ts with the rest of the physical unit chain; these aliases exist so the module still
 *  compiles until task 5 deletes it, and they are deliberately NOT exported so nothing new can
 *  depend on them. */
type Cm360 = number;
type Dpi = number;

/** Degrees of view rotation per mouse count, so one 360 spans `cm360` cm at this DPI. Requires cm360 > 0 and dpi > 0. */
export function degPerCountFor(cm360: Cm360, dpi: Dpi): number {
  return TURN_CM / (cm360 * dpi); // TURN_CM = 360 * 2.54
}

/** Mouse counts of travel for one full 360 at this cm/360 and DPI. Requires cm360 > 0 and dpi > 0. */
export function turnCountsFor(cm360: Cm360, dpi: Dpi): number {
  return (cm360 * dpi) / 2.54;
}

/** The cm/360 implied by sweeping `turnCounts` counts for one full 360 at this DPI. */
export function cm360FromTurnCounts(turnCounts: number, dpi: Dpi): Cm360 {
  return (turnCounts * 2.54) / dpi;
}
