import type { Instrument, InstrumentId } from '../types';
import { track } from './track';
import { flick } from './flick';
import { calibrate } from './calibrate';
import { strike } from './strike';

/** All instruments keyed by id. Phase 4's session controller dispatches through this. */
export const INSTRUMENTS: Record<InstrumentId, Instrument> = {
  track,
  flick,
  calibrate,
  strike,
};

export function getInstrument(id: InstrumentId): Instrument {
  return INSTRUMENTS[id];
}
