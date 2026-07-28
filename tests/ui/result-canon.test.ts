// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { result as resultScreen } from '../../src/ui/result';
import type { AppContext, Route, SessionDraft } from '../../src/ui/shell';
import { counts360, type Counts360, type Result } from '../../src/types';
import type { Prescription } from '../../src/optimizer/result';

const c = counts360;
const ci = (lo: number, hi: number): [Counts360, Counts360] => [c(lo), c(hi)];

// Deliberately a PARTIAL pin: two games known, six not. The screen dashes the six, which is what
// a reader should see, and it is the case the sweeps below have to survive without lying.
const PRES: Prescription = {
  ratio: 0.88, ratioCi90: [0.79, 0.97],
  counts: c(8240), countsCi90: ci(7800, 8700),
  perGameSens: { cs2: 1.59, valorant: 0.5 },
  kSource: 'typed-sens',
  kLogSd: 0.12,
  hardwareCounts: c(4120),
};
const RESULT: Result = {
  optimalCounts: c(8240), ci90: ci(7800, 8700),
  breakdown: { biasZeroCounts: c(7940), precisionFloorDeg: 0.42, ttkMs: 511, hitRate: 0.86 },
  prescription: PRES,
};

function mount(res: Result): HTMLElement {
  const host = document.createElement('div');
  const draft: SessionDraft = { currentGame: 'cs2', currentSens: 1, bounds: ci(4000, 16000),
    profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } } };
  const ctx = {
    route: 'result' as Route, draft,
    navigate() {},
    storage: { saveSession() {}, loadSessions: () => [], saveResult() {}, exportJson: () => '{}' },
    lastResult: { sessionId: 's1', result: res },
  } as unknown as AppContext;
  resultScreen(host, ctx).mount();
  return host;
}

// Text as a reader actually meets it: one string per run of text, never a concatenation across
// element boundaries. `textContent` welds siblings together, so two adjacent table cells each
// holding a lone dash placeholder read back as a double hyphen that exists only inside the
// extraction. The canon forbids the double hyphen as PUNCTUATION IN PROSE, so the sweep below
// asks each run on its own: a genuine `--` inside one run still fires, a pair of dashed cells
// does not.
function textRuns(root: HTMLElement): string[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const runs: string[] = [];
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const t = n.textContent ?? '';
    if (t.trim() !== '') runs.push(t);
  }
  return runs;
}

// Every honesty branch of the hero, so the sweeps below cover each sentence the screen can speak.
const VARIANTS: Record<string, Result> = {
  directional: RESULT,
  confirmed: { ...RESULT, prescription: { ...PRES, ratio: 1.0, ratioCi90: [0.97, 1.04] } },
  indistinct: { ...RESULT, prescription: { ...PRES, ratio: 0.93, ratioCi90: [0.85, 1.08] } },
  kOnly: (() => { const { ratio: _r, ratioCi90: _rc, ...rest } = PRES; return { ...RESULT, prescription: rest }; })(),
  unanchored: (() => { const { prescription: _p, ...rest } = RESULT; return rest; })(),
  bounded: { ...RESULT, peakAtBound: 'high' },
  tuned: { ...RESULT, tuned: true },
};

describe('result screen canon', () => {
  it('orders the tiers structurally: one, two, three in DOM order', () => {
    const host = mount(RESULT);
    const one = host.querySelector('[data-tier="one"]');
    const two = host.querySelector('[data-tier="two"]');
    const three = host.querySelector('[data-tier="three"]');
    expect(one).toBeTruthy();
    expect(two).toBeTruthy();
    expect(three).toBeTruthy();
    // The ordering is the argument (least assuming first), so it is pinned as DOM structure,
    // not left to CSS: a stylesheet reorder cannot silently invert the epistemics.
    expect(one!.compareDocumentPosition(two!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(two!.compareDocumentPosition(three!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('labels each tier with what it assumes', () => {
    const host = mount(RESULT);
    const head = (tier: string): string =>
      host.querySelector(`[data-tier="${tier}"] .result__tier-head`)!.textContent!;
    expect(head('one')).toBe('No. 1 · assumes nothing');
    expect(head('two')).toBe('No. 2 · one measured factor');
    expect(head('three')).toBe('No. 3 · arithmetic on your input');
  });

  it('the only centimetre on the page is the typed-DPI arithmetic, and no cm/360 survives', () => {
    const host = mount(RESULT);
    expect(host.textContent).not.toContain('cm/360');
    expect(host.textContent).not.toContain('cm per 360'); // absent until the player types a DPI
    const input = host.querySelector('[data-action="dpi-convert"]') as HTMLInputElement;
    input.value = '800';
    input.dispatchEvent(new Event('input'));
    const out = host.querySelector('[data-result="dpi-converted"]')!;
    expect(out.textContent).toContain('cm per 360');
    expect(out.textContent).toContain('2.54');
    expect(host.textContent).not.toContain('cm/360'); // still nowhere, even after converting
  });

  it('spells the unit counts per 360 everywhere, never a slashed compact form (F36)', () => {
    for (const res of Object.values(VARIANTS)) {
      const text = mount(res).textContent!;
      expect(text).toContain('counts per 360');
      expect(text).not.toContain('counts/360');
    }
  });

  it('a bounded result also speaks counts, never the deleted unit', () => {
    const host = mount(VARIANTS.bounded!);
    expect(host.textContent).not.toContain('cm/360');
    expect(host.querySelector('[data-result="bounded"]')!.textContent).toContain('counts per 360');
  });

  it('no em dash, en dash, or double hyphen reaches visible copy, in any hero variant', () => {
    for (const res of Object.values(VARIANTS)) {
      for (const run of textRuns(mount(res))) {
        expect(run).not.toMatch(/[—–]/);
        expect(run).not.toContain('--');
      }
    }
  });

  it('the sweep still catches a double hyphen inside one run of prose', () => {
    // The separator fix must not blunt the rule it enforces. A doctored run proves the sweep
    // above fails on real prose punctuation, not merely on the way the text was gathered.
    const host = mount(RESULT);
    host.querySelector('.result__lead')!.textContent = 'Where you aim best -- roughly';
    const offenders = textRuns(host).filter((run) => run.includes('--'));
    expect(offenders).toHaveLength(1);
  });
});
