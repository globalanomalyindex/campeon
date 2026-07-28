// Guided calibration orchestrator. Pure step machine (calibrate-flow) under a thin shell that
// mounts the blind turn view and writes the session draft. The guided path is the offer (name
// your game and sensitivity, or skip), then the turn, then the spread report, then the commit,
// which is the single place k is pinned: the typed pair needs the arena's own count for the SAME
// turn, so the offer rides alongside the turn and never replaces it. Nothing here carries a
// physical unit: the card, the DPI field and the cm vocabulary left with the sweep (spec
// 2026-07-25, "deleting the measurement, not replacing the card").
import { rememberPrefs, type AppContext, type Screen } from './shell';
import type { GameId } from '../types';
import { GAME_YAW, yawFor } from '../convert/yaw-table';
import { countsForSens } from '../convert/counts';
import { boundsFromSeed } from './options/settings';
import { pinConvention, type TypedSensRoute } from '../input/count-convention';
import type { Convention } from '../input/lattice';
import { calibrateReducer, initialCalState, type CalState } from './calibrate-flow';
import { createTurnView, type TurnView } from './calibrate/turn-view';
import type { TurnEstimate } from '../anchor/reference-turn';

/** Thin-shell injection seam (mirrors sessionView's SessionViewDeps): production mounts the real
 *  pointer-locked turn view, but a jsdom test can swap in a fake to drive the onTurn to
 *  commitGuided chain without a pointer lock. */
export interface SetupDeps { createTurnView: typeof createTurnView; }
const DEFAULT_SETUP_DEPS: SetupDeps = { createTurnView };

