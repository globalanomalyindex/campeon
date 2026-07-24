// Guided calibration orchestrator. Pure step machine (calibrate-flow) under a thin shell that
// mounts the sweep + spin views and writes the session draft. The game pick is deferred to the
// result; the speed/accuracy goal defaults to balanced. Retires the typed setup + the gate.
import { rememberPrefs, type AppContext, type Screen } from './shell';
import type { GameId } from '../types';
import { GAME_YAW, yawFor } from '../convert/yaw-table';
import { cmPer360 } from '../convert/cm360';
import { boundsFromSeed } from './options/settings';
import { CARD_WIDTH_CM } from '../input/dpi-sweep';
import { isValidDpi, parseDpi, MIN_DPI, MAX_DPI } from '../input/dpi';
import { calibrateReducer, initialCalState, type CalState } from './calibrate-flow';
import { createSweepView, type SweepView } from './calibrate/sweep-view';
import { createSpinView, type SpinView } from './calibrate/spin-view';

/** Thin-shell injection seam (mirrors sessionView's SessionViewDeps): production mounts the real
 *  WebGL sweep + spin views, but a jsdom test can swap in fakes to drive the guided commit path -
 *  the sweep->spin->onSeed->commitGuided chain - without a GL context. */
export interface SetupDeps {
  createSweepView: typeof createSweepView;
  createSpinView: typeof createSpinView;
}
const DEFAULT_SETUP_DEPS: SetupDeps = { createSweepView, createSpinView };

/** The persistent 2-segment journey tracker overlaid across the sweep + spin steps. Pure markup so
 *  it is unit-testable: the active step is highlighted, an earlier finished step gets a checkmark. */
export function calibrationProgress(step: 'sweep' | 'spin'): string {
  const seg = (n: string, label: string, st: 'done' | 'active' | 'todo'): string =>
    `<span class="cal-progress__seg" data-state="${st}"><span class="cal-progress__num">${st === 'done' ? '✓' : n}</span>${label}</span>`;
  return `<div class="cal-progress" data-cal-progress>${
    seg('1', 'the sweep', step === 'sweep' ? 'active' : 'done')
  }<span class="cal-progress__arrow">→</span>${
    seg('2', 'the spin', step === 'spin' ? 'active' : 'todo')
  }</div>`;
}

