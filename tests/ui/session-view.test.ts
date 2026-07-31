// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { counts360, countsBounds } from '../../src/types';
import {
  marksFromTrials, instructionFor, searchLabel, announceEstimate, sessionView,
  CURTAIN_LINE, ENV_BEATS, dialedBudget, segmentShape, type SessionViewDeps,
} from '../../src/ui/session-view';
import type { AppContext } from '../../src/ui/shell';
import type { Counts360, InstrumentId, Report, TrialResult } from '../../src/types';
import type { SessionOutcome } from '../../src/optimizer/session-controller';
import type { FirstReach } from '../../src/anchor/flick-anchor';
import { turnFromPasses } from '../../src/anchor/reference-turn';
import type { ArenaStage } from '../../src/ui/arena-stage';

describe('session-view helpers', () => {
  it('frames the loop as evolution - gene-pool seeding, then numbered generations testing a sensitivity', () => {
    // The thesis ("generations of sensitivities") must be visible: cold-start trials are Generation 0
    // (the initial gene pool); after that each trial is a numbered generation testing one count total.
    expect(searchLabel(0, 18, 8, 20)).toBe('Gen 0 · seeding the gene pool · trial 1 of 20 · testing 18.0 counts per 360');
    expect(searchLabel(8, 32.37, 8, 20)).toBe('Generation 1 · trial 9 of 20 · testing 32.4 counts per 360');
    expect(searchLabel(11, 30, 8, 20)).toBe('Generation 4 · trial 12 of 20 · testing 30.0 counts per 360');
  });

  it('always carries a denominator, so the run never reads as open-ended', () => {
    // Behind one "begin" click sit minutes of drills. Every progress line has to say how far
    // through the segment you are, not just which generation is running.
    for (const i of [0, 5, 8, 19]) expect(searchLabel(i, 30, 8, 20)).toContain(`of 20`);
  });

  it('states the shape of the commitment before begin, from the constants the segment runs on', () => {
    expect(segmentShape(12, 20)).toContain('12 to 20 rounds');
    expect(segmentShape(12, 20)).toMatch(/minutes/);
  });

  it('maps trials to plot marks preserving counts/score/instrument', () => {
    const trials: TrialResult[] = [
      { instrument: 'flick', counts: counts360(30), score: 0.4, raw: {}, at: 0 },
      { instrument: 'track', counts: counts360(42), score: -0.1, raw: {}, at: 0 },
    ];
    expect(marksFromTrials(trials)).toEqual([
      { counts: counts360(30), score: 0.4, instrument: 'flick' },
      { counts: counts360(42), score: -0.1, instrument: 'track' },
    ]);
  });

  it('gives each instrument human instruction copy that names its organism', () => {
    expect(instructionFor('track').toLowerCase()).toMatch(/track|dragonfly|falcon/);
    expect(instructionFor('flick').toLowerCase()).toMatch(/flick|spider|snap/);
    expect(instructionFor('calibrate').toLowerCase()).toMatch(/calibrat|archerfish|bias/);
    expect(instructionFor('strike').toLowerCase()).toMatch(/strike|shrimp|fast/);
  });
});

// ── P4-2: exit/abort scrim + pre-lock begin state ──────────────────────────────

function fakeContext(): { ctx: AppContext; saveSession: ReturnType<typeof vi.fn>; saveResult: ReturnType<typeof vi.fn>; navigate: ReturnType<typeof vi.fn> } {
  const saveSession = vi.fn();
  const saveResult = vi.fn();
  const navigate = vi.fn();
  const ctx = {
    navigate,
    route: 'session',
    storage: { saveSession, loadSessions: () => [], saveResult, exportJson: () => '' },
    draft: {
      dpi: 800, currentGame: 'cs2', currentSens: 1,
      profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
      bounds: [15, 60] as [number, number],
    },
  } as unknown as AppContext;
  return { ctx, saveSession, saveResult, navigate };
}

