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
type SweepOpts = Parameters<typeof import('../../src/ui/calibrate/sweep-view').createSweepView>[1];

/** A card reading that puts the fixture turn (8,000 counts) at 25.4 cm per 360: comfortably inside
 *  the human band, so the plausibility flag stays out of the way of every test not about it. */
const DPI = 800;

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

interface Captured {
  deps: SetupDeps;
  turn: () => TurnOpts;
  sweep: () => SweepOpts;
  mounts: () => number;
  sweeps: () => number;
}

function captureTurn(): Captured {
  let turnOpts: TurnOpts | null = null;
  let sweepOpts: SweepOpts | null = null;
  let n = 0, s = 0;
  const deps: SetupDeps = {
    createSweepView: ((_h: HTMLElement, o: SweepOpts) => {
      sweepOpts = o; s += 1; return { dispose() {} };
    }) as SetupDeps['createSweepView'],
    createTurnView: ((_h: HTMLElement, o: TurnOpts) => {
      turnOpts = o; n += 1; return { dispose() {} };
    }) as SetupDeps['createTurnView'],
  };
  return { deps, turn: () => turnOpts!, sweep: () => sweepOpts!, mounts: () => n, sweeps: () => s };
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

/** Walk the guided path to a mounted turn view: intro -> card -> offer -> (accept | skip) -> turn.
 *  The offer opens with BOTH halves empty, so accepting means filling both: no test may lean on a
 *  prefill, because there is none to lean on. */
function startTurn(
  host: HTMLElement,
  accept?: { game: string; sens: string },
  cap?: Captured,
  dpi = DPI,
): void {
  (host.querySelector('[data-action="start-guided"]') as HTMLButtonElement).click();
  cap?.sweep().onResult({ dpi, accelerated: false });
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

describe('setup: the guided flow (the card, the offer, then the blind turn)', () => {
  it('offers the guided path and the typed fork, and previews two measured steps', () => {
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    expect(host.querySelector('[data-action="start-guided"]')).toBeTruthy();
    expect(host.querySelector('[data-action="start-manual"]')).toBeTruthy();
    // Two measured steps now, the card and the turn; the offer is a question, not a step.
    expect(host.querySelectorAll('.cal-preview li').length).toBe(2);
    expect(host.textContent!.toLowerCase()).toContain('card');
  });

  it('start-guided goes to the card first, and only then to the offer', () => {
    // The order is the argument. The card is the one reading taken against a physical standard, and
    // it is over in seconds, so it comes before the ask that needs the player to remember a number.
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    (host.querySelector('[data-action="start-guided"]') as HTMLButtonElement).click();
    expect(cap.sweeps()).toBe(1);
    expect(cap.mounts()).toBe(0);
    // The standard the player is being held to is named at the call site, not reached for inside
    // the view: 85.60 mm, the ISO/IEC 7810 ID-1 long edge.
    expect(cap.sweep().referenceWidthCm).toBeCloseTo(8.56, 6);
    cap.sweep().onResult({ dpi: DPI, accelerated: false });
    expect(host.querySelector('h1')!.textContent).toBe('Name your game, if you like');
    expect(host.querySelector('[data-action="offer-accept"]')).toBeTruthy();
    expect(host.querySelector('[data-action="offer-skip"]')).toBeTruthy();
    expect(host.textContent).toContain('Skipping costs the per-game table, not the result.');
  });

  it('a sweep that saw acceleration is a refusal, not a reading', () => {
    // An accelerated sweep has no single counts-per-inch to commit: the same stretch of desk counts
    // differently depending on how fast it was crossed. Committing one anyway would hand the
    // plausibility check a number that is wrong by however hard the player swiped.
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    (host.querySelector('[data-action="start-guided"]') as HTMLButtonElement).click();
    cap.sweep().onResult({ dpi: DPI, accelerated: true });
    expect(host.querySelector('h1')!.textContent).toBe('Mouse acceleration is on');
    expect(cap.mounts()).toBe(0);
  });

  it('a sweep that did not measure cleanly names the spread and retries the card, not the turn', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    (host.querySelector('[data-action="start-guided"]') as HTMLButtonElement).click();
    cap.sweep().onBlocked('invalid', 14.2);
    expect(host.querySelector('h1')!.textContent).toBe('That sweep did not measure cleanly');
    const spread = host.querySelector('[data-blocked="spread"]')!;
    expect(spread.textContent).toBe('14.2');
    expect(spread.className).toContain('mono');
    (host.querySelector('[data-action="retry"]') as HTMLButtonElement).click();
    expect(cap.sweeps()).toBe(2); // back to the card, and the turn was never reached
    expect(cap.mounts()).toBe(0);
  });

  it('starts on no answer at all, so an ignored offer cannot be read as one', () => {
    // The anchoring defect that killed the spin dial, in a new costume. The spin prefilled a dial
    // and then measured the constant it had prefilled; an offer prefilled from defaultDraft()
    // ('cs2', 1) would let a player who clicks straight past it pin k off a pair nobody typed, and
    // k would then be wrong by the ratio of two yaws with nothing on the screen to show it. Empty
    // is the only value that means "no answer": storage cannot say whether a remembered
    // currentSens was typed or defaulted, so it never prefills this either.
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    (host.querySelector('[data-action="start-guided"]') as HTMLButtonElement).click();
    cap.sweep().onResult({ dpi: DPI, accelerated: false });
    expect((host.querySelector('[data-field="game"]') as HTMLSelectElement).value).toBe('');
    expect((host.querySelector('[data-field="sens"]') as HTMLInputElement).value).toBe('');
  });

  it('a half-filled offer refuses and names the missing half', () => {
    // Half an offer is the one state that must not reach the turn: a sensitivity with no game is
    // not a pair, and silently dropping a number the player took the trouble to type is worse than
    // refusing it by name.
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host, { game: '', sens: '2' }, cap);
    expect(cap.mounts()).toBe(0); // the turn never started
    const err = host.querySelector('[data-error]')!;
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.textContent!.toLowerCase()).toContain('game');
    expect(ctx.draft.currentSens).toBe(1); // and nothing reached the draft
  });

  it('skipping the offer mounts the blind turn without touching the draft', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host, undefined, cap);
    expect(cap.turn()).toBeTruthy();
    expect(ctx.draft.currentSens).toBe(1); // a skip records nothing
  });

  it('accepting the offer records the pair on the draft, then mounts the turn', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host, { game: 'cs2', sens: '2' }, cap);
    expect(ctx.draft.currentSens).toBe(2);
    expect(cap.mounts()).toBe(1);
  });

  it('an unusable offered sensitivity refuses with a named alert and does not advance', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host, { game: 'cs2', sens: '0' }, cap);
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
    startTurn(host, undefined, cap);
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
    startTurn(host, undefined, cap);
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
    startTurn(host, { game: 'cs2', sens: '2' }, cap);
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
    startTurn(host, undefined, cap);
    cap.turn().onTurn(EST, SCALED);
    (host.querySelector('[data-action="turn-continue"]') as HTMLButtonElement).click();
    expect(ctx.draft.kPin).toEqual({ pinned: true, k: 2, source: 'lattice', logSd: 0 });
    expect(ctx.draft.convention).toEqual(SCALED);
  });

  it('the typed pair outranks the lattice when both exist', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host, { game: 'cs2', sens: '2' }, cap);
    cap.turn().onTurn(EST, SCALED);
    (host.querySelector('[data-action="turn-continue"]') as HTMLButtonElement).click();
    const pin = ctx.draft.kPin!;
    expect(pin.pinned && pin.source).toBe('typed-sens');
  });

  it('redo discards the pending estimate and remounts the turn, committing nothing', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host, undefined, cap);
    cap.turn().onTurn(EST, SCALED);
    (host.querySelector('[data-action="redo-turn"]') as HTMLButtonElement).click();
    expect(cap.mounts()).toBe(2);
    expect(ctx.draft.turn).toBeUndefined();
    expect(ctx.nav).toEqual([]);
  });

  it('an accel refusal shows the acceleration screen, and retry remounts the turn', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host, undefined, cap);
    cap.turn().onBlocked('accel', null);
    expect(host.querySelectorAll('h1').length).toBe(1);
    expect(host.querySelector('h1')!.textContent).toBe('Mouse acceleration is on');
    (host.querySelector('[data-action="retry"]') as HTMLButtonElement).click();
    expect(cap.mounts()).toBe(2);
  });

  it('a spread refusal names the measured spread and the fourth pass', () => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host, undefined, cap);
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
    startTurn(host, undefined, cap);
    cap.turn().onBack();
    expect(host.querySelector('[data-action="start-guided"]')).toBeTruthy();
    startTurn(host, undefined, cap);
    cap.turn().onManual();
    expect(host.querySelector('[data-action="manual-begin"]')).toBeTruthy();
    expect(ctx.nav).toEqual([]);
  });
});

