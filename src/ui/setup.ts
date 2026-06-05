// Guided calibration orchestrator. Pure step machine (calibrate-flow) under a thin shell that
// mounts the sweep + turn views and writes the session draft. Retires the typed setup + the gate.
import type { AppContext, Screen } from './shell';
import type { GameId } from '../types';
import { GAME_YAW, yawFor } from '../convert/yaw-table';
import { cmPer360 } from '../convert/cm360';
import { boundsFromSeed } from './options/settings';
import { CARD_WIDTH_CM } from '../input/dpi-sweep';
import { calibrateReducer, initialCalState, type CalState } from './calibrate-flow';
import { createSweepView, type SweepView } from './calibrate/sweep-view';
import { createTurnView, type TurnView } from './calibrate/turn-view';

export function setup(host: HTMLElement, ctx: AppContext): Screen {
  let state: CalState = initialCalState();
  let view: SweepView | TurnView | null = null;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function dispatch(a: Parameters<typeof calibrateReducer>[1]): void {
    state = calibrateReducer(state, a);
    render();
  }

  function teardownView(): void { view?.dispose(); view = null; }

  function gameOptions(sel: GameId): string {
    return GAME_YAW.map((g) => `<option value="${g.id}"${g.id === sel ? ' selected' : ''}>${g.label}</option>`).join('');
  }

  function commitGuided(game: GameId, goal: number): void {
    const dpi = state.dpi;
    if (dpi !== null) ctx.draft.dpi = dpi;
    ctx.draft.currentGame = game;
    ctx.draft.profile = { ...ctx.draft.profile, speedAccuracy: goal };
    ctx.draft.bounds = boundsFromSeed(state.seedCm360 ?? cmPer360(ctx.draft.dpi, 1, yawFor(game)));
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
        onInvalid: () => dispatch({ type: 'sweep-done', dpi: NaN, accelerated: true }),
        onLockFailed: () => dispatch({ type: 'start-manual' }) });
      return;
    }
    if (state.step === 'turn' && state.dpi !== null) {
      const dpi = state.dpi;
      view = createTurnView(host, { dpi, onSeed: (cm) => dispatch({ type: 'turn-done', seedCm360: cm }) });
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
        <p class="setup__lead">we'll measure your turn by feel, not by numbers. grab any card from your wallet - bank card, gym card, hotel key. they're all the same size.</p>
        ${reduced ? `<p class="setup__lead mono">reduced-motion is on - you can skip the rendered turn with "i already know my numbers" below.</p>` : ''}
        <button class="action action--primary" data-action="start-guided">start</button>
        <button class="action action--ghost" data-action="start-manual">i already know my numbers</button>
      </div>`;
    if (state.step === 'blocked') return `
      <div class="wrap stack gate__inner">
        <p class="gate__lead">mouse acceleration looks like it's on (or the card sweep was uneven) - cm/360 is undefined under acceleration.</p>
        <p>turn off OS/driver acceleration ("enhance pointer precision"), then retry.</p>
        <button class="action action--primary" data-action="retry">retry</button>
        <button class="action action--ghost" data-action="manual">type my numbers instead</button>
      </div>`;
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
    // step === 'game'
    return `
      <div class="wrap stack setup__inner">
        <h2 class="display setup__title">+ your game</h2>
        <p class="setup__lead">your comfortable spin is <span class="mono">${(state.seedCm360 ?? 0).toFixed(1)}</span> cm per full turn. pick your game so we can give you the number to enter.</p>
        <label class="field">game<select data-field="game">${gameOptions(ctx.draft.currentGame)}</select></label>
        <label class="field">goal - precision to speed<input type="range" min="0" max="1" step="0.01" data-field="goal" value="${ctx.draft.profile.speedAccuracy}"></label>
        <button class="action action--primary" data-action="game-begin">play</button>
      </div>`;
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
    click('game-begin', () => commitGuided(val('game') as GameId, Number(val('goal'))));
  }

  return {
    mount() { render(); },
    unmount() { teardownView(); host.replaceChildren(); },
  };
}
