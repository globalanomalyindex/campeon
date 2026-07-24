import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { hex } from '../src/palette';

/**
 * These tests enforce docs/design/canon.md mechanically.
 *
 * The design system this app adopts has a handful of absolute rules (zero radius,
 * Regular weight only, no decorative gradients, no coloured glows, an 8px ramp).
 * Rules that live only in a document drift. Rules with a test behind them do not,
 * so each one below fails the build if someone reintroduces what the canon removed.
 */

const tokens = readFileSync('src/styles/tokens.css', 'utf8');
const base = readFileSync('src/styles/base.css', 'utf8');
const sheets = readdirSync('src/styles')
  .filter((f) => f.endsWith('.css'))
  .map((f) => ({ name: f, css: readFileSync(`src/styles/${f}`, 'utf8') }));

/** Strip comments so a rule named in prose never satisfies or trips an assertion. */
const code = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('design tokens: the foundation', () => {
  it('defines the warm stone ramp end to end', () => {
    for (const step of [0, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      expect(tokens).toMatch(new RegExp(`--stone-${step}:`));
    }
    expect(tokens).toContain('--stone-50:  #F4F0E7'); // the paper
    expect(tokens).toContain('--stone-900: #17140F'); // the ink
  });

  it('defines all twelve minerals with a wash apiece', () => {
    const minerals = ['lapis', 'malachite', 'amethyst', 'carnelian', 'citrine', 'rose',
      'turquoise', 'azurite', 'jade', 'sulfur', 'pyrite', 'hematite'];
    for (const m of minerals) {
      expect(tokens, `${m} base`).toMatch(new RegExp(`--${m}:\\s*#[0-9A-F]{6}`));
      expect(tokens, `${m} wash`).toMatch(new RegExp(`--${m}-wash:\\s*#[0-9A-F]{6}`));
    }
  });

  it('keeps Lapis as the one interactive primary, never an instrument', () => {
    expect(tokens).toMatch(/--color-primary:\s*var\(--lapis\)/);
    for (const i of ['track', 'flick', 'calibrate', 'strike']) {
      expect(tokens).not.toMatch(new RegExp(`--instrument-${i}:\\s*var\\(--lapis\\)`));
    }
  });

  it('names the four instruments as four distinct minerals', () => {
    const pairs: Array<[string, string]> = [
      ['track', 'amethyst'], ['flick', 'citrine'],
      ['calibrate', 'turquoise'], ['strike', 'carnelian'],
    ];
    const seen = new Set<string>();
    for (const [instrument, mineral] of pairs) {
      expect(tokens).toMatch(new RegExp(`--instrument-${instrument}:\\s*var\\(--${mineral}\\)`));
      seen.add(mineral);
    }
    expect(seen.size, 'each instrument gets its own mineral').toBe(4);
  });
});

describe('design tokens: the absolute rules', () => {
  it('is sharp by rule: no frame ever carries a radius', () => {
    for (const { name, css } of sheets) {
      const radii = code(css).match(/border-radius:\s*[^;]+/g) ?? [];
      for (const decl of radii) {
        // Circles are permitted as content or affordance (dots, thumbs, swatches).
        expect(decl, `${name}: ${decl}`).toMatch(/(:\s*0\b)|(50%)|(999px)|(--radius-(none|pill|round))/);
      }
    }
  });

  it('never fakes a weight: both faces ship Regular only', () => {
    for (const { name, css } of sheets) {
      const weights = code(css).match(/font-weight:\s*[^;]+/g) ?? [];
      for (const decl of weights) {
        expect(decl, `${name}: ${decl}`).toMatch(/(400)|(normal)|(--weight-regular)/);
      }
      // The `font:` shorthand can smuggle a weight in as a leading number.
      const shorthand = code(css).match(/[^-]font:\s*(?!var\()[^;]+/g) ?? [];
      for (const decl of shorthand) {
        expect(decl, `${name}: ${decl}`).not.toMatch(/\b([5-9]00|bold(er)?)\b/);
      }
    }
  });

  it('carries no decorative gradient and no coloured glow', () => {
    for (const { name, css } of sheets) {
      const c = code(css);
      expect(c, `${name} gradient`).not.toMatch(/linear-gradient|radial-gradient|conic-gradient/);
      expect(c, `${name} text-shadow`).not.toMatch(/text-shadow:\s*(?!none)/);
      // Shadows stay matte and ink-tinted: rgba(23,20,15,...) only.
      for (const decl of c.match(/box-shadow:\s*[^;]+/g) ?? []) {
        expect(decl, `${name}: ${decl}`).toMatch(/(none)|(var\(--(shadow|elevation|focus)-)|(rgba\(23,\s*20,\s*15)/);
      }
    }
  });

  it('has retired the western skin completely', () => {
    for (const { name, css } of sheets) {
      for (const dead of ['Bartine Disco', '#c4251f', '#FFC400', '#efe7d6', '#0c0b09', 'Gefalent']) {
        expect(css, `${name} still references ${dead}`).not.toContain(dead);
      }
    }
  });

  it('moves calmly: no bounce, no overshoot', () => {
    for (const { name, css } of sheets) {
      for (const decl of code(css).match(/cubic-bezier\([^)]*\)/g) ?? []) {
        // An overshoot shows up as a control point outside [0,1] on the output axis.
        const [, y1, , y2] = decl.replace(/cubic-bezier\(|\)/g, '').split(',').map(Number);
        expect(y1, `${name}: ${decl}`).toBeLessThanOrEqual(1);
        expect(y2, `${name}: ${decl}`).toBeLessThanOrEqual(1);
        expect(y1, `${name}: ${decl}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('holds the 8px rhythm in the spacing ramp', () => {
    const ramp = [4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192];
    ramp.forEach((px, i) => expect(tokens).toContain(`--space-${i + 1}: ${px}px`));
  });
});

describe('design tokens: type', () => {
  it('loads exactly the two brand faces, subset as woff2', () => {
    const faces = tokens.match(/@font-face\s*{[^}]*}/g) ?? [];
    expect(faces).toHaveLength(2);
    expect(tokens).toMatch(/font-family:\s*'Dessign Maison'/);
    expect(tokens).toMatch(/font-family:\s*'Karrik'/);
    for (const face of faces) {
      expect(face).toMatch(/\.woff2'\) format\('woff2'\)/);
      expect(face).toMatch(/font-weight:\s*400/);
    }
  });

  it('splits the two faces by role: Dessign displays, Karrik reads', () => {
    expect(tokens).toMatch(/--font-display:\s*'Dessign Maison'/);
    expect(tokens).toMatch(/--font-text:\s*'Karrik'/);
    expect(tokens).toMatch(/--type-display-2xl:.*var\(--font-display\)/);
    expect(tokens).toMatch(/--type-body-md:.*var\(--font-text\)/);
  });

  it('gives every measured number tabular figures and a slashed zero', () => {
    expect(tokens).toMatch(/--features-figures:\s*'tnum' 1, 'zero' 1/);
    expect(base).toMatch(/\.t-figure\b[\s\S]*?font-variant-numeric:\s*tabular-nums slashed-zero/);
  });
});

describe('the chamber', () => {
  it('re-points the same semantic names instead of forking a second token set', () => {
    const chamber = tokens.slice(tokens.indexOf("[data-surface='chamber']"));
    for (const t of ['--surface-page', '--text-body', '--border-hairline', '--color-primary']) {
      expect(chamber, `chamber must override ${t}`).toContain(`${t}:`);
    }
    expect(chamber).toMatch(/--surface-page:\s*var\(--stone-900\)/);
  });

  it('lifts the primary off Lapis so an action stays readable on ink', () => {
    const chamber = tokens.slice(tokens.indexOf("[data-surface='chamber']"));
    expect(chamber).toMatch(/--color-primary:\s*var\(--azurite\)/);
  });
});

describe('the canvas mirror', () => {
  // src/palette.ts feeds the WebGL and 2D canvas layers, which cannot read CSS
  // custom properties. If the two drift, the arena silently leaves the palette.
  it('mirrors every chamber colour that tokens.css states as literal hex', () => {
    const chamber = tokens.slice(tokens.indexOf("[data-surface='chamber']"));
    const pairs: Array<[keyof typeof hex, string]> = [
      ['track', '--instrument-track'],
      ['flick', '--instrument-flick'],
      ['calibrate', '--instrument-calibrate'],
      ['strike', '--instrument-strike'],
      ['ok', '--color-success'],
      ['danger', '--color-danger'],
    ];
    for (const [key, token] of pairs) {
      const found = chamber.match(new RegExp(`${token}:\\s*(#[0-9A-Fa-f]{6})`));
      expect(found, `${token} must be literal hex in the chamber block`).toBeTruthy();
      expect(found![1].toUpperCase(), `${token} vs palette.${key}`).toBe(hex[key].toUpperCase());
    }
  });

  it('draws the arena field and the stone ramp from the same values as the CSS', () => {
    expect(hex.ink.toUpperCase()).toBe('#17140F'); // --stone-900
    expect(hex.paper.toUpperCase()).toBe('#F4F0E7'); // --stone-50
    expect(hex.alabaster.toUpperCase()).toBe('#FBFAF6'); // --stone-0
    expect(hex.hide.toUpperCase()).toBe('#635B4B'); // --stone-600
    for (const [name, value] of Object.entries(hex)) {
      expect(value, `palette.${name} must be a full hex triplet`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
