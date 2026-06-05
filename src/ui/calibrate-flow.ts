// Pure step machine for the guided calibration (mirrors the gateReducer pattern: pure
// transitions, thin DOM in the screen). The screen performs navigation + draft writes.
export type CalStep = 'intro' | 'sweep' | 'turn' | 'game' | 'manual' | 'blocked';

export interface CalState {
  step: CalStep;
  dpi: number | null;
  seedCm360: number | null;
}

export type CalAction =
  | { type: 'start-guided' }
  | { type: 'start-manual' }
  | { type: 'sweep-done'; dpi: number; accelerated: boolean }
  | { type: 'turn-done'; seedCm360: number }
  | { type: 'retry' }
  | { type: 'back-to-intro' };

export function initialCalState(): CalState {
  return { step: 'intro', dpi: null, seedCm360: null };
}

export function calibrateReducer(state: CalState, action: CalAction): CalState {
  switch (action.type) {
    case 'start-guided':
      return { ...state, step: 'sweep' };
    case 'start-manual':
      return { ...state, step: 'manual' };
    case 'sweep-done':
      return { ...state, dpi: action.dpi, step: action.accelerated ? 'blocked' : 'turn' };
    case 'turn-done':
      return { ...state, seedCm360: action.seedCm360, step: 'game' };
    case 'retry':
      return { ...state, step: 'sweep', dpi: null };
    case 'back-to-intro':
      return { ...state, step: 'intro' };
  }
}
