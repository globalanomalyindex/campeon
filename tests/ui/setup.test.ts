// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { setup, type SetupDeps } from '../../src/ui/setup';
import { countsForSens } from '../../src/convert/counts';
import { yawFor } from '../../src/convert/yaw-table';
import { boundsFromSeed } from '../../src/ui/options/settings';
import { counts360, type PersistedPrefs } from '../../src/types';
import type { TurnEstimate } from '../../src/anchor/reference-turn';
import type { Convention } from '../../src/input/lattice';
import type { AppContext, Route, SessionDraft } from '../../src/ui/shell';

type TurnOpts = Parameters<typeof import('../../src/ui/calibrate/turn-view').createTurnView>[1];

function fakeCtx(): AppContext & { nav: Route[] } {
  const nav: Route[] = [];
  // Typed as SessionDraft, no cast: phase 1a already deleted dpi, so the honest fixture simply
  // does not have one. counts360() is required by the brand and harmless if bounds stayed plain.
  const draft: SessionDraft = {
    currentGame: 'cs2', currentSens: 1,
    bounds: [counts360(4000), counts360(16000)],
    profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
  };
  return { route: 'setup', navigate(r: Route) { nav.push(r); }, draft, nav,
    storage: { saveSession() {}, loadSessions: () => [], saveResult() {}, exportJson: () => '' } } as AppContext & { nav: Route[] };
}

const EST: TurnEstimate = { counts: counts360(8000), spreadPct: 2.1, logSd: 0.08, agreed: true, passes: 3 };
const SCALED: Convention = { state: 'scaled', k: 2, purity: 1 };

function captureTurn(): { deps: SetupDeps; turn: () => TurnOpts; mounts: () => number } {
  let turnOpts: TurnOpts | null = null;
  let n = 0;
  const deps: SetupDeps = {
    createTurnView: ((_h: HTMLElement, o: TurnOpts) => {
      turnOpts = o; n += 1; return { dispose() {} };
    }) as SetupDeps['createTurnView'],
  };
  return { deps, turn: () => turnOpts!, mounts: () => n };
}

function rememberingCtx(prefs: PersistedPrefs | null): ReturnType<typeof fakeCtx> & { savedPrefs: () => PersistedPrefs | null } {
  const ctx = fakeCtx();
  let saved = prefs;
  ctx.storage.loadPrefs = () => saved;
  ctx.storage.savePrefs = (p) => { saved = p; };
  return Object.assign(ctx, { savedPrefs: () => saved });
}

const PREFS: PersistedPrefs = {
  currentGame: 'valorant', currentSens: 0.4, speedAccuracy: 0.7,
  bounds: [counts360(5000), counts360(14000)],
};

/** Walk the guided path to a mounted turn view: intro -> offer -> (accept | skip) -> turn.
 *  The offer opens with BOTH halves empty, so accepting means filling both: no test may lean on a
 *  prefill, because there is none to lean on. */
function startTurn(host: HTMLElement, accept?: { game: string; sens: string }): void {
  (host.querySelector('[data-action="start-guided"]') as HTMLButtonElement).click();
  if (accept) {
    const game = host.querySelector('[data-field="game"]') as HTMLSelectElement;
    game.value = accept.game;
    const sens = host.querySelector('[data-field="sens"]') as HTMLInputElement;
    sens.value = accept.sens;
    sens.dispatchEvent(new Event('input', { bubbles: true }));
    (host.querySelector('[data-action="offer-accept"]') as HTMLButtonElement).click();
  } else {
    (host.querySelector('[data-action="offer-skip"]') as HTMLButtonElement).click();
  }
}