export function setup(host: HTMLElement, ctx: AppContext, deps: SetupDeps = DEFAULT_SETUP_DEPS): Screen {
  const { createTurnView } = deps;
  let state: CalState = initialCalState();
  let view: TurnView | null = null;
  /** The turn awaiting the player's continue on the spread report. Outside the reducer on
   *  purpose: the reducer carries no measurement state. */
  let pending: { estimate: TurnEstimate; convention: Convention | null } | null = null;
  /** The measured spread behind a 'spread' block, for the blocked screen to name. */
  let blockedSpread: number | null = null;

  function dispatch(a: Parameters<typeof calibrateReducer>[1]): void {
    state = calibrateReducer(state, a);
    render();
  }

  function teardownView(): void { view?.dispose(); view = null; }

  function gameOptions(sel: GameId): string {
    return GAME_YAW.map((g) => `<option value="${g.id}"${g.id === sel ? ' selected' : ''}>${g.label}</option>`).join('');
  }

  /** The OFFER's picker, which starts on no answer at all, unlike the typed fallback's, which
   *  defaults to the draft. The difference is the whole point. The spin dial was deleted because it
   *  prefilled a number and then measured the number it had prefilled; a prefilled game beside a
   *  prefilled sensitivity is the same defect in new clothes, because k is pinned from that pair
   *  and a player who clicks past the offer would pin it against whatever `defaultDraft()` happened
   *  to hold ('cs2' and 1), wrong by the ratio of two yaws with nothing on the screen to show it.
   *  Empty is the only value that can mean "no answer", which is why a remembered `currentSens`
   *  never prefills this either: storage cannot say whether that number was typed or defaulted.
   *  Pinned by 'starts on no answer at all, so an ignored offer cannot be read as one'. */
  function offerGameOptions(): string {
    const opts = GAME_YAW.map((g) => `<option value="${g.id}">${g.label}</option>`).join('');
    return `<option value="" selected>Pick your game</option>${opts}`;
  }

  /** The guided commit, and the ONLY place k is pinned. The typed route needs both halves: the
   *  exact counts the player's own setting implies (the offer pair) and the arena's count for the
   *  same turn (the estimate). That is why the offer is collected alongside the turn rather than
   *  instead of it: skipping it costs the absolute numbers and never the ratio. */
  function commitGuided(estimate: TurnEstimate, convention: Convention | null): void {
    ctx.draft.turn = estimate; // phase 4's reconciliation reads the turn's own spread as its weight
    ctx.draft.convention = convention;
    const offered = state.offerAccepted && Number.isFinite(ctx.draft.currentSens) && ctx.draft.currentSens > 0;
    const typed: TypedSensRoute | null = offered
      ? { game: ctx.draft.currentGame, sens: ctx.draft.currentSens, arenaCounts: estimate.counts, anchorLogSd: estimate.logSd }
      : null;
    ctx.draft.kPin = pinConvention(convention, typed);
    ctx.draft.profile = { ...ctx.draft.profile, speedAccuracy: 0.5 }; // balanced default; tune later on options
    ctx.draft.bounds = boundsFromSeed(estimate.counts);
    // rememberPrefs persists game, sens, goal and bounds only. The pin, the turn and the
    // convention stay off disk on purpose: each is measured against one turn on one browser, and
    // reusing last week's pin on a new browser is the silent unit error the pin exists to prevent.
    rememberPrefs(ctx);
    ctx.navigate('session');
  }

  /** True when a stored bounds pair can seed the search. Guards the remembered fast path: a
   *  malformed pair would hand the optimizer an empty or inverted window on every later visit. */
  function usableBounds(b: readonly [number, number]): boolean {
    return Number.isFinite(b[0]) && Number.isFinite(b[1]) && b[0] > 0 && b[1] > b[0];
  }

  // The typed fallback: a genuine fallback, not a second pin route. Without a turn there is no
  // arena count to compare the pair against, so k stays honestly unpinned here (gate-closed: the
  // estimator never ran) and the typed numbers seed the search window only. Do not reintroduce a
  // DPI field here: the unit chain is deleted, not dormant.
  function commitManual(sens: number, game: GameId, goal: number): boolean {
    if (!(Number.isFinite(sens) && sens > 0)) return false;
    ctx.draft.currentSens = sens;
    ctx.draft.currentGame = game;
    ctx.draft.profile = { ...ctx.draft.profile, speedAccuracy: goal };
    ctx.draft.bounds = boundsFromSeed(countsForSens(sens, yawFor(game)));
    // A typed commit replaces any earlier guided run wholesale: the stale turn, its convention
    // and its pin are all cleared, because phase 4 must never weigh a turn the player chose to
    // type over (pinned in tests/ui/setup.test.ts).
    delete ctx.draft.turn;
    delete ctx.draft.convention;
    ctx.draft.kPin = pinConvention(null, null);
    rememberPrefs(ctx);
    ctx.navigate('session');
    return true;
  }

  function render(): void {
    teardownView();
    host.replaceChildren();

    if (state.step === 'turn') {
      view = createTurnView(host, {
        onTurn: (estimate, convention) => {
          pending = { estimate, convention };
          dispatch({ type: 'turn-complete' }); // the spread report comes BEFORE the commit
        },
        onBlocked: (reason, spreadPct) => {
          blockedSpread = spreadPct;
          dispatch({ type: 'turn-blocked', reason });
        },
        onManual: () => dispatch({ type: 'start-manual' }),
        onBack: () => dispatch({ type: 'back-to-intro' }),
      });
      return;
    }

    const root = document.createElement('section');
    root.className = 'screen screen--shell fade-in'; // every calibration screen is paper chrome
    root.innerHTML = stepHtml();
    host.appendChild(root);
    wire(root);
  }

  function stepHtml(): string {
    if (state.step === 'intro') {
      // A returning visitor's fast path: their calibration was measured once and remembered
      // (campeon.prefs.v1). Recalibrating stays one click away (a new mouse or pad invalidates the
      // old turn). Malformed stored bounds are not offered: recalibrating is the only honest
      // option then.
      const stored = ctx.storage.loadPrefs?.() ?? null;
      const remembered = stored !== null && usableBounds(stored.bounds) ? stored : null;
      const rememberedBlock = remembered
        ? `<div class="setup__remembered" data-remembered>
            <p class="setup__lead">You've calibrated before. Searching <span class="mono">${Math.round(remembered.bounds[0]).toLocaleString('en-US')}</span> to <span class="mono">${Math.round(remembered.bounds[1]).toLocaleString('en-US')}</span> counts per 360.</p>
            <button class="action action--primary" data-action="use-saved">Start from your saved calibration</button>
          </div>`
        : '';
      return `
      <div class="wrap stack setup__inner">
        <h1 class="display setup__title">Calibrate</h1>
        ${rememberedBlock}
        <p class="setup__lead">Nothing to measure or look up. Name your game if you like, then three blind turns read the turn distance your hands already know.</p>
        <ol class="cal-preview">
          <li><span class="cal-preview__n">1</span><span>The turn. Turn all the way around by feel, three times: right, left, right.</span></li>
        </ol>
        <button class="action ${remembered ? 'action--ghost' : 'action--primary'}" data-action="start-guided">${remembered ? 'Recalibrate' : 'Start the turn'}</button>
        <button class="action action--ghost" data-action="start-manual">I'll type my numbers instead</button>
        <p class="setup__lead setup__manual-note mono">Typed numbers are the starting point the search works out from.</p>
        <button class="action action--ghost" data-action="to-hero">Back</button>
      </div>`;
    }
    if (state.step === 'offer') return `
      <div class="wrap stack setup__inner">
        <h1 class="display setup__title">Name your game, if you like</h1>
        <p class="setup__lead">Your game and the sensitivity you have in it right now pin the absolute numbers, because that pair says exactly how far your hand travels for one turn. Both halves or neither: half a pair measures nothing. Skip it and you still get the change to make, just not the numbers to type.</p>
        <label class="field">Current game<select data-field="game">${offerGameOptions()}</select></label>
        <label class="field">In-game sensitivity<input class="mono" type="number" min="0.01" step="0.01" data-field="sens" value="" aria-describedby="setup-error"></label>
        <p class="field__error" id="setup-error" data-error role="alert"></p>
        <button class="action action--primary" data-action="offer-accept">Use these</button>
        <button class="action action--ghost" data-action="offer-skip">Skip, I don't know it</button>
        <p class="setup__lead setup__manual-note mono">Skipping costs the per-game table, not the result.</p>
        <button class="action action--ghost" data-action="back">Back</button>
      </div>`;
    if (state.step === 'turn-done' && pending !== null) {
      // 'done' always rests on exactly three kept passes: an agreeing trio keeps all three, a
      // rescued fourth drops the outlier back to three, and everything else blocks. So "your
      // three turns" is always the truth. The spread is the payoff of the blindness: no meter
      // told the hands where to stop, and they still landed this close.
      return `
      <div class="wrap stack setup__inner">
        <h1 class="display setup__title">Your turns agree</h1>
        <p class="gate__lead">Your three turns landed within <span class="mono" data-done="spread">${pending.estimate.spreadPct.toFixed(1)}</span> percent of each other. That agreement is the whole measurement: no meter told your hands where to stop.</p>
        <button class="action action--primary" data-action="turn-continue">Keep going</button>
        <button class="action action--ghost" data-action="redo-turn">Redo the turn</button>
      </div>`;
    }
    if (state.step === 'blocked') {
      const accel = state.blockReason === 'accel';
      return `
      <div class="wrap stack gate__inner">
        ${accel
          ? `<h1 class="display setup__title">Mouse acceleration is on</h1>
             <p class="gate__lead">Your mouse speeds up the faster you move, which makes one true turn distance impossible to pin down.</p>
             <p>Turn off "enhance pointer precision" (Windows) or your mouse driver's acceleration, then try again.</p>`
          : `<h1 class="display setup__title">Those turns never settled</h1>
             <p class="gate__lead">${blockedSpread !== null
               ? `Even with a fourth pass, your turns landed <span class="mono" data-blocked="spread">${blockedSpread.toFixed(1)}</span> percent apart, too far for one honest number.`
               : 'Even with a fourth pass, your turns landed too far apart for one honest number.'}</p>
             <p>A steadier ritual helps: same start posture, a full circle each time, the same finishing click. Or type your numbers below.</p>`}
        <button class="action action--primary" data-action="retry">Try again</button>
        <button class="action action--ghost" data-action="manual">I'll type my numbers instead</button>
        <p class="setup__lead setup__manual-note mono">Typed numbers are the starting point the search works out from.</p>
        <button class="action action--ghost" data-action="back">Back</button>
      </div>`;
    }
    if (state.step === 'manual') return `
      <div class="wrap stack setup__inner">
        <h1 class="display setup__title">Your numbers</h1>
        <label class="field">Current game<select data-field="game">${gameOptions(ctx.draft.currentGame)}</select></label>
        <label class="field">In-game sensitivity<input class="mono" type="number" min="0.01" step="0.01" data-field="sens" value="${ctx.draft.currentSens}" aria-describedby="setup-error"></label>
        <label class="field">Goal, precision to speed<input type="range" min="0" max="1" step="0.01" data-field="goal" value="${ctx.draft.profile.speedAccuracy}"></label>
        <p class="field__error" id="setup-error" data-error role="alert"></p>
        <button class="action action--primary" data-action="manual-begin">Begin</button>
        <button class="action action--ghost" data-action="back">Back</button>
      </div>`;
    // 'turn' returns early in render(). 'turn-done' with no pending estimate is unreachable:
    // only onTurn dispatches turn-complete, and it sets pending first.
    return '';
  }

  function wire(root: HTMLElement): void {
    const click = (sel: string, fn: () => void): void => root.querySelector(`[data-action="${sel}"]`)?.addEventListener('click', fn);
    const val = (sel: string): string => (root.querySelector(`[data-field="${sel}"]`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
    click('start-guided', () => dispatch({ type: 'start-guided' }));
    click('use-saved', () => {
      // Re-apply the remembered prefs to the draft (the shell already merged them at boot, but a
      // mid-session edit may have drifted the draft) and go straight to the hunt.
      const p = ctx.storage.loadPrefs?.();
      if (!p || !usableBounds(p.bounds)) return; // a poisoned pref never reaches the arena
      ctx.draft.currentGame = p.currentGame;
      ctx.draft.currentSens = p.currentSens;
      ctx.draft.profile = { ...ctx.draft.profile, speedAccuracy: p.speedAccuracy };
      ctx.draft.bounds = p.bounds;
      // The stored prefs carry no turn record and never a pin (see SessionDraft.kPin): stale
      // measurement state from an earlier run on this visit must not ride along either.
      delete ctx.draft.turn;
      delete ctx.draft.convention;
      ctx.draft.kPin = pinConvention(null, null);
      ctx.navigate('session');
    });
    click('start-manual', () => dispatch({ type: 'start-manual' }));
    click('offer-skip', () => dispatch({ type: 'offer-skipped' }));
    click('turn-continue', () => { if (pending !== null) commitGuided(pending.estimate, pending.convention); });
    click('redo-turn', () => { pending = null; dispatch({ type: 'retry' }); });
    click('retry', () => { blockedSpread = null; dispatch({ type: 'retry' }); });
    click('manual', () => dispatch({ type: 'start-manual' }));
    click('back', () => dispatch({ type: 'back-to-intro' }));
    click('to-hero', () => ctx.navigate('hero'));
    wireOfferValidation(root, val);
    wireManualValidation(root, val);
  }

  /** The offer validates at the boundary, exactly as the typed fallback does: the accept button
   *  stays focusable and clickable when the answer is wrong (a disabled control explains
   *  nothing). Pressing it names the problem in a role="alert" and refuses to advance.
   *
   *  Both halves are required, and refusing half an offer is the load-bearing part. k is
   *  arenaCounts / countsForSens(sens, yawFor(game)), so a sensitivity without its game is not a
   *  measurement of anything: pairing it with a defaulted game would pin k wrong by the ratio of
   *  two yaws, and pairing a game with a defaulted sensitivity would pin it wrong by the ratio of
   *  two sensitivities. Skipping is always available and costs only the per-game table, so there
   *  is no honest reason to accept half a pair. */
  function wireOfferValidation(root: HTMLElement, val: (sel: string) => string): void {
    const accept = root.querySelector('[data-action="offer-accept"]') as HTMLButtonElement | null;
    const errEl = root.querySelector('[data-error]') as HTMLElement | null;
    if (!accept || !errEl) return;
    let attempted = false;

    const problem = (): string | null => {
      const game = val('game');
      const raw = val('sens').trim();
      if (game === '') return 'Pick the game that sensitivity is from, or skip this step.';
      if (raw === '') return 'Type the sensitivity you have in that game, or skip this step.';
      const sens = Number(raw);
      return Number.isFinite(sens) && sens > 0 ? null : 'In-game sensitivity needs to be a number above zero.';
    };
    const show = (msg: string | null): void => {
      errEl.textContent = msg ?? '';
      accept.setAttribute('aria-disabled', msg ? 'true' : 'false');
      root.querySelector('[data-field="sens"]')?.setAttribute('aria-invalid', msg ? 'true' : 'false');
    };
    root.querySelector('[data-field="sens"]')?.addEventListener('input', () => { if (attempted) show(problem()); });
    root.querySelector('[data-field="game"]')?.addEventListener('change', () => { if (attempted) show(problem()); });
    accept.addEventListener('click', () => {
      attempted = true;
      const msg = problem();
      show(msg);
      if (msg !== null) { (root.querySelector('[data-field="sens"]') as HTMLElement | null)?.focus(); return; }
      // The offer only records the pair. k is measured against the arena's own count, which does
      // not exist until the turn passes are in, so the pin happens at the commit and not here.
      ctx.draft.currentGame = val('game') as GameId;
      ctx.draft.currentSens = Number(val('sens'));
      dispatch({ type: 'offer-accepted' });
    });
  }

  /** The typed fallback validates at the boundary, same contract as the offer above. Once a first
   *  attempt has failed, typing corrects the message live, so the fix is confirmed as it is made. */
  function wireManualValidation(root: HTMLElement, val: (sel: string) => string): void {
    const begin = root.querySelector('[data-action="manual-begin"]') as HTMLButtonElement | null;
    const errEl = root.querySelector('[data-error]') as HTMLElement | null;
    if (!begin || !errEl) return;
    let attempted = false;

    const problem = (): string | null => {
      const sens = Number(val('sens'));
      return Number.isFinite(sens) && sens > 0 ? null : 'In-game sensitivity needs to be a number above zero.';
    };
    const show = (msg: string | null): void => {
      errEl.textContent = msg ?? '';
      begin.setAttribute('aria-disabled', msg ? 'true' : 'false');
      root.querySelector('[data-field="sens"]')?.setAttribute('aria-invalid', msg ? 'true' : 'false');
    };
    root.querySelector('[data-field="sens"]')?.addEventListener('input', () => { if (attempted) show(problem()); });
    begin.addEventListener('click', () => {
      attempted = true;
      const msg = problem();
      show(msg);
      if (msg !== null) { (root.querySelector('[data-field="sens"]') as HTMLElement | null)?.focus(); return; }
      commitManual(Number(val('sens')), val('game') as GameId, Number(val('goal')));
    });
  }

  return {
    mount() { render(); },
    unmount() { teardownView(); host.replaceChildren(); },
  };
}
