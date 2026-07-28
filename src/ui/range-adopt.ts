import type { Counts360, Result } from '../types';

/**
 * Build a "tuned by feel" Result from a measured one at a hand-picked count total. KEEPS the measured
 * breakdown (it characterizes the measured run, not the hand-picked value) and drops every MEASURED
 * readout a hand-picked value cannot honestly carry: the 90 percent interval, the performance
 * `curve`/`bounds` (no measured curve to plot), the `driftZ` session-drift disclosure, the
 * `facetConcordance`, and the `prescription`.
 *
 * Two of those are load bearing. The interval was measured around where the SEARCH peaked, and the
 * screen already refused to print it on a tuned value; carrying it in the object anyway meant it
 * reached localStorage and the exported JSON, where the screen's gate cannot follow, so a tuned
 * value has carried a measured interval in every export this tool has ever written. The
 * prescription is the same defect one tier up: its ratio is measured against the optimum the search
 * found, so on a hand-picked value it would report a multiply factor for a number nothing measured.
 * Pure: returns a new object, never mutates the input.
 */
export function adoptResult(measured: Result, adoptedCounts: Counts360): Result {
  const {
    ci90: _ci90, curve: _curve, bounds: _bounds, driftZ: _driftZ, facetConcordance: _facet,
    prescription: _prescription, ...rest
  } = measured;
  return {
    ...rest,
    optimalCounts: adoptedCounts,
    tuned: true,
  };
}
