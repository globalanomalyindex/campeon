import { describe, it, expect } from 'vitest';
import { buildExportBundle, toJson } from '../../src/state/export';
import type { Result, Session } from '../../src/types';

const session: Session = {
  id: 'a', dpi: 800,
  profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
  trials: [], status: 'complete', createdAt: 123,
};
const result: Result = {
  optimalCm360: 32, ci90: [28, 37], perGameSens: { cs2: 1.5 },
  breakdown: { biasZeroCm360: 30, precisionFloorDeg: 0.4, ttkMs: 500, hitRate: 0.8 },
};

describe('export', () => {
  it('builds a versioned, timestamped bundle', () => {
    const b = buildExportBundle([session], { a: result }, 777);
    expect(b.version).toBe('1');
    expect(b.exportedAt).toBe(777);
    expect(b.sessions[0].id).toBe('a');
    expect(b.results.a.optimalCm360).toBe(32);
  });

  it('serializes to pretty JSON that round-trips', () => {
    const json = toJson(buildExportBundle([session], { a: result }, 777));
    expect(json).toContain('\n  '); // 2-space pretty
    expect(JSON.parse(json).results.a.ci90).toEqual([28, 37]);
  });
});
