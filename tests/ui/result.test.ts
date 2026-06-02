// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { result as resultScreen } from '../../src/ui/result';
import type { AppContext, Route, SessionDraft } from '../../src/ui/shell';
import type { Result } from '../../src/types';

const RESULT: Result = {
  optimalCm360: 32.4, ci90: [29.1, 36.0],
  perGameSens: { cs2: 1.59, valorant: 0.5, apex: 1.59, ow2: 5.3, cod: 5.3, fortnite: 6.3, r6: 6.1, pubg: 15.7 },
  breakdown: { biasZeroCm360: 31.0, precisionFloorDeg: 0.42, ttkMs: 511, hitRate: 0.86 },
};
function fakeCtx(): AppContext & { nav: Route[] } {
  const nav: Route[] = [];
  const draft: SessionDraft = { dpi: 800, currentGame: 'cs2', currentSens: 1, bounds: [15, 60],
    profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } } };
  return {
    nav, route: 'result', draft,
    navigate(r: Route) { nav.push(r); },
    storage: { saveSession() {}, loadSessions: () => [], saveResult() {}, exportJson: () => '{}' },
    lastResult: { sessionId: 's1', result: RESULT },
  } as AppContext & { nav: Route[] };
}

describe('result screen', () => {
  it('shows the one cm/360 number and the 90% CI range', () => {
    const host = document.createElement('div');
    resultScreen(host, fakeCtx()).mount();
    expect(host.querySelector('[data-result="cm360"]')!.textContent).toContain('32.4');
    const ci = host.querySelector('[data-result="ci"]')!.textContent!;
    expect(ci).toContain('29.1');
    expect(ci).toContain('36.0');
  });

  it('renders a per-game row for every game and highlights the current one', () => {
    const host = document.createElement('div');
    resultScreen(host, fakeCtx()).mount();
    expect(host.querySelectorAll('[data-game]').length).toBe(8);
    expect(host.querySelector('[data-game="cs2"]')!.getAttribute('data-current')).toBe('true');
  });

  it('shows breakdown contributions and renders NaN as —', () => {
    const host = document.createElement('div');
    const ctx = fakeCtx();
    ctx.lastResult!.result = { ...RESULT, breakdown: { ...RESULT.breakdown, precisionFloorDeg: NaN } };
    resultScreen(host, ctx).mount();
    expect(host.querySelector('[data-breakdown="ttkMs"]')!.textContent).toContain('511');
    expect(host.querySelector('[data-breakdown="precisionFloorDeg"]')!.textContent).toContain('—');
  });

  it('+ run again navigates home', () => {
    const host = document.createElement('div');
    const ctx = fakeCtx();
    resultScreen(host, ctx).mount();
    (host.querySelector('[data-action="again"]') as HTMLButtonElement).click();
    expect(ctx.nav).toContain('hero');
  });
});
