import { makeEvolution } from '../optimizer/evolution';
import { runSession } from '../optimizer/session-controller';
import { buildResult } from '../optimizer/result';
import { INSTRUMENTS } from '../instruments/registry';
import { mulberry32 } from '../stats/rng';
import { plotGeometry, renderConvergencePlot, type PlotMark } from './convergence-plot';
import { createArenaStage } from './arena-stage';
import type { AppContext, Screen } from './shell';
import type { InstrumentId, Report, TrialResult } from '../types';

const SCHEDULE: InstrumentId[] = ['flick', 'track', 'calibrate', 'strike'];
const MAX_TRIALS = 24; // spec §5.4: ~15–30, capped ~20–25
const COLD_START = 8; // Generation 0 - the initial gene pool (≥2 trials/instrument before selection)

export function marksFromTrials(trials: readonly TrialResult[]): PlotMark[] {
  return trials.map((t) => ({ cm360: t.cm360, score: t.score, instrument: t.instrument }));
}

const COPY: Record<InstrumentId, string> = {
  track: '+track · the open-air intercept - hold your lead on the weaving prey (dragonfly + falcon)',
  flick: '+flick · the ambush - break-cover targets to snap and lock (spider + raptor)',
  calibrate: '+calibrate · shooting through the bend - learn the gap between aim and impact (archerfish)',
  strike: '+strike · the strike window - commit the instant you see it, no settling (mantis shrimp)',
};
export function instructionFor(id: InstrumentId): string { return COPY[id]; }

/** Live HUD line for the evolutionary loop. Cold-start trials are Generation 0 (the initial gene
 *  pool); after that, each trial is a numbered generation testing one mutated sensitivity. */
export function searchLabel(index: number, cm360: number, coldStart: number): string {
  const testing = `testing ${cm360.toFixed(1)} cm/360`;
  return index < coldStart
    ? `gen 0 · seeding the gene pool · ${testing}`
    : `generation ${index - coldStart + 1} · ${testing}`;
}

export function sessionView(host: HTMLElement, ctx: AppContext): Screen {
  let alive = true;
  let cleanup: (() => void) | null = null;

  return {
    mount() {
      const root = document.createElement('section');
      root.className = 'screen screen--arena session';
      root.innerHTML = `
        <canvas class="session__canvas"></canvas>
        <div class="session__crosshair" aria-hidden="true"></div>
        <header class="session__hud mono"><span data-hud="instruction">click to lock in</span>
          <span data-hud="progress"></span></header>
        <figure class="session__plot"><svg data-plot aria-label="convergence on your optimal cm/360"></svg>
          <figcaption class="mono" data-hud="estimate"></figcaption></figure>`;
      host.appendChild(root);

      const canvas = root.querySelector('canvas') as HTMLCanvasElement;
      const svg = root.querySelector('[data-plot]') as unknown as SVGElement;
      const hudInstruction = root.querySelector('[data-hud="instruction"]')!;
      const hudProgress = root.querySelector('[data-hud="progress"]')!;
      const hudEstimate = root.querySelector('[data-hud="estimate"]')!;

      const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const stage = createArenaStage(root, { canvas, cm360: ctx.draft.bounds[0], dpi: ctx.draft.dpi, reducedMotion: reduced });

      const drawPlot = (report: Report, trials: readonly TrialResult[]): void => {
        const g = plotGeometry({
          bounds: ctx.draft.bounds, marks: marksFromTrials(trials),
          curve: report.curve, ci90: report.ci90, peak: report.optimalCm360,
          size: { width: svg.clientWidth || 360, height: svg.clientHeight || 180 },
        });
        renderConvergencePlot(svg, g, 'blended score');
        hudEstimate.textContent = `most-evolved · ${report.optimalCm360.toFixed(1)} cm/360 · 90% CI ${report.ci90[0].toFixed(1)}–${report.ci90[1].toFixed(1)}`;
      };

      const start = (): void => {
        stage.playViewmodel('flickDraw', 'idleReady'); // flick the cigarette, draw the deagle (the reveal)
        const engine = makeEvolution({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.1 }, sigma0: 0.3, maxTrials: MAX_TRIALS });
        void runSession({
          dpi: ctx.draft.dpi, profile: ctx.draft.profile, bounds: ctx.draft.bounds,
          engine, instruments: INSTRUMENTS, scene: stage.arena, schedule: SCHEDULE,
          maxTrials: MAX_TRIALS, coldStart: COLD_START, rng: mulberry32(2026), minTrials: 12, ciStopWidth: 6, bootstrapIters: 300,
          onTrialStart: (id, i, cm360) => {
            hudInstruction.textContent = instructionFor(id);
            hudProgress.textContent = searchLabel(i, cm360, COLD_START);
            stage.setEnemyEnvironment(id); // skin this trial's targets with the environment's prey
            stage.arena.clearTargets();
          },
          onTrial: (_t, trials, interim) => drawPlot(interim, trials),
        }).then(({ report, trials }) => {
          if (!alive) return; // unmounted mid-session - never touch a torn-down context
          const sessionId = `s-${trials.length}-${Math.round(report.optimalCm360 * 100)}`;
          const result = buildResult(report, trials, ctx.draft.dpi);
          ctx.storage.saveSession({ id: sessionId, dpi: ctx.draft.dpi, profile: ctx.draft.profile, trials: [...trials], status: 'complete', createdAt: 0 });
          ctx.storage.saveResult(sessionId, result);
          ctx.lastResult = { sessionId, result };
          ctx.navigate('result');
        });
      };

      canvas.addEventListener('click', () => void stage.requestLock().then(start).catch(start), { once: true });

      cleanup = () => {
        alive = false;
        stage.dispose();
      };
    },
    unmount() { cleanup?.(); host.replaceChildren(); },
  };
}
