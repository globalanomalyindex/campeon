// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { result as resultScreen, typedCm } from '../../src/ui/result';
import type { AppContext, Route, SessionDraft } from '../../src/ui/shell';
import { counts360, type Counts360, type Result, type Session, type TrialResult } from '../../src/types';
import type { Prescription } from '../../src/optimizer/result';

const c = counts360;
const ci = (lo: number, hi: number): [Counts360, Counts360] => [c(lo), c(hi)];

// A typed-sens pin with k = 2: hardwareCounts = 8240 / 2, and kLogSd carries the anchor's spread.
const PRES: Prescription = {
  ratio: 0.88, ratioCi90: [0.79, 0.97],
  counts: c(8240), countsCi90: ci(7800, 8700),
  perGameSens: { cs2: 1.59, valorant: 0.5, apex: 1.59, ow2: 5.3, cod: 5.3, fortnite: 6.3, r6: 6.1, pubg: 15.7 },
  kSource: 'typed-sens',
  kLogSd: 0.12,
  hardwareCounts: c(4120),
};
const RESULT: Result = {
  optimalCounts: c(8240), ci90: ci(7800, 8700),
  breakdown: { biasZeroCounts: c(7940), precisionFloorDeg: 0.42, ttkMs: 511, hitRate: 0.86, trackContribZ: 0.6, flickContribZ: -0.3 },
  curve: [{ x: Math.log(5000), mean: 0.2 }, { x: Math.log(8240), mean: 0.9 }, { x: Math.log(13000), mean: 0.3 }],
  bounds: ci(4000, 16000),
  prescription: PRES,
};
const TRIALS: TrialResult[] = [
  { instrument: 'flick', counts: c(5600), score: 0.4, raw: {}, at: 0 },
  { instrument: 'track', counts: c(7900), score: 0.8, raw: {}, at: 0 },
  { instrument: 'strike', counts: c(10200), score: 0.5, raw: {}, at: 0 },
];
function session(id: string, trials: TrialResult[]): Session {
  return { id, profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
    trials, status: 'complete', createdAt: 0 };
}
function fakeCtx(sessions: Session[] = [session('s1', TRIALS)]): AppContext & { nav: Route[] } {
  const nav: Route[] = [];
  const draft: SessionDraft = { currentGame: 'cs2', currentSens: 1, bounds: ci(4000, 16000),
    profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } } };
  return {
    nav, route: 'result', draft,
    navigate(r: Route) { nav.push(r); },
    storage: { saveSession() {}, loadSessions: () => sessions, saveResult() {}, exportJson: () => '{}' },
    lastResult: { sessionId: 's1', result: RESULT },
  } as AppContext & { nav: Route[] };
}
function mount(res?: Result): HTMLElement {
  const host = document.createElement('div');
  const ctx = fakeCtx();
  if (res) ctx.lastResult = { sessionId: 's1', result: res };
  resultScreen(host, ctx).mount();
  return host;
}
const noPrescription = (): Result => {
  const { prescription: _p, ...rest } = RESULT;
  return rest;
};
// The reachable A5 state: k pinned, anchor refused - a prescription with no ratio fields.
const kOnlyPres = (): Prescription => {
  const { ratio: _r, ratioCi90: _rc, ...rest } = PRES;
  return rest;
};
// k unpinned: a prescription with tier one only.
const unpinnedPres = (): Prescription => {
  const { perGameSens: _g, kSource: _k, kLogSd: _l, hardwareCounts: _h, ...rest } = PRES;
  return rest;
};

