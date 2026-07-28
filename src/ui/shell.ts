import type { Counts360, GameId, PersistedPrefs, Profile, Result, Session, Storage } from '../types';
import { countsBounds } from '../types';

export type Route = 'hero' | 'setup' | 'session' | 'result' | 'case-study' | 'options' | 'range';

export interface Screen {
  mount(): void;
  unmount(): void;
}

/** Cross-screen, in-memory draft of the session being configured. */
export interface SessionDraft {
  currentGame: GameId;
  currentSens: number;
  profile: Profile;
  bounds: [Counts360, Counts360];
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

/**
 * What each route is called out loud. This string is user-visible three ways over: it names the
 * <main> landmark, it is spoken on navigation, and it is the document title. So it is written as
 * copy, in sentence case. `hero` stays exactly the product name, which the title logic below
 * special-cases so the front door never reads "campeón · campeón".
 */
export const ROUTE_NAME: Record<Route, string> = {
  hero: 'campeón',
  setup: 'Set up the run',
  session: 'The hunt',
  result: 'Your result',
  'case-study': 'How I built it',
  options: 'Options',
  range: 'The range',
};

function defaultDraft(): SessionDraft {
  return {
    currentGame: 'cs2',
    currentSens: 1,
    profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
    bounds: countsBounds(4800, 19200),
  };
}

/** Fold remembered prefs over the defaults - a returning visitor starts from their own calibration. */
function draftFromPrefs(prefs: PersistedPrefs | null): SessionDraft {
  const d = defaultDraft();
  if (!prefs) return d;
  return {
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

  // One live region for the whole app. Navigation swaps the screen's markup, which is silent to a
  // screen reader, so the route name is spoken here instead.
  //
  // It is created and attached ONCE, and render() never touches it. The old code cleared the whole
  // root and re-appended the region on every navigation, then wrote to it in the same synchronous
  // task: assistive tech has to have a live region attached and registered BEFORE its content
  // changes to report the change, so a detach/attach/write inside one task lost the announcement
  // most of the time. Only the <main> beside it is replaced now.
  const announcer = document.createElement('p');
  announcer.className = 'sr-only';
  announcer.setAttribute('aria-live', 'polite');
  announcer.setAttribute('aria-atomic', 'true');
  root.appendChild(announcer);

  /** The screen landmark currently mounted, replaced in place so the announcer stays attached. */
  let landmark: HTMLElement | null = null;
  let pendingAnnounce: ReturnType<typeof setTimeout> | undefined;

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
    context.route = route;
    const name = ROUTE_NAME[route];

    // Each screen gets its own landmark, and focus moves into it once it is mounted. Without
    // this, navigation removes the element that had focus and the browser drops focus back on
    // <body>: a keyboard or screen-reader user lands at the top of the document every time and
    // has no idea the screen changed. tabindex="-1" makes the landmark a programmatic target
    // only, so it never joins the tab order.
    //
    // The landmark carries the route name, so focus lands on "Set up the run, main" rather than
    // on an anonymous region. It replaces its predecessor in place, which leaves the live region
    // attached beside it.
    const main = document.createElement('main');
    main.tabIndex = -1;
    main.dataset.route = route;
    main.setAttribute('aria-label', name);
    if (landmark) landmark.replaceWith(main);
    else root.insertBefore(main, announcer);
    landmark = main;

    const factory = deps.screens[route];
    current = factory(main, context);
    current.mount();
    main.focus();

    // The hero's route name IS the product name, so suffixing it there gives
    // "campeón · campeón". Every other route reads as a page inside the product.
    if (typeof document !== 'undefined') {
      document.title = name === 'campeón' ? name : `${name} · campeón`;
    }
    announce(name);
  }

  /**
   * Speak the new route. Cleared synchronously so re-entering the same route still reads as a
   * change worth announcing, then written in a later task so the screen change and the text change
   * are two separate events: written in the same task as the DOM swap, the text is often already in
   * place by the time assistive tech observes the region, and nothing is reported. A superseded
   * announcement is cancelled so a fast back/forward run speaks only where it landed.
   */
  function announce(name: string): void {
    clearTimeout(pendingAnnounce);
    announcer.textContent = '';
    pendingAnnounce = setTimeout(() => { announcer.textContent = name; }, 0);
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
