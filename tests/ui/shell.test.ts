// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createShell, ROUTE_NAME, type Screen, type AppContext, type Route } from '../../src/ui/shell';

const recordingScreen = (log: string[], name: string) => (host: HTMLElement, _ctx: AppContext): Screen => ({
  mount() { host.innerHTML = `<div data-screen="${name}">${name}</div>`; log.push(`mount:${name}`); },
  unmount() { log.push(`unmount:${name}`); },
});

describe('shell router', () => {
  beforeEach(() => { location.hash = ''; document.body.innerHTML = '<div id="app"></div>'; });

  it('mounts the default (hero) screen on start', () => {
    const log: string[] = [];
    const root = document.getElementById('app')!;
    const shell = createShell(root, {
      screens: { hero: recordingScreen(log, 'hero'), setup: recordingScreen(log, 'setup') } as never,
    });
    shell.start();
    expect(root.querySelector('[data-screen="hero"]')).not.toBeNull();
    expect(log).toContain('mount:hero');
  });

  it('navigate unmounts the old screen and mounts the new one', () => {
    const log: string[] = [];
    const root = document.getElementById('app')!;
    const shell = createShell(root, {
      screens: { hero: recordingScreen(log, 'hero'), setup: recordingScreen(log, 'setup') } as never,
    });
    shell.start();
    shell.context.navigate('setup');
    expect(root.querySelector('[data-screen="setup"]')).not.toBeNull();
    expect(log).toEqual(['mount:hero', 'unmount:hero', 'mount:setup']);
  });

});

// ── Navigation is announced, and focus lands somewhere named ───────────────────
//
// Navigation swaps the screen's markup, which is silent: no page load, no focus change a
// screen reader reports on its own. The router owes a keyboard or screen-reader user two
// things on every route change, and both used to be broken.

describe('shell router: navigation is perceivable', () => {
  beforeEach(() => { location.hash = ''; document.body.innerHTML = '<div id="app"></div>'; });

  const twoScreens = () => ({
    hero: recordingScreen([], 'hero'), setup: recordingScreen([], 'setup'),
  } as never);

  const settled = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  it('keeps ONE live region attached across navigations instead of detaching it each time', async () => {
    // The old render() cleared the root, which detached the region, re-appended it, and wrote to
    // it in the same task. Assistive tech only reports a mutation inside a region it is already
    // observing, so an announcement written into a freshly attached node is usually lost. The
    // region must therefore be the SAME node before and after a navigation.
    const root = document.getElementById('app')!;
    const shell = createShell(root, { screens: twoScreens() });
    shell.start();

    const live = root.querySelector('[aria-live="polite"]')!;
    expect(live.getAttribute('aria-atomic')).toBe('true');
    expect(live.className).toContain('sr-only');

    shell.context.navigate('setup');
    await settled();
    const after = root.querySelectorAll('[aria-live]');
    expect(after).toHaveLength(1);        // never duplicated
    expect(after[0]).toBe(live);          // and never replaced: the same node throughout
    expect(live.isConnected).toBe(true);  // still in the document
  });

  it('announces the route name, and only after the DOM change has settled', async () => {
    const root = document.getElementById('app')!;
    const shell = createShell(root, { screens: twoScreens() });
    shell.start();
    await settled();
    const live = root.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toBe('campeón');

    shell.context.navigate('setup');
    // Synchronously the region is cleared, not yet rewritten: the text change has to be a
    // separate event from the screen swap or there is nothing for the region to report.
    expect(live.textContent).toBe('');
    await settled();
    expect(live.textContent).toBe('Set up the run');
  });

  it('re-entering the same route still announces it', async () => {
    const root = document.getElementById('app')!;
    const shell = createShell(root, { screens: twoScreens() });
    shell.start();
    await settled();
    const live = root.querySelector('[aria-live="polite"]')!;

    shell.context.navigate('setup');
    await settled();
    shell.context.navigate('setup');
    expect(live.textContent).toBe('');     // cleared, so the identical text reads as a change
    await settled();
    expect(live.textContent).toBe('Set up the run');
  });

  it('speaks only the route it landed on when navigations arrive back to back', async () => {
    const root = document.getElementById('app')!;
    const shell = createShell(root, { screens: twoScreens() });
    shell.start();
    shell.context.navigate('setup');
    shell.context.navigate('hero');
    await settled();
    expect(root.querySelector('[aria-live="polite"]')!.textContent).toBe('campeón');
  });

  it('moves focus into a NAMED landmark, so it is not "main" with nothing after it', async () => {
    const root = document.getElementById('app')!;
    const shell = createShell(root, { screens: twoScreens() });
    shell.start();

    let main = root.querySelector('main')!;
    expect(document.activeElement).toBe(main);
    expect(main.getAttribute('aria-label')).toBe('campeón');
    expect(main.tabIndex).toBe(-1);

    shell.context.navigate('setup');
    main = root.querySelector('main')!;
    expect(document.activeElement).toBe(main);
    expect(main.getAttribute('aria-label')).toBe('Set up the run');
    expect(root.querySelectorAll('main')).toHaveLength(1); // the old landmark is gone, not stacked
  });

  it('titles the document with the route, and never doubles the product name on the hero', async () => {
    const root = document.getElementById('app')!;
    const shell = createShell(root, { screens: twoScreens() });
    shell.start();
    expect(document.title).toBe('campeón');
    shell.context.navigate('setup');
    expect(document.title).toBe('Set up the run · campeón');
  });
});

