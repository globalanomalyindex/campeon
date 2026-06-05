// Guided calibration orchestrator. Pure step machine (calibrate-flow) under a thin shell that
// mounts the sweep + spin views and writes the session draft. The game pick is deferred to the
// result; the speed/accuracy goal defaults to balanced. Retires the typed setup + the gate.
import type { AppContext, Screen } from './shell';
import type { GameId } from '../types';
import { GAME_YAW, yawFor } from '../convert/yaw-table';
import { cmPer360 } from '../convert/cm360';
import { boundsFromSeed } from './options/settings';
import { CARD_WIDTH_CM } from '../input/dpi-sweep';
import { calibrateReducer, initialCalState, type CalState } from './calibrate-flow';
import { createSweepView, type SweepView } from './calibrate/sweep-view';
import { createSpinView, type SpinView } from './calibrate/spin-view';

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

export function setup(host: HTMLElement, ctx: AppContext): Screen {
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
    ctx.navigate('session');
  }

  function commitManual(dpi: number, sens: number, game: GameId, goal: number): void {
    ctx.draft.dpi = dpi;
    ctx.draft.currentSens = sens;
    ctx.draft.currentGame = game;
    ctx.draft.profile = { ...ctx.draft.profile, speedAccuracy: goal };
    ctx.draft.bounds = boundsFromSeed(cmPer360(dpi, sens, yawFor(game)));
    ctx.navigate('session');
  }

  function render(): void {
    teardownView();
    host.replaceChildren();

    if (state.step === 'sweep') {
      view = createSweepView(host, { referenceWidthCm: CARD_WIDTH_CM,
        onResult: (r) => dispatch({ type: 'sweep-done', dpi: r.dpi, accelerated: r.accelerated }),
        onInvalid: () => dispatch({ type: 'sweep-invalid' }),
        onLockFailed: () => dispatch({ type: 'start-manual' }) });
      host.insertAdjacentHTML('beforeend', calibrationProgress('sweep')); // fixed-position overlay tracker
      return;
    }
    if (state.step === 'spin' && state.dpi !== null) {
      const dpi = state.dpi;
      view = createSpinView(host, { dpi, onSeed: (cm) => commitGuided(cm) });
      host.insertAdjacentHTML('beforeend', calibrationProgress('spin'));
      return;
    }

    const root = document.createElement('section');
    root.className = state.step === 'blocked' ? 'screen screen--arena fade-in' : 'screen screen--shell fade-in';
    root.innerHTML = stepHtml();
    host.appendChild(root);
    wire(root);
  }

  function stepHtml(): string {
    if (state.step === 'intro') return `
      <div class="wrap stack setup__inner">
        <h2 class="display setup__title">+ calibrate</h2>
        <p class="setup__lead">two quick steps, no numbers to look up - we just watch how your hand actually moves.</p>
        <ol class="cal-preview">
          <li><span class="cal-preview__n">1</span><span>the sweep - drag a card's width, so we learn your mouse.</span></li>
          <li><span class="cal-preview__n">2</span><span>the spin - turn all the way around once.</span></li>
        </ol>
        <p class="setup__lead">first, grab any card from your wallet - bank card, gym card, hotel key. they're all exactly the same size.</p>
        ${reduced ? `<p class="setup__lead mono">reduced-motion is on - you can skip the rendered turn with "i already know my numbers" below.</p>` : ''}
        <button class="action action--primary" data-action="start-guided">i've got a card - start</button>
        <button class="action action--ghost" data-action="start-manual">i already know my numbers</button>
      </div>`;
    if (state.step === 'blocked') {
      const accel = state.blockReason === 'accel';
      return `
      <div class="wrap stack gate__inner">
        ${accel
          ? `<p class="gate__lead">looks like your mouse speeds up the faster you move - that's "mouse acceleration", and it makes one true turn distance impossible to pin down.</p>
             <p>turn off "enhance pointer precision" (windows) or your mouse driver's acceleration, then try again.</p>`
          : `<p class="gate__lead">that sweep didn't quite register - probably a little too short or uneven.</p>
             <p>line the card up, rest your mouse at its left edge, and slide smoothly all the way to the right edge.</p>`}
        <button class="action action--primary" data-action="retry">try again</button>
        <button class="action action--ghost" data-action="manual">type my numbers instead</button>
      </div>`;
    }
    if (state.step === 'manual') return `
      <div class="wrap stack setup__inner">
        <h2 class="display setup__title">+ your numbers</h2>
        <label class="field">mouse dpi<input class="mono" type="number" min="100" max="32000" step="50" data-field="dpi" value="${ctx.draft.dpi}"></label>
        <label class="field">current game<select data-field="game">${gameOptions(ctx.draft.currentGame)}</select></label>
        <label class="field">in-game sensitivity<input class="mono" type="number" min="0.01" step="0.01" data-field="sens" value="${ctx.draft.currentSens}"></label>
        <label class="field">goal - precision to speed<input type="range" min="0" max="1" step="0.01" data-field="goal" value="${ctx.draft.profile.speedAccuracy}"></label>
        <button class="action action--primary" data-action="manual-begin">begin</button>
        <button class="action action--ghost" data-action="back">back</button>
      </div>`;
    return ''; // 'spin' returns early in render(); no other steps reach here
  }

  function wire(root: HTMLElement): void {
    const click = (sel: string, fn: () => void): void => root.querySelector(`[data-action="${sel}"]`)?.addEventListener('click', fn);
    const val = (sel: string): string => (root.querySelector(`[data-field="${sel}"]`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
    click('start-guided', () => dispatch({ type: 'start-guided' }));
    click('start-manual', () => dispatch({ type: 'start-manual' }));
    click('retry', () => dispatch({ type: 'retry' }));
    click('manual', () => dispatch({ type: 'start-manual' }));
    click('back', () => dispatch({ type: 'back-to-intro' }));
    click('manual-begin', () => commitManual(Number(val('dpi')), Number(val('sens')), val('game') as GameId, Number(val('goal'))));
  }

  return {
    mount() { render(); },
    unmount() { teardownView(); host.replaceChildren(); },
  };
}
