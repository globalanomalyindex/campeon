// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { setup } from '../../src/ui/setup';
import { cmPer360 } from '../../src/convert/cm360';
import { yawFor } from '../../src/convert/yaw-table';
import type { AppContext, Route, SessionDraft } from '../../src/ui/shell';

function fakeCtx(): AppContext & { nav: Route[]; draft: SessionDraft } {
  const nav: Route[] = [];
  return {
    nav, route: 'setup',
    navigate(r: Route) { nav.push(r); },
    storage: { saveSession() {}, loadSessions: () => [], saveResult() {}, exportJson: () => '' },
    draft: { dpi: 800, currentGame: 'cs2', currentSens: 1, bounds: [15, 60],
      profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } } },
  } as AppContext & { nav: Route[]; draft: SessionDraft };
}

describe('setup', () => {
  it('shows the current cm/360 for the entered dpi/game/sens', () => {
    const ctx = fakeCtx();
    const host = document.createElement('div');
    setup(host, ctx).mount();
    const dpi = host.querySelector('[data-field="dpi"]') as HTMLInputElement;
    const sens = host.querySelector('[data-field="sens"]') as HTMLInputElement;
    dpi.value = '1600'; dpi.dispatchEvent(new Event('input'));
    sens.value = '0.5'; sens.dispatchEvent(new Event('input'));
    const expected = cmPer360(1600, 0.5, yawFor('cs2')).toFixed(1);
    expect(host.querySelector('[data-readout="cm360"]')!.textContent).toContain(expected);
  });

  it('+ begin writes dpi/sens/profile to the draft and navigates to gate', () => {
    const ctx = fakeCtx();
    const host = document.createElement('div');
    setup(host, ctx).mount();
    (host.querySelector('[data-field="dpi"]') as HTMLInputElement).value = '400';
    (host.querySelector('[data-field="dpi"]') as HTMLInputElement).dispatchEvent(new Event('input'));
    const goal = host.querySelector('[data-field="goal"]') as HTMLInputElement;
    goal.value = '0.8'; goal.dispatchEvent(new Event('input'));
    (host.querySelector('[data-action="begin"]') as HTMLButtonElement).click();
    expect(ctx.draft.dpi).toBe(400);
    expect(ctx.draft.profile.speedAccuracy).toBeCloseTo(0.8, 6);
    expect(ctx.nav).toContain('gate');
  });
});
