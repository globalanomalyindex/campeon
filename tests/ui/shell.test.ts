// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createShell, type Screen, type AppContext } from '../../src/ui/shell';

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

  it('exposes a mutable draft with sensible defaults', () => {
    const root = document.getElementById('app')!;
    const shell = createShell(root, { screens: { hero: recordingScreen([], 'hero') } as never });
    shell.start();
    expect(shell.context.draft.dpi).toBeGreaterThan(0);
    expect(shell.context.draft.bounds[0]).toBeLessThan(shell.context.draft.bounds[1]);
    expect(shell.context.draft.profile.speedAccuracy).toBeGreaterThanOrEqual(0);
  });
});

// ── Phase C: remember-my-calibration (prefs restore + last-result deep links) ──

import type { PersistedPrefs, Result, Storage } from '../../src/types';
import { rememberPrefs } from '../../src/ui/shell';

const SAVED_RESULT: Result = {
  optimalCm360: 32.4, ci90: [29.1, 36.0], perGameSens: { cs2: 1.59 },
  breakdown: { biasZeroCm360: 31, precisionFloorDeg: 0.42, ttkMs: 511, hitRate: 0.86 },
};
const PREFS: PersistedPrefs = {
  dpi: 1600, currentGame: 'valorant', currentSens: 0.4,
  speedAccuracy: 0.7, bounds: [18, 50], lastSessionId: 's-last',
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
    expect(shell.context.draft.dpi).toBe(1600);
    expect(shell.context.draft.currentGame).toBe('valorant');
    expect(shell.context.draft.bounds).toEqual([18, 50]);
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
    expect(shell.context.draft.dpi).toBe(800);
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
