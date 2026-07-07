// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { setup, calibrationProgress } from '../../src/ui/setup';
import { cmPer360 } from '../../src/convert/cm360';
import { yawFor } from '../../src/convert/yaw-table';
import { boundsFromSeed } from '../../src/ui/options/settings';
import type { AppContext, Route, SessionDraft } from '../../src/ui/shell';

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
    expect(onSweep).toContain('the sweep');
    expect(onSweep).toContain('the spin');
    expect(onSweep).toMatch(/data-state="active"[^>]*><span[^>]*>1<\/span>the sweep/); // sweep active on the sweep step
    const onSpin = calibrationProgress('spin');
    expect(onSpin).toMatch(/data-state="done"[^>]*><span[^>]*>✓<\/span>the sweep/); // sweep checked once on the spin
    expect(onSpin).toMatch(/data-state="active"[^>]*>.*the spin/);
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
});
