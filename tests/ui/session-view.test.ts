// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  marksFromTrials, instructionFor, searchLabel, announceEstimate, sessionView,
  CURTAIN_LINE, ENV_BEATS, dialedBudget, type SessionViewDeps,
} from '../../src/ui/session-view';
import type { AppContext } from '../../src/ui/shell';
import type { InstrumentId, Report, TrialResult } from '../../src/types';
import type { ArenaStage } from '../../src/ui/arena-stage';

describe('session-view helpers', () => {
  it('frames the loop as evolution - gene-pool seeding, then numbered generations testing a sensitivity', () => {
    // The thesis ("generations of sensitivities") must be visible: cold-start trials are Generation 0
    // (the initial gene pool); after that each trial is a numbered generation testing one cm/360.
    expect(searchLabel(0, 18, 8)).toBe('gen 0 · seeding the gene pool · testing 18.0 cm/360');
    expect(searchLabel(8, 32.37, 8)).toBe('generation 1 · testing 32.4 cm/360');
    expect(searchLabel(11, 30, 8)).toBe('generation 4 · testing 30.0 cm/360');
  });

  it('maps trials to plot marks preserving cm360/score/instrument', () => {
    const trials: TrialResult[] = [
      { instrument: 'flick', cm360: 30, score: 0.4, raw: {}, at: 0 },
      { instrument: 'track', cm360: 42, score: -0.1, raw: {}, at: 0 },
    ];
    expect(marksFromTrials(trials)).toEqual([
      { cm360: 30, score: 0.4, instrument: 'flick' },
      { cm360: 42, score: -0.1, instrument: 'track' },
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
function fakeStage(): { stage: ArenaStage; requestLock: ReturnType<typeof vi.fn>; exitLock: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> } {
  const requestLock = vi.fn(() => Promise.resolve('raw'));
  const exitLock = vi.fn();
  const dispose = vi.fn();
  const stage = {
    arena: { clearTargets: vi.fn() } as unknown as ArenaStage['arena'],
    requestLock, exitLock, dispose,
    setCm360: vi.fn(), setEnemyEnvironment: vi.fn(), isLocked: () => false,
    ready: Promise.resolve(),
  } as unknown as ArenaStage;
  return { stage, requestLock, exitLock, dispose };
}

/** Drive a mount with injected deps; the segment runner is a deferred we can hold open so the
 *  abort scrim's `running` gate is satisfiable mid-flight. */
function mountWithRunningSegment() {
  const { ctx, saveSession, saveResult, navigate } = fakeContext();
  const { stage, requestLock, exitLock, dispose } = fakeStage();
  const host = document.createElement('div');
  document.body.appendChild(host);

  let resolveSegment: ((v: { report: Report; trials: TrialResult[] }) => void) | null = null;
  const runSegment = vi.fn(() => new Promise<{ report: Report; trials: TrialResult[] }>((res) => { resolveSegment = res; }));

  const deps: SessionViewDeps = { createStage: () => stage, runSession: runSegment };
  const screen = sessionView(host, ctx, deps);
  screen.mount();

  const root = host.querySelector('.session') as HTMLElement;
  return { host, root, screen, ctx, stage, requestLock, exitLock, dispose, saveSession, saveResult, navigate, runSegment, getResolve: () => resolveSegment };
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
    expect(announceEstimate({ optimalCm360: 32.4, ci90: [29.1, 36.0] } as Report))
      .toBe('dialed in around 32.4 cm/360, 90% CI 29.1 to 36.0');
    expect(announceEstimate({ optimalCm360: 32.4, ci90: [29.1, 36.0] } as Report)).not.toContain('–');
  });
});

describe('session-view: pre-lock begin state (P4-2)', () => {
  it('opens on "click to begin" - never the lock-it-in commit copy', () => {
    const { root, screen } = mountWithRunningSegment();
    const hud = root.querySelector('[data-hud="instruction"]')!;
    expect(hud.textContent).toBe('click to begin');
    screen.unmount();
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
    // runSegment re-entry guard together collapse a double-click to a single launch. cm/360 is never
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

    expect(requestLock).toHaveBeenCalledTimes(1);   // ONLY requestLock
    expect(saveSession).not.toHaveBeenCalled();      // no scored trial stream persisted
    expect(navigate).not.toHaveBeenCalled();         // resume does not leave
    expect(dispose).not.toHaveBeenCalled();          // resume does not tear down
    expect(scrim.hidden).toBe(true);                 // scrim dismissed
    screen.unmount();
  });

  it('quit calls navigate("hero") ONLY: appends NO scored trial and does not double-dispose', async () => {
    const { root, screen, navigate, saveSession, dispose } = mountWithRunningSegment();
    (root.querySelector('[data-prelock="begin"]') as HTMLButtonElement).click();
    await flush();
    dropLock();

    (root.querySelector('[data-abort="quit"]') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('hero');
    expect(saveSession).not.toHaveBeenCalled();      // no scored trial appended on the way out

    // The shell's unmount→cleanup disposes ONCE (guarded). Quit must not add a second dispose.
    screen.unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
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
    expect(root.querySelector('[data-beat-title]')!.textContent).toBe('evolution begins');

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
    optimalCm360: 32.4, ci90: [32.0, 32.6], // tight
    curve: [{ x: Math.log(20), mean: 0.1 }, { x: Math.log(40), mean: 0.4 }],
  } as Report;
  const TRIALS: TrialResult[] = [
    { instrument: 'flick', cm360: 30, score: 0.4, raw: {}, at: 0 },
    { instrument: 'track', cm360: 34, score: 0.5, raw: {}, at: 0 },
  ];

  it('the panel shows the CI-concord line (width bucket, honesty copy) and the trial budget', async () => {
    const { root, screen, runSegment, getResolve } = mountWithRunningSegment();
    (root.querySelector('[data-prelock="begin"]') as HTMLButtonElement).click();
    await flush();
    expect(runSegment).toHaveBeenCalledTimes(1);
    getResolve()!({ report: REPORT, trials: TRIALS });
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
    getResolve()!({ report: { ...REPORT, ci90: [NaN, NaN] as [number, number] }, trials: TRIALS });
    await flush();
    await flush();
    expect((root.querySelector('[data-dialed="concord"]') as HTMLElement).hidden).toBe(true);
    screen.unmount();
  });
});
