// Pure step machine for the guided calibration (mirrors the gateReducer pattern: pure transitions,
// thin DOM in the screen). The screen performs navigation + draft writes; the spin commits via its
// onSeed callback, so there is no 'game' step and no terminal action in the reducer.
export type CalStep = 'intro' | 'sweep' | 'spin' | 'manual' | 'blocked';

/** Why the sweep was blocked: 'accel' = OS acceleration detected (cm/360 undefined); 'invalid' = a
 *  too-short / uneven sweep that did not measure cleanly (NOT acceleration - just redo it). */
export type BlockReason = 'accel' | 'invalid';

export interface CalState {
  step: CalStep;
  dpi: number | null;
  blockReason: BlockReason | null;
}

export type CalAction =
  | { type: 'start-guided' }
  | { type: 'start-manual' }
  | { type: 'sweep-done'; dpi: number; accelerated: boolean }
  | { type: 'sweep-invalid' }
  | { type: 'retry' }
  | { type: 'back-to-intro' };

export function initialCalState(): CalState {
  return { step: 'intro', dpi: null, blockReason: null };
}

export function calibrateReducer(state: CalState, action: CalAction): CalState {
  switch (action.type) {
    case 'start-guided':
      return { ...state, step: 'sweep', blockReason: null };
    case 'start-manual':
      return { ...state, step: 'manual' };
    case 'sweep-done':
      return {
        ...state,
        dpi: action.dpi,
        step: action.accelerated ? 'blocked' : 'spin',
        blockReason: action.accelerated ? 'accel' : null,
      };
    case 'sweep-invalid':
      return { ...state, step: 'blocked', dpi: null, blockReason: 'invalid' };
    case 'retry':
      return { ...state, step: 'sweep', dpi: null, blockReason: null };
    case 'back-to-intro':
      return { ...state, step: 'intro' };
  }
}
