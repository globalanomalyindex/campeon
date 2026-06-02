import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('brand tokens', () => {
  const css = readFileSync('src/styles/tokens.css', 'utf8');
  it('defines the exact campeón palette', () => {
    expect(css).toContain('--bone: #EAE7DC');
    expect(css).toContain('--slate: #4A5A66');
    expect(css).toContain('--gold: #FFC400');
    expect(css).toContain('--ink: #0D0D0D');
  });
  it('declares the Gefalent face', () => {
    expect(css).toMatch(/@font-face[\s\S]*Gefalent/);
  });
});
