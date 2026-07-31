// Guided calibration orchestrator. Pure step machine (calibrate-flow) under a thin shell that
// mounts the card sweep and the blind turn and writes the session draft. The guided path is the
// card, then the offer (name your game and sensitivity, or skip), then the turn, then the report,
// then the commit, which is the single place k is pinned: the typed pair needs the arena's own
// count for the SAME turn, so the offer rides alongside the turn and never replaces it.
//
// The card is back and the centimetre is not the unit again. Counts per 360 remains the only thing
// measured, searched and reported; what the card adds is one number measured against a physical
// standard, which is the only way anything in this browser can be checked against the world outside
// it. Its whole job on this screen is the report at the end of the turn: a distance the player can
// recognize, and a flag when that distance is not one a hand makes.
import { rememberPrefs, type AppContext, type Screen } from './shell';
import type { Dpi, GameId } from '../types';
import { GAME_YAW, yawFor } from '../convert/yaw-table';
import { countsForSens } from '../convert/counts';
import { boundsFromSeed } from './options/settings';
import { pinConvention, type TypedSensRoute } from '../input/count-convention';
import type { Convention } from '../input/lattice';
import { calibrateReducer, initialCalState, type CalState } from './calibrate-flow';
import { createTurnView, type TurnView } from './calibrate/turn-view';
import { createSweepView, type SweepView } from './calibrate/sweep-view';
import { CARD_WIDTH_CM } from '../input/dpi-sweep';
import { isValidDpi } from '../input/dpi';
import {
  turnPlausibility, HUMAN_MIN_CM360, HUMAN_MAX_CM360, type TurnPlausibility,
} from '../anchor/plausibility';
import type { TurnEstimate } from '../anchor/reference-turn';

/**
 * What the card has to say about the turn, as one block of copy. Exported pure so the sentences can
 * be pinned without a pointer lock, and written here rather than inside the plausibility module so
 * that module stays a measurement with no opinions.
 *
 * Three shapes, and the differences between them are the point. An unmeasured verdict says nothing
 * at all: the sweep was skipped or refused, and inventing reassurance out of a check that never ran
 * is the failure mode this whole screen is built against. A human verdict is stated as "not absurd"
 * and never as "confirmed", because a band 5.3 times wide cannot confirm anything. A flag names the
 * distance, names both suspects, and says plainly that nothing was changed: the number the player
 * carries forward is theirs to accept, and an instrument that quietly rescaled the turn to fit the
 * band would be the retired spin with better manners.
 */
export function cardCheckHtml(p: TurnPlausibility): string {
  if (p.verdict === 'unmeasured') return '';
  const cm = `<span class="mono" data-check="cm">${p.cm360.toFixed(1)}</span>`;
  if (p.verdict === 'human') {
    return `<p class="cal-method" data-check="human">Against the card, that turn is ${cm} cm of desk for one full circle, which is inside the range hands work in. That is a sanity check, not a second measurement: it can say a reading is not absurd, and no more.</p>`;
  }
  const edge = p.verdict === 'short'
    ? `shorter than <span class="mono">${HUMAN_MIN_CM360}</span> cm, and a full turn that short is faster than hands are usually set`
    : `longer than <span class="mono">${HUMAN_MAX_CM360}</span> cm, and a full turn that long is slower than hands are usually set`;
  return `<div class="cal-helper" data-check="flag"><span><b>Worth a second look.</b> Against the card, that turn is ${cm} cm of desk for one full circle. That is ${edge}. One of the two readings is probably off: the card sweep may have stopped short of an edge, or a turn may have been cut. Nothing has been adjusted for you, and the choice is yours.</span></div>`;
}

/** Thin-shell injection seam (mirrors sessionView's SessionViewDeps): production mounts the real
 *  pointer-locked views, but a jsdom test can swap in fakes to drive the sweep to onTurn to
 *  commitGuided chain without a pointer lock. */
export interface SetupDeps {
  createSweepView: typeof createSweepView;
  createTurnView: typeof createTurnView;
}
const DEFAULT_SETUP_DEPS: SetupDeps = { createSweepView, createTurnView };

