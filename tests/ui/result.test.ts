// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { result as resultScreen } from '../../src/ui/result';
import type { AppContext, Route, SessionDraft } from '../../src/ui/shell';
import type { Result, Session, TrialResult } from '../../src/types';

const RESULT: Result = {
  optimalCm360: 32.4, ci90: [29.1, 36.0],
  perGameSens: { cs2: 1.59, valorant: 0.5, apex: 1.59, ow2: 5.3, cod: 5.3, fortnite: 6.3, r6: 6.1, pubg: 15.7 },
  breakdown: { biasZeroCm360: 31.0, precisionFloorDeg: 0.42, ttkMs: 511, hitRate: 0.86, trackContribZ: 0.6, flickContribZ: -0.3 },
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

  it('renders a single sr-only summary sentence near the number (rendered once, NOT a live region)', () => {
    const host = document.createElement('div');
    resultScreen(host, fakeCtx()).mount();
    const summaries = host.querySelectorAll('.result__sr-summary');
    expect(summaries.length).toBe(1); // exactly one, rendered once
    const sr = summaries[0]!;
    expect(sr.getAttribute('aria-live')).toBeNull(); // NOT a live region
    const t = sr.textContent!.toLowerCase();
    expect(t).toContain('32.4'); // the number
    expect(t).toContain('to');   // CI range spoken as "to", never an en-dash
    expect(sr.textContent).not.toContain('–');
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

  it('groups the breakdown into two tiers: where the number comes from vs readings at that sensitivity', () => {
    const host = document.createElement('div');
    resultScreen(host, fakeCtx()).mount();
    const origin = host.querySelector('[data-tier="origin"]')!;
    const readings = host.querySelector('[data-tier="readings"]')!;
    // bias-zero is where the number comes from; the rest are readings AT that sensitivity
    expect(origin.querySelector('[data-breakdown="biasZeroCm360"]')).toBeTruthy();
    expect(readings.querySelector('[data-breakdown="precisionFloorDeg"]')).toBeTruthy();
    expect(readings.querySelector('[data-breakdown="ttkMs"]')).toBeTruthy();
    expect(readings.querySelector('[data-breakdown="hitRate"]')).toBeTruthy();
    // the origin tier must NOT contain a reading (the tiers are not just cosmetic relabels)
    expect(origin.querySelector('[data-breakdown="ttkMs"]')).toBeNull();
  });

  it('keeps every legacy data-breakdown value span byte-identical (storage/export pinning)', () => {
    const host = document.createElement('div');
    resultScreen(host, fakeCtx()).mount();
    expect(host.querySelector('[data-breakdown="biasZeroCm360"]')!.textContent).toBe('31.0 cm/360');
    expect(host.querySelector('[data-breakdown="precisionFloorDeg"]')!.textContent).toBe('0.42°');
    expect(host.querySelector('[data-breakdown="ttkMs"]')!.textContent).toBe('511 ms');
    expect(host.querySelector('[data-breakdown="hitRate"]')!.textContent).toBe('86%');
  });

  it('renders the track/flick facet positions as an organism-colored micro-plot on the ln axis', () => {
    const host = document.createElement('div');
    resultScreen(host, fakeCtx()).mount();
    const micro = host.querySelector('svg[data-facets]') as SVGElement | null;
    expect(micro).toBeTruthy();
    expect(micro!.getAttribute('viewBox')).toMatch(/^0 0 \d/); // fixed viewBox, not clientWidth
    // a mark per track + flick trial (the persisted trials in TRIALS), colored by organism
    const marks = micro!.querySelectorAll('[data-mark="track"], [data-mark="flick"]');
    expect(marks.length).toBe(2); // one track + one flick trial in TRIALS
    // strike/calibrate are NOT facet marks in this micro-plot (it is the two intercept probes)
    expect(micro!.querySelector('[data-mark="strike"]')).toBeNull();
  });

  it('renders the affine-fused track/flick contribution numbers (dash when NaN - no fabrication)', () => {
    const host = document.createElement('div');
    const ctx = fakeCtx();
    ctx.lastResult!.result = { ...RESULT, breakdown: { ...RESULT.breakdown, trackContribZ: NaN } };
    resultScreen(host, ctx).mount();
    expect(host.querySelector('[data-breakdown="flickContribZ"]')!.textContent).toContain('0.3');
    expect(host.querySelector('[data-breakdown="trackContribZ"]')!.textContent).toContain('-');
  });

  it('omits the facet micro-plot for an OLD result that lacks track/flick contributions', () => {
    const host = document.createElement('div');
    const ctx = fakeCtx();
    const { trackContribZ: _t, flickContribZ: _f, ...bk } = RESULT.breakdown;
    ctx.lastResult = { sessionId: 's1', result: { ...RESULT, breakdown: bk } };
    resultScreen(host, ctx).mount();
    // graceful: no facet plot, no contribution numbers, but the number still renders
    expect(host.querySelector('svg[data-facets]')).toBeNull();
    expect(host.querySelector('[data-breakdown="trackContribZ"]')).toBeNull();
    expect(host.querySelector('[data-result="cm360"]')!.textContent).toContain('32.4');
  });

  it('shows the CI-concord readout (tight) for a sharp measured CI', () => {
    const host = document.createElement('div');
    const ctx = fakeCtx();
    ctx.lastResult!.result = { ...RESULT, ci90: [32.0, 32.6] }; // tight
    resultScreen(host, ctx).mount();
    const concord = host.querySelector('[data-result="concord"]')!;
    expect(concord).toBeTruthy();
    expect(concord.textContent!.toLowerCase()).toContain('concur');
  });

  it('frames a wide CI as a possibility LIST naming BOTH causes (never asserts one)', () => {
    const host = document.createElement('div');
    const ctx = fakeCtx();
    ctx.lastResult!.result = { ...RESULT, ci90: [18, 50] }; // wide
    resultScreen(host, ctx).mount();
    const txt = host.querySelector('[data-result="concord"]')!.textContent!.toLowerCase();
    // a wide CI cannot distinguish sampling noise from facet disagreement - copy must name BOTH
    expect(txt).toContain('short');   // short-session sampling noise
    expect(txt).toContain('disagree'); // facets disagreeing
    // never asserts a single cause
    expect(txt).not.toMatch(/because the (facets|views) disagree/);
  });

  it('gates the concord readout behind !tuned (a hand-picked value has no measured concord)', () => {
    const host = document.createElement('div');
    const ctx = fakeCtx();
    ctx.lastResult = { sessionId: 's1', result: { ...RESULT, tuned: true } };
    resultScreen(host, ctx).mount();
    expect(host.querySelector('[data-result="concord"]')).toBeNull();
  });

  it('omits the concord readout for an OLD result whose CI is degenerate', () => {
    const host = document.createElement('div');
    const ctx = fakeCtx();
    ctx.lastResult = { sessionId: 's1', result: { ...RESULT, ci90: [NaN, NaN] } };
    resultScreen(host, ctx).mount();
    expect(host.querySelector('[data-result="concord"]')).toBeNull();
  });

  it('shows the session-drift readout with NEUTRAL copy - practice or fatigue, never one cause (A4)', () => {
    const host = document.createElement('div');
    const ctx = fakeCtx();
    ctx.lastResult!.result = { ...RESULT, driftZ: 0.42 };
    resultScreen(host, ctx).mount();
    const v = host.querySelector('[data-result="driftZ"]')!;
    expect(v).toBeTruthy();
    expect(v.textContent).toContain('0.42');
    const txt = host.textContent!.toLowerCase();
    // neutral copy: names BOTH practice and fatigue and says it was removed from the number
    expect(txt).toContain('practice');
    expect(txt).toContain('fatigue');
    expect(txt).toContain('removed from the number');
    // never asserts the single cause the data cannot distinguish
    expect(txt).not.toMatch(/practice gain|fatigue loss|because of practice|because of fatigue/);
  });

  it('dashes the drift readout when the extended fit fell back (no removal claim)', () => {
    const host = document.createElement('div');
    resultScreen(host, fakeCtx()).mount(); // RESULT has no driftZ - fell back / old result
    const v = host.querySelector('[data-result="driftZ"]')!;
    expect(v).toBeTruthy();
    expect(v.textContent).toBe('-');
    const txt = host.textContent!.toLowerCase();
    // a dashed readout must NOT claim anything was removed from the number
    expect(txt).not.toContain('removed from the number');
    expect(txt).toContain('nothing removed');
  });

  it('gates the drift readout behind !tuned (a hand-picked value makes no drift-removal claim)', () => {
    const host = document.createElement('div');
    const ctx = fakeCtx();
    ctx.lastResult = { sessionId: 's1', result: { ...RESULT, driftZ: 0.42, tuned: true } };
    resultScreen(host, ctx).mount();
    expect(host.querySelector('[data-result="driftZ"]')).toBeNull();
  });

  it('labels the strike rows with the speed/accuracy lean sourced from the profile (your call)', () => {
    const host = document.createElement('div');
    const ctx = fakeCtx();
    ctx.lastResult!.result = { ...RESULT, speedAccuracy: 0.8 }; // leaning speed
    resultScreen(host, ctx).mount();
    const lean = host.querySelector('[data-result="strikeLean"]')!;
    expect(lean).toBeTruthy();
    const t = lean.textContent!.toLowerCase();
    expect(t).toContain('speed');
    expect(t).toContain('your call');
    // the note must make clear track/flick/calibrate are pure skill while strike encodes the chosen lean
    expect(host.textContent!.toLowerCase()).toContain('skill');
  });

  it('labels the lean toward accuracy when the profile leans that way', () => {
    const host = document.createElement('div');
    const ctx = fakeCtx();
    ctx.lastResult!.result = { ...RESULT, speedAccuracy: 0.2 }; // leaning accuracy
    resultScreen(host, ctx).mount();
    expect(host.querySelector('[data-result="strikeLean"]')!.textContent!.toLowerCase()).toContain('accuracy');
  });

  it('omits the strike lean label for an OLD result that lacks speedAccuracy', () => {
    const host = document.createElement('div');
    const ctx = fakeCtx();
    const { ...old } = RESULT; // RESULT has no speedAccuracy
    ctx.lastResult = { sessionId: 's1', result: old };
    resultScreen(host, ctx).mount();
    expect(host.querySelector('[data-result="strikeLean"]')).toBeNull();
    // the strike readings still render (graceful)
    expect(host.querySelector('[data-breakdown="ttkMs"]')!.textContent).toBe('511 ms');
  });
});
