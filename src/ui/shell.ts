import type { Cm360, Dpi, GameId, Profile, Result, Session, Storage } from '../types';

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

function defaultDraft(): SessionDraft {
  return {
    dpi: 800,
    currentGame: 'cs2',
    currentSens: 1,
    profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
    bounds: [15, 60],
  };
}

/** Screens that require prerequisites; otherwise redirect. */
const GUARDS: Partial<Record<Route, (ctx: AppContext) => Route | null>> = {
  result: (ctx) => (ctx.lastResult ? null : 'hero'),
  range: (ctx) => (ctx.lastResult ? null : 'hero'),
};

export function createShell(root: HTMLElement, deps: ShellDeps): { start(): void; context: AppContext } {
  let current: Screen | null = null;

  // Old-school film cut between screens: a quick cream flash on every route change.
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let flashEl: HTMLElement | null = null;
  function flashCut(): void {
    if (reduceMotion || typeof document === 'undefined') return;
    if (!flashEl) {
      flashEl = document.createElement('div');
      flashEl.className = 'route-flash';
      flashEl.setAttribute('aria-hidden', 'true');
      document.body.appendChild(flashEl);
    }
    flashEl.classList.remove('is-on');
    void flashEl.offsetWidth; // reflow so the animation restarts on rapid navigation
    flashEl.classList.add('is-on');
  }

  const context: AppContext = {
    route: 'hero',
    storage: deps.storage ?? inMemoryStorage(),
    draft: defaultDraft(),
    navigate(route: Route) {
      flashCut();
      location.hash = ROUTE_HASH[route];
      render(route);
    },
  };

  function routeFromHash(): Route {
    return HASH_ROUTE.get(location.hash) ?? 'hero';
  }

  function render(route: Route): void {
    const guard = GUARDS[route]?.(context) ?? null;
    if (guard) { context.navigate(guard); return; }
    current?.unmount();
    root.replaceChildren();
    context.route = route;
    const factory = deps.screens[route];
    current = factory(root, context);
    current.mount();
  }

  function start(): void {
    // navigate() renders synchronously (jsdom fires no sync hashchange); the browser's hashchange
    // echo is deduped here so a screen never mounts twice. Genuine nav (back/forward) still routes.
    window.addEventListener('hashchange', () => {
      const next = routeFromHash();
      if (next !== context.route) { flashCut(); render(next); }
    });
    render(routeFromHash());
  }

  return { start, context };
}

/** A no-persistence fallback Storage (used if none injected; the real app injects LocalStorage). */
function inMemoryStorage(): Storage {
  const sessions: Session[] = [];
  const results: Record<string, Result> = {};
  return {
    saveSession(s) { const i = sessions.findIndex((x) => x.id === s.id); if (i >= 0) sessions[i] = s; else sessions.push(s); },
    loadSessions() { return [...sessions]; },
    saveResult(id, r) { results[id] = r; },
    exportJson() { return JSON.stringify({ version: '1', sessions, results }, null, 2); },
  };
}