export function setup(host: HTMLElement, ctx: AppContext, deps: SetupDeps = DEFAULT_SETUP_DEPS): Screen {
  const { createSweepView, createTurnView } = deps;
  let state: CalState = initialCalState();
  let view: SweepView | TurnView | null = null;
  /** The turn awaiting the player's continue on the report. Outside the reducer on purpose: the
   *  reducer carries no measurement state. */
  let pending: { estimate: TurnEstimate; convention: Convention | null } | null = null;
  /**
   * The card reading from THIS run, held here for the same reason the estimate is: nothing commits
   * until the player accepts the report.
   *
   * It is also the only DPI the plausibility check is allowed to see, and that is load-bearing.
   * The check works because the sweep and the turn counted through the same browser, so the count
   * convention k they both carry cancels in the division. A DPI restored from storage was measured
   * on some other visit and possibly some other browser, where k was different, and dividing this
   * run's counts by it would produce a confident wrong distance and a flag nobody could explain.
   * Same reason the count convention pin is never persisted (SessionDraft.kPin).
   */
  let sweptDpi: Dpi | null = null;
  /** The measured spread behind a refusal, for the blocked screen to name: the turn's pass spread
   *  on 'spread', the card's pass spread on 'invalid', null when the reason carries no number. */
  let blockedSpread: number | null = null;

  function dispatch(a: Parameters<typeof calibrateReducer>[1]): void {
    state = calibrateReducer(state, a);
    render();
  }

  function teardownView(): void { view?.dispose(); view = null; }

  /** Read per mount rather than captured at module load: a visitor can turn the preference on
   *  mid-session, and matchMedia is absent in jsdom, where the honest answer is "no preference". */
  function prefersReducedMotion(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

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
    // The card reading, recorded rather than used: it seeds nothing and scales nothing, and the
    // search runs in counts whether it is here or not. A run where the sweep was skipped or refused
    // carries none, which is why it is deleted rather than written as zero.
    if (sweptDpi !== null) ctx.draft.dpi = sweptDpi; else delete ctx.draft.dpi;
    // rememberPrefs persists game, sens, goal, bounds and that reading. The pin, the turn and the
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
  // estimator never ran) and the typed numbers seed the search window only. The card does NOT get a
  // field here: a typed DPI is a number off a driver page, not a measurement, and the sweep exists
  // precisely because the label and the reading disagree often enough to matter.
  function commitManual(sens: number, game: GameId, goal: number): boolean {
    if (!(Number.isFinite(sens) && sens > 0)) return false;
    ctx.draft.currentSens = sens;
    ctx.draft.currentGame = game;
    ctx.draft.profile = { ...ctx.draft.profile, speedAccuracy: goal };
    ctx.draft.bounds = boundsFromSeed(countsForSens(sens, yawFor(game)));
    // A typed commit replaces any earlier guided run wholesale: the stale turn, its convention, its
    // pin and its card reading are all cleared, because phase 4 must never weigh a turn the player
    // chose to type over, and a reading kept past the run it was taken in is a number waiting to be
    // divided into counts it never shared a browser with (pinned in tests/ui/setup.test.ts).
    delete ctx.draft.turn;
    delete ctx.draft.convention;
    delete ctx.draft.dpi;
    sweptDpi = null;
    ctx.draft.kPin = pinConvention(null, null);
    rememberPrefs(ctx);
    ctx.navigate('session');
    return true;
  }

  function render(): void {
    teardownView();
    host.replaceChildren();

    if (state.step === 'sweep') {
      view = createSweepView(host, {
        // The standard is named at the call site rather than reached for inside the view, so the
        // width the player is being held to is visible from the flow that holds them to it.
        referenceWidthCm: CARD_WIDTH_CM,
        reducedMotion: prefersReducedMotion(),
        onResult: (r) => {
          // A sweep that saw acceleration is a refusal, not a reading: OS scaling makes the counts
          // per inch depend on how fast the hand moved, so there is no single number to commit.
          if (r.accelerated) { sweptDpi = null; blockedSpread = null; dispatch({ type: 'sweep-blocked', reason: 'accel' }); return; }
          // Validated at the boundary rather than trusted from the view, the same way the typed
          // route validates its sensitivity here: a NaN or out-of-band reading that reached the
          // draft would persist to localStorage and come back on every later visit, and it would
          // divide into the turn's counts to produce a distance and a flag out of nothing.
          sweptDpi = isValidDpi(r.dpi) ? r.dpi : null;
          dispatch({ type: 'sweep-complete' });
        },
        onBlocked: (reason, spreadPct) => {
          sweptDpi = null; // a refused sweep leaves no reading behind to check the turn against
          blockedSpread = spreadPct;
          dispatch({ type: 'sweep-blocked', reason });
        },
        onManual: () => dispatch({ type: 'start-manual' }),
        onBack: () => dispatch({ type: 'back-to-intro' }),
      });
      return;
    }

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
        <p class="setup__lead">Nothing to look up. One card off your desk, then three blind turns read the turn distance your hands already know.</p>
        <ol class="cal-preview">
          <li><span class="cal-preview__n">1</span><span>The card. Slide your mouse across a bank card, twice. Its width is fixed by standard, so it is a ruler.</span></li>
          <li><span class="cal-preview__n">2</span><span>The turn. Turn all the way around by feel, three times: right, left, right.</span></li>
        </ol>
        <button class="action ${remembered ? 'action--ghost' : 'action--primary'}" data-action="start-guided">${remembered ? 'Recalibrate' : 'Start with the card'}</button>
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
      const check = turnPlausibility(pending.estimate.counts, sweptDpi ?? Number.NaN);
      const flagged = check.verdict === 'short' || check.verdict === 'long';
      return `
      <div class="wrap stack setup__inner">
        <h1 class="display setup__title">Your turns agree</h1>
        <p class="gate__lead">Your three turns landed within <span class="mono" data-done="spread">${pending.estimate.spreadPct.toFixed(1)}</span> percent of each other. That agreement is the whole measurement: no meter told your hands where to stop.</p>
        ${cardCheckHtml(check)}
        <button class="action action--primary" data-action="turn-continue">${flagged ? 'Keep this reading anyway' : 'Keep going'}</button>
        <button class="action action--ghost" data-action="redo-turn">Redo the turn</button>
        ${flagged ? '<button class="action action--ghost" data-action="start-over">Start over from the card</button>' : ''}
      </div>`;
    }
    if (state.step === 'blocked') {
      // Three refusals share this screen, and each names its own cause. 'accel' arrives from either
      // instrument's quick pass, which is why the retry is routed by where it happened rather than
      // by the reason (calibrate-flow's blockedAt), and why this copy speaks of a distance in
      // general rather than of the turn.
      const blocked = state.blockReason === 'accel'
        ? `<h1 class="display setup__title">Mouse acceleration is on</h1>
           <p class="gate__lead">Your mouse speeds up the faster you move, which makes any one true distance impossible to pin down: the same stretch of desk counts differently depending on how quickly you crossed it.</p>
           <p>Turn off "enhance pointer precision" (Windows) or your mouse driver's acceleration, then try again.</p>`
        : state.blockReason === 'invalid'
          ? `<h1 class="display setup__title">That sweep did not measure cleanly</h1>
             <p class="gate__lead">${blockedSpread !== null && blockedSpread > 0
               ? `Your two passes came out <span class="mono" data-blocked="spread">${blockedSpread.toFixed(1)}</span> percent apart, too far to average into one reading.`
               : 'The reading that came out is not one a mouse produces, so it was refused rather than committed.'}</p>
             <p>Almost always this is a pass that began or ended short of an edge. Start on the very edge of the card, slide flat and slow, and click at the far edge.</p>`
          : `<h1 class="display setup__title">Those turns never settled</h1>
             <p class="gate__lead">${blockedSpread !== null
               ? `Even with a fourth pass, your turns landed <span class="mono" data-blocked="spread">${blockedSpread.toFixed(1)}</span> percent apart, too far for one honest number.`
               : 'Even with a fourth pass, your turns landed too far apart for one honest number.'}</p>
             <p>A steadier ritual helps: same start posture, a full circle each time, the same finishing click. Or type your numbers below.</p>`;
      return `
      <div class="wrap stack gate__inner">
        ${blocked}
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
    // 'sweep' and 'turn' return early in render(). 'turn-done' with no pending estimate is
    // unreachable: only onTurn dispatches turn-complete, and it sets pending first.
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
      // The remembered card reading rides along as a RECORD of what was measured, and the fast path
      // is safe ground for it precisely because it runs no turn: there are no counts on this route
      // for it to be divided into. Absent in the stored blob (an older visit, or a run that skipped
      // the card) it is deleted rather than left at whatever this visit's draft held.
      if (p.dpi !== undefined) ctx.draft.dpi = p.dpi; else delete ctx.draft.dpi;
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
    // The card is the other suspect behind a flagged reading, and it cannot be re-swept on its own:
    // the check compares a sweep and a turn measured in one run on one browser, so replacing half
    // the pair would compare across two. Starting over is therefore the honest offer, and it drops
    // both readings rather than keeping the one that might be the wrong one.
    click('start-over', () => { pending = null; sweptDpi = null; blockedSpread = null; dispatch({ type: 'start-guided' }); });
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
