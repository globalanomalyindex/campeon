import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const css = readFileSync('src/styles/case-study.css', 'utf-8');

describe('case-study.css', () => {
  it('sets the article in sentence case, with tracked caps reserved for small labels', () => {
    // The article used to force text-transform: lowercase on everything, which the
    // adopted system reserves for nothing: sentence case for anything readable,
    // tracked uppercase only for labels and captions.
    expect(css).not.toMatch(/\.case\b[^{]*\{[^}]*text-transform:\s*lowercase/);
    for (const label of ['.cs-eyebrow', '.cs-env-tag', '.cs-spec dt']) {
      const block = css.slice(css.indexOf(label));
      expect(block.slice(0, block.indexOf('}')), `${label} is a tracked-caps label`)
        .toMatch(/text-transform:\s*uppercase/);
    }
  });
  it('defines the brutalist-editorial chrome selectors', () => {
    // .cs-exo, the dotted frame that used to sit behind every section, is gone: it was
    // decoration the specimen-sheet motif already carries with the registration marks.
    for (const sel of ['.cs-grid', '.cs-numeral', '.cs-reg', '.cs-spine', '.cs-spec',
      '.cs-eyebrow', '.cs-cite', '.cs-demo-tag', '.cs-notes']) {
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