describe('result screen, tier one (assumes nothing)', () => {
  it('leads with the multiply factor when the interval excludes no change', () => {
    const host = mount();
    expect(host.querySelector('[data-result="ratio"]')).toBeTruthy();
    expect(host.querySelector('[data-result="ratio"]')!.textContent).toBe('0.88');
    expect(host.querySelector('[data-result="ratio-ci"]')!.textContent).toBe('0.79 to 0.97');
    expect((host.querySelector('[data-tier="one"]') as HTMLElement).dataset.hero).toBe('ratio');
    expect(host.textContent).toContain('Multiply your in-game sensitivity by');
  });

  it('prices the wider interval as completeness, in the width note', () => {
    const note = mount().querySelector('[data-result="ratio-note"]')!.textContent!;
    // Tier one is wider than the plot band because it carries the anchor too; the copy must say
    // so as a fact about the question answered, never as an apology.
    expect(note).toContain('wider');
    expect(note.toLowerCase()).toContain('two measurements');
    expect(note.toLowerCase()).toContain('easier question');
  });

  it('a factor of 1.00 with a confined interval reads as a finding the interval supports (F33)', () => {
    const host = mount({ ...RESULT, prescription: { ...PRES, ratio: 1.0, ratioCi90: [0.97, 1.04] } });
    expect(host.querySelector('[data-result="ratio"]')!.textContent).toBe('1.00');
    expect((host.querySelector('[data-tier="one"]') as HTMLElement).dataset.hero).toBe('confirmed');
    const t = host.querySelector('[data-result="ratio-confirmed"]')!.textContent!;
    expect(t).toContain('tightest this instrument resolves');
    expect(t).toContain('change nothing');
    // F33: no claim about the session's design ("every chance to move you") and no claim beyond
    // the interval's own resolution - the sentence states only what the interval allows.
    expect(t).not.toContain('every chance');
  });

  it('an interval that includes no change drops the multiply framing (spec error path)', () => {
    const host = mount({ ...RESULT, prescription: { ...PRES, ratio: 0.93, ratioCi90: [0.85, 1.08] } });
    expect(host.querySelector('[data-result="ratio"]')).toBeNull();
    expect(host.querySelector('[data-result="counts360"]')!.textContent).toBe('8,240');
    expect(host.querySelector('[data-result="ci"]')!.textContent).toBe('7,800 to 8,700');
    expect(host.querySelector('[data-result="ratio-withheld"]')!.textContent).toContain('includes 1.00');
  });

  it('without a prescription the location stands alone and says why', () => {
    const host = mount(noPrescription());
    expect(host.querySelector('[data-result="counts360"]')!.textContent).toBe('8,240');
    expect(host.querySelector('[data-result="ratio-unavailable"]')!.textContent).toContain('leave the factor blank');
  });

  it('a k-only prescription (A5) leads with the located counts, factor blank, tier two intact', () => {
    const host = mount({ ...RESULT, prescription: kOnlyPres() });
    expect(host.querySelector('[data-result="ratio"]')).toBeNull();
    expect(host.querySelector('[data-result="counts360"]')!.textContent).toBe('8,240');
    expect(host.querySelector('[data-result="ratio-unavailable"]')!.textContent).toContain('leave the factor blank');
    expect(host.querySelectorAll('[data-game]').length).toBe(8); // the table earned its gate
  });

  it('renders a single sr-only summary sentence near the number (rendered once, NOT a live region)', () => {
    const host = mount();
    const summaries = host.querySelectorAll('.result__sr-summary');
    expect(summaries.length).toBe(1);
    const sr = summaries[0]!;
    expect(sr.getAttribute('aria-live')).toBeNull();
    const t = sr.textContent!;
    expect(t).toContain('0.88');
    expect(t).toContain(' to ');   // ranges spoken as "to", never an en-dash glyph
    expect(t).not.toContain('–');
  });

  it('a tuned value shows no factor even if a stale prescription rides the Result (honesty gate)', () => {
    const host = mount({ ...RESULT, tuned: true });
    expect(host.querySelector('[data-result="ratio"]')).toBeNull();
    expect(host.textContent).toContain('tuned by feel');
    expect(host.querySelector('[data-result="ratio-note"]')).toBeNull();
  });

  it('a bounded result keeps the bound copy and prefixes tier three with the bound direction', () => {
    const host = mount({ ...RESULT, peakAtBound: 'high' });
    expect(host.textContent).toContain('Where the search stopped');
    expect(host.querySelector('[data-result="bounded"]')!.textContent).toContain('at least 8,240');
    expect(host.querySelector('[data-result="ratio"]')).toBeNull(); // no factor against a bound
    expect(host.querySelector('[data-tier="three"]')!.textContent).toContain('At least');
    expect(host.querySelector('[data-result="tier-two-withheld"]')!.textContent).toContain('edge of the window');
  });
});

