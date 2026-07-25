import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * Markup and stylesheets are written in different files with nothing checking that they agree,
 * so a class can be applied to an element and styled by nobody. That failure is invisible in
 * review: the element renders, just as unstyled prose. Five of them shipped that way at once
 * (.cal-method, the two .session__dialed readouts, .setup__remembered, .setup__manual-note),
 * which is what this file is for. It reads the sheets and the markup as text and checks they
 * still line up.
 */

const SHEETS = readdirSync('src/styles').filter((f) => f.endsWith('.css'));

/** Strip comments so a class merely discussed in prose never satisfies an assertion. */
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');

const code = strip(SHEETS.map((f) => readFileSync(`src/styles/${f}`, 'utf8')).join('\n'));

/** Every class selector the stylesheets define, e.g. `.options__panel` -> `options__panel`. */
const defined = new Set([...code.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]));

/**
 * Names that are deliberately unstyled, each for a stated reason. A class on an element is
 * usually a promise that a rule exists; these are the exceptions, and keeping them written
 * down is what makes the assertion below meaningful rather than a wall of noise.
 */
const HOOKS = new Map<string, string>([
  // Block roots. The screen's look comes from .screen / .screen--shell; the block name is a
  // namespace for its own elements and a stable handle for tests.
  ['hero', 'block root'],
  ['options', 'block root'],
  ['session', 'block root'],
  ['range', 'block root'],
  ['result', 'block root'],
  ['case', 'block root'],
  // Layout wrappers that are simply a grid or flex child and need nothing of their own.
  ['hero__intro', 'grid cell, sized by .hero'],
  // Already hidden by .sr-only alongside it; this name exists so a test can find the sentence.
  ['result__sr-summary', 'test handle on an .sr-only element'],
  // A state flag result.ts sets that no sheet reads: the staged reveal runs from the .reveal
  // animation on mount, which does not need JS. Reported for removal in result.ts.
  ['is-revealed', 'inert state flag, owned by result.ts'],
]);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
}
const tsFiles = walk('src').filter((f) => f.endsWith('.ts'));

/**
 * Class names the app actually puts on an element. Collected from the ways this codebase sets
 * them: a `class="..."` attribute inside a template string, an assignment to `.className`
 * (including the ternary form), and `classList.add/remove/toggle`. A `${...}` hole inside a
 * class attribute is skipped rather than guessed at, so an interpolated class is never
 * reported as missing.
 */
function appliedClasses(src: string): string[] {
  const out: string[] = [];
  const push = (list: string): void => {
    for (const raw of list.split(/\s+/)) {
      if (raw && /^[A-Za-z][\w-]*$/.test(raw)) out.push(raw);
    }
  };
  for (const m of src.matchAll(/class="([^"]*)"/g)) push(m[1]);
  for (const m of src.matchAll(/className\s*\+?=\s*['"`]([^'"`$]*)['"`]/g)) push(m[1]);
  for (const m of src.matchAll(/className\s*\+?=[^;\n]*?\?\s*'([^']*)'\s*:\s*'([^']*)'/g)) {
    push(m[1]); push(m[2]);
  }
  for (const m of src.matchAll(/classList\.(?:add|remove|toggle)\(([^)]*)\)/g)) {
    for (const lit of m[1].matchAll(/['"`]([^'"`$]*)['"`]/g)) push(lit[1]);
  }
  return out;
}

describe('stylesheets and markup agree', () => {
  it('styles every class the app applies to an element', () => {
    const missing = new Map<string, string>();
    for (const file of tsFiles) {
      for (const cls of appliedClasses(readFileSync(file, 'utf8'))) {
        if (!defined.has(cls) && !HOOKS.has(cls) && !missing.has(cls)) missing.set(cls, file);
      }
    }
    expect(
      [...missing].map(([cls, file]) => `.${cls} (applied in ${file})`),
      'these classes are applied to elements and styled by nothing',
    ).toEqual([]);
  });

  it('carries no rule for a class nothing applies, beyond the named primitives', () => {
    // The other direction. A rule with no caller is dead weight, and it also lies about what
    // the system offers. Two entries survive on purpose: .panel and .lattice are the canon's
    // named primitives, and the copy sites share their declarations through the selector list
    // rather than each restating them, so both names carry real rules.
    const applied = new Set(tsFiles.flatMap((f) => appliedClasses(readFileSync(f, 'utf8'))));
    const PRIMITIVES = new Set(['lattice', 'panel']);
    const dead = [...defined].filter((c) => !applied.has(c) && !PRIMITIVES.has(c) && c !== 'woff2');
    expect(dead.sort(), 'these rules are defined and never called').toEqual([]);
  });

  it('animates on the motion tokens, never a hand-typed duration', () => {
    // 2.4s, 90ms and a 70ms stagger step all shipped as literals. A duration that is not a
    // token cannot be turned down by the reduced-motion block, which is the point of having
    // tokens at all. The 0.001ms in base.css is that block's own kill switch, not a design
    // choice, so it is the one literal allowed.
    const offenders: string[] = [];
    for (const name of SHEETS) {
      const sheet = strip(readFileSync(`src/styles/${name}`, 'utf8'));
      for (const m of sheet.matchAll(/(?:^|[;{])\s*(transition|animation)(-duration|-delay)?\s*:\s*([^;}]+)/g)) {
        for (const term of m[3].split(/[\s,]+/)) {
          if (!/^[\d.]+m?s$/.test(term) || term === '0.001ms') continue;
          offenders.push(`${name}: ${m[1]}${m[2] ?? ''}: ${m[3].trim()}`);
        }
      }
    }
    expect(offenders, 'these durations are not on the --dur tokens').toEqual([]);
  });

  it('reads every custom property it defines, outside the published scales', () => {
    // A one-off token nobody consumes is debt: --pad-card, --gap-inline, --gap-stack, the whole
    // elevation ladder and a pill radius all sat here unread, each reading as an offer the
    // system does not actually make.
    //
    // The line this draws: a SCALE is the design system and stays whole, because a scale with
    // steps missing is not a scale and the next component has nowhere to land. Anything that is
    // not part of a scale has to be called by something. The scales are the ones the canon
    // fixes and tests hold: the stone ramp, the twelve-mineral collection with its washes, the
    // status triples, the type steps, and the duration ramp. The product-side shorthand for
    // those steps is the .t-* roles above, and those DO have to be called.
    const tokens = strip(readFileSync('src/styles/tokens.css', 'utf8'));
    const MINERALS = ['lapis', 'malachite', 'amethyst', 'carnelian', 'citrine', 'rose',
      'turquoise', 'azurite', 'jade', 'sulfur', 'pyrite', 'hematite'];
    const scale = (t: string): boolean =>
      /^--stone-\d+$/.test(t)
      || MINERALS.some((m) => t === `--${m}` || t === `--${m}-wash`)
      || /^--(color|text-on)-(success|warning|danger|info)(-wash)?$/.test(t)
      || /^--(text|type|leading|tracking)-[\w-]+$/.test(t)
      || /^--dur-[\w-]+$/.test(t);

    const read = new Set([...code.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
    const dead = [...new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))]
      .filter((t) => !read.has(t) && !scale(t));
    expect(dead.sort(), 'these tokens are defined and never read').toEqual([]);
  });
});
