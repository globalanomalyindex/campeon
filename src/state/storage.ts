import type { Result, Session, Storage } from '../types';

/** Minimal key/value surface — satisfied by window.localStorage and by test fakes. */
export interface KvBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const SESSIONS_KEY = 'campeon.sessions.v1';
const RESULTS_KEY = 'campeon.results.v1';
const VERSION = '1';

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
