// Pure step machine for the guided calibration (mirrors the gateReducer pattern: pure transitions,
// thin DOM in the screen). The screen performs navigation + draft writes; the spin commits via its
// onSeed callback, so there is no 'game' step and no terminal action in the reducer.
export type CalStep = 'intro' | 'sweep' | 'spin' | 'manual' | 'blocked';

export interface CalState {
  step: CalStep;
  dpi: number | null;
}

export type CalAction =
  | { type: 'start-guided' }
  | { type: 'start-manual' }
  | { type: 'sweep-done'; dpi: number; accelerated: boolean }
  | { type: 'retry' }
  | { type: 'back-to-intro' };

export function initialCalState(): CalState {
  return { step: 'intro', dpi: null };
}

export function calibrateReducer(state: CalState, action: CalAction): CalState {
  switch (action.type) {
    case 'start-guided':
      return { ...state, step: 'sweep' };
    case 'start-manual':
      return { ...state, step: 'manual' };
    case 'sweep-done':
      return { ...state, dpi: action.dpi, step: action.accelerated ? 'blocked' : 'spin' };
    case 'retry':
      return { ...state, step: 'sweep', dpi: null };
    case 'back-to-intro':
      return { ...state, step: 'intro' };
  }
}