describe('result screen, tier two (one measured factor)', () => {
  it('shows the per-game table only because k is pinned, and renders every game row', () => {
    const host = mount();
    expect(host.querySelectorAll('[data-game]').length).toBe(8);
    expect(host.querySelector('[data-game="cs2"]')!.getAttribute('data-current')).toBe('true');
  });

  it('names the typed-sens route in words a player can act on, without claiming an exact pin', () => {
    const note = mount().querySelector('.result__k-note')!.textContent!;
    expect(note).toContain('sensitivity you typed');
    // A5: the typed route inherits the anchor's spread whole, so the note may not say "exactly".
    expect(note.toLowerCase()).not.toContain('exactly');
  });

  it('names the lattice route when the movement stream pinned k', () => {
    const host = mount({ ...RESULT, prescription: { ...PRES, kSource: 'lattice', kLogSd: 0 } });
    expect(host.querySelector('.result__k-note')!.textContent).toContain('movement stream');
  });

  it('widens each row by the search interval and k spread combined in quadrature (A5, D3)', () => {
    const host = mount(); // countsCi90 [7800, 8700] and kLogSd 0.12 from the typed route
    const bands = host.querySelectorAll('[data-sens-band]');
    expect(bands.length).toBe(8);
    // Half-width in ln space: hypot(ln(8700/7800)/2, 1.6448536269514722 * 0.12)
    // = hypot(0.05460, 0.19738) = 0.20479. cs2 sens 1.59 * exp(-/+ 0.20479) = 1.296 to 1.951.
    // k's spread ALONE would give 1.305 to 1.937, narrower than the evidence: the band must carry
    // the search's own precision too, and hypot can only widen (D3).
    expect(host.querySelector('tr[data-game="cs2"] [data-sens-band]')!.textContent).toBe('1.296 to 1.951');
  });

  it('renders the search band alone when the pin carries no spread (lattice, kLogSd 0)', () => {
    const host = mount({ ...RESULT, prescription: { ...PRES, kSource: 'lattice', kLogSd: 0 } });
    // An exactly pure lattice pins k with zero spread, and the drill bootstrap is still there: a
    // bare three-decimal sensitivity would present a number the player types into their game as
    // if it were exact (D3). Half-width = ln(8700/7800)/2 = 0.05460; 1.59 * exp(-/+ 0.05460).
    expect(host.querySelectorAll('[data-sens-band]').length).toBe(8);
    expect(host.querySelector('tr[data-game="cs2"] [data-sens-band]')!.textContent).toBe('1.506 to 1.679');
  });

  it('omits the band for a degenerate countsCi90 rather than fabricating one', () => {
    const host = mount({ ...RESULT, prescription: { ...PRES, countsCi90: ci(8240, 8240) } });
    expect(host.querySelectorAll('[data-game]').length).toBe(8); // the table itself survives
    expect(host.querySelector('[data-sens-band]')).toBeNull();
  });

  it('withholds tier two in a sentence a player understands when k is unpinned', () => {
    const host = mount({ ...RESULT, prescription: unpinnedPres() });
    expect(host.querySelector('.result__games')).toBeNull();
    const t = host.querySelector('[data-result="tier-two-withheld"]')!.textContent!;
    expect(t).toContain('one measured factor');
    expect(t).toContain('your game and current in-game sensitivity');
  });

  it('the your-game selector re-highlights the matching row and REMEMBERS the pick', () => {
    const host = document.createElement('div');
    const ctx = fakeCtx();
    const saved: unknown[] = [];
    ctx.storage.savePrefs = (p) => void saved.push(p);
    resultScreen(host, ctx).mount();
    const select = host.querySelector('[data-action="your-game"]') as HTMLSelectElement;
    select.value = 'valorant';
    select.dispatchEvent(new Event('change'));
    expect(host.querySelector('tr[data-game="valorant"]')!.getAttribute('data-current')).toBe('true');
    expect(host.querySelectorAll('tr[data-current="true"]').length).toBe(1);
    expect(ctx.draft.currentGame).toBe('valorant');
    expect(saved.length).toBe(1);
    expect((saved[0] as { currentGame: string }).currentGame).toBe('valorant');
  });

  it('a tuned value renders no tier two at all (its k evidence was dropped with the measurement)', () => {
    const host = mount({ ...RESULT, tuned: true });
    expect(host.querySelector('[data-tier="two"]')).toBeNull();
    expect(host.querySelector('[data-result="tier-two-withheld"]')).toBeNull();
  });
});

