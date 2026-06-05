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
