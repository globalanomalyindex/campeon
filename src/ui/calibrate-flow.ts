// Pure step machine for the guided calibration (mirrors the gateReducer pattern: pure transitions,
// thin DOM in the screen). The guided path is sweep -> offer -> turn -> turn-done. The card is
// swept first: it is the one step measured against a physical standard, and it is over in seconds.
// Then the game/sensitivity pair is asked for as an offer alongside the turn rather than a fork
// away from it, because that pair is the one reliable route to the count convention k and k can
// only be measured against the turn the player is about to perform (spec, "in-game sensitivity, and
// why it is a different kind of ask"). Skipping the offer costs the absolute numbers and never the
// ratio.
//
// The reducer holds no measurement state, and that survived the card coming back. The sweep's
// measured DPI does NOT land here: the screen holds it until the player accepts the reading,
// exactly as it holds the turn's estimate, because a number ferried between steps by the router is
// how a physical unit quietly grows back into the routing layer. Pinned by "carries no measurement
// state, even with the card back".
import type { TurnBlockReason } from './calibrate/turn-view';

export type CalStep = 'intro' | 'sweep' | 'offer' | 'turn' | 'turn-done' | 'manual' | 'blocked';

/** Why the sweep refused: 'accel' = OS acceleration detected (the fast cross-check pass accumulated
 *  materially more than the slow ones); 'invalid' = a sweep that did not measure cleanly, either an
 *  implausible reading or passes too far apart to average. 'invalid' names a redo, not a fault to
 *  go and fix in the OS, which is why it is not folded into 'accel'. */
export type SweepBlockReason = 'accel' | 'invalid';

/** Why a step refused, from either instrument. */
export type BlockReason = TurnBlockReason | SweepBlockReason;

export interface CalState {
  step: CalStep;
  blockReason: BlockReason | null;
  /** Which instrument refused, so a retry returns to that one. Routing, not measurement: 'accel' is
   *  reachable from the sweep's fast pass AND from the turn's, so the reason alone cannot say where
   *  to go back to, and sending a blocked sweep on to the turn would skip the card in silence.
   *  Pinned by "retry returns to the step that refused, not to a fixed one". */
  blockedAt: 'sweep' | 'turn' | null;
  /** Whether the player answered the offer with their game + sensitivity pair. Routing only: the
   *  pair itself lives on the draft, and the pin is computed at the commit, against the turn's own
   *  count (src/ui/setup.ts commitGuided). */
  offerAccepted: boolean;
}

export type CalAction =
  | { type: 'start-guided' }
  | { type: 'start-manual' }
  | { type: 'sweep-complete' }
  | { type: 'sweep-blocked'; reason: SweepBlockReason }
  | { type: 'offer-accepted' }
  | { type: 'offer-skipped' }
  | { type: 'turn-complete' }
  | { type: 'turn-blocked'; reason: TurnBlockReason }
  | { type: 'retry' }
  | { type: 'back-to-intro' };

export function initialCalState(): CalState {
  return { step: 'intro', blockReason: null, blockedAt: null, offerAccepted: false };
}

export function calibrateReducer(state: CalState, action: CalAction): CalState {
  switch (action.type) {
    case 'start-guided':
      // A fresh guided run re-sweeps and re-asks the offer: last run's answer must not silently pin
      // this run's k, and a card measured on an earlier visit must not stand in for this one.
      return { ...state, step: 'sweep', blockReason: null, blockedAt: null, offerAccepted: false };
    case 'start-manual':
      return { ...state, step: 'manual' };
    case 'sweep-complete':
      return { ...state, step: 'offer' };
    case 'sweep-blocked':
      return { ...state, step: 'blocked', blockReason: action.reason, blockedAt: 'sweep' };
    case 'offer-accepted':
      return { ...state, step: 'turn', offerAccepted: true };
    case 'offer-skipped':
      return { ...state, step: 'turn', offerAccepted: false };
    case 'turn-complete':
      return { ...state, step: 'turn-done' };
    case 'turn-blocked':
      return { ...state, step: 'blocked', blockReason: action.reason, blockedAt: 'turn' };
    case 'retry':
      // Back to whichever instrument refused. Nothing blocked means this is the turn's own redo
      // from the spread report, so the turn is the honest default. The offer answer survives either
      // way: the pair was typed once, and the pin is recomputed at commit against the NEW turn, so
      // re-asking would only cost patience.
      return { ...state, step: state.blockedAt ?? 'turn', blockReason: null, blockedAt: null };
    case 'back-to-intro':
      return { ...state, step: 'intro' };
  }
}
