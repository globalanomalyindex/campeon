import { describe, it, expect } from 'vitest';
import { INSTRUMENTS, getInstrument } from '../../src/instruments/registry';
import type { InstrumentId } from '../../src/types';

describe('instrument registry', () => {
  const ids: InstrumentId[] = ['track', 'flick', 'calibrate', 'strike'];

  it('contains all four instruments, keyed by their own id', () => {
    for (const id of ids) {
      expect(INSTRUMENTS[id]).toBeDefined();
      expect(INSTRUMENTS[id].id).toBe(id);
      expect(typeof INSTRUMENTS[id].run).toBe('function');
    }
    expect(Object.keys(INSTRUMENTS)).toHaveLength(4);
  });

  it('getInstrument returns the matching instrument', () => {
    expect(getInstrument('flick').id).toBe('flick');
  });
});