describe('setup: the card checks the turn', () => {
  /** Walk to the report with a card reading of `dpi` behind it. */
  function report(dpi: number): { host: HTMLElement; ctx: ReturnType<typeof fakeCtx>; cap: Captured } {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host, undefined, cap, dpi);
    cap.turn().onTurn(EST, null);
    return { host, ctx, cap };
  }

  it('states the turn as a distance, in tabular figures, and claims no more than a sanity check', () => {
    // 8,000 counts at 800 counts per inch is 25.4 cm for a full circle. This is the payoff the card
    // was restored for: a number in a unit the player's own desk can confirm.
    const { host } = report(800);
    const cm = host.querySelector('[data-check="cm"]')!;
    expect(cm.textContent).toBe('25.4');
    expect(cm.className).toContain('mono');
    expect(host.querySelector('[data-check="human"]')).toBeTruthy();
    expect(host.querySelector('[data-check="flag"]')).toBeNull();
    expect(host.textContent).toContain('sanity check, not a second measurement');
  });

  it('flags a turn the card puts outside the human band, and changes nothing', () => {
    // 8,000 counts at 3,200 counts per inch is 6.35 cm for a full circle, which no hand does. One
    // of the two readings is wrong and the screen says so without deciding which.
    const { host, ctx } = report(3200);
    const flag = host.querySelector('[data-check="flag"]')!;
    expect(flag.textContent).toContain('Worth a second look.');
    expect(host.querySelector('[data-check="cm"]')!.textContent).toBe('6.3');
    expect(flag.textContent).toContain('Nothing has been adjusted for you');
    expect(host.querySelector('[data-check="human"]')).toBeNull();
    // The anchor is untouched: the flag is a sentence, not a correction.
    expect(ctx.draft.turn).toBeUndefined();
    expect(ctx.nav).toEqual([]);
  });

  it('a flagged reading still commits when the player says so: it is their call, not the tool\'s', () => {
    const { host, ctx } = report(3200);
    (host.querySelector('[data-action="turn-continue"]') as HTMLButtonElement).click();
    expect(ctx.draft.turn).toEqual(EST);       // committed exactly as measured, not nudged toward the band
    expect(ctx.draft.bounds).toEqual(boundsFromSeed(EST.counts));
    expect(ctx.nav).toEqual(['session']);
  });

  it('a flagged reading offers the way back to the card, which the agreed one does not', () => {
    // The card is the other suspect, and it cannot be re-swept alone: the check only holds when the
    // sweep and the turn were counted in one run on one browser. So starting over drops both.
    const { host, cap } = report(3200);
    (host.querySelector('[data-action="start-over"]') as HTMLButtonElement).click();
    expect(cap.sweeps()).toBe(2);
    expect(host.querySelector('[data-check="flag"]')).toBeNull();
    expect(report(800).host.querySelector('[data-action="start-over"]')).toBeNull();
  });

  it('says nothing at all when no card was measured', () => {
    // The sweep can be skipped, refused or denied its pointer lock. An absent check must render as
    // absent: reassurance manufactured from a check that never ran is the failure this screen exists
    // to avoid.
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    (host.querySelector('[data-action="start-guided"]') as HTMLButtonElement).click();
    cap.sweep().onManual();
    (host.querySelector('[data-action="back"]') as HTMLButtonElement).click();
    (host.querySelector('[data-action="start-guided"]') as HTMLButtonElement).click();
    cap.sweep().onBlocked('invalid', 21);
    (host.querySelector('[data-action="retry"]') as HTMLButtonElement).click();
    cap.sweep().onResult({ dpi: Number.NaN, accelerated: false }); // a reading that is not a number
    (host.querySelector('[data-action="offer-skip"]') as HTMLButtonElement).click();
    cap.turn().onTurn(EST, null);
    expect(host.querySelector('[data-check="human"]')).toBeNull();
    expect(host.querySelector('[data-check="flag"]')).toBeNull();
    expect(host.querySelector('[data-done="spread"]')).toBeTruthy(); // the turn still reports itself
  });
});