describe('ROUTE_NAME: user-visible copy, so it obeys the voice', () => {
  // These strings name the landmark, get spoken on navigation, and become the document title.
  // They were lowercase back when nothing read them aloud.
  it('is sentence case everywhere except the wordmark itself', () => {
    for (const [route, name] of Object.entries(ROUTE_NAME) as Array<[Route, string]>) {
      if (route === 'hero') {
        expect(name, 'the hero entry IS the product name; the title logic keys on it').toBe('campeón');
        continue;
      }
      expect(name[0], `${route}: "${name}" must start with a capital`).toBe(name[0].toUpperCase());
      // Sentence case, so no word after the first is capitalised. "I" is the pronoun and the
      // one legitimate mid-sentence capital in this app's voice.
      const titleCased = name.split(' ').slice(1).filter((w) => /^[A-Z]/.test(w) && w !== 'I');
      expect(titleCased, `${route}: "${name}" is title-cased`).toEqual([]);
    }
  });

  it('writes the first person pronoun as a capital I', () => {
    expect(ROUTE_NAME['case-study']).toBe('How I built it');
    for (const name of Object.values(ROUTE_NAME)) {
      expect(name, `"${name}" carries a lowercase standalone i`).not.toMatch(/(^|\s)i(\s|$)/);
    }
  });

  it('carries no dash of any kind', () => {
    for (const name of Object.values(ROUTE_NAME)) {
      expect(name, `"${name}"`).not.toMatch(/[—–]|--/);
    }
  });
});

describe('shell router: draft', () => {
  beforeEach(() => { location.hash = ''; document.body.innerHTML = '<div id="app"></div>'; });

  it('still exposes a mutable draft with sensible defaults', () => {
    const root = document.getElementById('app')!;
    const shell = createShell(root, { screens: { hero: recordingScreen([], 'hero') } as never });
    shell.start();
    expect(shell.context.draft.bounds[0]).toBeLessThan(shell.context.draft.bounds[1]);
    expect(shell.context.draft.profile.speedAccuracy).toBeGreaterThanOrEqual(0);
  });
});

// ── Phase C: remember-my-calibration (prefs restore + last-result deep links) ──

import { counts360, countsBounds } from '../../src/types';
import type { PersistedPrefs, Result, Storage } from '../../src/types';
import { rememberPrefs } from '../../src/ui/shell';