describe('setup: the guided flow (the offer, then the blind turn)', () => {
  it('offers the guided path and the typed fork, with no card and no DPI anywhere', () => {
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    expect(host.querySelector('[data-action="start-guided"]')).toBeTruthy();
    expect(host.querySelector('[data-action="start-manual"]')).toBeTruthy();
    expect(host.querySelectorAll('.cal-preview li').length).toBe(1); // one measured step; the offer is a question, not a step
    const text = host.textContent!.toLowerCase();
    expect(text).not.toContain('card'); // the prop is gone, not merely optional
    expect(text).not.toContain('dpi');  // the unit chain is gone with it
  });

  it('start-guided asks for the game pair first, as an offer whose skip costs only the table', () => {
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    (host.querySelector('[data-action="start-guided"]') as HTMLButtonElement).click();
    expect(host.querySelector('h1')!.textContent).toBe('Name your game, if you like');
    expect(host.querySelector('[data-action="offer-accept"]')).toBeTruthy();
    expect(host.querySelector('[data-action="offer-skip"]')).toBeTruthy();
    expect(host.textContent).toContain('Skipping costs the per-game table, not the result.');
  });

  it('starts on no answer at all, so an ignored offer cannot be read as one', () => {
    // The anchoring defect that killed the spin dial, in a new costume. The spin prefilled a dial
    // and then measured the constant it had prefilled; an offer prefilled from defaultDraft()
    // ('cs2', 1) would let a player who clicks straight past it pin k off a pair nobody typed, and
    // k would then be wrong by the ratio of two yaws with nothing on the screen to show it. Empty
    // is the only value that means "no answer": storage cannot say whether a remembered
    // currentSens was typed or defaulted, so it never prefills this either.
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    (host.querySelector('[data-action="start-guided"]') as HTMLButtonElement).click();
    expect((host.querySelector('[data-field="game"]') as HTMLSelectElement).value).toBe('');
    expect((host.querySelector('[data-field="sens"]') as HTMLInputElement).value).toBe('');
  });

  it('a half-filled offer refuses and names the missing half', () => {
    // Half an offer is the one state that must not reach the turn: a sensitivity with no game is
    // not a pair, and silently dropping a number the player took the trouble to type is worse than
    // refusing it by name.
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host, { game: '', sens: '2' });
    expect(cap.mounts()).toBe(0); // the turn never started
    const err = host.querySelector('[data-error]')!;
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.textContent!.toLowerCase()).toContain('game');
    expect(ctx.draft.currentSens).toBe(1); // and nothing reached the draft
  });

  it('skipping the offer mounts the blind turn without touching the draft', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host);
    expect(cap.turn()).toBeTruthy();
    expect(ctx.draft.currentSens).toBe(1); // a skip records nothing
  });

  it('accepting the offer records the pair on the draft, then mounts the turn', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host, { game: 'cs2', sens: '2' });
    expect(ctx.draft.currentSens).toBe(2);
    expect(cap.mounts()).toBe(1);
  });

  it('an unusable offered sensitivity refuses with a named alert and does not advance', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host, { game: 'cs2', sens: '0' });
    expect(cap.mounts()).toBe(0); // still on the offer
    const err = host.querySelector('[data-error]')!;
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.textContent!.toLowerCase()).toContain('sensitivity');
    expect(host.querySelector('[data-field="sens"]')!.getAttribute('aria-invalid')).toBe('true');
  });

  it('a completed turn reports its own spread before anything commits', () => {
    // Spec: "Afterwards it reports the spread honestly." This screen is the agreed case: the
    // player is told how close their three turns landed, which is the moment the blind
    // instrument earns its blindness. Tabular figures per canon.
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host);
    cap.turn().onTurn(EST, null);
    const spread = host.querySelector('[data-done="spread"]')!;
    expect(spread.textContent).toBe('2.1');
    expect(spread.className).toContain('mono');
    expect(ctx.nav).toEqual([]); // reported BEFORE committing, not after
    expect(ctx.draft.turn).toBeUndefined();
  });

  it('continue commits the estimate, seeds counts bounds, remembers, and heads to the hunt', () => {
    const cap = captureTurn(); const ctx = rememberingCtx(null); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host);
    cap.turn().onTurn(EST, null);
    (host.querySelector('[data-action="turn-continue"]') as HTMLButtonElement).click();
    expect(ctx.draft.turn).toEqual(EST); // phase 4's reconciliation reads the turn's own spread
    expect(ctx.draft.bounds).toEqual(boundsFromSeed(EST.counts));
    expect(ctx.draft.profile.speedAccuracy).toBe(0.5);
    // Skipped offer plus a closed lattice gate: k is honestly unpinned, and the reason says the
    // estimator never ran (which the result screen turns into "type your sensitivity instead").
    expect(ctx.draft.kPin).toEqual({ pinned: false, reason: 'gate-closed' });
    expect(ctx.savedPrefs()).not.toBeNull();
    expect(ctx.nav).toEqual(['session']);
  });

  it('an accepted offer pins k by the typed route, inheriting the turn pass spread whole', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host, { game: 'cs2', sens: '2' });
    cap.turn().onTurn(EST, null);
    (host.querySelector('[data-action="turn-continue"]') as HTMLButtonElement).click();
    const pin = ctx.draft.kPin!;
    expect(pin.pinned).toBe(true);
    if (pin.pinned) {
      expect(pin.source).toBe('typed-sens');
      expect(pin.logSd).toBe(EST.logSd); // the reproduction error lands whole on k
      expect(pin.k).toBeCloseTo(8000 / countsForSens(2, yawFor('cs2')), 10);
    }
  });

  it('a scaled lattice pins k even when the offer was skipped', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host);
    cap.turn().onTurn(EST, SCALED);
    (host.querySelector('[data-action="turn-continue"]') as HTMLButtonElement).click();
    expect(ctx.draft.kPin).toEqual({ pinned: true, k: 2, source: 'lattice', logSd: 0 });
    expect(ctx.draft.convention).toEqual(SCALED);
  });

  it('the typed pair outranks the lattice when both exist', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host, { game: 'cs2', sens: '2' });
    cap.turn().onTurn(EST, SCALED);
    (host.querySelector('[data-action="turn-continue"]') as HTMLButtonElement).click();
    const pin = ctx.draft.kPin!;
    expect(pin.pinned && pin.source).toBe('typed-sens');
  });

  it('redo discards the pending estimate and remounts the turn, committing nothing', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host);
    cap.turn().onTurn(EST, SCALED);
    (host.querySelector('[data-action="redo-turn"]') as HTMLButtonElement).click();
    expect(cap.mounts()).toBe(2);
    expect(ctx.draft.turn).toBeUndefined();
    expect(ctx.nav).toEqual([]);
  });

  it('an accel refusal shows the acceleration screen, and retry remounts the turn', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host);
    cap.turn().onBlocked('accel', null);
    expect(host.querySelectorAll('h1').length).toBe(1);
    expect(host.querySelector('h1')!.textContent).toBe('Mouse acceleration is on');
    (host.querySelector('[data-action="retry"]') as HTMLButtonElement).click();
    expect(cap.mounts()).toBe(2);
  });

  it('a spread refusal names the measured spread and the fourth pass', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host);
    cap.turn().onBlocked('spread', 27.4);
    expect(host.querySelector('h1')!.textContent).toBe('Those turns never settled');
    expect(host.textContent!.toLowerCase()).toContain('fourth pass');
    const spread = host.querySelector('[data-blocked="spread"]')!;
    expect(spread.textContent).toBe('27.4'); // the honest number, not "too far apart"
    expect(spread.className).toContain('mono');
  });

  it('the turn can go back to the intro and hand off to the typed fallback, committing nothing', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host);
    cap.turn().onBack();
    expect(host.querySelector('[data-action="start-guided"]')).toBeTruthy();
    startTurn(host);
    cap.turn().onManual();
    expect(host.querySelector('[data-action="manual-begin"]')).toBeTruthy();
    expect(ctx.nav).toEqual([]);
  });
});

