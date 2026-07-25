// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { setup, calibrationProgress } from '../../src/ui/setup';
import { cmPer360 } from '../../src/convert/cm360';
import { yawFor } from '../../src/convert/yaw-table';
import { boundsFromSeed } from '../../src/ui/options/settings';
import type { AppContext, Route, SessionDraft } from '../../src/ui/shell';

type SweepOpts = Parameters<typeof import('../../src/ui/calibrate/sweep-view').createSweepView>[1];
type SpinOpts = Parameters<typeof import('../../src/ui/calibrate/spin-view').createSpinView>[1];

function fakeCtx(): AppContext & { nav: Route[] } {
  const nav: Route[] = [];
  const draft: SessionDraft = { dpi: 800, currentGame: 'cs2', currentSens: 1, bounds: [15, 60],
    profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } } };
  return { route: 'setup', navigate(r: Route) { nav.push(r); }, draft, nav,
    storage: { saveSession() {}, loadSessions: () => [], saveResult() {}, exportJson: () => '' } } as AppContext & { nav: Route[] };
}

describe('setup (guided calibration orchestrator)', () => {
  it('offers a guided start and a typed fast path on the intro step', () => {
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    expect(host.querySelector('[data-action="start-guided"]')).toBeTruthy();
    expect(host.querySelector('[data-action="start-manual"]')).toBeTruthy();
    expect(host.querySelector('[data-field="pad"]')).toBeNull(); // no typed mousepad width
    // a novice-friendly intro: a 2-step preview and a card-grab confirm on the primary button
    expect(host.querySelectorAll('.cal-preview li').length).toBe(2);
    expect(host.querySelector('[data-action="start-guided"]')!.textContent!.toLowerCase()).toContain('card');
  });

  it('the progress tracker marks the active step and checks off a finished one', () => {
    const onSweep = calibrationProgress('sweep');
    expect(onSweep).toContain('The sweep');
    expect(onSweep).toContain('The spin');
    expect(onSweep).toMatch(/data-state="active"[^>]*><span[^>]*>1<\/span>The sweep/); // sweep active on the sweep step
    const onSpin = calibrationProgress('spin');
    expect(onSpin).toMatch(/data-state="done"[^>]*><span[^>]*>✓<\/span>The sweep/); // sweep checked once on the spin
    expect(onSpin).toMatch(/data-state="active"[^>]*>.*The spin/);
  });

  it('rewords the typed fork so it stops inviting the read-my-sens misconception, with a starting-point note (P4-3)', () => {
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    const manual = host.querySelector('[data-action="start-manual"]')!;
    expect(manual.textContent!.toLowerCase()).toContain("i'll type my numbers");
    // a starting-point note must clarify the typed numbers seed the search, not read out as the answer
    expect(host.textContent!.toLowerCase()).toContain('starting point');
  });

  it('keeps the manual fast path reachable from the intro (reduced-motion / lock-denial escape hatch)', () => {
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    (host.querySelector('[data-action="start-manual"]') as HTMLButtonElement).click();
    expect(host.querySelector('[data-field="dpi"]')).toBeTruthy(); // the typed form is still reachable
  });

  it('the typed fast path writes dpi/sens/game + seeded bounds and navigates to session', () => {
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    (host.querySelector('[data-action="start-manual"]') as HTMLButtonElement).click();
    (host.querySelector('[data-field="dpi"]') as HTMLInputElement).value = '1600';
    (host.querySelector('[data-field="sens"]') as HTMLInputElement).value = '0.5';
    (host.querySelector('[data-action="manual-begin"]') as HTMLButtonElement).click();
    expect(ctx.draft.dpi).toBe(1600);
    expect(ctx.draft.currentSens).toBe(0.5);
    const seed = cmPer360(1600, 0.5, yawFor(ctx.draft.currentGame));
    expect(ctx.draft.bounds).toEqual(boundsFromSeed(seed));
    expect(ctx.nav).toContain('session');
  });

  it('the intro offers a way back out of the flow', () => {
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    const back = host.querySelector('[data-action="to-hero"]') as HTMLButtonElement;
    expect(back).toBeTruthy();
    back.click();
    expect(ctx.nav).toEqual(['hero']);
  });

  it('speaks in the first person singular, with no institutional "we"', () => {
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    expect(host.textContent!).not.toMatch(/\bwe\b|\bwe'll\b|\bus\b/i);
  });

  // The canon voice: sentence case, capital "I", one <h1> naming the screen, and no revived "+"
  // motif (it was retired because screen readers announced "plus" before every heading).
  it.each(['intro', 'manual'] as const)('the %s step renders exactly one h1, sentence case, no "+" prefix', (step) => {
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    if (step === 'manual') (host.querySelector('[data-action="start-manual"]') as HTMLButtonElement).click();
    const h1s = host.querySelectorAll('h1');
    expect(h1s.length).toBe(1);
    expect(host.querySelector('h2')).toBeNull(); // the screen name is the h1 now, no orphan h2
    const title = h1s[0]!.textContent!;
    expect(title.startsWith('+')).toBe(false);
    expect(title).toMatch(/^[A-Z]/);
  });

  it('never writes the first-person pronoun as a lowercase "i"', () => {
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    expect(host.textContent!).not.toMatch(/\bi\b/); // case-sensitive: a standalone lowercase i is the violation
    (host.querySelector('[data-action="start-manual"]') as HTMLButtonElement).click();
    expect(host.textContent!).not.toMatch(/\bi\b/);
  });
});

// ── The typed step validates at the boundary ──
// A dpi of 0 used to reach CameraRig, divide by zero and blank the page - and rememberPrefs had
// already persisted it, so the blank page came back on every later visit.

describe('setup: the typed step refuses numbers the arena cannot use', () => {
  function manualStep(ctx: ReturnType<typeof fakeCtx>): HTMLElement {
    const host = document.createElement('div');
    setup(host, ctx).mount();
    (host.querySelector('[data-action="start-manual"]') as HTMLButtonElement).click();
    return host;
  }
  const type = (host: HTMLElement, field: string, value: string): void => {
    const el = host.querySelector(`[data-field="${field}"]`) as HTMLInputElement;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it.each([['', 'empty'], ['0', 'zero'], ['-5', 'negative'], ['40000', 'above the supported range']])(
    'a %s dpi (%s) neither navigates nor reaches the draft, and says why', (bad) => {
      const ctx = fakeCtx(); const host = manualStep(ctx);
      type(host, 'dpi', bad);
      (host.querySelector('[data-action="manual-begin"]') as HTMLButtonElement).click();
      expect(ctx.nav).toEqual([]);
      expect(ctx.draft.dpi).toBe(800); // the draft is untouched
      const err = host.querySelector('[data-error]')!;
      expect(err.getAttribute('role')).toBe('alert');
      expect(err.textContent!.toLowerCase()).toContain('dpi');
      expect(host.querySelector('[data-field="dpi"]')!.getAttribute('aria-invalid')).toBe('true');
    });

  it('a zero or missing sensitivity is refused too, and names the sensitivity field', () => {
    const ctx = fakeCtx(); const host = manualStep(ctx);
    type(host, 'sens', '0');
    (host.querySelector('[data-action="manual-begin"]') as HTMLButtonElement).click();
    expect(ctx.nav).toEqual([]);
    expect(host.querySelector('[data-error]')!.textContent!.toLowerCase()).toContain('sensitivity');
    expect(host.querySelector('[data-field="sens"]')!.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector('[data-field="dpi"]')!.getAttribute('aria-invalid')).toBe('false');
  });

  it('clears the message as soon as the number is corrected, then commits', () => {
    const ctx = fakeCtx(); const host = manualStep(ctx);
    const begin = host.querySelector('[data-action="manual-begin"]') as HTMLButtonElement;
    type(host, 'dpi', '0');
    begin.click();
    expect(begin.getAttribute('aria-disabled')).toBe('true');
    type(host, 'dpi', '1600');
    expect(host.querySelector('[data-error]')!.textContent).toBe('');
    expect(begin.getAttribute('aria-disabled')).toBe('false');
    begin.click();
    expect(ctx.draft.dpi).toBe(1600);
    expect(ctx.nav).toEqual(['session']);
  });

  it('never persists a dpi the arena cannot use', () => {
    const ctx = rememberingCtx(null); const host = manualStep(ctx);
    type(host, 'dpi', '0');
    (host.querySelector('[data-action="manual-begin"]') as HTMLButtonElement).click();
    expect(ctx.savedPrefs()).toBeNull();
  });
});

// ── Phase C: remember-my-calibration on the intro step ──

import type { PersistedPrefs } from '../../src/types';

const PREFS: PersistedPrefs = {
  dpi: 1600, currentGame: 'valorant', currentSens: 0.4,
  speedAccuracy: 0.7, bounds: [18, 50],
};

function rememberingCtx(prefs: PersistedPrefs | null): ReturnType<typeof fakeCtx> & { savedPrefs: () => PersistedPrefs | null } {
  const ctx = fakeCtx();
  let saved = prefs;
  ctx.storage.loadPrefs = () => saved;
  ctx.storage.savePrefs = (p) => { saved = p; };
  return Object.assign(ctx, { savedPrefs: () => saved });
}

describe('setup: remembered calibration (Phase C)', () => {
  it('offers the saved-calibration fast path as PRIMARY when prefs exist, demoting recalibration', () => {
    const ctx = rememberingCtx(PREFS); const host = document.createElement('div');
    setup(host, ctx).mount();
    const useSaved = host.querySelector('[data-action="use-saved"]') as HTMLButtonElement;
    expect(useSaved).toBeTruthy();
    expect(useSaved.className).toContain('action--primary');
    expect(host.querySelector('[data-remembered]')!.textContent).toContain('1600');
    const recal = host.querySelector('[data-action="start-guided"]')!;
    expect(recal.className).toContain('action--ghost');
    expect(recal.textContent!.toLowerCase()).toContain('recalibrate');
  });

  it('shows NO fast path on a first visit (or a prefs-less Storage)', () => {
    const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx).mount();
    expect(host.querySelector('[data-action="use-saved"]')).toBeNull();
    expect(host.querySelector('[data-action="start-guided"]')!.className).toContain('action--primary');
  });

  it('use-saved re-applies the remembered prefs to the draft and goes straight to the hunt', () => {
    const ctx = rememberingCtx(PREFS); const host = document.createElement('div');
    ctx.draft.dpi = 999; // a drifted draft must not leak into the session
    setup(host, ctx).mount();
    (host.querySelector('[data-action="use-saved"]') as HTMLButtonElement).click();
    expect(ctx.draft.dpi).toBe(1600);
    expect(ctx.draft.currentGame).toBe('valorant');
    expect(ctx.draft.bounds).toEqual([18, 50]);
    expect(ctx.draft.profile.speedAccuracy).toBe(0.7);
    expect(ctx.nav).toEqual(['session']);
  });

  it('the typed commit REMEMBERS the calibration for the next visit', () => {
    const ctx = rememberingCtx(null); const host = document.createElement('div');
    setup(host, ctx).mount();
    (host.querySelector('[data-action="start-manual"]') as HTMLButtonElement).click();
    (host.querySelector('[data-field="dpi"]') as HTMLInputElement).value = '3200';
    (host.querySelector('[data-action="manual-begin"]') as HTMLButtonElement).click();
    expect(ctx.savedPrefs()).toMatchObject({ dpi: 3200 });
  });

  it('the GUIDED (sweep -> spin) commit also remembers the calibration and heads to the hunt', () => {
    // The primary path per the intro copy. Injected fake views drive the sweep-done -> onSeed chain
    // without a GL context, so a dropped rememberPrefs in commitGuided would fail here.
    const ctx = rememberingCtx(null);
    let sweepOpts: Parameters<typeof import('../../src/ui/calibrate/sweep-view').createSweepView>[1] | null = null;
    let spinOpts: Parameters<typeof import('../../src/ui/calibrate/spin-view').createSpinView>[1] | null = null;
    const deps = {
      createSweepView: ((_host: HTMLElement, opts: never) => { sweepOpts = opts; return { dispose() {} }; }) as typeof import('../../src/ui/calibrate/sweep-view').createSweepView,
      createSpinView: ((_host: HTMLElement, opts: never) => { spinOpts = opts; return { dispose() {} }; }) as typeof import('../../src/ui/calibrate/spin-view').createSpinView,
    };
    const host = document.createElement('div');
    setup(host, ctx, deps).mount();

    (host.querySelector('[data-action="start-guided"]') as HTMLButtonElement).click();
    expect(sweepOpts, 'sweep view mounted on start-guided').toBeTruthy();
    sweepOpts!.onResult({ dpi: 1600, accelerated: false }); // sweep measured a dpi -> advance to spin
    expect(spinOpts, 'spin view mounted after a valid sweep').toBeTruthy();
    spinOpts!.onSeed(30); // the spin supplies the seed -> commitGuided

    expect(ctx.savedPrefs()).toMatchObject({ dpi: 1600 });
    expect(ctx.nav).toEqual(['session']);
  });

  it('hides the saved-calibration fast path when the stored dpi is unusable', () => {
    // A pref poisoned before the boundary check existed must not route straight into a divide by
    // zero on every later visit. Recalibrating is the only offer left.
    const ctx = rememberingCtx({ ...PREFS, dpi: 0 }); const host = document.createElement('div');
    setup(host, ctx).mount();
    expect(host.querySelector('[data-action="use-saved"]')).toBeNull();
    expect(host.querySelector('[data-action="start-guided"]')!.className).toContain('action--primary');
  });
});

// ── The guided steps are not a corridor ──

describe('setup: the sweep and the spin can be left', () => {
  function captureOpts(): { deps: Parameters<typeof setup>[2]; sweep: () => SweepOpts; spin: () => SpinOpts } {
    let sweepOpts: SweepOpts | null = null;
    let spinOpts: SpinOpts | null = null;
    const deps = {
      createSweepView: ((_h: HTMLElement, o: SweepOpts) => { sweepOpts = o; return { dispose() {} }; }) as typeof import('../../src/ui/calibrate/sweep-view').createSweepView,
      createSpinView: ((_h: HTMLElement, o: SpinOpts) => { spinOpts = o; return { dispose() {} }; }) as typeof import('../../src/ui/calibrate/spin-view').createSpinView,
    };
    return { deps, sweep: () => sweepOpts!, spin: () => spinOpts! };
  }

  it('the sweep can go back to the intro and can hand off to the typed step', () => {
    const cap = captureOpts(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    (host.querySelector('[data-action="start-guided"]') as HTMLButtonElement).click();
    cap.sweep().onBack();
    expect(host.querySelector('[data-action="start-guided"]'), 'back returns to the intro').toBeTruthy();

    (host.querySelector('[data-action="start-guided"]') as HTMLButtonElement).click();
    cap.sweep().onManual();
    expect(host.querySelector('[data-field="dpi"]'), 'manual reaches the typed step').toBeTruthy();
  });

  it('the spin can go back to the intro and can hand off to the typed step', () => {
    const cap = captureOpts(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    (host.querySelector('[data-action="start-guided"]') as HTMLButtonElement).click();
    cap.sweep().onResult({ dpi: 1600, accelerated: false });
    cap.spin().onBack();
    expect(host.querySelector('[data-action="start-guided"]')).toBeTruthy();
    expect(ctx.nav).toEqual([]); // leaving the spin commits nothing
  });

  it('gives the blocked step an h1 for each block reason (accel and invalid)', () => {
    // The blocked screen used to render leads with no heading at all, leaving the document
    // outline empty exactly where a visitor most needs orientation.
    const cap = captureOpts(); const ctx = fakeCtx(); const host = document.createElement('div');
    setup(host, ctx, cap.deps).mount();
    (host.querySelector('[data-action="start-guided"]') as HTMLButtonElement).click();
    cap.sweep().onInvalid();
    expect(host.querySelectorAll('h1').length).toBe(1);
    expect(host.querySelector('h1')!.textContent).toBe("That sweep didn't take");

    (host.querySelector('[data-action="retry"]') as HTMLButtonElement).click();
    cap.sweep().onResult({ dpi: 1600, accelerated: true });
    expect(host.querySelectorAll('h1').length).toBe(1);
    expect(host.querySelector('h1')!.textContent).toBe('Mouse acceleration is on');
  });

  it.each([true, false])('passes prefers-reduced-motion (%s) into both guided views', (reduce) => {
    // The views draw their cues on canvas, which the CSS reduced-motion block cannot reach, so the
    // preference has to travel as a flag or it is simply ignored.
    const prev = (window as { matchMedia?: unknown }).matchMedia;
    (window as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({ matches: reduce && q.includes('reduced-motion') });
    try {
      const cap = captureOpts(); const ctx = fakeCtx(); const host = document.createElement('div');
      setup(host, ctx, cap.deps).mount();
      (host.querySelector('[data-action="start-guided"]') as HTMLButtonElement).click();
      expect(cap.sweep().reducedMotion).toBe(reduce);
      cap.sweep().onResult({ dpi: 1600, accelerated: false });
      expect(cap.spin().reducedMotion).toBe(reduce);
    } finally {
      (window as unknown as { matchMedia: unknown }).matchMedia = prev;
    }
  });
});