/** A fake ArenaStage that records lock calls and dispose count; never touches WebGL. */
function fakeStage(denyLock = false): { stage: ArenaStage; requestLock: ReturnType<typeof vi.fn>; exitLock: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> } {
  const requestLock = vi.fn(() => (denyLock ? Promise.reject(new Error('denied')) : Promise.resolve('raw')));
  const exitLock = vi.fn();
  const dispose = vi.fn();
  const stage = {
    arena: { clearTargets: vi.fn() } as unknown as ArenaStage['arena'],
    requestLock, exitLock, dispose,
    setCounts: vi.fn(), setEnemyEnvironment: vi.fn(), isLocked: () => false,
    ready: Promise.resolve(),
  } as unknown as ArenaStage;
  return { stage, requestLock, exitLock, dispose };
}

/** Drive a mount with injected deps; the segment runner is a deferred we can hold open so the
 *  abort scrim's `running` gate is satisfiable mid-flight. */
function mountWithRunningSegment(opts: { denyLock?: boolean } = {}) {
  const { ctx, saveSession, saveResult, navigate } = fakeContext();
  const { stage, requestLock, exitLock, dispose } = fakeStage(opts.denyLock);
  const host = document.createElement('div');
  document.body.appendChild(host);

  let resolveSegment: ((v: SessionOutcome) => void) | null = null;
  let rejectSegment: ((e: unknown) => void) | null = null;
  const runSegment = vi.fn(() => new Promise<SessionOutcome>((res, rej) => {
    resolveSegment = res; rejectSegment = rej;
  }));

  const deps: SessionViewDeps = { createStage: () => stage, runSession: runSegment };
  const screen = sessionView(host, ctx, deps);
  screen.mount();

  const root = host.querySelector('.session') as HTMLElement;
  return {
    host, root, screen, ctx, stage, requestLock, exitLock, dispose, saveSession, saveResult, navigate,
    runSegment, getResolve: () => resolveSegment, getReject: () => rejectSegment,
  };
}

function dropLock(): void {
  // Simulate the browser firing pointerlockchange with no locked element (the Esc/abort case).
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: null });
  document.dispatchEvent(new Event('pointerlockchange'));
}

/** Flush microtasks so the begin button's requestLock().then(begin) chain has set running=true. */
const flush = (): Promise<void> => Promise.resolve().then(() => undefined);

describe('session-view: assistive-tech narration (P4-3)', () => {
  it('marks the decorative convergence plot aria-hidden', () => {
    const { root, screen } = mountWithRunningSegment();
    const svg = root.querySelector('[data-plot]') as unknown as SVGElement;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    screen.unmount();
  });

  it('makes the estimate figcaption a polite + atomic live region', () => {
    const { root, screen } = mountWithRunningSegment();
    const cap = root.querySelector('[data-hud="estimate"]')!;
    expect(cap.getAttribute('aria-live')).toBe('polite');
    expect(cap.getAttribute('aria-atomic')).toBe('true');
    screen.unmount();
  });

  it('announces a concise summary using " to " for the range, never an en-dash glyph', () => {
    expect(announceEstimate({ optimalCounts: counts360(32.4), ci90: countsBounds(29.1, 36.0) } as Report))
      .toBe('Dialed in around 32.4 counts per 360, 90% CI 29.1 to 36.0');
    expect(announceEstimate({ optimalCounts: counts360(32.4), ci90: countsBounds(29.1, 36.0) } as Report)).not.toContain('–');
  });
});

