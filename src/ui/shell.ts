import type { Cm360, Dpi, GameId, PersistedPrefs, Profile, Result, Session, Storage } from '../types';

export type Route = 'hero' | 'setup' | 'session' | 'result' | 'case-study' | 'options' | 'range';

export interface Screen {
  mount(): void;
  unmount(): void;
}

/** Cross-screen, in-memory draft of the session being configured. */
export interface SessionDraft {
  dpi: Dpi;
  currentGame: GameId;
  currentSens: number;
  profile: Profile;
  bounds: [Cm360, Cm360];
}

export interface AppContext {
  navigate(route: Route): void;
  route: Route;
  storage: Storage;
  draft: SessionDraft;
  lastResult?: { sessionId: string; result: Result };
}

export type ScreenFactory = (host: HTMLElement, ctx: AppContext) => Screen;

export interface ShellDeps {
  storage?: Storage;
  screens: Record<Route, ScreenFactory>;
}

const ROUTE_HASH: Record<Route, string> = {
  hero: '#/', setup: '#/setup', session: '#/session',
  result: '#/result', 'case-study': '#/case-study', options: '#/options',
  range: '#/range',
};
const HASH_ROUTE = new Map<string, Route>(Object.entries(ROUTE_HASH).map(([r, h]) => [h, r as Route]));

/** What each route is called out loud. Announced on navigation and used as the page title. */
export const ROUTE_NAME: Record<Route, string> = {
  hero: 'campeón',
  setup: 'set up the run',
  session: 'the hunt',
  result: 'your result',
  'case-study': 'how I built it',
  options: 'options',
  range: 'the range',
};

function defaultDraft(): SessionDraft {
  return {
    dpi: 800,
    currentGame: 'cs2',
    currentSens: 1,
    profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
    bounds: [15, 60],
  };
}

/** Fold remembered prefs over the defaults - a returning visitor starts from their own calibration. */
function draftFromPrefs(prefs: PersistedPrefs | null): SessionDraft {
  const d = defaultDraft();
  if (!prefs) return d;
  return {
    dpi: prefs.dpi,
    currentGame: prefs.currentGame,
    currentSens: prefs.currentSens,
    profile: { ...d.profile, speedAccuracy: prefs.speedAccuracy },
    bounds: prefs.bounds,
  };
}

/**
 * Remember the live draft as the returning-visitor prefs (feature-checked - a Storage without
 * prefs support is a silent no-op). `lastSessionId` updates the restore pointer when given and is
 * PRESERVED from the previous save otherwise, so remembering a game pick never forgets the result.
 */
export function rememberPrefs(ctx: AppContext, lastSessionId?: string): void {
  const prev = ctx.storage.loadPrefs?.() ?? null;
  const pointer = lastSessionId ?? prev?.lastSessionId;
  ctx.storage.savePrefs?.({
    dpi: ctx.draft.dpi,
    currentGame: ctx.draft.currentGame,
    currentSens: ctx.draft.currentSens,
    speedAccuracy: ctx.draft.profile.speedAccuracy,
    bounds: ctx.draft.bounds,
    ...(pointer !== undefined ? { lastSessionId: pointer } : {}),
  });
}

/** Screens that require prerequisites; otherwise redirect. */
const GUARDS: Partial<Record<Route, (ctx: AppContext) => Route | null>> = {
  result: (ctx) => (ctx.lastResult ? null : 'hero'),
  range: (ctx) => (ctx.lastResult ? null : 'hero'),
};

export function createShell(root: HTMLElement, deps: ShellDeps): { start(): void; context: AppContext } {
  let current: Screen | null = null;

  // One live region for the whole app. Navigation replaces the entire document body, which is
  // silent to a screen reader, so the route name is spoken here instead. Re-appended on every
  // render because replaceChildren() clears it along with the old screen.
  const announcer = document.createElement('p');
  announcer.className = 'sr-only';
  announcer.setAttribute('aria-live', 'polite');
  announcer.setAttribute('aria-atomic', 'true');

  const storage = deps.storage ?? inMemoryStorage();
  const prefs = storage.loadPrefs?.() ?? null;

  const context: AppContext = {
    route: 'hero',
    storage,
    draft: draftFromPrefs(prefs),
    navigate(route: Route) {
      location.hash = ROUTE_HASH[route];
      render(route);
    },
  };

  // Restore the last shown result so #/result and #/range deep-links survive a reload: the prefs
  // carry only a POINTER; the Result itself comes from its own store. Absent/stale pointers fall
  // through to the route guards (which bounce to the hero) - nothing is fabricated.
  if (prefs?.lastSessionId) {
    const saved = storage.loadResults?.()[prefs.lastSessionId];
    if (saved) context.lastResult = { sessionId: prefs.lastSessionId, result: saved };
  }

  function routeFromHash(): Route {
    return HASH_ROUTE.get(location.hash) ?? 'hero';
  }

  function render(route: Route): void {
    const guard = GUARDS[route]?.(context) ?? null;
    if (guard) { context.navigate(guard); return; }
    current?.unmount();
    root.replaceChildren();
    context.route = route;

    // Each screen gets its own landmark, and focus moves into it once it is mounted. Without
    // this, navigation removes the element that had focus and the browser drops focus back on
    // <body>: a keyboard or screen-reader user lands at the top of the document every time and
    // has no idea the screen changed. tabindex="-1" makes the landmark a programmatic target
    // only, so it never joins the tab order.
    const main = document.createElement('main');
    main.tabIndex = -1;
    main.dataset.route = route;
    root.append(main, announcer);

    const factory = deps.screens[route];
    current = factory(main, context);
    current.mount();
    main.focus();

    if (typeof document !== 'undefined') document.title = `${ROUTE_NAME[route]} · campeón`;
    // Cleared first so re-entering the same route still counts as a change worth announcing.
    announcer.textContent = '';
    announcer.textContent = ROUTE_NAME[route];
  }

  function start(): void {
    // navigate() renders synchronously (jsdom fires no sync hashchange); the browser's hashchange
    // echo is deduped here so a screen never mounts twice. Genuine nav (back/forward) still routes.
    window.addEventListener('hashchange', () => {
      const next = routeFromHash();
      if (next !== context.route) render(next);
    });
    render(routeFromHash());
  }

  return { start, context };
}

/** A no-persistence fallback Storage (used if none injected; the real app injects LocalStorage). */
function inMemoryStorage(): Storage {
  const sessions: Session[] = [];
  const results: Record<string, Result> = {};
  let prefs: PersistedPrefs | null = null;
  return {
    saveSession(s) { const i = sessions.findIndex((x) => x.id === s.id); if (i >= 0) sessions[i] = s; else sessions.push(s); },
    loadSessions() { return [...sessions]; },
    saveResult(id, r) { results[id] = r; },
    loadResults() { return { ...results }; },
    savePrefs(p) { prefs = p; },
    loadPrefs() { return prefs; },
    exportJson() { return JSON.stringify({ version: '1', sessions, results }, null, 2); },
  };
}