describe('setup: the typed fallback', () => {
  function manualStep(ctx: ReturnType<typeof fakeCtx>): HTMLElement {
    const host = document.createElement('div');
    setup(host, ctx).mount();
    (host.querySelector('[data-action="start-manual"]') as HTMLButtonElement).click();
    return host;
  }
  const type = (host: HTMLElement, field: string, value: string): void => {
    const el = host.querySelector(`[data-field="${field}"]`) as HTMLInputElement;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('has no DPI field: game and in-game sensitivity are the whole ask', () => {
    const host = manualStep(fakeCtx());
    expect(host.querySelector('[data-field="dpi"]')).toBeNull();
    expect(host.querySelector('[data-field="game"]')).toBeTruthy();
    expect(host.querySelector('[data-field="sens"]')).toBeTruthy();
  });

  it('writes sens/game plus counts-seeded bounds, clears stale turn state, leaves k unpinned, and navigates', () => {
    const ctx = fakeCtx();
    // A guided run the player is now replacing by typing: every trace of it must go.
    ctx.draft.turn = EST;
    ctx.draft.convention = SCALED;
    ctx.draft.kPin = { pinned: true, k: 2, source: 'lattice', logSd: 0 };
    const host = manualStep(ctx);
    type(host, 'sens', '0.5');
    (host.querySelector('[data-action="manual-begin"]') as HTMLButtonElement).click();
    expect(ctx.draft.currentSens).toBe(0.5);
    expect(ctx.draft.bounds).toEqual(boundsFromSeed(countsForSens(0.5, yawFor('cs2'))));
    expect(ctx.draft.turn).toBeUndefined();       // phase 4 must never reconcile against a replaced run
    expect(ctx.draft.convention).toBeUndefined();
    // Typing alone cannot pin k: without a turn there is no arena count to compare against, so
    // the typed numbers seed the search window only and the pin is honestly refused.
    expect(ctx.draft.kPin).toEqual({ pinned: false, reason: 'gate-closed' });
    expect(ctx.nav).toEqual(['session']);
  });

  it.each([['', 'empty'], ['0', 'zero'], ['-2', 'negative']])(
    'a %s sensitivity (%s) neither navigates nor reaches the draft, and says why', (bad) => {
      const ctx = fakeCtx(); const host = manualStep(ctx);
      type(host, 'sens', bad);
      (host.querySelector('[data-action="manual-begin"]') as HTMLButtonElement).click();
      expect(ctx.nav).toEqual([]);
      expect(ctx.draft.currentSens).toBe(1); // the draft is untouched
      const err = host.querySelector('[data-error]')!;
      expect(err.getAttribute('role')).toBe('alert');
      expect(err.textContent!.toLowerCase()).toContain('sensitivity');
      expect(host.querySelector('[data-field="sens"]')!.getAttribute('aria-invalid')).toBe('true');
    });

  it('clears the message as soon as the number is corrected, then commits', () => {
    const ctx = fakeCtx(); const host = manualStep(ctx);
    const begin = host.querySelector('[data-action="manual-begin"]') as HTMLButtonElement;
    type(host, 'sens', '0');
    begin.click();
    expect(begin.getAttribute('aria-disabled')).toBe('true');
    type(host, 'sens', '0.5');
    expect(host.querySelector('[data-error]')!.textContent).toBe('');
    expect(begin.getAttribute('aria-disabled')).toBe('false');
    begin.click();
    expect(ctx.nav).toEqual(['session']);
  });
});

describe('setup: remembered calibration', () => {
  it('offers the saved fast path as PRIMARY when the stored bounds are usable', () => {
    const ctx = rememberingCtx(PREFS); const host = document.createElement('div');
    setup(host, ctx).mount();
    const useSaved = host.querySelector('[data-action="use-saved"]') as HTMLButtonElement;
    expect(useSaved).toBeTruthy();
    expect(useSaved.className).toContain('action--primary');
    expect(host.querySelector('[data-remembered]')!.textContent).toContain('5,000');
    expect(host.querySelector('[data-action="start-guided"]')!.className).toContain('action--ghost');
  });

  it('shows NO fast path on a first visit', () => {
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    expect(host.querySelector('[data-action="use-saved"]')).toBeNull();
    expect(host.querySelector('[data-action="start-guided"]')!.className).toContain('action--primary');
  });

  it('hides the fast path when the stored bounds are malformed', () => {
    // A poisoned pref must not hand the optimizer an empty or inverted window on every visit.
    const ctx = rememberingCtx({ ...PREFS, bounds: [counts360(0), counts360(0)] });
    const host = document.createElement('div');
    setup(host, ctx).mount();
    expect(host.querySelector('[data-action="use-saved"]')).toBeNull();
  });

  it('use-saved re-applies the remembered prefs, resets the pin, and goes straight to the hunt', () => {
    const ctx = rememberingCtx(PREFS); const host = document.createElement('div');
    ctx.draft.currentSens = 9; // a drifted draft must not leak into the session
    ctx.draft.kPin = { pinned: true, k: 2, source: 'lattice', logSd: 0 }; // a stale pin must not either
    setup(host, ctx).mount();
    (host.querySelector('[data-action="use-saved"]') as HTMLButtonElement).click();
    expect(ctx.draft.currentGame).toBe('valorant');
    expect(ctx.draft.currentSens).toBe(0.4);
    expect(ctx.draft.bounds).toEqual([5000, 14000]);
    expect(ctx.draft.profile.speedAccuracy).toBe(0.7);
    // The pin is measured against one turn on one browser and is never persisted, so the fast
    // path cannot carry one: it resets to the honest refusal.
    expect(ctx.draft.kPin).toEqual({ pinned: false, reason: 'gate-closed' });
    expect(ctx.draft.turn).toBeUndefined();
    expect(ctx.nav).toEqual(['session']);
  });
});

describe('setup: voice', () => {
  it.each(['intro', 'offer', 'manual'] as const)('the %s step: one h1, sentence case, no "+", no we, no lowercase i', (step) => {
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    if (step === 'offer') (host.querySelector('[data-action="start-guided"]') as HTMLButtonElement).click();
    if (step === 'manual') (host.querySelector('[data-action="start-manual"]') as HTMLButtonElement).click();
    const h1s = host.querySelectorAll('h1');
    expect(h1s.length).toBe(1);
    expect(host.querySelector('h2')).toBeNull();
    expect(h1s[0]!.textContent!.startsWith('+')).toBe(false);
    expect(h1s[0]!.textContent!).toMatch(/^[A-Z]/);
    expect(host.textContent!).not.toMatch(/\bwe\b|\bwe'll\b|\bus\b/i);
    expect(host.textContent!).not.toMatch(/\bi\b/); // case-sensitive
  });

  it('the intro offers a way back out of the flow', () => {
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    (host.querySelector('[data-action="to-hero"]') as HTMLButtonElement).click();
    expect(ctx.nav).toEqual(['hero']);
  });
});
