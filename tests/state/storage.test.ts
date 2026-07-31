// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createStorage, type KvBackend } from '../../src/state/storage';
import { counts360, countsBounds } from '../../src/types';
import type { Counts360, Result, Session } from '../../src/types';

const fakeKv = (): KvBackend => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};
const session = (id: string): Session => ({
  id,
  profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
  trials: [], status: 'complete', createdAt: 0,
});
const result: Result = {
  optimalCounts: counts360(32), ci90: countsBounds(28, 37),
  breakdown: { biasZeroCounts: counts360(30), precisionFloorDeg: 0.4, ttkMs: 500, hitRate: 0.8 },
};

describe('LocalStorage Storage', () => {
  it('round-trips sessions and upserts by id', () => {
    const s = createStorage(fakeKv());
    s.saveSession(session('a'));
    s.saveSession(session('b'));
    s.saveSession({ ...session('a'), createdAt: 99 }); // upsert, not append
    const all = s.loadSessions();
    expect(all.map((x) => x.id).sort()).toEqual(['a', 'b']);
    expect(all.find((x) => x.id === 'a')?.createdAt).toBe(99);
  });

  it('saves and exports results keyed by sessionId', () => {
    const s = createStorage(fakeKv());
    s.saveSession(session('a'));
    s.saveResult('a', result);
    const json = s.exportJson();
    const parsed = JSON.parse(json);
    expect(parsed.results.a.optimalCounts).toBe(32);
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
    currentGame: 'cs2' as const, currentSens: 0.5,
    speedAccuracy: 0.7, bounds: countsBounds(5670, 15750) as [Counts360, Counts360], lastSessionId: 's-12-3240',
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
      JSON.stringify({ ...prefs, speedAccuracy: 3 }),
      JSON.stringify({ ...prefs, bounds: [19200, 4800] }), // inverted window
      JSON.stringify({ ...prefs, bounds: [4800] }),
      JSON.stringify({ ...prefs, currentGame: '' }),
      JSON.stringify({ ...prefs, currentGame: 'minecraft' }), // non-empty but not a real game id
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

  it('round-trips the card reading, and reads a blob that predates it as simply not having one', () => {
    const s = createStorage(fakeKv());
    s.savePrefs!({ ...prefs, dpi: 1600 });
    expect(s.loadPrefs!()!.dpi).toBe(1600);
    s.savePrefs!(prefs); // a visit whose card was skipped or refused
    expect(s.loadPrefs!()!.dpi).toBeUndefined();
  });

  it('drops an unusable card reading WITHOUT taking the calibration down with it', () => {
    // The asymmetry is deliberate. Every other field here is what the search runs on, so garbage in
    // one means the whole blob is untrustworthy. The card reading seeds nothing, so binning a good
    // search window over a hand-edited DPI would cost the visitor their calibration to punish a
    // note. Dropped, it reads downstream as "the card never ran" - what a first visit looks like.
    for (const dpi of [0, -800, 5, 90000, Number.NaN, 'lots']) {
      const kv = fakeKv();
      kv.setItem('campeon.prefs.v1', JSON.stringify({ ...prefs, dpi }));
      const read = createStorage(kv).loadPrefs!();
      expect(read, `dpi: ${String(dpi)}`).not.toBeNull();
      expect(read!.dpi).toBeUndefined();
      expect(read!.bounds).toEqual(prefs.bounds);
    }
  });
});
