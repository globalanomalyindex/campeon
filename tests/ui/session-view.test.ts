// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { marksFromTrials, instructionFor, searchLabel, announceEstimate, sessionView, type SessionViewDeps } from '../../src/ui/session-view';
import type { AppContext } from '../../src/ui/shell';
import type { Report, TrialResult } from '../../src/types';
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
    arena: {} as ArenaStage['arena'],
    requestLock, exitLock, dispose,
    setCm360: vi.fn(), setEnemyEnvironment: vi.fn(),
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