describe('result screen, tier three (arithmetic on your input)', () => {
  it('renders HARDWARE counts when k is pinned, and says so (A6)', () => {
    const host = mount();
    const span = host.querySelector('[data-result="tier-three-counts"]')!;
    expect(span.textContent).toBe('4,120'); // 8,240 browser counts / k of 2
    expect(span.getAttribute('data-counts-kind')).toBe('hardware');
    const t = host.querySelector('[data-tier="three"]')!.textContent!;
    expect(t).toContain('hardware counts');
    expect(t).toContain('divided by DPI, times 2.54');
  });

  it('converts the hardware counts through a typed DPI, labelled as arithmetic, no extra caveat needed', () => {
    const host = mount();
    const input = host.querySelector('[data-action="dpi-convert"]') as HTMLInputElement;
    input.value = '800';
    input.dispatchEvent(new Event('input'));
    const out = host.querySelector('[data-result="dpi-converted"]') as HTMLElement;
    expect(out.hidden).toBe(false);
    expect(out.textContent).toContain('4,120 ÷ 800 × 2.54');
    expect(out.textContent).toContain('13.1 cm per 360'); // 4120 / 800 * 2.54 = 13.08
    expect(out.textContent!.toLowerCase()).toContain('arithmetic on the dpi you typed');
    expect(out.textContent!.toLowerCase()).not.toContain('second unmeasured factor');
  });

  it('falls back to BROWSER counts when k is unpinned and names the second unmeasured factor (A6)', () => {
    const host = mount({ ...RESULT, prescription: unpinnedPres() });
    const span = host.querySelector('[data-result="tier-three-counts"]')!;
    expect(span.textContent).toBe('8,240');
    expect(span.getAttribute('data-counts-kind')).toBe('browser');
    expect(host.querySelector('[data-tier="three"]')!.textContent).toContain('browser counts');
    const input = host.querySelector('[data-action="dpi-convert"]') as HTMLInputElement;
    input.value = '800';
    input.dispatchEvent(new Event('input'));
    const out = host.querySelector('[data-result="dpi-converted"]')!;
    expect(out.textContent).toContain('26.2 cm per 360'); // 8240 / 800 * 2.54 = 26.16
    // The tier that exists to refuse overclaiming may not quietly overclaim: the conversion
    // names BOTH unmeasured factors, the typed DPI and the browser-to-mouse scale.
    expect(out.textContent!.toLowerCase()).toContain('second unmeasured factor');
  });

  it('clears the conversion for a DPI that is not a positive number: no guess, no zero', () => {
    const host = mount();
    const input = host.querySelector('[data-action="dpi-convert"]') as HTMLInputElement;
    const out = host.querySelector('[data-result="dpi-converted"]') as HTMLElement;
    for (const bad of ['800', '-5']) { // prime with a good value first, then poison
      input.value = bad;
      input.dispatchEvent(new Event('input'));
    }
    expect(out.hidden).toBe(true);
    expect(out.textContent).toBe('');
  });

  it('typedCm is pure arithmetic that refuses instead of guessing', () => {
    expect(typedCm(8240, 800)).toBeCloseTo(26.162, 3);
    expect(typedCm(8240, 0)).toBeNull();
    expect(typedCm(8240, -1)).toBeNull();
    expect(typedCm(8240, NaN)).toBeNull();
  });
});

