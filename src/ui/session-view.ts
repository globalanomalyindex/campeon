import { WebGLRenderer } from 'three';
import { Arena, type InputSource } from '../engine/arena';
import { createPointerLock } from '../input/pointer-lock';
import { makeBo } from '../optimizer/bayesopt';
import { runSession } from '../optimizer/session-controller';
import { buildResult } from '../optimizer/result';
import { INSTRUMENTS } from '../instruments/registry';
import { mulberry32 } from '../stats/rng';
import { plotGeometry, renderConvergencePlot, type PlotMark } from './convergence-plot';
import type { AppContext, Screen } from './shell';
import type { InstrumentId, Report, TrialResult } from '../types';

const SCHEDULE: InstrumentId[] = ['flick', 'track', 'calibrate', 'strike'];
const MAX_TRIALS = 24; // spec §5.4: ~15–30, capped ~20–25

export function marksFromTrials(trials: readonly TrialResult[]): PlotMark[] {
  return trials.map((t) => ({ cm360: t.cm360, score: t.score, instrument: t.instrument }));
}

const COPY: Record<InstrumentId, string> = {
  track: '+track · keep the dot on the mover — dragonfly lead + falcon hold',
  flick: '+flick · snap to each target and settle — spider acquisition + raptor fovea',
  calibrate: '+calibrate · fire center-mass; we separate your bias from your spread — archerfish',
  strike: '+strike · fire as fast as you can — mantis-shrimp speed pole',
};
export function instructionFor(id: InstrumentId): string { return COPY[id]; }

export function sessionView(host: HTMLElement, ctx: AppContext): Screen {
  let raf = 0;
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

      const renderer = new WebGLRenderer({ canvas, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      const size = (): [number, number] => [window.innerWidth, window.innerHeight];
      const pointer = createPointerLock(canvas);
      const input: InputSource = {
        onSample: (cb) => pointer.onSample(cb),
        onFire: (cb) => pointer.onFire(cb),
      };
      const arena = new Arena({ renderer, input, size, cm360: ctx.draft.bounds[0], dpi: ctx.draft.dpi, rng: mulberry32(7) });

      const onResize = (): void => arena.resize();
      window.addEventListener('resize', onResize);
      let last = 0;
      const loop = (ts: number): void => {
        const dt = last === 0 ? 16 : ts - last; last = ts;
        arena.tick(dt); arena.render();
        raf = window.requestAnimationFrame(loop);
      };
      raf = window.requestAnimationFrame(loop);

      const drawPlot = (report: Report, trials: readonly TrialResult[]): void => {
        const g = plotGeometry({
          bounds: ctx.draft.bounds, marks: marksFromTrials(trials),
          curve: report.curve, ci90: report.ci90, peak: report.optimalCm360,
          size: { width: svg.clientWidth || 360, height: svg.clientHeight || 180 },
        });
        renderConvergencePlot(svg, g);
        hudEstimate.textContent = `${report.optimalCm360.toFixed(1)} cm/360 · 90% CI ${report.ci90[0].toFixed(1)}–${report.ci90[1].toFixed(1)}`;
      };

      const start = (): void => {
        const engine = makeBo({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.1 }, acquisition: 'ei' });
        void runSession({
          dpi: ctx.draft.dpi, profile: ctx.draft.profile, bounds: ctx.draft.bounds,
          engine, instruments: INSTRUMENTS, scene: arena, schedule: SCHEDULE,
          maxTrials: MAX_TRIALS, rng: mulberry32(2026), minTrials: 12, ciStopWidth: 6, bootstrapIters: 300,
          onTrialStart: (id, i, _cm360) => {
            hudInstruction.textContent = instructionFor(id);
            hudProgress.textContent = `trial ${i + 1} / ${MAX_TRIALS}`;
            arena.clearTargets();
          },
          onTrial: (_t, trials, interim) => drawPlot(interim, trials),
        }).then(({ report, trials }) => {
          if (!alive) return; // unmounted mid-session — never touch a torn-down context
          const sessionId = `s-${trials.length}-${Math.round(report.optimalCm360 * 100)}`;
          const result = buildResult(report, trials, ctx.draft.dpi);
          ctx.storage.saveSession({ id: sessionId, dpi: ctx.draft.dpi, profile: ctx.draft.profile, trials: [...trials], status: 'complete', createdAt: 0 });
          ctx.storage.saveResult(sessionId, result);
          ctx.lastResult = { sessionId, result };
          ctx.navigate('result');
        });
      };

      canvas.addEventListener('click', () => void pointer.request().then(start).catch(start), { once: true });

      cleanup = () => {
        alive = false;
        window.cancelAnimationFrame(raf);
        window.removeEventListener('resize', onResize);
        pointer.dispose();
        arena.dispose();
      };
    },
    unmount() { cleanup?.(); host.replaceChildren(); },
  };
}
