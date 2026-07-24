import { makeEvolution } from '../optimizer/evolution';
import { runSession as runSessionImpl, type SessionConfig, type SessionOutcome } from '../optimizer/session-controller';
import { buildResult, ciConcord } from '../optimizer/result';
import { INSTRUMENTS } from '../instruments/registry';
import { mulberry32 } from '../stats/rng';
import { CONCORD_COPY } from './concord';
import { plotGeometry, plotLegendHtml, renderConvergencePlot, type PlotMark } from './convergence-plot';
import { createArenaStage } from './arena-stage';
import { rememberPrefs, type AppContext, type Screen } from './shell';
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

/** Concise spoken summary for the estimate live region (P4-3). The CI range is spelled " to " so a
 *  screen reader never voices a raw en-dash glyph; announced only at segment-meaningful moments. */
export function announceEstimate(report: Pick<Report, 'optimalCm360' | 'ci90'>): string {
  return `dialed in around ${report.optimalCm360.toFixed(1)} cm/360, 90% CI ${report.ci90[0].toFixed(1)} to ${report.ci90[1].toFixed(1)}`;
}

/** The curtain line: announced ONCE, at the trial where the search leaves Generation 0 - the moment
 *  the gene pool stops seeding and evolution proper begins (a segment-meaningful live-region beat). */
export const CURTAIN_LINE = 'gene pool seeded - evolution begins';

/** First-encounter title cards: the beat shown the FIRST time each environment appears. Purely
 *  narrative framing over the schedule the optimizer already chose - it names what the probe does
 *  and which organisms tuned it, and never claims anything the copy in COPY does not. */
export const ENV_BEATS: Record<InstrumentId, { title: string; sub: string }> = {
  track: { title: 'the open-air intercept', sub: 'hold your lead on the weaving prey · dragonfly + falcon' },
  flick: { title: 'the ambush', sub: 'break-cover targets to snap and lock · spider + raptor' },
  calibrate: { title: 'shooting through the bend', sub: 'learn the gap between aim and impact · archerfish' },
  strike: { title: 'the strike window', sub: 'commit the instant you see it · mantis shrimp' },
};

/** The dialed-in panel's budget line: plain facts the lock/refine choice actually turns on - trials
 *  spent against the hard cap, and what "keep refining" would really do (run more, or lock at cap). */
export function dialedBudget(used: number, max: number, refineGens: number): string {
  return used >= max
    ? `${used} of ${max} trials used - the budget is spent, so refining would lock this in`
    : `${used} of ${max} trials used · refining runs up to ${refineGens} more generations`;
}

/** Thin-shell injection seam: the production defaults build the real WebGL stage + run the real
 *  Bayesian session, but a jsdom test can swap in fakes to exercise the shell wiring (abort/begin
 *  states) without WebGL. Pure-core estimators are unchanged; only the view shell is injectable. */
export interface SessionViewDeps {
  createStage: typeof createArenaStage;
  runSession: (config: SessionConfig) => Promise<SessionOutcome>;
}

const DEFAULT_DEPS: SessionViewDeps = { createStage: createArenaStage, runSession: runSessionImpl };