describe('result screen, evidence blocks', () => {
  it('shows breakdown contributions and renders NaN as -', () => {
    const host = mount({ ...RESULT, breakdown: { ...RESULT.breakdown, precisionFloorDeg: NaN } });
    expect(host.querySelector('[data-breakdown="ttkMs"]')!.textContent).toContain('511');
    expect(host.querySelector('[data-breakdown="precisionFloorDeg"]')!.textContent).toContain('-');
  });

  it('groups the breakdown into origin vs readings tiers', () => {
    const host = mount();
    const origin = host.querySelector('[data-tier="origin"]')!;
    const readings = host.querySelector('[data-tier="readings"]')!;
    expect(origin.querySelector('[data-breakdown="biasZeroCounts"]')).toBeTruthy();
    expect(readings.querySelector('[data-breakdown="precisionFloorDeg"]')).toBeTruthy();
    expect(readings.querySelector('[data-breakdown="ttkMs"]')).toBeTruthy();
    expect(readings.querySelector('[data-breakdown="hitRate"]')).toBeTruthy();
    expect(origin.querySelector('[data-breakdown="ttkMs"]')).toBeNull();
  });

  it('pins every data-breakdown value span byte-identically (storage/export pinning)', () => {
    const host = mount();
    expect(host.querySelector('[data-breakdown="biasZeroCounts"]')!.textContent).toBe('7,940 counts per 360');
    expect(host.querySelector('[data-breakdown="precisionFloorDeg"]')!.textContent).toBe('0.42°');
    expect(host.querySelector('[data-breakdown="ttkMs"]')!.textContent).toBe('511 ms');
    expect(host.querySelector('[data-breakdown="hitRate"]')!.textContent).toBe('86%');
  });

  it('renders the convergence plot (curve + peak + a mark per persisted trial) as the climax', () => {
    const host = mount();
    const svg = host.querySelector('figure svg') as SVGElement | null;
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute('aria-hidden')).toBe('true');
    expect(svg!.getAttribute('viewBox')).toMatch(/^0 0 \d/); // fixed viewBox, not clientWidth
    expect(svg!.querySelector('[data-curve]')).toBeTruthy();
    expect(svg!.querySelector('[data-peak]')).toBeTruthy();
    expect(svg!.querySelectorAll('[data-mark]').length).toBe(TRIALS.length);
  });

  it('renders number-only (no plot) for an OLD result that lacks curve/bounds', () => {
    const { curve: _c, bounds: _b, ...old } = RESULT;
    const host = mount(old);
    expect(host.querySelector('figure svg')).toBeNull();
    expect(host.querySelector('[data-result="counts360"], [data-result="ratio"]')).toBeTruthy();
  });

  it('does NOT draw the plot for a tuned-by-feel result (no measured curve claim)', () => {
    const host = mount({ ...RESULT, tuned: true });
    expect(host.querySelector('figure svg')).toBeNull();
  });

  it('renders the track/flick facet micro-plot on the shared counts log axis', () => {
    const host = mount();
    const micro = host.querySelector('svg[data-facets]') as SVGElement | null;
    expect(micro).toBeTruthy();
    expect(micro!.getAttribute('viewBox')).toMatch(/^0 0 \d/);
    const marks = micro!.querySelectorAll('[data-mark="track"], [data-mark="flick"]');
    expect(marks.length).toBe(2);
    expect(micro!.querySelector('[data-mark="strike"]')).toBeNull();
  });

  it('renders the affine contribution numbers (dash when NaN, no fabrication)', () => {
    const host = mount({ ...RESULT, breakdown: { ...RESULT.breakdown, trackContribZ: NaN } });
    expect(host.querySelector('[data-breakdown="flickContribZ"]')!.textContent).toContain('0.3');
    expect(host.querySelector('[data-breakdown="trackContribZ"]')!.textContent).toContain('-');
  });

  it('omits the facet micro-plot for an OLD result that lacks contributions', () => {
    const { trackContribZ: _t, flickContribZ: _f, ...bk } = RESULT.breakdown;
    const host = mount({ ...RESULT, breakdown: bk });
    expect(host.querySelector('svg[data-facets]')).toBeNull();
    expect(host.querySelector('[data-breakdown="trackContribZ"]')).toBeNull();
  });

  it('shows the CI-concord readout (tight) for a sharp measured CI', () => {
    const host = mount({ ...RESULT, ci90: ci(8100, 8300) });
    const concord = host.querySelector('[data-result="concord"]')!;
    expect(concord).toBeTruthy();
    expect(concord.textContent!.toLowerCase()).toContain('concur');
  });

  it('frames a wide CI as a possibility LIST naming BOTH causes (never asserts one)', () => {
    const host = mount({ ...RESULT, ci90: ci(4500, 12500) });
    const txt = host.querySelector('[data-result="concord"]')!.textContent!.toLowerCase();
    expect(txt).toContain('short');
    expect(txt).toContain('disagree');
    expect(txt).not.toMatch(/because the (facets|views) disagree/);
  });

  it('gates the concord readout behind !tuned and omits it for a degenerate CI', () => {
    expect(mount({ ...RESULT, tuned: true }).querySelector('[data-result="concord"]')).toBeNull();
    expect(mount({ ...RESULT, ci90: [c(NaN), c(NaN)] }).querySelector('[data-result="concord"]')).toBeNull();
  });

  it('shows the session-drift readout with NEUTRAL copy: practice or fatigue, never one cause', () => {
    const host = mount({ ...RESULT, driftZ: 0.42 });
    const v = host.querySelector('[data-result="driftZ"]')!;
    expect(v.textContent).toContain('0.42');
    const txt = host.textContent!.toLowerCase();
    expect(txt).toContain('practice');
    expect(txt).toContain('fatigue');
    expect(txt).toContain('removed from the number');
    expect(txt).not.toMatch(/practice gain|fatigue loss|because of practice|because of fatigue/);
  });

  it('dashes the drift readout when the extended fit fell back (no removal claim)', () => {
    const host = mount(); // RESULT has no driftZ
    const v = host.querySelector('[data-result="driftZ"]')!;
    expect(v.textContent).toBe('-');
    const txt = host.textContent!.toLowerCase();
    expect(txt).not.toMatch(/\bremoved from the number\b/);
    expect(txt).toMatch(/not separable|nothing was removed/);
    expect(txt).toMatch(/plain fit/);
  });

  it('gates the drift readout behind !tuned', () => {
    expect(mount({ ...RESULT, driftZ: 0.42, tuned: true }).querySelector('[data-result="driftZ"]')).toBeNull();
  });

  it('labels the strike rows with the chosen speed/accuracy lean, attributed to the user', () => {
    const host = mount({ ...RESULT, speedAccuracy: 0.8 });
    const lean = host.querySelector('[data-result="strikeLean"]')!;
    const t = lean.textContent!.toLowerCase();
    expect(t).toContain('speed');
    expect(t).toMatch(/you chose|your call|your choice/);
    expect(host.textContent!.toLowerCase()).toContain('skill');
    const acc = mount({ ...RESULT, speedAccuracy: 0.2 });
    expect(acc.querySelector('[data-result="strikeLean"]')!.textContent!.toLowerCase()).toContain('accuracy');
    expect(mount().querySelector('[data-result="strikeLean"]')).toBeNull(); // absent lean: no label
  });
});

