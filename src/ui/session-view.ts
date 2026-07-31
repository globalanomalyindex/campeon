import { makeEvolution } from '../optimizer/evolution';
import { runSession as runSessionImpl, type SessionConfig, type SessionOutcome } from '../optimizer/session-controller';
import { buildResult, ciConcord } from '../optimizer/result';
import { anchorFromReaches, type FirstReach } from '../anchor/flick-anchor';
import { reconcile } from '../anchor/reconcile';
import { INSTRUMENTS } from '../instruments/registry';
import { mulberry32 } from '../stats/rng';
import { CONCORD_COPY } from './concord';
import { plotGeometry, plotLegendHtml, renderConvergencePlot, type PlotMark } from './convergence-plot';
import { createArenaStage } from './arena-stage';
import { openModal, type ModalHandle } from './modal';
import { rememberPrefs, type AppContext, type Screen } from './shell';
import type { InstrumentId, Report, TrialResult } from '../types';

const SCHEDULE: InstrumentId[] = ['flick', 'track', 'calibrate', 'strike'];
const MAX_TRIALS = 30;     // hard cap across all segments
const COLD_START = 8;      // Generation 0 - the initial gene pool
const FIRST_STOP_CI = 1900;   // a segment converges when the 90% CI, in counts per 360, is tighter than this
const REFINE_GENS = 6;     // extra generations per "keep refining"
const MIN_TRIALS = 12;     // the segment never stops short of this, however tight the CI gets
const FIRST_SEGMENT = Math.min(MAX_TRIALS, COLD_START + 12); // the first segment's hard ceiling

export function marksFromTrials(trials: readonly TrialResult[]): PlotMark[] {
  return trials.map((t) => ({ counts: t.counts, score: t.score, instrument: t.instrument }));
}

const COPY: Record<InstrumentId, string> = {
  track: 'Track · the open-air intercept · hold your lead on the weaving prey (dragonfly, falcon)',
  flick: 'Flick · the ambush · break-cover targets to snap and lock (spider, raptor)',
  calibrate: 'Calibrate · shooting through the bend · learn the gap between aim and impact (archerfish)',
  strike: 'Strike · the strike window · commit the instant you see it, no settling (mantis shrimp)',
};
export function instructionFor(id: InstrumentId): string { return COPY[id]; }

/** Live HUD line for the evolutionary loop. Cold-start trials are Generation 0 (the initial gene
 *  pool); after that, each trial is a numbered generation testing one mutated sensitivity. The
 *  `of total` denominator is the segment's hard ceiling, so the line always says how far in you
 *  are: without it the run reads as open-ended and there is no way to judge whether to stop. */
export function searchLabel(index: number, counts: number, coldStart: number, total: number): string {
  const where = `trial ${index + 1} of ${total} · testing ${counts.toFixed(1)} counts per 360`;
  return index < coldStart
    ? `Gen 0 · seeding the gene pool · ${where}`
    : `Generation ${index - coldStart + 1} · ${where}`;
}

/** What the visitor is committing to when they press begin. Derived from the same constants the
 *  segment actually runs on, so the promise cannot drift away from the loop. */
export function segmentShape(minTrials: number, maxTrials: number): string {
  return `${minTrials} to ${maxTrials} rounds before the first result. I'd budget about five minutes.`;
}

/** Concise spoken summary for the estimate live region (P4-3). The CI range is spelled " to " so a
 *  screen reader never voices a raw en-dash glyph; announced only at segment-meaningful moments. */
export function announceEstimate(report: Pick<Report, 'optimalCounts' | 'ci90'>): string {
  return `Dialed in around ${report.optimalCounts.toFixed(1)} counts per 360, 90% CI ${report.ci90[0].toFixed(1)} to ${report.ci90[1].toFixed(1)}`;
}

/** The curtain line: announced ONCE, at the trial where the search leaves Generation 0 - the moment
 *  the gene pool stops seeding and evolution proper begins (a segment-meaningful live-region beat). */
export const CURTAIN_LINE = 'Gene pool seeded · evolution begins';