const SAVED_RESULT: Result = {
  optimalCounts: counts360(8240), ci90: countsBounds(7400, 9150),
  breakdown: { biasZeroCounts: counts360(7900), precisionFloorDeg: 0.42, ttkMs: 511, hitRate: 0.86 },
};
const PREFS: PersistedPrefs = {
  currentGame: 'valorant', currentSens: 0.4,
  speedAccuracy: 0.7, bounds: countsBounds(5670, 15750), lastSessionId: 's-last',
};

function prefsStorage(prefs: PersistedPrefs | null, results: Record<string, Result> = {}): Storage {
  let saved = prefs;
  return {
    saveSession() {}, loadSessions: () => [], saveResult() {}, exportJson: () => '{}',
    loadResults: () => results,
    savePrefs(p) { saved = p; },
    loadPrefs: () => saved,
  };
}

describe('shell: remembered prefs (Phase C)', () => {
  beforeEach(() => { location.hash = ''; document.body.innerHTML = '<div id="app"></div>'; });

  it('folds remembered prefs into the draft at boot (calibration is never redone silently)', () => {
    const root = document.getElementById('app')!;
    const shell = createShell(root, {
      storage: prefsStorage(PREFS),
      screens: { hero: recordingScreen([], 'hero') } as never,
    });
    shell.start();
    expect(shell.context.draft.currentGame).toBe('valorant');
    expect(shell.context.draft.bounds).toEqual([5670, 15750]);
    expect(shell.context.draft.profile.speedAccuracy).toBe(0.7);
    // instrument weights stay the app's own defaults - taste is remembered, weights are not prefs
    expect(shell.context.draft.profile.instrumentWeights.track).toBe(1);
  });

  it('restores the last result from the prefs pointer so #/result survives a reload', () => {
    const root = document.getElementById('app')!;
    const shell = createShell(root, {
      storage: prefsStorage(PREFS, { 's-last': SAVED_RESULT }),
      screens: { hero: recordingScreen([], 'hero'), result: recordingScreen([], 'result') } as never,
    });
    shell.start();
    expect(shell.context.lastResult).toEqual({ sessionId: 's-last', result: SAVED_RESULT });
    // the result route guard now passes - the deep link lands on the result, not the hero
    shell.context.navigate('result');
    expect(root.querySelector('[data-screen="result"]')).not.toBeNull();
  });

  it('a stale pointer (result gone) restores nothing and the guard still bounces to hero', () => {
    const root = document.getElementById('app')!;
    const shell = createShell(root, {
      storage: prefsStorage(PREFS, {}), // pointer exists, result store is empty
      screens: { hero: recordingScreen([], 'hero'), result: recordingScreen([], 'result') } as never,
    });
    shell.start();
    expect(shell.context.lastResult).toBeUndefined();
    shell.context.navigate('result');
    expect(root.querySelector('[data-screen="hero"]')).not.toBeNull();
  });

  it('boots on plain defaults for a first visit or a prefs-less Storage (feature-checked)', () => {
    const root = document.getElementById('app')!;
    const bare: Storage = { saveSession() {}, loadSessions: () => [], saveResult() {}, exportJson: () => '{}' };
    const shell = createShell(root, { storage: bare, screens: { hero: recordingScreen([], 'hero') } as never });
    shell.start();
    expect(shell.context.lastResult).toBeUndefined();
  });

  it('rememberPrefs writes the live draft and PRESERVES the last-result pointer unless given a new one', () => {
    const storage = prefsStorage(PREFS);
    const root = document.getElementById('app')!;
    const shell = createShell(root, { storage, screens: { hero: recordingScreen([], 'hero') } as never });
    shell.start();

    shell.context.draft.currentGame = 'apex';
    rememberPrefs(shell.context); // no pointer given - must keep s-last
    expect(storage.loadPrefs!()).toMatchObject({ currentGame: 'apex', lastSessionId: 's-last' });

    rememberPrefs(shell.context, 's-new'); // an explicit pointer replaces it
    expect(storage.loadPrefs!()!.lastSessionId).toBe('s-new');
  });
});
