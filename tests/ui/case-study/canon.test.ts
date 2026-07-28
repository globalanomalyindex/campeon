// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { caseStudy } from '../../../src/ui/case-study/case-study';
import { demoConvergence } from '../../../src/ui/case-study/content';
import type { AppContext } from '../../../src/ui/shell';

beforeEach(() => {
  class IO { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } root = null; rootMargin = ''; thresholds = []; }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
});

function mountCase(): HTMLElement {
  const host = document.createElement('div');
  const ctx = { navigate() {}, route: 'case-study', storage: {} as never, draft: {} as never } as unknown as AppContext;
  caseStudy(host, ctx).mount();
  return host;
}

describe('case study canon (the spec test extended beyond the result screen, F18)', () => {
  it('speaks counts per 360 and never the retired unit', () => {
    const text = mountCase().textContent!;
    expect(text).not.toContain('cm/360');
    // "cm per 360" is reserved for the result screen's typed-DPI conversion line; the case study
    // may say "centimetres" when explaining that conversion, but never quotes the retired unit.
    expect(text).not.toContain('cm per 360');
    expect(text).toContain('counts per 360');
  });

  it('tells the blind-turn story, not the card sweep or the spin', () => {
    const text = mountCase().textContent!.toLowerCase();
    // The deleted instrument's narrative markers. "specimen card" (a UI idiom) stays legal;
    // the WALLET card, the drag-a-card sweep and the DPI measurement claim do not.
    expect(text).not.toMatch(/drag a card|card('|’)s width|wallet card/);
    expect(text).not.toContain('measure your dpi');
    expect(text).toContain('blind');
    expect(text).toContain('turn all the way around');
  });

  it('the specimen-card figure quotes counts, not centimetre-shaped values relabelled', () => {
    const card = mountCase().querySelector('.cs-ui--card')!;
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('your counts per 360');
    expect(card.textContent).toContain('9,260');
    expect(card.textContent).toContain('8,630 to 9,800 counts per 360');
    // The sed relabel trap (F18): 29.4 was centimetres; as counts it would be fabricated.
    expect(card.textContent).not.toContain('29.4');
  });

  it('the worked-example fixture lives on a counts scale, not relabelled centimetres', () => {
    const demo = demoConvergence();
    // 15 to 60 was the cm-era window; a counts axis is three orders of magnitude up. This pins
    // the whole fixture, not just the four peaks phase 1a already converted.
    expect(demo.bounds[0]).toBeGreaterThan(1000);
    expect(demo.ci90![0]).toBeGreaterThan(1000);
    expect(demo.marks.every((m) => m.counts > 1000)).toBe(true);
    for (const f of demo.facetPeaks!) {
      expect(f.peakCounts === undefined || f.peakCounts > 1000).toBe(true);
    }
  });
});
