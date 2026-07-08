import type { GameId, PersistedPrefs, Result, Session, Storage } from '../types';
import { GAME_YAW } from '../convert/yaw-table';

/** The known game ids, so a remembered currentGame is validated against the real table (not just
 *  "some non-empty string") - a stale/hand-edited id degrades the whole blob to a first visit. */
const KNOWN_GAMES = new Set<string>(GAME_YAW.map((g) => g.id));

/** Minimal key/value surface - satisfied by window.localStorage and by test fakes. */
export interface KvBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const SESSIONS_KEY = 'campeon.sessions.v1';
const RESULTS_KEY = 'campeon.results.v1';
const PREFS_KEY = 'campeon.prefs.v1';
const VERSION = '1';

/**
 * Validate remembered prefs on READ: a malformed or nonsensical blob (hand-edited localStorage, a
 * future-version shape, NaN poisoning) degrades to null - the app then behaves like a first visit
 * instead of seeding a search from garbage. Never throws.
 */
function validPrefs(p: unknown): PersistedPrefs | null {
  if (!p || typeof p !== 'object') return null;
  const c = p as Partial<PersistedPrefs>;
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!finite(c.dpi) || c.dpi <= 0) return null;
  if (!finite(c.currentSens) || c.currentSens <= 0) return null;
  if (!finite(c.speedAccuracy) || c.speedAccuracy < 0 || c.speedAccuracy > 1) return null;
  // Must be a REAL game id, not merely a non-empty string: a stale-schema or hand-edited id would
  // otherwise seed a draft whose game matches no yaw-table row, silently breaking the result-table
  // highlight and the setup pre-selection (and the doc contract promises to degrade such a blob).
  if (typeof c.currentGame !== 'string' || !KNOWN_GAMES.has(c.currentGame)) return null;
  if (!Array.isArray(c.bounds) || c.bounds.length !== 2) return null;
  const [lo, hi] = c.bounds;
  if (!finite(lo) || !finite(hi) || !(lo > 0) || !(hi > lo)) return null;
  if (c.lastSessionId !== undefined && typeof c.lastSessionId !== 'string') return null;
  return {
    dpi: c.dpi,
    currentGame: c.currentGame as GameId,
    currentSens: c.currentSens,
    speedAccuracy: c.speedAccuracy,
    bounds: [lo, hi],
    ...(c.lastSessionId !== undefined ? { lastSessionId: c.lastSessionId } : {}),
  };
}

function readJson<T>(kv: KvBackend, key: string, fallback: T): T {
  const raw = kv.getItem(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback; // malformed → degrade, never throw on read
  }
}

class LocalStorageStore implements Storage {
  constructor(private readonly kv: KvBackend) {}

  saveSession(s: Session): void {
    const all = this.loadSessions().filter((x) => x.id !== s.id);
    all.push(s);
    this.kv.setItem(SESSIONS_KEY, JSON.stringify(all));
  }

  loadSessions(): Session[] {
    const all = readJson<Session[]>(this.kv, SESSIONS_KEY, []);
    return Array.isArray(all) ? all : [];
  }

  loadResults(): Record<string, Result> {
    const all = readJson<Record<string, Result>>(this.kv, RESULTS_KEY, {});
    return all && typeof all === 'object' ? all : {};
  }

  saveResult(sessionId: string, r: Result): void {
    const all = this.loadResults();
    all[sessionId] = r;
    this.kv.setItem(RESULTS_KEY, JSON.stringify(all));
  }

  savePrefs(p: PersistedPrefs): void {
    this.kv.setItem(PREFS_KEY, JSON.stringify(p));
  }

  loadPrefs(): PersistedPrefs | null {
    return validPrefs(readJson<unknown>(this.kv, PREFS_KEY, null));
  }

  exportJson(): string {
    return JSON.stringify(
      { version: VERSION, sessions: this.loadSessions(), results: this.loadResults() },
      null,
      2,
    );
  }
}

/** Create a Storage. Defaults to window.localStorage; pass a backend in tests. */
export function createStorage(backend?: KvBackend): Storage & { loadResults(): Record<string, Result> } {
  return new LocalStorageStore(backend ?? window.localStorage);
}