export function setup(host: HTMLElement, ctx: AppContext, deps: SetupDeps = DEFAULT_SETUP_DEPS): Screen {
  const { createSweepView, createSpinView } = deps;
  let state: CalState = initialCalState();
  let view: SweepView | SpinView | null = null;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function dispatch(a: Parameters<typeof calibrateReducer>[1]): void {
    state = calibrateReducer(state, a);
    render();
  }

  function teardownView(): void { view?.dispose(); view = null; }

  function gameOptions(sel: GameId): string {
    return GAME_YAW.map((g) => `<option value="${g.id}"${g.id === sel ? ' selected' : ''}>${g.label}</option>`).join('');
  }

  function commitGuided(seedCm360: number): void {
    const dpi = state.dpi;
    if (dpi !== null) ctx.draft.dpi = dpi;
    ctx.draft.profile = { ...ctx.draft.profile, speedAccuracy: 0.5 }; // balanced default; tune later on options
    ctx.draft.bounds = boundsFromSeed(seedCm360); // the spin always supplies a seed
    rememberPrefs(ctx); // a returning visitor never redoes a calibration they already earned
    ctx.navigate('session');
  }

  /** True when this pair can safely reach the arena. A zero or negative dpi divides by zero in
   *  degreesPerCount, so the boundary is here: nothing invalid enters the draft or localStorage. */
  function usableNumbers(dpi: number, sens: number): boolean {
    return isValidDpi(dpi) && Number.isFinite(sens) && sens > 0;
  }

  /** Returns false and writes nothing when the numbers are unusable, so no caller can poison the
   *  draft (and, through rememberPrefs, every later visit) with a dpi the arena cannot use. */
  function commitManual(dpi: number, sens: number, game: GameId, goal: number): boolean {
    if (!usableNumbers(dpi, sens)) return false;
    ctx.draft.dpi = dpi;
    ctx.draft.currentSens = sens;
    ctx.draft.currentGame = game;
    ctx.draft.profile = { ...ctx.draft.profile, speedAccuracy: goal };
    ctx.draft.bounds = boundsFromSeed(cmPer360(dpi, sens, yawFor(game)));
    rememberPrefs(ctx);
    ctx.navigate('session');
    return true;
  }

  function render(): void {
    teardownView();
    host.replaceChildren();

    if (state.step === 'sweep') {
      view = createSweepView(host, { referenceWidthCm: CARD_WIDTH_CM, reducedMotion: reduced,
        onResult: (r) => dispatch({ type: 'sweep-done', dpi: r.dpi, accelerated: r.accelerated }),
        onInvalid: () => dispatch({ type: 'sweep-invalid' }),
        onLockFailed: () => dispatch({ type: 'start-manual' }),
        onManual: () => dispatch({ type: 'start-manual' }),
        onBack: () => dispatch({ type: 'back-to-intro' }) });
      host.insertAdjacentHTML('beforeend', calibrationProgress('sweep')); // fixed-position overlay tracker
      return;
    }
    if (state.step === 'spin' && state.dpi !== null) {
      const dpi = state.dpi;
      view = createSpinView(host, { dpi, reducedMotion: reduced, onSeed: (cm) => commitGuided(cm),
        onManual: () => dispatch({ type: 'start-manual' }),
        onBack: () => dispatch({ type: 'back-to-intro' }) });
      host.insertAdjacentHTML('beforeend', calibrationProgress('spin'));
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
      // A returning visitor's fast path: their calibration was hardware-measured once and remembered
      // (campeon.prefs.v1) - offer to reuse it as the search seed rather than redo the sweep+spin.
      // Recalibrating stays one click away (a new mouse or pad invalidates the old measurement).
      // A stored dpi the arena cannot use is not offered as a fast path: it would route straight to a
      // divide by zero. Recalibrating is the only honest option in that case.
      const stored = ctx.storage.loadPrefs?.() ?? null;
      const remembered = stored !== null && isValidDpi(stored.dpi) ? stored : null;
      const rememberedBlock = remembered
        ? `<div class="setup__remembered" data-remembered>
            <p class="setup__lead">you've calibrated before. <span class="mono">${remembered.dpi} dpi</span>, searching ${remembered.bounds[0]} to ${remembered.bounds[1]} cm/360.</p>
            <button class="action action--primary" data-action="use-saved">start from your saved calibration</button>
          </div>`
        : '';
      return `
      <div class="wrap stack setup__inner">
        <h2 class="display setup__title">+ calibrate</h2>
        ${rememberedBlock}
        <p class="setup__lead">two quick steps, no numbers to look up. the sweep and the spin read how your hand actually moves.</p>
        <ol class="cal-preview">
          <li><span class="cal-preview__n">1</span><span>the sweep. drag a card's width, which measures your mouse.</span></li>
          <li><span class="cal-preview__n">2</span><span>the spin. turn all the way around once.</span></li>
        </ol>
        <p class="setup__lead">first, grab any card from your wallet: bank card, gym card, hotel key. they're all exactly the same size.</p>
        ${reduced ? `<p class="setup__lead mono">reduced motion is on, so the guided steps draw their cues as still marks.</p>` : ''}
        <button class="action ${remembered ? 'action--ghost' : 'action--primary'}" data-action="start-guided">${remembered ? "recalibrate, i've got a card" : "i've got a card, start"}</button>
        <button class="action action--ghost" data-action="start-manual">i'll type my numbers instead</button>
        <p class="setup__lead setup__manual-note mono">typed numbers are the starting point the search works out from.</p>
        <button class="action action--ghost" data-action="to-hero">back</button>
      </div>`;
    }
    if (state.step === 'blocked') {
      const accel = state.blockReason === 'accel';
      return `
      <div class="wrap stack gate__inner">
        ${accel
          ? `<p class="gate__lead">looks like your mouse speeds up the faster you move. that's "mouse acceleration", and it makes one true turn distance impossible to pin down.</p>
             <p>turn off "enhance pointer precision" (windows) or your mouse driver's acceleration, then try again.</p>`
          : `<p class="gate__lead">that sweep didn't quite register, probably a little too short or uneven.</p>
             <p>line the card up, rest your mouse at its left edge, and slide smoothly all the way to the right edge.</p>`}
        <button class="action action--primary" data-action="retry">try again</button>
        <button class="action action--ghost" data-action="manual">i'll type my numbers instead</button>
        <p class="setup__lead setup__manual-note mono">typed numbers are the starting point the search works out from.</p>
        <button class="action action--ghost" data-action="back">back</button>
      </div>`;
    }
    if (state.step === 'manual') return `
      <div class="wrap stack setup__inner">
        <h2 class="display setup__title">+ your numbers</h2>
        <label class="field">mouse dpi<input class="mono" type="number" min="${MIN_DPI}" max="${MAX_DPI}" step="50" data-field="dpi" value="${ctx.draft.dpi}" aria-describedby="setup-error"></label>
        <label class="field">current game<select data-field="game">${gameOptions(ctx.draft.currentGame)}</select></label>
        <label class="field">in-game sensitivity<input class="mono" type="number" min="0.01" step="0.01" data-field="sens" value="${ctx.draft.currentSens}" aria-describedby="setup-error"></label>
        <label class="field">goal, precision to speed<input type="range" min="0" max="1" step="0.01" data-field="goal" value="${ctx.draft.profile.speedAccuracy}"></label>
        <p class="field__error" id="setup-error" data-error role="alert"></p>
        <button class="action action--primary" data-action="manual-begin">begin</button>
        <button class="action action--ghost" data-action="back">back</button>
      </div>`;
    return ''; // 'spin' returns early in render(); no other steps reach here
  }

  function wire(root: HTMLElement): void {
    const click = (sel: string, fn: () => void): void => root.querySelector(`[data-action="${sel}"]`)?.addEventListener('click', fn);
    const val = (sel: string): string => (root.querySelector(`[data-field="${sel}"]`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
    click('start-guided', () => dispatch({ type: 'start-guided' }));
    click('use-saved', () => {
      // Re-apply the remembered prefs to the draft (the shell already merged them at boot, but a
      // mid-session edit may have drifted the draft) and go straight to the hunt.
      const p = ctx.storage.loadPrefs?.();
      if (!p || !usableNumbers(p.dpi, p.currentSens)) return; // a poisoned pref never reaches the arena
      ctx.draft.dpi = p.dpi;
      ctx.draft.currentGame = p.currentGame;
      ctx.draft.currentSens = p.currentSens;
      ctx.draft.profile = { ...ctx.draft.profile, speedAccuracy: p.speedAccuracy };
      ctx.draft.bounds = p.bounds;
      ctx.navigate('session');
    });
    click('start-manual', () => dispatch({ type: 'start-manual' }));
    click('retry', () => dispatch({ type: 'retry' }));
    click('manual', () => dispatch({ type: 'start-manual' }));
    click('back', () => dispatch({ type: 'back-to-intro' }));
    click('to-hero', () => ctx.navigate('hero'));
    wireManualValidation(root, val);
  }

  /** The typed step validates at the boundary. The begin button stays focusable and stays clickable
   *  when the numbers are wrong (a disabled control explains nothing): pressing it names the problem
   *  in a role="alert" and refuses to navigate. Once a first attempt has failed, typing corrects the
   *  message live, so the fix is confirmed as it is made. */
  function wireManualValidation(root: HTMLElement, val: (sel: string) => string): void {
    const begin = root.querySelector('[data-action="manual-begin"]') as HTMLButtonElement | null;
    const errEl = root.querySelector('[data-error]') as HTMLElement | null;
    if (!begin || !errEl) return;
    const fields = ['dpi', 'sens'] as const;
    let attempted = false;

    const problem = (): { field: 'dpi' | 'sens'; msg: string } | null => {
      const dpi = parseDpi(val('dpi'));
      if (!isValidDpi(dpi)) return { field: 'dpi', msg: `mouse dpi needs to be a number between ${MIN_DPI} and ${MAX_DPI}. you'll find it in your mouse software.` };
      const sens = Number(val('sens'));
      if (!Number.isFinite(sens) || sens <= 0) return { field: 'sens', msg: 'in-game sensitivity needs to be a number above zero.' };
      return null;
    };
    const show = (p: ReturnType<typeof problem>): void => {
      errEl.textContent = p?.msg ?? '';
      begin.setAttribute('aria-disabled', p ? 'true' : 'false');
      for (const f of fields) {
        root.querySelector(`[data-field="${f}"]`)?.setAttribute('aria-invalid', f === p?.field ? 'true' : 'false');
      }
    };
    for (const f of fields) {
      root.querySelector(`[data-field="${f}"]`)?.addEventListener('input', () => { if (attempted) show(problem()); });
    }
    begin.addEventListener('click', () => {
      attempted = true;
      const p = problem();
      show(p);
      if (p !== null) { (root.querySelector(`[data-field="${p.field}"]`) as HTMLElement | null)?.focus(); return; }
      commitManual(parseDpi(val('dpi')), Number(val('sens')), val('game') as GameId, Number(val('goal')));
    });
  }

  return {
    mount() { render(); },
    unmount() { teardownView(); host.replaceChildren(); },
  };
}