describe('session-view: pre-lock begin state (P4-2)', () => {
  it('opens by pointing at the begin button (the real start gesture), never the retired canvas-click copy', () => {
    const { root, screen } = mountWithRunningSegment();
    const hud = root.querySelector('[data-hud="instruction"]')!;
    expect(hud.textContent).toBe('Press begin to start');
    expect(hud.textContent!.toLowerCase()).not.toContain('click'); // the canvas-click start is retired
    screen.unmount();
  });

  it('names the screen with an <h1> and labels the landmark from it, so arrival announces the title', () => {
    const { host, root, screen } = mountWithRunningSegment();
    const h1 = root.querySelector('h1') as HTMLHeadingElement;
    expect(h1.textContent).toBe('The hunt');
    // The shell focuses the <main> landmark after mount; aria-labelledby makes this h1 what a
    // screen reader hears at that moment, instead of an unnamed region.
    expect(host.getAttribute('aria-labelledby')).toBe(h1.id);
    screen.unmount();
    expect(host.getAttribute('aria-labelledby')).toBeNull(); // the label leaves with its target
  });

  it('exposes a single focusable begin button (pinned start gesture, not a canvas-click hybrid)', () => {
    const { root, screen } = mountWithRunningSegment();
    const begin = root.querySelector('[data-prelock="begin"]') as HTMLButtonElement;
    expect(begin).toBeTruthy();
    expect(begin.tagName).toBe('BUTTON');
    screen.unmount();
  });

  it('begin is a one-shot: a stacked double-click launches exactly ONE segment (no interleaved ES lineage)', async () => {
    // Two queued clicks inside the async lock window must not start two concurrent segments that
    // share the stateful (1+lambda)-ES engine + trial buffer. The { once:true } listener plus the
    // runSegment re-entry guard together collapse a double-click to a single launch. The count total is never
    // at risk regardless (the gold sphere owns it); this protects the search lineage + live plot.
    const { root, screen, requestLock, runSegment } = mountWithRunningSegment();
    const begin = root.querySelector('[data-prelock="begin"]') as HTMLButtonElement;
    begin.click();
    begin.click(); // stacked double-click
    await flush();
    expect(requestLock).toHaveBeenCalledTimes(1);
    expect(runSegment).toHaveBeenCalledTimes(1); // exactly one segment runner invoked
    screen.unmount();
  });
});