// A5 thesis block + payoff arc, carried over from the cm/360 screen with counts formatting.
const FC: NonNullable<Result['facetConcordance']> = {
  facets: [
    { instrument: 'track', peakCounts: c(7900), spreadLn: 0.08, laneConditioned: false },
    { instrument: 'flick', peakCounts: c(8400), spreadLn: 0.11, laneConditioned: false },
    { instrument: 'calibrate', laneConditioned: false }, // unfittable: dashed, never faked
    { instrument: 'strike', peakCounts: c(10200), spreadLn: 0.2, laneConditioned: true },
  ],
  tier: 'some-spread',
};

describe('result screen, A5 thesis block', () => {
  it('renders the tier copy, each facet peak in counts (dash when unfittable), and the strike note', () => {
    const host = mount({ ...RESULT, facetConcordance: FC });
    const thesis = host.querySelector('[data-result="thesis"]')!;
    expect(thesis.getAttribute('data-thesis-tier')).toBe('some-spread');
    const txt = thesis.textContent!;
    expect(txt).toContain('7,900');
    expect(txt).toContain('8,400');
    expect(txt).toContain('counts per 360');
    expect(thesis.querySelector('[data-thesis-facet="calibrate"]')!.textContent).toContain('-');
    expect(thesis.querySelector('[data-thesis-facet="strike"]')!.innerHTML).toContain('sup');
    expect(txt.toLowerCase()).toContain('excluded from the verdict');
  });

  it('reports an inconclusive tier plainly: no verdict, never a hidden pass', () => {
    const host = mount({ ...RESULT, facetConcordance: { facets: FC.facets } });
    const thesis = host.querySelector('[data-result="thesis"]')!;
    expect(thesis.getAttribute('data-thesis-tier')).toBe('inconclusive');
    expect(thesis.textContent!.toLowerCase()).toContain('no verdict');
  });

  it('divergence is shown as honest doubt, never asserting a cause', () => {
    const host = mount({ ...RESULT, facetConcordance: { ...FC, tier: 'divergent' } });
    const txt = host.querySelector('[data-result="thesis"]')!.textContent!.toLowerCase();
    expect(txt).toContain('disagree');
    expect(txt).not.toMatch(/because|caused by/);
  });

  it('draws the facet-peak diamonds on the MAIN convergence plot', () => {
    const host = mount({ ...RESULT, facetConcordance: FC });
    const svg = host.querySelector('svg[data-plot]')!;
    expect(svg.querySelectorAll('[data-facet-peak]').length).toBe(3);
    expect(svg.querySelector('[data-facet-peak="strike"]')!.getAttribute('stroke-dasharray')).toBe('2 2');
    expect(svg.querySelector('[data-facet-peak="calibrate"]')).toBeNull();
  });

  it('renders NO thesis block when facetConcordance is absent or the value is tuned', () => {
    expect(mount().querySelector('[data-result="thesis"]')).toBeNull();
    expect(mount({ ...RESULT, facetConcordance: FC, tuned: true }).querySelector('[data-result="thesis"]')).toBeNull();
  });
});