/** First-encounter title cards: the beat shown the FIRST time each environment appears. Purely
 *  narrative framing over the schedule the optimizer already chose - it names what the probe does
 *  and which organisms tuned it, and never claims anything the copy in COPY does not. */
export const ENV_BEATS: Record<InstrumentId, { title: string; sub: string }> = {
  track: { title: 'The open-air intercept', sub: 'Hold your lead on the weaving prey · dragonfly and falcon' },
  flick: { title: 'The ambush', sub: 'Break-cover targets to snap and lock · spider and raptor' },
  calibrate: { title: 'Shooting through the bend', sub: 'Learn the gap between aim and impact · archerfish' },
  strike: { title: 'The strike window', sub: 'Commit the instant you see it · mantis shrimp' },
};

/** The dialed-in panel's budget line: plain facts the lock/refine choice actually turns on - trials
 *  spent against the hard cap, and what "keep refining" would really do (run more, or lock at cap). */
export function dialedBudget(used: number, max: number, refineGens: number): string {
  return used >= max
    ? `${used} of ${max} trials used · the budget is spent, so refining would lock this in`
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
        <h1 class="sr-only" id="session-title">The hunt</h1>
        <canvas class="session__canvas"></canvas>
        <div class="session__crosshair" aria-hidden="true"></div>
        <header class="session__hud mono" data-hud="bar"><span data-hud="instruction">Press begin to start</span>
          <span data-hud="progress"></span></header>
        <figure class="session__plot" data-plot-fig><svg data-plot aria-hidden="true"></svg>
          ${plotLegendHtml()}
          <span class="mono session__estimate-visual" data-hud="estimate-visual" aria-hidden="true"></span>
          <figcaption class="mono" data-hud="estimate" aria-live="polite" aria-atomic="true"></figcaption></figure>
        <div class="session__prelock" data-prelock>
          <span class="cal-pulse"><span class="cal-pulse__dot"></span></span>
          <p class="mono session__prelock-label">The hunt</p>
          <p class="session__prelock-lead" data-prelock-lead>Watch the prey break cover, then snap on and fire. Each
            round tests one sensitivity; the search evolves toward your sharpest counts per 360.</p>
          <p class="session__prelock-lead session__prelock-sub">${segmentShape(MIN_TRIALS, FIRST_SEGMENT)} When the
            search settles you can lock it in or keep refining. Press <kbd>Esc</kbd> any time to pause.</p>
          <div class="session__prelock-actions">
            <button class="action action--primary" data-prelock="begin">Begin</button>
            <button class="action action--ghost" data-prelock="back">Back to setup</button>
          </div>
        </div>
        <div class="session__beat" data-beat aria-hidden="true" hidden>
          <p class="session__beat-title" data-beat-title></p>
          <p class="mono session__beat-sub" data-beat-sub></p>
        </div>
        <div class="session__dialed" data-panel role="dialog" aria-label="Dialed in" hidden>
          <p class="mono session__dialed-label">Dialed in</p>
          <p class="display session__dialed-num"><span data-dialed="num"></span><small> counts per 360</small></p>
          <p class="mono session__dialed-ci">90% CI <span data-dialed="ci"></span></p>
          <p class="session__dialed-concord" data-dialed="concord" hidden></p>
          <p class="mono session__dialed-budget" data-dialed="budget"></p>
          <div class="session__dialed-actions">
            <button class="action action--primary" data-dialed="lock">Lock it in</button>
            <button class="action action--ghost" data-dialed="refine">Keep refining</button>
          </div>
        </div>
        <div class="session__abort" data-abort role="dialog" aria-label="Session paused" hidden>
          <p class="mono session__abort-label">Paused</p>
          <p class="session__abort-lead">The run is held right here. Resume puts the cursor back and carries on from
            the same trial.</p>
          <p class="session__abort-note" data-abort="note" hidden></p>
          <div class="session__abort-actions" data-abort="choices">
            <button class="action action--primary" data-abort="resume">Resume</button>
            <button class="action action--ghost" data-abort="quit">Quit and discard this run</button>
          </div>
          <div data-abort="confirm" hidden>
            <p class="session__abort-lead">Quitting throws away every trial in this run. Nothing is saved, and the
              next run starts the search from scratch.</p>
            <div class="session__abort-actions">
              <button class="action action--primary" data-abort="confirm-quit">Discard the run and quit</button>
              <button class="action action--ghost" data-abort="cancel">Keep the run</button>
            </div>
          </div>
        </div>
        <div class="session__abort" data-error role="dialog" aria-label="The run stopped" hidden>
          <p class="mono session__abort-label">The run stopped</p>
          <p class="session__abort-lead">Something went wrong mid-run. I stopped before scoring a trial I can't
            trust, and nothing was saved.</p>
          <div class="session__abort-actions">
            <button class="action action--primary" data-error="quit">Back to the menu</button>
          </div>
        </div>`;
      host.appendChild(root);
      // The screen's own <h1> names the landmark: the shell moves focus onto <main> after mount,
      // so labelling it from the title is what a screen reader hears on arrival.
      host.setAttribute('aria-labelledby', 'session-title');

      const canvas = root.querySelector('canvas') as HTMLCanvasElement;
      const svg = root.querySelector('[data-plot]') as unknown as SVGElement;
      const hudInstruction = root.querySelector('[data-hud="instruction"]')!;
      const hudProgress = root.querySelector('[data-hud="progress"]')!;
      const hudEstimate = root.querySelector('[data-hud="estimate"]')!;        // aria-live: meaningful moments only
      const hudEstimateVisual = root.querySelector('[data-hud="estimate-visual"]')!; // per-trial visual readout (aria-hidden)
      const panel = root.querySelector('[data-panel]') as HTMLElement;
      const prelock = root.querySelector('[data-prelock]') as HTMLElement;
      const prelockLead = root.querySelector('[data-prelock-lead]') as HTMLElement;
      const beginBtn = root.querySelector('[data-prelock="begin"]') as HTMLButtonElement;
      const abort = root.querySelector('[data-abort]') as HTMLElement;
      const errorEl = root.querySelector('[data-error]') as HTMLElement;
      const hudBar = root.querySelector('[data-hud="bar"]') as HTMLElement;
      const plotFig = root.querySelector('[data-plot-fig]') as HTMLElement;
      const $d = (s: string) => root.querySelector(`[data-dialed="${s}"]`) as HTMLElement;
      const $a = (s: string) => root.querySelector(`[data-abort="${s}"]`) as HTMLButtonElement;
      // The HUD and the plot are the only background content behind an open overlay; both go
      // inert so a Tab from inside a dialog cannot walk out into them.
      const behind = [hudBar, plotFig];

      const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const stage = createStage(root, { canvas, counts: ctx.draft.bounds[0], reducedMotion: reduced });
      const engine = makeEvolution({ gp: { signalVar: 1, lengthScale: 0.6, noiseVar: 0.1 }, sigma0: 0.3, maxTrials: MAX_TRIALS });

      let allTrials: TrialResult[] = [];
      // Every reach the anchor read, across every segment of this visit. Accumulated rather than
      // replaced: "keep refining" runs a second runSession with its own ReachObserver, so its
      // outcome carries only its own trials' reaches, and overwriting would hand the estimator a
      // fraction of the session. It would then REFUSE rather than error, which is a silent loss
      // wearing an honest refusal (pinned by 'accumulates reaches across segments').
      let allReaches: FirstReach[] = [];
      let leadInDiscarded = 0;
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
          curve: report.curve, ci90: report.ci90, peak: report.optimalCounts,
          size: { width: svg.clientWidth || 360, height: svg.clientHeight || 180 },
        });
        renderConvergencePlot(svg, g, 'blended score');
        // Per-trial visual readout only (aria-hidden): the live region stays quiet until a meaningful
        // moment. Range spelled " to " so no en-dash glyph ever reaches assistive tech.
        hudEstimateVisual.textContent = `Most-evolved · ${report.optimalCounts.toFixed(1)} counts per 360 · 90% CI ${report.ci90[0].toFixed(1)} to ${report.ci90[1].toFixed(1)}`;
      };

      const runSegment = async (maxTrials: number, ciStopWidth: number | undefined): Promise<void> => {
        if (running) return; // re-entry guard at the source: a second concurrent launch (a stacked
        // begin double-click inside the async lock window, or any future caller) must never interleave
        // the SHARED stateful (1+lambda)-ES engine + allTrials buffer. `running` is set synchronously
        // below before the first await, so the second microtask sees it true and bails. counts per 360 is never
        // at risk (the gold sphere owns it); this protects the search lineage + live plot consistency.
        running = true;
        // try/finally, so a throw anywhere under here releases `running`. Without it one failure
        // leaves the flag stuck true forever: the abort scrim's gate stays armed, "keep refining"
        // is dead behind its own guard, and the session freezes with nothing on screen to say so.
        try {
          const outcome = await runSession({
            profile: ctx.draft.profile, bounds: ctx.draft.bounds,
            engine, instruments: INSTRUMENTS, scene: stage.arena, schedule: SCHEDULE,
            maxTrials, coldStart: COLD_START, rng: mulberry32(2026), minTrials: MIN_TRIALS,
            ...(ciStopWidth !== undefined ? { ciStopWidth } : {}),
            bootstrapIters: 300, initialTrials: allTrials, shouldStop: () => lockedIn,
            onTrialStart: (id, i, counts) => {
              hudInstruction.textContent = instructionFor(id);
              hudProgress.textContent = searchLabel(i, counts, COLD_START, maxTrials);
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
                showBeat('Evolution begins', 'The gene pool is seeded · each round now tests one mutated sensitivity');
              }
              stage.setEnemyEnvironment(id); // skin this trial's targets with the environment's prey
              stage.arena.clearTargets();
            },
            onTrial: (_t, trials2, interim) => { lastReport = interim; drawPlot(interim, trials2); },
          });
          allTrials = outcome.trials;
          lastReport = outcome.report;
          // Concatenated, never assigned. See the declaration of allReaches above: a second segment
          // ran a second observer over its own trials only.
          allReaches = [...allReaches, ...outcome.reaches];
          leadInDiscarded += outcome.leadInDiscarded;
        } finally {
          running = false;
        }
      };

      const finalize = (): void => {
        if (!alive || !lastReport) return;
        const report = lastReport;
        // Identity is the clock, not the outcome: a content-derived id made two runs that matched
        // on trial count and optimum overwrite each other in both stores, and a hardcoded
        // createdAt: 0 left every record unsortable and unprunable.
        const now = Date.now();
        const sessionId = `s-${now}-${allTrials.length}`;
        // The two anchor routes meet here and nowhere else, because this is the only place both
        // exist: the blind turn was written to the draft at setup, and the reaches came out of the
        // segments above. reconcile returns null when neither route spoke, and null is passed
        // through as ABSENCE rather than widened into a guess: buildPrescription then withholds the
        // factor and the screen says so. Order is load bearing only in that each argument is the
        // previous result; nothing here refits anything.
        const anchor = reconcile(ctx.draft.turn ?? null, anchorFromReaches(allReaches));
        const result = buildResult(report, allTrials, {
          bounds: ctx.draft.bounds,
          profile: ctx.draft.profile,
          // Spread conditionally, not passed as undefined: exactOptionalPropertyTypes draws a
          // distinction between an absent option and one present with the value undefined, and the
          // absent one is what "no anchor this session" means.
          ...(anchor !== null ? { anchor } : {}),
          // Phase 3's pin, straight off the draft. Absent or unpinned costs tier two and never the
          // factor, because the factor is a ratio of two counts in the same browser units.
          ...(ctx.draft.kPin !== undefined ? { k: ctx.draft.kPin } : {}),
          // The card reading, but only when the guided path ran THIS run. The turn record is the
          // marker: setup writes it exactly when the guided commit does and every other route
          // clears it, so its presence proves the sweep and these trials shared one browser and
          // one count convention k, which is what the payoff's centimetre division cancels
          // (src/anchor/plausibility.ts). Without the gate, the saved-prefs fast path would ship
          // another visit's reading under this run's counts, and the screen would print a
          // confident length the pair never earned. Pinned in tests/ui/session-view.test.ts
          // 'a fast-path draft (dpi without a turn) never stamps the reading'.
          ...(ctx.draft.turn !== undefined && ctx.draft.dpi !== undefined ? { dpi: ctx.draft.dpi } : {}),
        });
        ctx.storage.saveSession({ id: sessionId, profile: ctx.draft.profile, trials: [...allTrials], status: 'complete', createdAt: now });
        ctx.storage.saveResult(sessionId, result);
        ctx.lastResult = { sessionId, result };
        rememberPrefs(ctx, sessionId); // point the returning-visitor restore at this result
        ctx.navigate('result');
      };

      // Only one overlay is ever open, so one handle is enough. Held so the trap can be released
      // and focus returned to whatever the user was on before the overlay appeared.
      let modal: ModalHandle | null = null;
      const closeModal = (): void => { modal?.release(); modal = null; };

      const showPanel = (report: Report): void => {
        stage.exitLock(); // hand the cursor back so the panel buttons are clickable
        drawPlot(report, allTrials);
        hudEstimate.textContent = announceEstimate(report); // dialed-in: a meaningful moment to announce
        $d('num').textContent = report.optimalCounts.toFixed(1);
        // " to ", never an en-dash: the range is read aloud as well as seen.
        $d('ci').textContent = `${report.ci90[0].toFixed(1)} to ${report.ci90[1].toFixed(1)} counts per 360`;
        // Decision support for lock-vs-refine: the CI-width bucket in its honesty-vetted copy (a
        // width observation, never a single-cause claim) plus the plain trial-budget facts.
        const concord = ciConcord(report.optimalCounts, report.ci90);
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
        // The panel already announces itself through the live region; what it was missing is focus.
        closeModal();
        modal = openModal(panel, { initialFocus: $d('lock') as HTMLButtonElement, inert: behind });
      };

      const begin = async (): Promise<void> => {
        // The reveal is now the in-scene 3D revolver's own look/fire motion (no named sprite draw anim).
        await runSegment(FIRST_SEGMENT, FIRST_STOP_CI);
        if (!alive) return;
        if (lockedIn) { finalize(); return; }
        showPanel(lastReport!);
      };

      // The paused scrim is a real modal: it takes focus, traps Tab while open, and hands focus
      // back on dismissal. Escape routes to resume, which is the only non-destructive way out.
      const abortNote = root.querySelector('[data-abort="note"]') as HTMLElement;
      const quitBtn = $a('quit');
      const quitChoices = root.querySelector('[data-abort="choices"]') as HTMLElement;
      const quitConfirm = root.querySelector('[data-abort="confirm"]') as HTMLElement;

      const setAbort = (show: boolean): void => {
        if (show === !abort.hidden) return;
        abort.hidden = !show;
        if (show) {
          quitConfirm.hidden = true; quitChoices.hidden = false; abortNote.hidden = true;
          hudEstimate.textContent = 'Session paused';
          closeModal();
          modal = openModal(abort, { initialFocus: $a('resume'), onEscape: () => resume(), inert: behind });
        } else {
          closeModal();
        }
      };

      // Resume dismisses ONLY once the lock is actually back. Hiding the scrim on a refused lock
      // (the ~1.5s post-Esc cooldown) would drop the user into an arena they cannot aim in, which
      // is the same failure bindRangeLock already refuses to ship.
      const resume = (): void => {
        void stage.requestLock().then(
          () => { if (alive) setAbort(false); },
          () => {
            if (!alive) return;
            abortNote.textContent = "Your browser hasn't handed the cursor back yet. Wait a second, then press resume again.";
            abortNote.hidden = false;
          },
        );
      };

      // A segment that throws leaves nothing to show and nothing to save. Say so and give the one
      // honest way out, rather than leaving a frozen arena the user cannot read or escape.
      const showFailure = (err: unknown): void => {
        if (!alive) return;
        console.error('[session] the run stopped', err);
        setAbort(false);
        closeModal();
        panel.hidden = true;
        errorEl.hidden = false;
        hudEstimate.textContent = 'The run stopped before it could finish';
        modal = openModal(errorEl, { initialFocus: root.querySelector('[data-error="quit"]') as HTMLButtonElement, inert: behind });
      };

      // Reveal the abort scrim ONLY when the lock dropped while a segment is mid-flight: lock dropped
      // AND running AND the dialed-in panel is hidden AND the user hasn't already committed. This is
      // pure SHELL wiring - it appends NO scored trial and never touches the gold target / counts.
      const syncAbort = (): void => {
        const lockDropped = document.pointerLockElement !== canvas;
        setAbort(lockDropped && running && panel.hidden && errorEl.hidden && !lockedIn);
      };
      document.addEventListener('pointerlockchange', syncAbort);

      $d('lock').addEventListener('click', () => { lockedIn = true; closeModal(); panel.hidden = true; finalize(); });
      $d('refine').addEventListener('click', () => {
        if (running) return;
        closeModal();
        panel.hidden = true;
        const target = Math.min(MAX_TRIALS, allTrials.length + REFINE_GENS);
        if (target <= allTrials.length) { finalize(); return; } // hit the cap - lock in
        void stage.requestLock().catch(() => {});
        void runSegment(target, undefined)
          .then(() => { if (alive && !lockedIn) showPanel(lastReport!); })
          .catch(showFailure);
      });

      $a('resume').addEventListener('click', resume);
      // Quitting discards every trial in the run, so it is never one click. The first press swaps
      // the scrim into the confirm state that says plainly what is about to be thrown away.
      quitBtn.addEventListener('click', () => {
        quitChoices.hidden = true;
        quitConfirm.hidden = false;
        $a('confirm-quit').focus();
      });
      $a('cancel').addEventListener('click', () => {
        quitConfirm.hidden = true;
        quitChoices.hidden = false;
        $a('resume').focus();
      });
      $a('confirm-quit').addEventListener('click', () => { closeModal(); ctx.navigate('hero'); });
      root.querySelector('[data-error="quit"]')!.addEventListener('click', () => { closeModal(); ctx.navigate('hero'); });

      // ONE start gesture, pinned to the focusable begin button (no canvas-click hybrid, so the start
      // path can never desync). The button hands off to the lock request, then the segment loop.
      // `startPending` is the synchronous half of the old { once: true }: it still collapses a stacked
      // double-click to one launch, but it can be released when the lock is DENIED so begin re-arms.
      let startPending = false;
      const onLockDenied = (): void => {
        if (!alive) return;
        startPending = false;
        prelock.hidden = false;
        // Starting the measurement without the lock would be an arena with no aim and no way out,
        // so nothing runs: the card comes back and says what happened.
        prelockLead.textContent = "Your browser wouldn't hide the cursor, so I haven't started anything. That usually "
          + 'means the last Esc is still cooling down, or the page is embedded without pointer lock. Press begin to try again.';
        beginBtn.textContent = 'Try again';
        beginBtn.focus();
      };
      beginBtn.addEventListener('click', () => {
        if (startPending || running) return;
        startPending = true;
        prelock.hidden = true;
        // Two-argument then(), so a rejected LOCK and a failed SEGMENT land in different places.
        void stage.requestLock().then(() => begin().catch(showFailure), onLockDenied);
      });
      root.querySelector('[data-prelock="back"]')!.addEventListener('click', () => { closeModal(); ctx.navigate('setup'); });

      cleanup = () => {
        alive = false;
        lockedIn = true; // break any in-flight segment so it never touches a torn-down context
        if (beatTimer !== null) clearTimeout(beatTimer);
        closeModal();
        document.removeEventListener('pointerlockchange', syncAbort);
        host.removeAttribute('aria-labelledby'); // the label's target leaves with the screen
        stage.dispose();
      };
    },
    unmount() { cleanup?.(); host.replaceChildren(); },
  };
}
