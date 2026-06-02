import { describe, it, expect } from 'vitest';
import { SECTIONS, CITATIONS, CREDIT, demoConvergence } from '../../../src/ui/case-study/content';

describe('case-study content', () => {
  it('has the five acts in order (premise, instruments, engine, honesty, colophon)', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(
      ['premise', 'track', 'flick', 'calibrate', 'strike', 'engine', 'honesty', 'colophon'],
    );
  });
  it('each instrument section carries its real organism numbers', () => {
    const byId = Object.fromEntries(SECTIONS.map((s) => [s.id, s]));
    const blob = (id: string) => JSON.stringify(byId[id]);
    expect(blob('track')).toContain('29.94');
    expect(blob('flick')).toContain('4.133');
    expect(blob('calibrate')).toContain('MSE');
    expect(blob('strike')).toContain('10,400');
  });
  it('names no company (implicit angle) but keeps the portfolio-theme credit', () => {
    const all = JSON.stringify({ SECTIONS, CITATIONS, CREDIT }).toLowerCase();
    expect(all).not.toContain('anthropic');
    expect(all).toContain('looking to nature for answers');
    expect(all).toContain('christopher robin fiore');
  });
  it('lists the spec §13 citations (≥ 8 sources, each with a year)', () => {
    expect(CITATIONS.length).toBeGreaterThanOrEqual(8);
    for (const c of CITATIONS) expect(c).toMatch(/\(\d{4}\)|\b(19|20)\d{2}\b/);
  });
  it('the convergence demo is concave with four organism mark-sets converging near the peak', () => {
    const demo = demoConvergence();
    const kinds = new Set(demo.marks.map((m) => m.instrument));
    expect(kinds).toEqual(new Set(['track', 'flick', 'calibrate', 'strike']));
    expect(demo.peak).toBeGreaterThan(demo.bounds[0]);
    expect(demo.peak).toBeLessThan(demo.bounds[1]);
    expect(demo.ci90![0]).toBeLessThan(demo.peak!);
    expect(demo.ci90![1]).toBeGreaterThan(demo.peak!);
  });
});