describe('result screen, payoff arc', () => {
  it('the range CTA is the PRIMARY action and leads the row', () => {
    const host = mount();
    const actions = host.querySelector('.result__actions')!;
    const buttons = [...actions.querySelectorAll('button')];
    expect(buttons[0].getAttribute('data-action')).toBe('range');
    expect(buttons[0].className).toContain('action--primary');
    expect(actions.querySelector('[data-action="again"]')!.className).toContain('action--ghost');
    expect(actions.querySelector('[data-action="export"]')!.className).toContain('action--ghost');
  });

  it('adds a plot legend keying the organism colors', () => {
    const legend = mount().querySelector('.result__plot .plot-legend')!;
    expect(legend).toBeTruthy();
    expect(legend.querySelectorAll('[data-legend]').length).toBe(4);
  });

  it('stages the reveal: number right after the lead, actions last', () => {
    const host = mount();
    const beats = [...host.querySelectorAll('[data-reveal]')];
    expect(beats.length).toBeGreaterThanOrEqual(8);
    const idx = (el: Element): number => Number((el as HTMLElement).style.getPropertyValue('--reveal-i'));
    expect(idx(host.querySelector('.result__number')!)).toBe(1);
    const actionsIdx = idx(host.querySelector('.result__actions')!);
    for (const b of beats) expect(idx(b)).toBeLessThanOrEqual(actionsIdx);
  });

  it('arms the reveal class on the next frame so the CSS cascade can run', async () => {
    const host = document.createElement('div');
    resultScreen(host, fakeCtx()).mount();
    const root = host.querySelector('.result')!;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(root.classList.contains('is-revealed')).toBe(true);
  });

  it('run again navigates home and the range CTA navigates to the range', () => {
    const host = document.createElement('div');
    const ctx = fakeCtx();
    resultScreen(host, ctx).mount();
    (host.querySelector('[data-action="again"]') as HTMLButtonElement).click();
    (host.querySelector('[data-action="range"]') as HTMLButtonElement).click();
    expect(ctx.nav).toContain('hero');
    expect(ctx.nav).toContain('range');
  });
});
