// Pure step machine for the guided calibration (mirrors the gateReducer pattern: pure transitions,
// thin DOM in the screen). The guided path is offer -> turn -> turn-done: the game/sensitivity
// pair is asked for FIRST, as an offer alongside the turn rather than a fork away from it, because
// that pair is the one reliable route to the count convention k and k can only be measured against
// the turn the player is about to perform (spec, "in-game sensitivity, and why it is a different
// kind of ask"). Skipping the offer costs the absolute numbers and never the ratio. The reducer
// holds no measurement state: the dpi field died with the unit chain, and reintroducing a carried
// number here is how a physical unit would quietly grow back.
import type { TurnBlockReason } from './calibrate/turn-view';

export type CalStep = 'intro' | 'offer' | 'turn' | 'turn-done' | 'manual' | 'blocked';

/** Why the turn was blocked: 'accel' = OS acceleration detected (counts per 360 undefined);
 *  'spread' = four passes never settled close enough to honestly average. */
export type BlockReason = TurnBlockReason;

export interface CalState {
  step: CalStep;
  blockReason: BlockReason | null;
  /** Whether the player answered the offer with their game + sensitivity pair. Routing only: the
   *  pair itself lives on the draft, and the pin is computed at the commit, against the turn's own
   *  count (src/ui/setup.ts commitGuided). */
  offerAccepted: boolean;
}

export type CalAction =
  | { type: 'start-guided' }
  | { type: 'start-manual' }
  | { type: 'offer-accepted' }
  | { type: 'offer-skipped' }
  | { type: 'turn-complete' }
  | { type: 'turn-blocked'; reason: BlockReason }
  | { type: 'retry' }
  | { type: 'back-to-intro' };

export function initialCalState(): CalState {
  return { step: 'intro', blockReason: null, offerAccepted: false };
}

export function calibrateReducer(state: CalState, action: CalAction): CalState {
  switch (action.type) {
    case 'start-guided':
      // A fresh guided run re-asks the offer: last run's answer must not silently pin this run's k.
      return { ...state, step: 'offer', blockReason: null, offerAccepted: false };
    case 'start-manual':
      return { ...state, step: 'manual' };
    case 'offer-accepted':
      return { ...state, step: 'turn', offerAccepted: true };
    case 'offer-skipped':
      return { ...state, step: 'turn', offerAccepted: false };
    case 'turn-complete':
      return { ...state, step: 'turn-done' };
    case 'turn-blocked':
      return { ...state, step: 'blocked', blockReason: action.reason };
    case 'retry':
      // The offer answer survives a retry: the pair was typed once, and the pin is recomputed at
      // commit against the NEW turn, so re-asking would only cost patience.
      return { ...state, step: 'turn', blockReason: null };
    case 'back-to-intro':
      return { ...state, step: 'intro' };
  }
}
