import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('brand tokens', () => {
  const css = readFileSync('src/styles/tokens.css', 'utf8');

  it('defines the cinematic western palette', () => {
    expect(css).toContain('--cinema-ink: #0c0b09');
    expect(css).toContain('--cinema-cream: #efe7d6');
    expect(css).toContain('--blood: #c4251f');
    expect(css).toContain('--gold: #FFC400');
  });

  it('exposes the semantic surface / text / line roles every screen builds on', () => {
    for (const t of ['--surface', '--surface-raised', '--text', '--text-muted', '--text-faint', '--line', '--accent']) {
      expect(css).toContain(`${t}:`);
    }
  });

  it('uses Bartine Disco as the display face, app-wide', () => {
    expect(css).toMatch(/@font-face[\s\S]*Bartine Disco/);
    expect(css).toMatch(/--font-display:\s*'Bartine Disco'/);
  });

  it('has fully retired the old Gefalent face', () => {
    expect(css).not.toContain('Gefalent');
  });
});
