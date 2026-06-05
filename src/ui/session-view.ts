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
const MAX_TRIALS = 30;     // hard cap across all segments
const COLD_START = 8;      // Generation 0 - the initial gene pool
const FIRST_STOP_CI = 6;   // a segment converges when the 90% CI (cm/360) is tighter than this
const REFINE_GENS = 6;     // extra generations per "keep refining"

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
          <figcaption class="mono" data-hud="estimate"></figcaption></figure>
        <div class="session__dialed" data-panel hidden>
          <p class="mono session__dialed-label">dialed in</p>
          <p class="display session__dialed-num"><span data-dialed="num"></span><small> cm/360</small></p>
          <p class="mono session__dialed-ci">90% CI <span data-dialed="ci"></span></p>
          <div class="session__dialed-actions">
            <button class="action action--primary" data-dialed="lock">lock it in</button>
            <button class="action action--ghost" data-dialed="refine">keep refining</button>
          </div>
        </div>`;
      host.appendChild(root);

      const canvas = root.querySelector('canvas') as HTMLCanvasElement;
      const svg = root.querySelector('[data-plot]') as unknown as SVGElement;
      const hudInstruction = root.querySelector('[data-hud="instruction"]')!;
      const hudProgress = root.querySelector('[data-hud="progress"]')!;
      const hudEstimate = root.querySelector('[data-hud="estimate"]')!;
      const panel = root.querySelector('[data-panel]') as HTMLElement;
      const $d = (s: string) => root.querySelector(`[data-dialed="${s}"]`) as HTMLElement;

      const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const stage = createArenaStage(root, { canvas, cm360: ctx.draft.bounds[0], dpi: ctx.draft.dpi, reducedMotion: reduced });
      const engine = makeEvolution({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.1 }, sigma0: 0.3, maxTrials: MAX_TRIALS });

      let allTrials: TrialResult[] = [];
      let lastReport: Report | null = null;
      let lockedIn = false;
      let running = false;

      const drawPlot = (report: Report, trials: readonly TrialResult[]): void => {
        const g = plotGeometry({
          bounds: ctx.draft.bounds, marks: marksFromTrials(trials),
          curve: report.curve, ci90: report.ci90, peak: report.optimalCm360,
          size: { width: svg.clientWidth || 360, height: svg.clientHeight || 180 },
        });
        renderConvergencePlot(svg, g, 'blended score');
        hudEstimate.textContent = `most-evolved · ${report.optimalCm360.toFixed(1)} cm/360 · 90% CI ${report.ci90[0].toFixed(1)}–${report.ci90[1].toFixed(1)}`;
      };

      const runSegment = async (maxTrials: number, ciStopWidth: number | undefined): Promise<void> => {
        running = true;
        const { report, trials } = await runSession({
          dpi: ctx.draft.dpi, profile: ctx.draft.profile, bounds: ctx.draft.bounds,
          engine, instruments: INSTRUMENTS, scene: stage.arena, schedule: SCHEDULE,
          maxTrials, coldStart: COLD_START, rng: mulberry32(2026), minTrials: 12,
          ...(ciStopWidth !== undefined ? { ciStopWidth } : {}),
          bootstrapIters: 300, initialTrials: allTrials, shouldStop: () => lockedIn,
          onTrialStart: (id, i, cm360) => {
            hudInstruction.textContent = instructionFor(id);
            hudProgress.textContent = searchLabel(i, cm360, COLD_START);
            stage.setEnemyEnvironment(id); // skin this trial's targets with the environment's prey
            stage.arena.clearTargets();
          },
          onTrial: (_t, trials2, interim) => { lastReport = interim; drawPlot(interim, trials2); },
        });
        allTrials = trials; lastReport = report;
        running = false;
      };

      const finalize = (): void => {
        if (!alive || !lastReport) return;
        const report = lastReport;
        const sessionId = `s-${allTrials.length}-${Math.round(report.optimalCm360 * 100)}`;
        const result = buildResult(report, allTrials, ctx.draft.dpi);
        ctx.storage.saveSession({ id: sessionId, dpi: ctx.draft.dpi, profile: ctx.draft.profile, trials: [...allTrials], status: 'complete', createdAt: 0 });
        ctx.storage.saveResult(sessionId, result);
        ctx.lastResult = { sessionId, result };
        ctx.navigate('result');
      };

      const showPanel = (report: Report): void => {
        stage.exitLock(); // hand the cursor back so the panel buttons are clickable
        drawPlot(report, allTrials);
        $d('num').textContent = report.optimalCm360.toFixed(1);
        $d('ci').textContent = `${report.ci90[0].toFixed(1)}–${report.ci90[1].toFixed(1)} cm/360`;
        panel.hidden = false;
      };

      const begin = async (): Promise<void> => {
        stage.playViewmodel('flickDraw', 'idleReady'); // flick the cigarette, draw the deagle (the reveal)
        await runSegment(Math.min(MAX_TRIALS, COLD_START + 12), FIRST_STOP_CI);
        if (!alive) return;
        if (lockedIn) { finalize(); return; }
        showPanel(lastReport!);
      };

      $d('lock').addEventListener('click', () => { lockedIn = true; panel.hidden = true; finalize(); });
      $d('refine').addEventListener('click', () => {
        if (running) return;
        panel.hidden = true;
        const target = Math.min(MAX_TRIALS, allTrials.length + REFINE_GENS);
        if (target <= allTrials.length) { finalize(); return; } // hit the cap - lock in
        void stage.requestLock().catch(() => {});
        void runSegment(target, undefined).then(() => { if (alive && !lockedIn) showPanel(lastReport!); });
      });

      canvas.addEventListener('click', () => void stage.requestLock().then(begin).catch(begin), { once: true });

      cleanup = () => {
        alive = false;
        lockedIn = true; // break any in-flight segment so it never touches a torn-down context
        stage.dispose();
      };
    },
    unmount() { cleanup?.(); host.replaceChildren(); },
  };
}