describe('session-view: abort scrim (P4-2)', () => {
  it('reveals ONLY when lock dropped AND running AND panel hidden AND !lockedIn', async () => {
    const { root, screen, requestLock } = mountWithRunningSegment();
    const scrim = root.querySelector('[data-abort]') as HTMLElement;
    expect(scrim.hidden).toBe(true); // not running yet

    // Start a segment (held open): now running === true.
    (root.querySelector('[data-prelock="begin"]') as HTMLButtonElement).click();
    expect(requestLock).toHaveBeenCalledTimes(1);
    await flush(); // requestLock().then(begin) → running = true

    // Lock has not dropped yet → still hidden.
    expect(scrim.hidden).toBe(true);

    // Esc drops the lock mid-flight → scrim reveals.
    dropLock();
    expect(scrim.hidden).toBe(false);
    screen.unmount();
  });

  it('resume calls requestLock ONLY: appends NO scored trial, no navigate, no dispose', async () => {
    const { root, screen, requestLock, saveSession, navigate, dispose } = mountWithRunningSegment();
    (root.querySelector('[data-prelock="begin"]') as HTMLButtonElement).click();
    await flush();
    requestLock.mockClear();
    dropLock();

    const scrim = root.querySelector('[data-abort]') as HTMLElement;
    expect(scrim.hidden).toBe(false);
    (root.querySelector('[data-abort="resume"]') as HTMLButtonElement).click();
    await flush();

    expect(requestLock).toHaveBeenCalledTimes(1);   // ONLY requestLock
    expect(saveSession).not.toHaveBeenCalled();      // no scored trial stream persisted
    expect(navigate).not.toHaveBeenCalled();         // resume does not leave
    expect(dispose).not.toHaveBeenCalled();          // resume does not tear down
    expect(scrim.hidden).toBe(true);                 // scrim dismissed
    screen.unmount();
  });

  it('resume keeps the scrim up when the lock is REFUSED, and says why', async () => {
    // Hiding the scrim on a refused lock (the ~1.5s post-Esc cooldown) would drop the user into
    // an arena they cannot aim in and cannot leave. Same contract bindRangeLock already holds.
    const { root, screen } = mountWithRunningSegment({ denyLock: true });
    (root.querySelector('[data-prelock="begin"]') as HTMLButtonElement).click();
    await flush();
    // A denied lock never starts the run, so drive the paused state through a granted one instead.
    screen.unmount();

    const live = mountWithRunningSegment();
    (live.root.querySelector('[data-prelock="begin"]') as HTMLButtonElement).click();
    await flush();
    dropLock();
    const scrim = live.root.querySelector('[data-abort]') as HTMLElement;
    live.requestLock.mockImplementation(() => Promise.reject(new Error('cooldown')));
    (live.root.querySelector('[data-abort="resume"]') as HTMLButtonElement).click();
    await flush();
    await flush();
    expect(scrim.hidden).toBe(false);
    const note = live.root.querySelector('[data-abort="note"]') as HTMLElement;
    expect(note.hidden).toBe(false);
    expect(note.textContent!.toLowerCase()).toContain('cursor');
    live.screen.unmount();
  });

  it('the paused scrim is a real dialog: named, aria-modal, focused, with the background inert', async () => {
    const { root, screen } = mountWithRunningSegment();
    (root.querySelector('[data-prelock="begin"]') as HTMLButtonElement).click();
    await flush();
    dropLock();

    const scrim = root.querySelector('[data-abort]') as HTMLElement;
    expect(scrim.getAttribute('role')).toBe('dialog');
    expect(scrim.getAttribute('aria-label')).toBe('Session paused');
    expect(scrim.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(root.querySelector('[data-abort="resume"]'));
    expect((root.querySelector('[data-hud="bar"]') as HTMLElement).hasAttribute('inert')).toBe(true);
    // and it is announced, not just drawn
    expect(root.querySelector('[data-hud="estimate"]')!.textContent).toBe('Session paused');
    screen.unmount();
  });

  it('Tab cycles inside the paused dialog instead of walking into the arena behind it', async () => {
    const { root, screen } = mountWithRunningSegment();
    (root.querySelector('[data-prelock="begin"]') as HTMLButtonElement).click();
    await flush();
    dropLock();

    const quit = root.querySelector('[data-abort="quit"]') as HTMLButtonElement;
    quit.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(root.querySelector('[data-abort="resume"]'));
    screen.unmount();
  });

  it('quit is never one click: it confirms, says what is thrown away, and only then navigates', async () => {
    // The run lives entirely in screen-local state until finalize(), so quitting discards every
    // trial. A single ghost button next to "resume" made that a one-click accident.
    const { root, screen, navigate, saveSession, dispose } = mountWithRunningSegment();
    (root.querySelector('[data-prelock="begin"]') as HTMLButtonElement).click();
    await flush();
    dropLock();

    const quit = root.querySelector('[data-abort="quit"]') as HTMLButtonElement;
    expect(quit.textContent!.toLowerCase()).toContain('discard');
    quit.click();
    expect(navigate).not.toHaveBeenCalled();          // the first press only opens the confirm

    const confirm = root.querySelector('[data-abort="confirm"]') as HTMLElement;
    expect(confirm.hidden).toBe(false);
    expect(confirm.textContent!.toLowerCase()).toContain('nothing is saved');
    expect(document.activeElement).toBe(root.querySelector('[data-abort="confirm-quit"]'));

    // backing out returns to the paused choices and still has not navigated
    (root.querySelector('[data-abort="cancel"]') as HTMLButtonElement).click();
    expect(confirm.hidden).toBe(true);
    expect(navigate).not.toHaveBeenCalled();

    quit.click();
    (root.querySelector('[data-abort="confirm-quit"]') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('hero');
    expect(saveSession).not.toHaveBeenCalled();      // no scored trial appended on the way out

    // The shell's unmount→cleanup disposes ONCE (guarded). Quit must not add a second dispose.
    screen.unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

describe('session-view: pointer-lock denial (never start a run you cannot play)', () => {
  it('does NOT start the measurement, restores the card, and re-arms begin', async () => {
    const { root, screen, runSegment } = mountWithRunningSegment({ denyLock: true });
    const prelock = root.querySelector('[data-prelock]') as HTMLElement;
    const begin = root.querySelector('[data-prelock="begin"]') as HTMLButtonElement;
    begin.click();
    await flush();
    await flush();

    expect(runSegment).not.toHaveBeenCalled();       // nothing scored, nothing running
    expect(prelock.hidden).toBe(false);              // the card is back, not a dead arena
    expect((root.querySelector('[data-prelock-lead]') as HTMLElement).textContent!.toLowerCase())
      .toContain('cursor');
    expect(document.activeElement).toBe(begin);      // and the way out is under the keyboard
    screen.unmount();
  });

  it('a re-armed begin can still start the run once the lock is granted', async () => {
    const { root, screen, requestLock, runSegment } = mountWithRunningSegment({ denyLock: true });
    const begin = root.querySelector('[data-prelock="begin"]') as HTMLButtonElement;
    begin.click();
    await flush();
    await flush();

    requestLock.mockImplementation(() => Promise.resolve('raw'));
    begin.click();
    await flush();
    expect(runSegment).toHaveBeenCalledTimes(1);
    screen.unmount();
  });

  it('the pre-run card has a way out, so the state before begin is not a trap', () => {
    const { root, screen, navigate } = mountWithRunningSegment();
    (root.querySelector('[data-prelock="back"]') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith('setup');
    screen.unmount();
  });
});

describe('session-view: a segment that throws is recoverable and visible', () => {
  it('surfaces a failure notice instead of freezing, and never persists a partial run', async () => {
    const { root, screen, getReject, saveSession, navigate } = mountWithRunningSegment();
    (root.querySelector('[data-prelock="begin"]') as HTMLButtonElement).click();
    await flush();
    getReject()!(new Error('degenerate condition'));
    await flush();
    await flush();

    const err = root.querySelector('[data-error]') as HTMLElement;
    expect(err.hidden).toBe(false);
    expect(err.getAttribute('role')).toBe('dialog');
    expect(document.activeElement).toBe(root.querySelector('[data-error="quit"]'));
    expect(saveSession).not.toHaveBeenCalled();
    expect(root.querySelector('[data-hud="estimate"]')!.textContent).toContain('stopped');

    (root.querySelector('[data-error="quit"]') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith('hero');
    screen.unmount();
  });

  it('releases the running flag, so "keep refining" is not dead behind its own guard', async () => {
    const { root, screen, getReject, runSegment, getResolve } = mountWithRunningSegment();
    (root.querySelector('[data-prelock="begin"]') as HTMLButtonElement).click();
    await flush();
    getReject()!(new Error('boom'));
    await flush();
    await flush();

    // If `running` were still true the refine handler would return at its guard and call nothing.
    (root.querySelector('[data-dialed="refine"]') as HTMLButtonElement).click();
    expect(runSegment).toHaveBeenCalledTimes(2);
    expect(getResolve()).toBeTypeOf('function');
    screen.unmount();
  });
});

// ── Phase C: session flow beats - curtain line, first encounters, dialed-in decision support ──

describe('session-view flow-beat helpers (pure)', () => {
  it('names a first-encounter beat for every environment, matching the instruction organisms', () => {
    for (const id of ['track', 'flick', 'calibrate', 'strike'] as InstrumentId[]) {
      expect(ENV_BEATS[id].title.length).toBeGreaterThan(0);
      expect(ENV_BEATS[id].sub.length).toBeGreaterThan(0);
    }
    expect(ENV_BEATS.flick.sub).toContain('spider');
    expect(ENV_BEATS.strike.sub).toContain('mantis');
  });

  it('dialedBudget states the plain facts for both under-cap and at-cap', () => {
    expect(dialedBudget(20, 30, 6)).toBe('20 of 30 trials used · refining runs up to 6 more generations');
    // at the cap, "keep refining" actually locks in - the copy must say so, not promise more trials
    expect(dialedBudget(30, 30, 6)).toContain('refining would lock this in');
  });
});

/** Drive the mounted view's onTrialStart through the captured session config (the injectable seam). */
function capturedConfig(runSegment: ReturnType<typeof vi.fn>): { onTrialStart: (id: InstrumentId, i: number, cm: number) => void } {
  const cfg = runSegment.mock.calls[0]![0] as { onTrialStart: (id: InstrumentId, i: number, cm: number) => void };
  expect(cfg.onTrialStart).toBeTypeOf('function');
  return cfg;
}

describe('session-view: first-encounter beats + the seed curtain (Phase C)', () => {
  it('shows a title card the FIRST time an environment appears, and not on repeats', async () => {
    const { root, screen, runSegment } = mountWithRunningSegment();
    (root.querySelector('[data-prelock="begin"]') as HTMLButtonElement).click();
    await flush();
    const cfg = capturedConfig(runSegment);
    const beat = root.querySelector('[data-beat]') as HTMLElement;
    expect(beat.hidden).toBe(true);

    cfg.onTrialStart('flick', 0, 30);
    expect(beat.hidden).toBe(false);
    expect(root.querySelector('[data-beat-title]')!.textContent).toBe(ENV_BEATS.flick.title);

    // a NEW environment re-beats with its own card...
    cfg.onTrialStart('track', 1, 28);
    expect(root.querySelector('[data-beat-title]')!.textContent).toBe(ENV_BEATS.track.title);

    // ...but repeating an already-seen environment does not re-title the card
    cfg.onTrialStart('flick', 2, 26);
    expect(root.querySelector('[data-beat-title]')!.textContent).toBe(ENV_BEATS.track.title);
    screen.unmount();
  });

  it('the beat card is aria-hidden decoration - the live region carries the words', async () => {
    const { root, screen, runSegment } = mountWithRunningSegment();
    (root.querySelector('[data-prelock="begin"]') as HTMLButtonElement).click();
    await flush();
    capturedConfig(runSegment).onTrialStart('flick', 0, 30);
    expect((root.querySelector('[data-beat]') as HTMLElement).getAttribute('aria-hidden')).toBe('true');
    screen.unmount();
  });

  it('drops the curtain ONCE at the first trial past Generation 0, winning the live region on a tie', async () => {
    const { root, screen, runSegment } = mountWithRunningSegment();
    (root.querySelector('[data-prelock="begin"]') as HTMLButtonElement).click();
    await flush();
    const cfg = capturedConfig(runSegment);
    const live = root.querySelector('[data-hud="estimate"]')!;

    cfg.onTrialStart('flick', 7, 30); // still Generation 0 (COLD_START = 8)
    expect(live.textContent).not.toBe(CURTAIN_LINE);

    cfg.onTrialStart('track', 8, 30); // the first evolved trial AND an instrument change - curtain wins
    expect(live.textContent).toBe(CURTAIN_LINE);
    expect(root.querySelector('[data-beat-title]')!.textContent).toBe('Evolution begins');

    cfg.onTrialStart('calibrate', 9, 30); // later beats resume normal announcements
    expect(live.textContent).toBe(instructionFor('calibrate'));
    screen.unmount();
  });

  it('reduced motion: no beat card ever shows (the HUD copy carries the beats)', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    try {
      const { root, screen, runSegment } = mountWithRunningSegment();
      (root.querySelector('[data-prelock="begin"]') as HTMLButtonElement).click();
      await flush();
      capturedConfig(runSegment).onTrialStart('flick', 0, 30);
      expect((root.querySelector('[data-beat]') as HTMLElement).hidden).toBe(true);
      screen.unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('session-view: dialed-in decision support (Phase C)', () => {
  const REPORT: Report = {
    optimalCounts: counts360(32.4), ci90: countsBounds(32.0, 32.6), // tight
    curve: [{ x: Math.log(20), mean: 0.1 }, { x: Math.log(40), mean: 0.4 }],
  } as Report;
  const TRIALS: TrialResult[] = [
    { instrument: 'flick', counts: counts360(30), score: 0.4, raw: {}, at: 0 },
    { instrument: 'track', counts: counts360(34), score: 0.5, raw: {}, at: 0 },
  ];

  it('the panel shows the CI-concord line (width bucket, honesty copy) and the trial budget', async () => {
    const { root, screen, runSegment, getResolve } = mountWithRunningSegment();
    (root.querySelector('[data-prelock="begin"]') as HTMLButtonElement).click();
    await flush();
    expect(runSegment).toHaveBeenCalledTimes(1);
    getResolve()!({ report: REPORT, trials: TRIALS, reaches: [], leadInDiscarded: 0 });
    await flush();
    await flush();

    const panel = root.querySelector('[data-panel]') as HTMLElement;
    expect(panel.hidden).toBe(false);
    const concord = root.querySelector('[data-dialed="concord"]') as HTMLElement;
    expect(concord.hidden).toBe(false);
    expect(concord.getAttribute('data-concord')).toBe('tight');
    expect(concord.textContent!.toLowerCase()).toContain('concur');
    expect(root.querySelector('[data-dialed="budget"]')!.textContent).toBe(dialedBudget(TRIALS.length, 30, 6));
    screen.unmount();
  });

  it('hides the concord line for a degenerate CI - no descriptor is fabricated', async () => {
    const { root, screen, getResolve } = mountWithRunningSegment();
    (root.querySelector('[data-prelock="begin"]') as HTMLButtonElement).click();
    await flush();
    getResolve()!({ report: { ...REPORT, ci90: countsBounds(NaN, NaN) }, trials: TRIALS, reaches: [], leadInDiscarded: 0 });
    await flush();
    await flush();
    expect((root.querySelector('[data-dialed="concord"]') as HTMLElement).hidden).toBe(true);
    screen.unmount();
  });

  it('locking in points the returning-visitor restore at the finalized session (Phase C)', async () => {
    const { root, screen, ctx, getResolve } = mountWithRunningSegment();
    const savedPrefs: unknown[] = [];
    ctx.storage.savePrefs = (p) => void savedPrefs.push(p);
    (root.querySelector('[data-prelock="begin"]') as HTMLButtonElement).click();
    await flush();
    getResolve()!({ report: REPORT, trials: TRIALS, reaches: [], leadInDiscarded: 0 });
    await flush();
    await flush();
    (root.querySelector('[data-dialed="lock"]') as HTMLButtonElement).click();
    expect(savedPrefs.length).toBe(1);
    expect((savedPrefs[0] as { lastSessionId?: string }).lastSessionId).toMatch(/^s-/);
    screen.unmount();
  });
});

describe('session-view: finalize reconciles the anchor and prescribes', () => {
  const c = counts360;
  const ci = (lo: number, hi: number): [Counts360, Counts360] => [c(lo), c(hi)];
  const REPORT: Report = {
    optimalCounts: c(6000),
    ci90: ci(5600, 6500),
    curve: [{ x: Math.log(5000), mean: 0.1 }, { x: Math.log(6000), mean: 0.4 }],
  } as Report;
  const TRIALS: TrialResult[] = [
    { instrument: 'flick', counts: c(5200), score: 0.4, raw: {}, at: 0 },
    { instrument: 'track', counts: c(6800), score: 0.5, raw: {}, at: 0 },
  ];
  /** A believed gain the reaches agree on, well away from the located optimum, so a factor of 1
   *  cannot pass by accident. */
  const B0 = 9000;
  const LEVELS = [4200, 4800, 5400, 6000, 6600, 7200, 7800, 8400];

  /** Reaches from an adapting player who believes B0, in the shape anchorFromReaches consumes. */
  const reaches = (trials: number, perTrial: number, from = 0): FirstReach[] => {
    const out: FirstReach[] = [];
    for (let t = from; t < from + trials; t++) {
      const rendered = LEVELS[t % LEVELS.length]!;
      const e0 = Math.log(B0) - Math.log(rendered);
      for (let j = 0; j < perTrial; j++) {
        out.push({
          rendered: c(rendered),
          landedFraction: Math.exp(e0 * Math.pow(0.6, j) + Math.log(0.94)),
          index: j,
        });
      }
    }
    return out;
  };

  const lockIn = async (
    outcome: SessionOutcome,
    prepare?: (ctx: AppContext) => void,
  ): Promise<AppContext> => {
    const h = mountWithRunningSegment();
    prepare?.(h.ctx);
    (h.root.querySelector('[data-prelock="begin"]') as HTMLButtonElement).click();
    await flush();
    h.getResolve()!(outcome);
    await flush();
    await flush();
    (h.root.querySelector('[data-dialed="lock"]') as HTMLButtonElement).click();
    h.screen.unmount();
    return h.ctx;
  };

  it('turns the reaches and the turn into a rendered factor, which is the whole change', async () => {
    const ctx = await lockIn(
      { report: REPORT, trials: TRIALS, reaches: reaches(6, 8), leadInDiscarded: 12 },
      (c2) => { c2.draft.turn = turnFromPasses([8900, 9050, 9000])!; },
    );
    const p = ctx.lastResult!.result.prescription;
    expect(p).toBeDefined();
    // The factor is the anchor over the located optimum, both counted in browser deltas. Around
    // 9000 / 6000, and the assertion is that it is a real quotient of two measured numbers rather
    // than 1.00, which is what an unwired seam would have produced by never rendering at all.
    expect(p!.ratio).toBeGreaterThan(1.3);
    expect(p!.ratio).toBeLessThan(1.7);
    expect(p!.ratioCi90![0]).toBeLessThan(p!.ratio!);
    expect(p!.ratioCi90![1]).toBeGreaterThan(p!.ratio!);
    expect(p!.counts).toBe(REPORT.optimalCounts);
  });

  it('the turn alone still anchors when the reaches refuse: the flick is a route, not a gate', async () => {
    const ctx = await lockIn(
      { report: REPORT, trials: TRIALS, reaches: [], leadInDiscarded: 0 },
      (c2) => { c2.draft.turn = turnFromPasses([8900, 9050, 9000])!; },
    );
    expect(ctx.lastResult!.result.prescription!.ratio).toBeGreaterThan(1.3);
  });

  it('neither route means no factor at all, never a padded one', async () => {
    // The honest degradation. reconcile returns null, buildPrescription is handed null, and with no
    // pinned k either there is nothing to prescribe: the screen leads with the located counts and
    // says the factor is withheld.
    const ctx = await lockIn({ report: REPORT, trials: TRIALS, reaches: [], leadInDiscarded: 0 });
    expect('prescription' in ctx.lastResult!.result).toBe(false);
    expect(ctx.lastResult!.result.optimalCounts).toBe(REPORT.optimalCounts);
  });

  it('stamps the card reading onto the Result when the guided run measured it alongside the turn', async () => {
    // Same-run pairing: the turn record proves the sweep and these trials shared one browser and
    // one count convention, which is what the payoff's centimetre division cancels.
    const ctx = await lockIn(
      { report: REPORT, trials: TRIALS, reaches: [], leadInDiscarded: 0 },
      (c2) => { c2.draft.turn = turnFromPasses([8900, 9050, 9000])!; },
    );
    expect(ctx.lastResult!.result.dpi).toBe(800);
  });

  it('a fast-path draft (dpi without a turn) never stamps the reading', async () => {
    // fakeContext writes dpi: 800 and no turn, the exact shape the saved-prefs fast path leaves:
    // a reading restored from another visit, riding a draft whose run measured nothing. Stamping
    // it would print a length whose count conventions never shared a browser.
    const ctx = await lockIn({ report: REPORT, trials: TRIALS, reaches: [], leadInDiscarded: 0 });
    expect('dpi' in ctx.lastResult!.result).toBe(false);
  });

  it('accumulates reaches across segments, because refining runs a second observer', async () => {
    // "Keep refining" calls runSession again, with its own ReachObserver, so its outcome carries
    // only the reaches of the trials it ran. Overwriting would hand the estimator a fraction of the
    // session's data, and the estimator would answer that with a REFUSAL rather than an error: the
    // loss would be silent and would look like a player who simply did not produce a clean read.
    // The two halves below are each below FLICK_MIN_REACHES and together are above it.
    // No turn on this draft: fakeContext() writes none, and exactOptionalPropertyTypes would reject
    // an explicit `= undefined` anyway, so absence is expressed by not writing the field.
    const h = mountWithRunningSegment();
    (h.root.querySelector('[data-prelock="begin"]') as HTMLButtonElement).click();
    await flush();
    h.getResolve()!({ report: REPORT, trials: TRIALS, reaches: reaches(4, 6), leadInDiscarded: 8 });
    await flush();
    await flush();
    (h.root.querySelector('[data-dialed="refine"]') as HTMLButtonElement).click();
    await flush();
    h.getResolve()!({ report: REPORT, trials: TRIALS, reaches: reaches(4, 6, 4), leadInDiscarded: 8 });
    await flush();
    await flush();
    (h.root.querySelector('[data-dialed="lock"]') as HTMLButtonElement).click();
    expect(h.ctx.lastResult!.result.prescription!.ratio).toBeGreaterThan(1.3);
    h.screen.unmount();
  });

  it('a single segment of the same size cannot anchor, so the test above is measuring the join', async () => {
    // The control for the accumulation test: 24 reaches is under FLICK_MIN_REACHES, so one half
    // alone refuses. Without this, the test above would pass on an implementation that simply kept
    // the LAST segment's reaches, and the whole assertion would be vacuous.
    const ctx = await lockIn({ report: REPORT, trials: TRIALS, reaches: reaches(4, 6), leadInDiscarded: 8 });
    expect('prescription' in ctx.lastResult!.result).toBe(false);
  });
});
