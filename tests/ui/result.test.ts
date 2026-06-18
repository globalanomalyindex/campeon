// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { result as resultScreen } from '../../src/ui/result';
import type { AppContext, Route, SessionDraft } from '../../src/ui/shell';
import type { Result, Session, TrialResult } from '../../src/types';

const RESULT: Result = {
  optimalCm360: 32.4, ci90: [29.1, 36.0],
  perGameSens: { cs2: 1.59, valorant: 0.5, apex: 1.59, ow2: 5.3, cod: 5.3, fortnite: 6.3, r6: 6.1, pubg: 15.7 },
  breakdown: { biasZeroCm360: 31.0, precisionFloorDeg: 0.42, ttkMs: 511, hitRate: 0.86 },
  curve: [{ x: Math.log(20), mean: 0.2 }, { x: Math.log(32.4), mean: 0.9 }, { x: Math.log(50), mean: 0.3 }],
  bounds: [15, 60],
};
const TRIALS: TrialResult[] = [
  { instrument: 'flick', cm360: 22, score: 0.4, raw: {}, at: 0 },
  { instrument: 'track', cm360: 31, score: 0.8, raw: {}, at: 0 },
  { instrument: 'strike', cm360: 40, score: 0.5, raw: {}, at: 0 },
];
function session(id: string, trials: TrialResult[]): Session {
  return { id, dpi: 800, profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
    trials, status: 'complete', createdAt: 0 };
}
function fakeCtx(sessions: Session[] = [session('s1', TRIALS)]): AppContext & { nav: Route[] } {
  const nav: Route[] = [];
  const draft: SessionDraft = { dpi: 800, currentGame: 'cs2', currentSens: 1, bounds: [15, 60],
    profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } } };
  return {
    nav, route: 'result', draft,
    navigate(r: Route) { nav.push(r); },
    storage: { saveSession() {}, loadSessions: () => sessions, saveResult() {}, exportJson: () => '{}' },
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

  it('shows breakdown contributions and renders NaN as -', () => {
    const host = document.createElement('div');
    const ctx = fakeCtx();
    ctx.lastResult!.result = { ...RESULT, breakdown: { ...RESULT.breakdown, precisionFloorDeg: NaN } };
    resultScreen(host, ctx).mount();
    expect(host.querySelector('[data-breakdown="ttkMs"]')!.textContent).toContain('511');
    expect(host.querySelector('[data-breakdown="precisionFloorDeg"]')!.textContent).toContain('-');
  });

  it('the your-game selector re-highlights the matching row (deferred game pick)', () => {
    const host = document.createElement('div');
    resultScreen(host, fakeCtx()).mount();
    const select = host.querySelector('[data-action="your-game"]') as HTMLSelectElement;
    expect(select).toBeTruthy();
    select.value = 'valorant';
    select.dispatchEvent(new Event('change'));
    expect(host.querySelector('tr[data-game="valorant"]')!.getAttribute('data-current')).toBe('true');
    expect(host.querySelectorAll('tr[data-current="true"]').length).toBe(1); // only one row current
  });

  it('+ run again navigates home', () => {
    const host = document.createElement('div');
    const ctx = fakeCtx();
    resultScreen(host, ctx).mount();
    (host.querySelector('[data-action="again"]') as HTMLButtonElement).click();
    expect(ctx.nav).toContain('hero');
  });

  it('renders a "step into the range" CTA that navigates to range', () => {
    const host = document.createElement('div');
    const ctx = fakeCtx();
    resultScreen(host, ctx).mount();
    const btn = host.querySelector('[data-action="range"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(ctx.nav).toContain('range');
  });

  it('shows the measured 90% CI when not tuned', () => {
    const host = document.createElement('div');
    resultScreen(host, fakeCtx()).mount();
    expect(host.querySelector('[data-result="ci"]')!.textContent).toContain('29.1');
    expect(host.textContent).not.toContain('tuned by feel');
  });

  it('drops the CI and labels "tuned by feel" when the result is adopted', () => {
    const host = document.createElement('div');
    const ctx = fakeCtx();
    ctx.lastResult = { sessionId: 's1', result: { ...RESULT, tuned: true } };
    resultScreen(host, ctx).mount();
    expect(host.querySelector('[data-result="ci"]')).toBeNull();
    expect(host.textContent).toContain('tuned by feel');
  });

  it('renders the convergence plot (curve + peak + a mark per persisted trial) as the climax', () => {
    const host = document.createElement('div');
    resultScreen(host, fakeCtx()).mount();
    const svg = host.querySelector('figure svg') as SVGElement | null;
    expect(svg).toBeTruthy();
    // decorative; P4 adds the screen-reader summary
    expect(svg!.getAttribute('aria-hidden')).toBe('true');
    // fixed viewBox (NOT clientWidth, which is 0 before layout)
    expect(svg!.getAttribute('viewBox')).toMatch(/^0 0 \d/);
    expect(svg!.querySelector('[data-curve]')).toBeTruthy();
    expect(svg!.querySelector('[data-peak]')).toBeTruthy();
    expect(svg!.querySelectorAll('[data-mark]').length).toBe(TRIALS.length);
  });

  it('renders number-only (no plot) for an OLD result that lacks curve/bounds', () => {
    const host = document.createElement('div');
    const ctx = fakeCtx();
    const { curve: _c, bounds: _b, ...old } = RESULT;
    ctx.lastResult = { sessionId: 's1', result: old };
    resultScreen(host, ctx).mount();
    expect(host.querySelector('figure svg')).toBeNull();
    // the number still renders
    expect(host.querySelector('[data-result="cm360"]')!.textContent).toContain('32.4');
  });

  it('does NOT draw the plot for a tuned-by-feel result (no measured curve claim - honesty)', () => {
    const host = document.createElement('div');
    const ctx = fakeCtx();
    // a tuned result that (defensively) still carries curve/bounds must not plot
    ctx.lastResult = { sessionId: 's1', result: { ...RESULT, tuned: true } };
    resultScreen(host, ctx).mount();
    expect(host.querySelector('figure svg')).toBeNull();
  });
});
