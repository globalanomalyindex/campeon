import { describe, it, expect } from 'vitest';
import { SECTIONS, CITATIONS, CREDIT, demoConvergence } from '../../../src/ui/case-study/content';

describe('case-study content', () => {
  it('has the five acts in order (premise, instruments, engine, honesty, colophon)', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(
      ['premise', 'track', 'flick', 'calibrate', 'strike', 'engine', 'honesty', 'colophon'],
    );
  });
  it('each instrument act names the environment that forged its accuracy (not just the animal brain)', () => {
    const byId = Object.fromEntries(SECTIONS.map((s) => [s.id, s]));
    for (const id of ['track', 'flick', 'calibrate', 'strike']) {
      expect(typeof byId[id]!.environment).toBe('string');
      expect(byId[id]!.environment!.length).toBeGreaterThan(20);
    }
  });
  it('each instrument section carries its real organism numbers', () => {
    const byId = Object.fromEntries(SECTIONS.map((s) => [s.id, s]));
    const blob = (id: string) => JSON.stringify(byId[id]);
    expect(blob('track')).toContain('29.94');
    expect(blob('flick')).toContain('4.133');
    expect(blob('calibrate')).toContain('MSE');
    expect(blob('strike')).toContain('10,400');
  });
  it('the colophon folds in the graphics-craft + payoff-arc story (Phases B/C), held to the measurement standard', () => {
    const colophon = SECTIONS.find((s) => s.id === 'colophon')!;
    const blob = JSON.stringify(colophon).toLowerCase();
    // Phase B: sculpted procedurally in-repo, and the read-never-write / byte-identical honesty parallel
    expect(blob).toContain('procedural'); // no external DCC pipeline - sculpted in-repo
    expect(blob).toContain('byte-identical'); // the scored stream is unmoved by the skin
    expect(blob).toContain('write nothing back'); // cosmetic layers read, never write
    // Phase C: the payoff arc as the experiential expression of the same rigor
    expect(blob).toContain('remembered'); // calibration remembered, not re-asked
    expect(blob).toContain('stages the reveal'); // the payoff is staged, not dumped
    expect(blob).toContain('range to feel'); // the range as the feel-it beat
    // the closing thesis stays: measurement and craft are one discipline
    expect(blob).toContain('same discipline');
  });
  it('the honesty act shows (not just states) the tested thesis - four marks on one axis', () => {
    const honesty = SECTIONS.find((s) => s.id === 'honesty')!;
    expect(JSON.stringify(honesty).toLowerCase()).toContain('draws them on the one axis');
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