export function sessionView(host: HTMLElement, ctx: AppContext, deps: SessionViewDeps = DEFAULT_DEPS): Screen {
  const { createStage, runSession } = deps;
  let alive = true;
  let cleanup: (() => void) | null = null;

  return {
    mount() {
      const root = document.createElement('section');
      root.className = 'screen screen--arena session';
      root.dataset.surface = 'chamber';
      root.innerHTML = `
        <canvas class="session__canvas"></canvas>
        <div class="session__crosshair" aria-hidden="true"></div>
        <header class="session__hud mono"><span data-hud="instruction">click to begin</span>
          <span data-hud="progress"></span></header>
        <figure class="session__plot"><svg data-plot aria-hidden="true"></svg>
          ${plotLegendHtml()}
          <span class="mono session__estimate-visual" data-hud="estimate-visual" aria-hidden="true"></span>
          <figcaption class="mono" data-hud="estimate" aria-live="polite" aria-atomic="true"></figcaption></figure>
        <div class="session__prelock" data-prelock>
          <span class="cal-pulse"><span class="cal-pulse__dot"></span></span>
          <p class="mono session__prelock-label">the hunt</p>
          <p class="session__prelock-lead">watch the prey break cover, then snap on and fire. each round tests one
            sensitivity; the search evolves toward your sharpest cm/360.</p>
          <p class="session__prelock-lead session__prelock-sub">when the search settles you'll get to lock it in - or
            keep refining. press <kbd>Esc</kbd> any time to pause.</p>
          <button class="action action--primary" data-prelock="begin">begin</button>
        </div>
        <div class="session__beat" data-beat aria-hidden="true" hidden>
          <p class="session__beat-title" data-beat-title></p>
          <p class="mono session__beat-sub" data-beat-sub></p>
        </div>
        <div class="session__dialed" data-panel hidden>
          <p class="mono session__dialed-label">dialed in</p>
          <p class="display session__dialed-num"><span data-dialed="num"></span><small> cm/360</small></p>
          <p class="mono session__dialed-ci">90% CI <span data-dialed="ci"></span></p>
          <p class="session__dialed-concord" data-dialed="concord" hidden></p>
          <p class="mono session__dialed-budget" data-dialed="budget"></p>
          <div class="session__dialed-actions">
            <button class="action action--primary" data-dialed="lock">lock it in</button>
            <button class="action action--ghost" data-dialed="refine">keep refining</button>
          </div>
        </div>
        <div class="session__abort" data-abort role="dialog" aria-label="session paused" hidden>
          <p class="mono session__abort-label">paused</p>
          <p class="session__abort-lead">the hunt is still in flight - your sensitivity search hasn't been touched.</p>
          <div class="session__abort-actions">
            <button class="action action--primary" data-abort="resume">resume</button>
            <button class="action action--ghost" data-abort="quit">quit to menu</button>
          </div>
        </div>`;
      host.appendChild(root);

      const canvas = root.querySelector('canvas') as HTMLCanvasElement;
      const svg = root.querySelector('[data-plot]') as unknown as SVGElement;
      const hudInstruction = root.querySelector('[data-hud="instruction"]')!;
      const hudProgress = root.querySelector('[data-hud="progress"]')!;
      const hudEstimate = root.querySelector('[data-hud="estimate"]')!;        // aria-live: meaningful moments only
      const hudEstimateVisual = root.querySelector('[data-hud="estimate-visual"]')!; // per-trial visual readout (aria-hidden)
      const panel = root.querySelector('[data-panel]') as HTMLElement;
      const prelock = root.querySelector('[data-prelock]') as HTMLElement;
      const beginBtn = root.querySelector('[data-prelock="begin"]') as HTMLButtonElement;
      const abort = root.querySelector('[data-abort]') as HTMLElement;
      const $d = (s: string) => root.querySelector(`[data-dialed="${s}"]`) as HTMLElement;
      const $a = (s: string) => root.querySelector(`[data-abort="${s}"]`) as HTMLButtonElement;

      const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const stage = createStage(root, { canvas, cm360: ctx.draft.bounds[0], dpi: ctx.draft.dpi, reducedMotion: reduced });
      const engine = makeEvolution({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.1 }, sigma0: 0.3, maxTrials: MAX_TRIALS });

      let allTrials: TrialResult[] = [];
      let lastReport: Report | null = null;
      let lockedIn = false;
      let running = false;
      // The estimate figcaption is an aria-live region; we write to it ONLY at segment-meaningful
      // moments (an instrument switch, the seed curtain, the dialed-in panel), never on every trial,
      // so a screen reader is not flooded. Read-only narration over pure values; it appends no score.
      let announcedInstrument: InstrumentId | null = null;
      let curtainDropped = false;
      const seenEnvs = new Set<InstrumentId>();

      // First-encounter / curtain title cards: a brief aria-hidden overlay beat (the live region
      // carries the same information in copy). Purely cosmetic; reduced motion never shows one.
      const beatEl = root.querySelector('[data-beat]') as HTMLElement;
      const beatTitle = root.querySelector('[data-beat-title]') as HTMLElement;
      const beatSub = root.querySelector('[data-beat-sub]') as HTMLElement;
      const BEAT_MS = 2400;
      let beatTimer: number | null = null;
      const showBeat = (title: string, sub: string): void => {
        if (reduced) return;
        beatTitle.textContent = title;
        beatSub.textContent = sub;
        beatEl.hidden = false;
        beatEl.classList.remove('is-on');
        void beatEl.offsetWidth; // restart the fade choreography on back-to-back beats
        beatEl.classList.add('is-on');
        if (beatTimer !== null) clearTimeout(beatTimer);
        beatTimer = window.setTimeout(() => {
          beatEl.hidden = true;
          beatEl.classList.remove('is-on');
          beatTimer = null;
        }, BEAT_MS);
      };

      const drawPlot = (report: Report, trials: readonly TrialResult[]): void => {
        const g = plotGeometry({
          bounds: ctx.draft.bounds, marks: marksFromTrials(trials),
          curve: report.curve, ci90: report.ci90, peak: report.optimalCm360,
          size: { width: svg.clientWidth || 360, height: svg.clientHeight || 180 },
        });
        renderConvergencePlot(svg, g, 'blended score');
        // Per-trial visual readout only (aria-hidden): the live region stays quiet until a meaningful
        // moment. Range spelled " to " so no en-dash glyph ever reaches assistive tech.
        hudEstimateVisual.textContent = `most-evolved · ${report.optimalCm360.toFixed(1)} cm/360 · 90% CI ${report.ci90[0].toFixed(1)} to ${report.ci90[1].toFixed(1)}`;
      };

      const runSegment = async (maxTrials: number, ciStopWidth: number | undefined): Promise<void> => {
        if (running) return; // re-entry guard at the source: a second concurrent launch (a stacked
        // begin double-click inside the async lock window, or any future caller) must never interleave
        // the SHARED stateful (1+lambda)-ES engine + allTrials buffer. `running` is set synchronously
        // below before the first await, so the second microtask sees it true and bails. cm/360 is never
        // at risk (the gold sphere owns it); this protects the search lineage + live plot consistency.
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
            // Announce ONLY when the instrument changes (a segment-meaningful moment), not every trial.
            if (id !== announcedInstrument) { announcedInstrument = id; hudEstimate.textContent = instructionFor(id); }
            // First encounter of an environment: a one-time title-card beat naming the probe.
            if (!seenEnvs.has(id)) {
              seenEnvs.add(id);
              showBeat(ENV_BEATS[id].title, ENV_BEATS[id].sub);
            }
            // The seed curtain: fires exactly once, on the first trial PAST Generation 0. Written
            // after the instrument announce so it wins the live region on a tie (rarer beat wins).
            if (i === COLD_START && !curtainDropped) {
              curtainDropped = true;
              hudEstimate.textContent = CURTAIN_LINE;
              showBeat('evolution begins', 'the gene pool is seeded - each round now tests one mutated sensitivity');
            }
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
        const result = buildResult(report, allTrials, ctx.draft.dpi, undefined, ctx.draft.bounds, ctx.draft.profile);
        ctx.storage.saveSession({ id: sessionId, dpi: ctx.draft.dpi, profile: ctx.draft.profile, trials: [...allTrials], status: 'complete', createdAt: 0 });
        ctx.storage.saveResult(sessionId, result);
        ctx.lastResult = { sessionId, result };
        rememberPrefs(ctx, sessionId); // point the returning-visitor restore at this result
        ctx.navigate('result');
      };

      const showPanel = (report: Report): void => {
        stage.exitLock(); // hand the cursor back so the panel buttons are clickable
        drawPlot(report, allTrials);
        hudEstimate.textContent = announceEstimate(report); // dialed-in: a meaningful moment to announce
        $d('num').textContent = report.optimalCm360.toFixed(1);
        $d('ci').textContent = `${report.ci90[0].toFixed(1)}–${report.ci90[1].toFixed(1)} cm/360`;
        // Decision support for lock-vs-refine: the CI-width bucket in its honesty-vetted copy (a
        // width observation, never a single-cause claim) plus the plain trial-budget facts.
        const concord = ciConcord(report.optimalCm360, report.ci90);
        const concordEl = $d('concord');
        if (concord) {
          concordEl.textContent = CONCORD_COPY[concord];
          concordEl.setAttribute('data-concord', concord);
          concordEl.hidden = false;
        } else {
          concordEl.hidden = true;
        }
        $d('budget').textContent = dialedBudget(allTrials.length, MAX_TRIALS, REFINE_GENS);
        panel.hidden = false;
      };

      const begin = async (): Promise<void> => {
        // The reveal is now the in-scene 3D revolver's own look/fire motion (no named sprite draw anim).
        await runSegment(Math.min(MAX_TRIALS, COLD_START + 12), FIRST_STOP_CI);
        if (!alive) return;
        if (lockedIn) { finalize(); return; }
        showPanel(lastReport!);
      };

      // Reveal the abort scrim ONLY when the lock dropped while a segment is mid-flight: lock dropped
      // AND running AND the dialed-in panel is hidden AND the user hasn't already committed. This is
      // pure SHELL wiring - it appends NO scored trial and never touches the gold target / cm360.
      const syncAbort = (): void => {
        const lockDropped = document.pointerLockElement !== canvas;
        abort.hidden = !(lockDropped && running && panel.hidden && !lockedIn);
      };
      document.addEventListener('pointerlockchange', syncAbort);

      $d('lock').addEventListener('click', () => { lockedIn = true; panel.hidden = true; finalize(); });
      $d('refine').addEventListener('click', () => {
        if (running) return;
        panel.hidden = true;
        const target = Math.min(MAX_TRIALS, allTrials.length + REFINE_GENS);
        if (target <= allTrials.length) { finalize(); return; } // hit the cap - lock in
        void stage.requestLock().catch(() => {});
        void runSegment(target, undefined).then(() => { if (alive && !lockedIn) showPanel(lastReport!); });
      });

      // Abort scrim: resume re-acquires the lock ONLY (the in-flight trial continues, the gold target
      // keeps cm/360 byte-identical); quit navigates home ONLY (the shell's unmount→cleanup disposes
      // once via the guarded `alive` flag - we add NO second dispose here, and NO scored trial).
      $a('resume').addEventListener('click', () => {
        abort.hidden = true;
        void stage.requestLock().catch(() => {});
      });
      $a('quit').addEventListener('click', () => { ctx.navigate('hero'); });

      // ONE start gesture, pinned to the focusable begin button (no canvas-click hybrid, so the start
      // path can never desync). The button hands off to the lock request, then the segment loop.
      beginBtn.addEventListener('click', () => {
        prelock.hidden = true;
        void stage.requestLock().then(begin).catch(begin);
      }, { once: true }); // start is a one-shot; with the runSegment re-entry guard this closes the double-click vector

      cleanup = () => {
        alive = false;
        lockedIn = true; // break any in-flight segment so it never touches a torn-down context
        if (beatTimer !== null) clearTimeout(beatTimer);
        document.removeEventListener('pointerlockchange', syncAbort);
        stage.dispose();
      };
    },
    unmount() { cleanup?.(); host.replaceChildren(); },
  };
}
