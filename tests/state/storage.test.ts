// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createStorage, type KvBackend } from '../../src/state/storage';
import type { Result, Session } from '../../src/types';

const fakeKv = (): KvBackend => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};
const session = (id: string): Session => ({
  id, dpi: 800,
  profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
  trials: [], status: 'complete', createdAt: 0,
});
const result: Result = {
  optimalCm360: 32, ci90: [28, 37], perGameSens: { cs2: 1.5 },
  breakdown: { biasZeroCm360: 30, precisionFloorDeg: 0.4, ttkMs: 500, hitRate: 0.8 },
};

describe('LocalStorage Storage', () => {
  it('round-trips sessions and upserts by id', () => {
    const s = createStorage(fakeKv());
    s.saveSession(session('a'));
    s.saveSession(session('b'));
    s.saveSession({ ...session('a'), dpi: 1600 }); // upsert, not append
    const all = s.loadSessions();
    expect(all.map((x) => x.id).sort()).toEqual(['a', 'b']);
    expect(all.find((x) => x.id === 'a')?.dpi).toBe(1600);
  });

  it('saves and exports results keyed by sessionId', () => {
    const s = createStorage(fakeKv());
    s.saveSession(session('a'));
    s.saveResult('a', result);
    const json = s.exportJson();
    const parsed = JSON.parse(json);
    expect(parsed.results.a.optimalCm360).toBe(32);
    expect(parsed.sessions[0].id).toBe('a');
    expect(typeof parsed.version).toBe('string');
  });

  it('returns [] for missing or malformed session data (never throws)', () => {
    const kv = fakeKv();
    kv.setItem('campeon.sessions.v1', '{not json');
    const s = createStorage(kv);
    expect(s.loadSessions()).toEqual([]);
  });

  it('defaults to window.localStorage when no backend is passed', () => {
    const s = createStorage();
    s.saveSession(session('z'));
    expect(s.loadSessions().some((x) => x.id === 'z')).toBe(true);
  });
});

describe('remembered prefs (campeon.prefs.v1, Phase C)', () => {
  const prefs = {
    dpi: 1600, currentGame: 'cs2' as const, currentSens: 0.5,
    speedAccuracy: 0.7, bounds: [18, 50] as [number, number], lastSessionId: 's-12-3240',
  };

  it('round-trips prefs, preserving the last-result pointer', () => {
    const s = createStorage(fakeKv());
    expect(s.loadPrefs!()).toBeNull(); // first visit - nothing remembered
    s.savePrefs!(prefs);
    expect(s.loadPrefs!()).toEqual(prefs);
  });

  it('validates on read: malformed or nonsensical blobs degrade to null (first-visit behavior)', () => {
    const bad: unknown[] = [
      '{not json',
      JSON.stringify({ ...prefs, dpi: NaN }),
      JSON.stringify({ ...prefs, dpi: -800 }),
      JSON.stringify({ ...prefs, speedAccuracy: 3 }),
      JSON.stringify({ ...prefs, bounds: [60, 15] }), // inverted window
      JSON.stringify({ ...prefs, bounds: [15] }),
      JSON.stringify({ ...prefs, currentGame: '' }),
      JSON.stringify(42),
    ];
    for (const blob of bad) {
      const kv = fakeKv();
      kv.setItem('campeon.prefs.v1', blob as string);
      expect(createStorage(kv).loadPrefs!(), `blob: ${String(blob).slice(0, 40)}`).toBeNull();
    }
  });

  it('accepts prefs without a lastSessionId (calibrated but never finished a session)', () => {
    const s = createStorage(fakeKv());
    const { lastSessionId: _p, ...noPointer } = prefs;
    s.savePrefs!(noPointer);
    expect(s.loadPrefs!()).toEqual(noPointer);
  });
});
