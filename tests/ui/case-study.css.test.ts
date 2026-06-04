import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const css = readFileSync('src/styles/case-study.css', 'utf-8');

describe('case-study.css', () => {
  it('forces the lowercase editorial voice on the article, with data/demo opt-outs', () => {
    expect(css).toMatch(/\.case\b[^{]*\{[^}]*text-transform:\s*lowercase/);
    expect(css).toMatch(/\[data-demo\][^{]*\{[^}]*text-transform:\s*none/);
  });
  it('defines the brutalist-editorial chrome selectors', () => {
    for (const sel of ['.cs-grid', '.cs-numeral', '.cs-reg', '.cs-spine', '.cs-spec', '.cs-exo', '.cs-eyebrow']) {
      expect(css).toContain(sel);
    }
  });
  it('threads a per-section organism accent variable', () => {
    expect(css).toMatch(/--cs-accent/);
  });
  it('reveal transition collapses under reduced motion', () => {
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(css).toMatch(/\[data-reveal\]/);
  });
  it('stays inside the campeón palette tokens (no raw cobalt from the sibling project)', () => {
    expect(css).not.toMatch(/#1D3FD9/i);
  });
  it('reveal is progressively enhanced - the hidden state is scoped to a JS-set active flag', () => {
    // opacity:0 must be gated by `.case[data-reveal-active]`, never global, so content is
    // never trapped invisible when JS/IntersectionObserver are absent or fail to fire.
    expect(css).toMatch(/\.case\[data-reveal-active\][^{]*\[data-reveal\][^{]*\{[^}]*opacity:\s*0/);
    expect(css).not.toMatch(/(^|\})\s*\[data-reveal\]\s*\{[^}]*opacity:\s*0/m);
  });
});
