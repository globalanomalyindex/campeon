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