describe('setup: the card reading on the draft and on disk', () => {
  it('commits the reading with the run, and remembers it', () => {
    const cap = captureTurn(); const ctx = rememberingCtx(null); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    startTurn(host, undefined, cap);
    cap.turn().onTurn(EST, null);
    (host.querySelector('[data-action="turn-continue"]') as HTMLButtonElement).click();
    expect(ctx.draft.dpi).toBe(DPI);
    expect(ctx.savedPrefs()!.dpi).toBe(DPI);
    // And it seeds nothing: the search window comes from the turn's counts, as it did without a card.
    expect(ctx.draft.bounds).toEqual(boundsFromSeed(EST.counts));
  });

  it('a run without a card leaves no reading, on the draft or on disk', () => {
    const cap = captureTurn(); const ctx = rememberingCtx({ ...PREFS, dpi: 1600 });
    const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    (host.querySelector('[data-action="start-guided"]') as HTMLButtonElement).click();
    cap.sweep().onResult({ dpi: Number.NaN, accelerated: false });
    (host.querySelector('[data-action="offer-skip"]') as HTMLButtonElement).click();
    cap.turn().onTurn(EST, null);
    (host.querySelector('[data-action="turn-continue"]') as HTMLButtonElement).click();
    // The previous visit's reading does not survive a run that measured none: leaving it in place
    // would attach an old card to a new turn, and those two never shared a browser.
    expect(ctx.draft.dpi).toBeUndefined();
    expect(ctx.savedPrefs()!.dpi).toBeUndefined();
  });

  it('a typed commit clears the reading with the rest of the guided run', () => {
    const ctx = rememberingCtx({ ...PREFS, dpi: 1600 }); const host = document.createElement('div');
    ctx.draft.dpi = 1600;
    setup(host, ctx).mount();
    (host.querySelector('[data-action="start-manual"]') as HTMLButtonElement).click();
    const sens = host.querySelector('[data-field="sens"]') as HTMLInputElement;
    sens.value = '0.5'; sens.dispatchEvent(new Event('input', { bubbles: true }));
    (host.querySelector('[data-action="manual-begin"]') as HTMLButtonElement).click();
    expect(ctx.draft.dpi).toBeUndefined();
    expect(ctx.savedPrefs()!.dpi).toBeUndefined();
  });

  it('the saved fast path carries the remembered reading, and drops it when there is none', () => {
    const withCard = rememberingCtx({ ...PREFS, dpi: 1600 });
    const host = document.createElement('div');
    setup(host, withCard).mount();
    (host.querySelector('[data-action="use-saved"]') as HTMLButtonElement).click();
    expect(withCard.draft.dpi).toBe(1600);

    const without = rememberingCtx(PREFS); const host2 = document.createElement('div');
    without.draft.dpi = 999; // a drifted draft from earlier this visit
    setup(host2, without).mount();
    (host2.querySelector('[data-action="use-saved"]') as HTMLButtonElement).click();
    expect(without.draft.dpi).toBeUndefined();
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
  it.each(['intro', 'card', 'offer', 'turn-done', 'manual'] as const)('the %s step: one h1, sentence case, no "+", no we, no lowercase i', (step) => {
    const cap = captureTurn(); const ctx = fakeCtx(); const host = document.createElement('div');
    // The card step mounts the REAL sweep view, so its copy is held to the same voice as the
    // screens around it rather than exempted for living in another file.
    setup(host, ctx, step === 'card' ? undefined : cap.deps).mount();
    if (step === 'card') (host.querySelector('[data-action="start-guided"]') as HTMLButtonElement).click();
    if (step === 'offer' || step === 'turn-done') {
      (host.querySelector('[data-action="start-guided"]') as HTMLButtonElement).click();
      cap.sweep().onResult({ dpi: DPI, accelerated: false });
    }
    if (step === 'turn-done') {
      (host.querySelector('[data-action="offer-skip"]') as HTMLButtonElement).click();
      cap.turn().onTurn(EST, null);
    }
    if (step === 'manual') (host.querySelector('[data-action="start-manual"]') as HTMLButtonElement).click();
    const h1s = host.querySelectorAll('h1');
    expect(h1s.length).toBe(1);
    expect(host.querySelector('h2')).toBeNull();
    expect(h1s[0]!.textContent!.startsWith('+')).toBe(false);
    expect(h1s[0]!.textContent!).toMatch(/^[A-Z]/);
    expect(host.textContent!).not.toMatch(/\bwe\b|\bwe'll\b|\bus\b/i);
    expect(host.textContent!).not.toMatch(/\bi\b/); // case-sensitive
  });

  it('the card step names what it is reading, and refuses to call it the mouse\'s own number', () => {
    // Rule of the restoration: the sweep runs on raw browser counts, so it measures the mouse's
    // setting times a browser scaling nobody pinned. The screen may not present that as the number
    // printed on the mouse, and the copy has to say why it does not need to be.
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    (host.querySelector('[data-action="start-guided"]') as HTMLButtonElement).click();
    const text = host.textContent!;
    expect(text).toContain('85.60 mm');
    expect(text).toContain('cancels');
    expect(text.toLowerCase()).toContain('does not have to match the number on your mouse');
  });

  it('the intro offers a way back out of the flow', () => {
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    (host.querySelector('[data-action="to-hero"]') as HTMLButtonElement).click();
    expect(ctx.nav).toEqual(['hero']);
  });
});
