# campeón Phase 6 — Polish + `+case study` + `+options` + falcon motion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Fresh subagent per task; two-stage review (spec compliance, then code quality) after each.

**Goal:** Land the four Phase-6 workstreams that turn campeón from "works end-to-end" into "portfolio-grade": the `+case study` science page (the authenticity payload AND the artifact a hiring engineer judges), the `+options` page, the falcon hero motion (wing-flap + parallax sky), and a polish/QA sweep.

**Architecture:** Same dependency-free, hand-rolled idiom as Phases 1–5. Screens are factories `(host, ctx) => Screen` with `mount()`/`unmount()`. The case study is one long lowercase scroll-`<article>` assembled from a pure content-data array + pure DOM "chrome" builders + an IntersectionObserver reveal controller; its data-viz beat reuses the existing pure `plotGeometry` + `renderConvergencePlot`. Options adds pure conversion-school math (`convert/schools.ts`) behind a thin screen. Falcon motion is CSS keyframes + a tiny rAF parallax driver on the existing typographic hero (sky strictly behind, opaque glyphs in front). Everything respects `prefers-reduced-motion`.

**Tech Stack:** TypeScript (strict) · Vite · Three.js (already wired) · Vitest (jsdom per-file via `// @vitest-environment jsdom`) · no new runtime dependencies.

---

## The `/goal` this phase must serve (read before building)

campeón is the **centerpiece of a portfolio for a top-tier design-engineer role** — specifically Anthropic's *Design Engineer, Web* posting, which prizes work at *"the intersection of design and engineering,"* *"data visualization systems,"* and a person for whom *"refined typography, deliberate motion, and considered interaction are not afterthoughts."* The case study must read as **one unified, holistic, genuinely-novel system** — *one latent constant (your optimal cm/360) on one speed↔accuracy manifold, triangulated by four evolution-tuned probes, fused by affine z-scoring + Bayesian optimization into one number with a confidence interval whose width signals how much the four faculties agree.* Not arbitrary inspiration — design engineering.

**Locked creative decisions (from the user, this phase):**
1. **Angle = implicit.** The case study stays a genuine in-product science page. Design-engineering excellence is *demonstrated, not declared*. A closing **colophon** makes the architecture/tests/seams + the data-viz legible, and the credit ties to the portfolio theme — **no company is named anywhere.**
2. **Visual = full brutalist-editorial port**, recolored to campeón's **bone/slate/gold/ink** + a **per-section organism accent** (`--c-track`/`--c-flick`/`--c-calibrate`/`--c-strike`). Port the *techniques* from the sibling "after tokens" project: fully lowercase editorial voice, roman-numeral section indices, mono `+`-separated eyebrow labels, huge faint architectural numerals, registration crosshairs, a faint technical drafting grid, vertical section spines, dotted exoskeleton frames, and spec-rail `dt/dd` rows.
3. **Scope = core + falcon hero motion.** Case study + options + polish/QA **plus** the falcon wing-flap + parallax sky. The **PSX arena skin stays deferred** (separate later track).

**Voice reference (study before writing copy):** `/Users/chrisfiore/Documents/Claude/Projects/diffusion-render-text/` — especially `app/globals.css` (the chrome system: `.section-spine`, `.section-data`, `.spec-row`, `.exo-frame`, the `main { text-transform: lowercase }` rule, registration/numeral patterns) and `components/sections/section-13-close.tsx` (the "what this does not solve" + credit pattern, the lowercase editorial register). campeón is the **next entry in that same portfolio theme: "looking to nature for answers."** Do NOT copy its React/Tailwind code — port the *language and chrome* into campeón's vanilla DOM/CSS.

---

## Conventions (apply to EVERY task)

- **Commit trailer on every commit** (exact):
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- Work on branch **`build/phase-6-polish-case-study`** (already created), never `main`.
- Tests use **explicit imports** — `import { describe, it, expect } from 'vitest';` — never globals.
- **DOM/UI tests** start with the pragma `// @vitest-environment jsdom` on line 1 (vitest.config defaults to `node`).
- **Measurement honesty:** never fabricate noise or signal; missing data renders `—`; never silently mask a failure. The case-study copy must be scientifically accurate to spec §4 and cite spec §13.
- **Lowercase voice:** the case-study root forces `text-transform: lowercase`; data/demos/code opt back out with `[data-demo]`/`.mono` exceptions. Real numbers, units, and math notation keep their natural form inside `.mono`/`[data-demo]`.
- **Organism accents** (already in `tokens.css`): `--c-track:#4A5A66` (slate · dragonfly/falcon), `--c-flick:#FFC400` (gold · spider/raptor), `--c-calibrate:#7FA6B6` (water-blue · archerfish), `--c-strike:#E8702A` (ember · mantis-shrimp). Track/flick render filled; calibrate/strike outline (matches `renderConvergencePlot`).
- After each task: `npx tsc --noEmit` clean and `npm test` green before commit.

---

## File map (what this phase creates / touches)

**Case study (6A)**
- Create `src/ui/case-study/chrome.ts` — pure DOM builders (mono label, section numeral, registration frame, spec rail).
- Create `src/ui/case-study/content.ts` — the `SECTIONS` data (all copy), the convergence-demo dataset, the citation list. Pure data.
- Create `src/ui/case-study/reveal.ts` — IntersectionObserver reveal controller (instant under reduced motion).
- Create `src/ui/case-study/case-study.ts` — the screen factory; assembles sections + mounts the convergence demo + wires reveal + unmount cleanup.
- Create `src/styles/case-study.css` — the brutalist-editorial chrome, campeón palette + per-section organism accent.
- Modify `src/main.ts` — replace `caseStudyStub`; import `case-study.css`.
- Modify `src/ui/stubs.ts` — drop `caseStudyStub` (keep `optionsStub` until 6B).

**Options (6B)**
- Modify `src/convert/schools.ts` — add FOV-aware monitor-distance conversion + a `CONVERSION_SCHOOLS` descriptor; keep `perGameSens`.
- Create `src/ui/options/settings.ts` — pure helpers: `normalizeBounds`, `effectiveYaw`/`effectiveYawTable`, `DEFAULT_SETTINGS`.
- Create `src/ui/options/options.ts` — the screen: conversion-school selector + FOV calculator + per-game table + yaw-override editor + cm/360 search-bounds editor (writes `ctx.draft.bounds`).
- Create `src/styles/options.css`.
- Modify `src/main.ts` — replace `optionsStub`; import `options.css`.
- Modify `src/ui/stubs.ts` — drop `optionsStub`.

**Falcon motion (6C)**
- Modify `src/ui/hero.ts` — add sky layer + wing markup hooks + a tiny rAF parallax driver (reduced-motion-aware; cleaned up on unmount).
- Modify `src/styles/shell.css` — hero sky/parallax/wing-flap keyframes + reduced-motion fallbacks.

**Polish & QA (6D)**
- Modify `src/styles/shell.css`, `src/ui/setup.ts` (goal-slider `accent-color: var(--gold)`), `src/styles/case-study.css` etc. — micro-motion, focus, plot y-axis label.
- Add `public/favicon.svg` + reference in `index.html`.
- Final whole-app Chromium QA proof.

---

# Workstream 6A — the `+case study` science page

### Task A1: case-study chrome stylesheet foundation

**Files:**
- Create: `src/styles/case-study.css`
- Test: `tests/ui/case-study.css.test.ts`

- [ ] **Step 1: Write the failing test** (presence test — the contract for the chrome system; mirrors the sibling project's `tokens.test.ts` approach)

`tests/ui/case-study.css.test.ts`:
```ts
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
    expect(css).not.toMatch(/#1D3FD9/i); // the after-tokens accent must not leak in
  });
});
```

- [ ] **Step 2: Run test, verify it fails** — `npm test tests/ui/case-study.css.test.ts` → FAIL (file missing).

- [ ] **Step 3: Implement `src/styles/case-study.css`.** Port the sibling project's chrome (study `diffusion-render-text/app/globals.css` for fidelity), recolored to campeón tokens. Complete, load-bearing rules below; add tasteful detail to match the reference, but keep all color references to `tokens.css` vars.

```css
/* ── +case study — graphic-brutalist-meets-editorial-corporation ─────────────
   Ported from the sibling "after tokens" project's chrome, recolored to the
   campeón palette. Fully lowercase voice; per-section organism accent. */

.case {
  --cs-accent: var(--slate);           /* overridden per-section inline */
  text-transform: lowercase;
  background: var(--bone);
  color: var(--ink);
  /* faint technical drafting grid under everything */
  background-image:
    linear-gradient(to right, color-mix(in oklab, var(--ink) 4%, transparent) 1px, transparent 1px),
    linear-gradient(to bottom, color-mix(in oklab, var(--ink) 4%, transparent) 1px, transparent 1px);
  background-size: 46px 46px;
  background-position: -1px -1px;
  width: 100%;
  overflow-x: hidden;
}
/* data, demos, code keep their natural casing + form */
.case [data-demo],
.case .mono,
.case code { text-transform: none; }

/* a single content column the chrome registers against */
.cs-grid { width: min(64rem, 92vw); margin-inline: auto; }

/* section: tall, padded, relative for the absolute chrome */
.cs-section {
  position: relative;
  padding: clamp(4rem, 11vh, 9rem) clamp(1.25rem, 5vw, 4rem);
  border-top: 1px solid color-mix(in oklab, var(--ink) 10%, transparent);
}
.cs-section[data-accent] { /* topbar in the section accent */ }
.cs-section::before {       /* top rule in the section accent */
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
  background: var(--cs-accent); opacity: .9;
}

/* mono +-separated eyebrow label */
.cs-eyebrow {
  display: inline-flex; align-items: center; gap: .5rem; flex-wrap: wrap;
  font-family: var(--font-mono); font-size: 10.5px; letter-spacing: .16em;
  color: var(--slate-2); margin-bottom: .9rem;
}
.cs-eyebrow .sep { color: color-mix(in oklab, var(--cs-accent) 70%, var(--ink)); }

/* huge faint architectural numeral, bottom-right of the section */
.cs-numeral {
  position: absolute; right: clamp(.5rem, 3vw, 2.5rem); bottom: -1.5rem;
  font-family: var(--font-display); font-weight: 700; font-size: clamp(7rem, 22vw, 16rem);
  line-height: .78; letter-spacing: -.06em; color: var(--ink);
  opacity: .05; pointer-events: none; user-select: none; z-index: 0;
}

/* registration crosshairs at the section's content corners */
.cs-reg { position: absolute; width: 13px; height: 13px; opacity: .55; color: var(--slate-2); pointer-events: none; }
.cs-reg::before, .cs-reg::after { content: ''; position: absolute; background: currentColor; }
.cs-reg::before { left: 50%; top: 0; width: 1px; height: 100%; transform: translateX(-50%); }
.cs-reg::after { top: 50%; left: 0; height: 1px; width: 100%; transform: translateY(-50%); }
.cs-reg[data-corner="tl"] { top: 1.4rem; left: 1.4rem; }
.cs-reg[data-corner="tr"] { top: 1.4rem; right: 1.4rem; }
.cs-reg[data-corner="bl"] { bottom: 1.4rem; left: 1.4rem; }
.cs-reg[data-corner="br"] { bottom: 1.4rem; right: 1.4rem; }

/* vertical section spine (wide screens only) */
.cs-spine {
  position: absolute; left: .9rem; top: 0; bottom: 0; display: none;
  align-items: center; justify-content: center; pointer-events: none; z-index: 1;
}
.cs-spine > span {
  writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap;
  font-family: var(--font-mono); font-size: 10px; letter-spacing: .34em;
  color: color-mix(in oklab, var(--cs-accent) 80%, transparent);
}
@media (min-width: 1180px) { .cs-spine { display: flex; } }

/* dotted exoskeleton frame around the content column */
.cs-exo {
  position: absolute; left: 0; right: 0; top: 2rem; bottom: 2rem;
  max-width: 66rem; margin-inline: auto;
  border: 1px dotted color-mix(in oklab, var(--ink) 14%, transparent);
  pointer-events: none; z-index: 0;
}

/* headline + body */
.cs-h { font-family: var(--font-display); line-height: 1.02; letter-spacing: -.02em;
  font-size: clamp(2rem, 5.5vw, 3.4rem); color: var(--ink); margin-bottom: 1.1rem; position: relative; z-index: 2; }
.cs-h .idx { color: var(--slate-2); font-weight: 500; margin-right: .3em; }
.cs-lede { font-size: clamp(1.05rem, 1.7vw, 1.3rem); line-height: 1.6; color: var(--slate);
  max-width: 46ch; position: relative; z-index: 2; }
.cs-body { font-size: 1rem; line-height: 1.7; color: var(--ink-2, var(--slate)); max-width: 60ch;
  position: relative; z-index: 2; }
.cs-body > * + * { margin-top: .9rem; }
.cs-body strong { color: var(--ink); font-weight: 600; }
.cs-body em { font-style: italic; color: color-mix(in oklab, var(--cs-accent) 60%, var(--ink)); }
/* a marker wash for the thesis phrases (reads like a real selection on bone) */
.cs-mark { background: color-mix(in oklab, var(--cs-accent) 20%, transparent); padding: 0 .12em; }

/* spec-rail: mono dt + ink dd rows — the instrument-panel data layer */
.cs-spec { border-top: 1px solid color-mix(in oklab, var(--cs-accent) 40%, transparent);
  margin-top: 1.4rem; max-width: 40rem; position: relative; z-index: 2; }
.cs-spec > div { display: flex; align-items: baseline; justify-content: space-between; gap: 1.5rem;
  padding: .55rem 0; border-bottom: 1px solid color-mix(in oklab, var(--ink) 10%, transparent); }
.cs-spec dt { font-family: var(--font-mono); font-size: 10px; letter-spacing: .14em;
  color: color-mix(in oklab, var(--cs-accent) 90%, var(--ink)); white-space: nowrap; }
.cs-spec dd { font-size: .95rem; text-align: right; color: var(--ink); }
.cs-spec dd.mono { font-family: var(--font-mono); }

/* convergence-demo figure (Act iii) */
.cs-figure { position: relative; z-index: 2; margin-top: 1.6rem; background: var(--ink);
  border: 1px solid var(--slate-2); padding: 1rem; }
.cs-figure svg { display: block; width: 100%; height: auto; }
.cs-figure figcaption { font-family: var(--font-mono); font-size: .72rem; color: var(--slate-2);
  margin-top: .5rem; text-transform: none; }

/* citations + colophon + credit */
.cs-refs { list-style: none; font-size: .82rem; line-height: 1.6; color: var(--slate); max-width: 60ch; }
.cs-refs li { padding: .3rem 0; border-bottom: 1px solid color-mix(in oklab, var(--ink) 8%, transparent); text-transform: none; }
.cs-credit { font-family: var(--font-display); font-style: italic; color: var(--gold); font-size: 1.05rem; margin-top: .4rem; }
.cs-credit-theme { color: var(--slate-2); font-size: .9rem; margin-top: .2rem; }

/* back-to-hero action sticks top-left */
.cs-back { position: sticky; top: 0; z-index: 5; display: inline-block;
  padding: .8rem clamp(1.25rem, 5vw, 4rem); }

/* reveal: sections lift + fade in on scroll; instant under reduced motion */
[data-reveal] { opacity: 0; transform: translateY(14px); transition: opacity .6s var(--ease-out), transform .6s var(--ease-out); }
[data-reveal][data-in-view="true"] { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) {
  [data-reveal] { opacity: 1; transform: none; transition: none; }
  .case { background-attachment: initial; }
}
```

- [ ] **Step 4: Run test, verify it passes** — `npm test tests/ui/case-study.css.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(case-study): brutalist-editorial chrome stylesheet (campeón palette)`.

---

### Task A2: pure DOM chrome builders

**Files:**
- Create: `src/ui/case-study/chrome.ts`
- Test: `tests/ui/case-study/chrome.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/ui/case-study/chrome.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { monoLabel, sectionNumeral, registrationFrame, specRail } from '../../../src/ui/case-study/chrome';

describe('case-study chrome builders', () => {
  it('monoLabel joins parts with + separators', () => {
    const el = monoLabel(['ii', 'the instruments', 'cm/360']);
    expect(el.querySelectorAll('.sep').length).toBe(2);
    expect(el.textContent).toContain('the instruments');
  });
  it('sectionNumeral zero-pads to two digits and is aria-hidden', () => {
    const el = sectionNumeral(3);
    expect(el.textContent).toBe('03');
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });
  it('registrationFrame emits four corner crosshairs', () => {
    const frag = registrationFrame();
    expect(frag.querySelectorAll('.cs-reg').length).toBe(4);
    expect([...frag.querySelectorAll('.cs-reg')].map((e) => e.getAttribute('data-corner')).sort())
      .toEqual(['bl', 'br', 'tl', 'tr']);
  });
  it('specRail renders dt/dd rows; numeric values get .mono', () => {
    const el = specRail([
      { k: 'tsdn latency', v: '29.94 ± 5.75 ms', mono: true },
      { k: 'success rate', v: '~95%' },
    ]);
    expect(el.querySelectorAll('div').length).toBe(2);
    expect(el.querySelector('dd.mono')?.textContent).toBe('29.94 ± 5.75 ms');
  });
});
```

- [ ] **Step 2: Run test, verify it fails** — FAIL (module missing).

- [ ] **Step 3: Implement `src/ui/case-study/chrome.ts`**

```ts
/** Pure DOM builders for the case-study chrome. No side effects beyond creating detached nodes. */

export function monoLabel(parts: readonly string[]): HTMLElement {
  const span = document.createElement('span');
  span.className = 'cs-eyebrow mono';
  parts.forEach((part, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.setAttribute('aria-hidden', 'true');
      sep.textContent = '+';
      span.appendChild(sep);
    }
    const s = document.createElement('span');
    s.textContent = part;
    span.appendChild(s);
  });
  return span;
}

export function sectionNumeral(n: number): HTMLElement {
  const span = document.createElement('span');
  span.className = 'cs-numeral';
  span.setAttribute('aria-hidden', 'true');
  span.textContent = String(n).padStart(2, '0');
  return span;
}

export function registrationFrame(): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const corner of ['tl', 'tr', 'bl', 'br'] as const) {
    const mark = document.createElement('span');
    mark.className = 'cs-reg';
    mark.setAttribute('data-corner', corner);
    mark.setAttribute('aria-hidden', 'true');
    frag.appendChild(mark);
  }
  return frag;
}

export interface SpecRow { k: string; v: string; mono?: boolean; }
export function specRail(rows: readonly SpecRow[]): HTMLElement {
  const dl = document.createElement('dl');
  dl.className = 'cs-spec';
  for (const row of rows) {
    const wrap = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = row.k;
    const dd = document.createElement('dd');
    dd.textContent = row.v;
    if (row.mono) dd.classList.add('mono');
    wrap.append(dt, dd);
    dl.appendChild(wrap);
  }
  return dl;
}
```

- [ ] **Step 4: Run test, verify it passes** — PASS.
- [ ] **Step 5: Commit** — `feat(case-study): pure DOM chrome builders (mono label, numeral, registration, spec rail)`.

---

### Task A3: case-study content (the authenticity payload)

**Files:**
- Create: `src/ui/case-study/content.ts`
- Test: `tests/ui/case-study/content.test.ts`

This is the heart — scientifically accurate to spec §4, citing spec §13, in the lowercase editorial voice, expressing the unified-system `/goal`. `body` strings may contain inline `<strong>`, `<em>`, and `<span class="cs-mark">` markup (rendered as trusted HTML — this is static authored content, no user input). `accent` selects the per-section organism color.

- [ ] **Step 1: Write the failing test** (content invariants — load-bearing: pins the real numbers + structure so future edits can't silently gut the science)

`tests/ui/case-study/content.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { SECTIONS, CITATIONS, demoConvergence } from '../../../src/ui/case-study/content';

describe('case-study content', () => {
  it('has the five acts in order (premise, instruments, engine, honesty, colophon)', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(
      ['premise', 'track', 'flick', 'calibrate', 'strike', 'engine', 'honesty', 'colophon'],
    );
  });
  it('each instrument section carries its real organism numbers', () => {
    const byId = Object.fromEntries(SECTIONS.map((s) => [s.id, s]));
    const blob = (id: string) => JSON.stringify(byId[id]);
    expect(blob('track')).toContain('29.94');      // dragonfly TSDN latency
    expect(blob('flick')).toContain('4.133');      // Fitts We = 4.133σ
    expect(blob('calibrate')).toContain('MSE');    // bias/variance decomposition
    expect(blob('strike')).toContain('10,400');    // mantis-shrimp g-force
  });
  it('names no company (implicit angle) but keeps the portfolio-theme credit', () => {
    const all = JSON.stringify({ SECTIONS, CITATIONS }).toLowerCase();
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
```

- [ ] **Step 2: Run test, verify it fails** — FAIL (module missing).

- [ ] **Step 3: Implement `src/ui/case-study/content.ts`.** Use this exact content (the copy is the deliverable; keep it verbatim — it is the science + the voice + the `/goal`).

```ts
import type { InstrumentId } from '../../types';
import type { PlotInput } from '../convergence-plot';

export interface CaseSection {
  id: 'premise' | 'track' | 'flick' | 'calibrate' | 'strike' | 'engine' | 'honesty' | 'colophon';
  idx: string;              // roman numeral, lowercase
  eyebrow: string[];        // mono +-separated parts
  spine?: string;           // vertical spine label
  accent: 'track' | 'flick' | 'calibrate' | 'strike' | 'slate' | 'gold';
  title: string;
  lede?: string;
  body: string[];           // paragraphs; may contain <strong>/<em>/<span class="cs-mark">
  spec?: { k: string; v: string; mono?: boolean }[];
}

const ACCENT_VAR: Record<CaseSection['accent'], string> = {
  track: 'var(--c-track)', flick: 'var(--c-flick)', calibrate: 'var(--c-calibrate)',
  strike: 'var(--c-strike)', slate: 'var(--slate)', gold: 'var(--gold)',
};
export const accentVar = (a: CaseSection['accent']): string => ACCENT_VAR[a];

export const SECTIONS: CaseSection[] = [
  {
    id: 'premise', idx: 'i', accent: 'slate',
    eyebrow: ['the science', 'a case study', 'cm/360'],
    spine: 'one latent constant',
    title: 'every trainer hands you a score. none hands you your number.',
    lede: 'aim trainers measure how well you did today. campeón measures the one setting your hands were built for — and tells you how sure it is.',
    body: [
      'there is exactly one number that decides how far your hand travels to turn all the way around: <strong>cm/360</strong> — centimeters of mouse movement per 360°. it is hardware-independent, game-independent, the true unit of aim. everything downstream (your in-game sliders) is just this number wearing different clothes.',
      'the problem: nobody can tell you <em>yours</em>. so campeón treats it as a hidden quantity to be <span class="cs-mark">measured</span>, not guessed — and borrows its instruments from the only engineers who have already solved targeting: <strong>evolution</strong>.',
      'six predators, four faculties, <span class="cs-mark">one number</span> with a confidence interval. this page is the real mechanism behind each one — and how four heterogeneous probes collapse into a single answer.',
    ],
    spec: [
      { k: 'the variable', v: 'cm/360 — physical cm per 360° turn', },
      { k: 'method', v: 'bayesian search over a speed↔accuracy manifold' },
      { k: 'output', v: 'one cm/360 + a 90% confidence interval', mono: true },
    ],
  },
  {
    id: 'track', idx: 'ii', accent: 'track',
    eyebrow: ['instrument 01', 'track', 'dragonfly + falcon'],
    spine: 'predictive tracking',
    title: 'the lead. holding a moving target still.',
    lede: 'a dragonfly intercepts prey ~95% of the time using a feed-forward internal model — it aims where prey will be, not where it is.',
    body: [
      'dragonfly target-selective descending neurons decode prey direction as a population vector at a sensorimotor latency of <strong>29.94 ± 5.75 ms</strong>; an efference-copy forward model predicts self-induced image motion so the strike <em>leads</em>. the peregrine falcon does the mirror task — <strong>vor + okr</strong> gaze-stabilization holds the target image still on the fovea, nulling its angular velocity, terminal guidance fitting proportional navigation.',
      'campeón rebuilds this with a <strong>constant-velocity kalman filter</strong> on the target state. the optimal lead point is θ̂ + θ̇̂·L, where L is your measured reaction latency. the filter\'s <em>innovation</em> — ν = z − Hx̂⁻ — <span class="cs-mark">is</span> the instantaneous tracking error.',
      'the cm/360 signal: too sensitive and tremor multiplies into jitter and overshoot oscillation; too slow and you can\'t reach the lead point on a velocity step, so the crosshair lags. the optimum jointly minimizes slip + jitter.',
    ],
    spec: [
      { k: 'tsdn latency', v: '29.94 ± 5.75 ms', mono: true },
      { k: 'dragonfly intercept', v: '~95% success' },
      { k: 'scorer', v: 'kalman innovation ν = z − Hx̂⁻', mono: true },
      { k: 'metrics', v: 'lead rmse · predictive index · jitter · time-on-target' },
    ],
  },
  {
    id: 'flick', idx: 'iii', accent: 'flick',
    eyebrow: ['instrument 02', 'flick', 'spider + raptor'],
    spine: 'staged acquisition',
    title: 'the snap. a flick is a three-stage pipeline.',
    lede: 'a jumping spider detects with wide-field secondary eyes, fires a ballistic body saccade open-loop, then confirms with high-acuity principal eyes. that is exactly a human flick.',
    body: [
      'the spider\'s orient is pre-programmed — <strong>810–1300 °/s</strong>, amplitude preset from retinal eccentricity, no mid-flight correction — and the coarse error is cleaned up by the confirm stage. the raptor adds a two-fovea trade: a deep fovea (~140 cyc/deg, the scope) and a shallow fovea (wide, fast). speed vs precision, two modes.',
      'campeón decomposes your mouse-velocity trace into the same stages — detection latency, ballistic orient (gain G = covered/required, overshoot), corrective sub-movements — then scores <strong>fitts effective throughput</strong> (iso 9241-9): effective width <span class="cs-mark">We = 4.133·σ</span>, IDe = log2(Ae/We + 1), TP = IDe / MT.',
      'the central tension: flick throughput peaks at <em>lower</em> cm/360 (big reorientations cheap); micro-adjust throughput peaks at <em>higher</em> cm/360 (fine placement, attenuated tremor). your optimum is the crossover, weighted by how you play.',
    ],
    spec: [
      { k: 'spider orient', v: '810–1300 °/s, open-loop', mono: true },
      { k: 'raptor deep fovea', v: '~140 cyc/deg' },
      { k: 'scorer', v: 'fitts effective throughput (bits/s)' },
      { k: 'effective width', v: 'We = 4.133·σ', mono: true },
    ],
  },
  {
    id: 'calibrate', idx: 'iv', accent: 'calibrate',
    eyebrow: ['instrument 03', 'calibrate', 'archerfish'],
    spine: 'bias vs variance',
    title: 'the correction. separating aim from noise.',
    lede: 'an archerfish shoots prey through the air–water boundary and must cancel a systematic refraction offset of up to 10–15°. it learns the correction trial by trial.',
    body: [
      'the tell that it is a real internal model: a <strong>negative aftereffect</strong> when the offset is removed — the signature of a recalibrated forward model. the abstraction campeón borrows is the cleanest in aim: <span class="cs-mark">error = systematic bias + random variance</span>. bias is learnable and removable; variance is your precision floor.',
      'we estimate gain bias g = E[r_impact]/E[r_required] (g > 1 = oversensitive, g < 1 = undersensitive) and decompose <strong>MSE = |bias|² + σ_R²</strong>. cm/360 drives bias steeply and monotonically, so the <em>bias-zero sensitivity</em> — where g crosses 1 — is the headline estimator. variance is the hardware/skill floor, not the recommendation.',
    ],
    spec: [
      { k: 'refraction offset', v: 'up to 10–15°', mono: true },
      { k: 'decomposition', v: 'MSE = |bias|² + σ_R²', mono: true },
      { k: 'headline', v: 'bias-zero cm/360 (gain g = 1)' },
    ],
  },
  {
    id: 'strike', idx: 'v', accent: 'strike',
    eyebrow: ['instrument 04', 'strike', 'mantis shrimp'],
    spine: 'the speed pole',
    title: 'the limit. pure, uncorrectable speed.',
    lede: 'the mantis shrimp strike is a latch-mediated spring: ~10,400 g, full discharge in ~1.1 ms, no mid-flight correction. it is the canonical speed pole of the speed–accuracy trade-off.',
    body: [
      'the charge phase is ~300× longer than the strike itself — commit, then there is no taking it back. campeón\'s strike drill is the same: fire as fast as possible, misses allowed, no settling. we record reaction t_R, ballistic strike t_S, peak velocity, endpoint scatter σ_θ, and hit rate H.',
      'the pair <strong>(TTK = t_R + t_S, H)</strong> is your speed–accuracy operating point at each cm/360. this is what lets the optimizer respect <em>your</em> preference — the goal slider in setup — instead of assuming everyone wants the same trade. too sensitive: fast but σ_θ explodes and H collapses. too slow: tight but late.',
    ],
    spec: [
      { k: 'peak acceleration', v: '~10,400 g', mono: true },
      { k: 'strike duration', v: '~1.1 ms', mono: true },
      { k: 'operating point', v: '(TTK = t_R + t_S, hit rate)', mono: true },
    ],
  },
  {
    id: 'engine', idx: 'vi', accent: 'gold',
    eyebrow: ['the engine', 'one system', 'speed↔accuracy'],
    spine: 'triangulation',
    title: 'four probes, one number.',
    lede: 'the four instruments measure different physical quantities — bits per second, a (0,1] rate, strikes per second, degrees. the trick is fusing them without lying.',
    body: [
      'each instrument is swept across cm/360 and <strong>z-scored across its own sweep</strong>. z-scoring is an affine map, and a quadratic\'s peak is invariant under affine transforms — so normalizing makes heterogeneous metrics commensurable <span class="cs-mark">without moving any instrument\'s own optimum</span>. that is the whole reason the fusion is honest rather than arbitrary.',
      'the blended objective (weighted by your speed↔accuracy preference) feeds a <strong>gaussian-process bayesian optimizer</strong> — a matérn-5/2 surrogate, expected-improvement acquisition on a dense ln(cm/360) grid — which proposes the next trial where it expects to learn most. a psychometric curve is fit; a <strong>bootstrap</strong> draws the 90% confidence interval.',
      'the payoff is conceptual: there is <em>one</em> latent constant on <em>one</em> manifold, and the four faculties are four views of it. when they agree, the interval is tight. when they disagree, the interval widens — <span class="cs-mark">the ci width is the system telling you how much your four faculties concur.</span>',
    ],
    spec: [
      { k: 'normalize', v: 'per-instrument z-score (affine, peak-preserving)' },
      { k: 'surrogate', v: 'gaussian process · matérn-5/2' },
      { k: 'acquisition', v: 'expected improvement on ln(cm/360)', mono: true },
      { k: 'uncertainty', v: 'bootstrap 90% ci — width = facet agreement' },
    ],
  },
  {
    id: 'honesty', idx: 'vii', accent: 'slate',
    eyebrow: ['the honest part', 'what this does not solve'],
    spine: 'measurement honesty',
    title: 'what this does not solve.',
    body: [
      '<strong>the interval can be wide.</strong> a short session, or genuinely conflicting faculties, produces an honestly-wide ci rather than a falsely-precise point. that is a feature: the number comes with its own doubt.',
      '<strong>variance is a floor, not a knob.</strong> precision (σ_R) is set by your hardware and your hands. campeón reports it; it does not pretend a sensitivity can fix it.',
      '<strong>no fabricated noise.</strong> the scorers record what actually happened. a degenerate trial drops out of the blend rather than being padded with synthetic spread — padding would inflate the metric and lie. realistic spread belongs in the test fixtures, never in production.',
      '<strong>raw input is gated.</strong> measurement only proceeds after pointer-lock raw capture and an acceleration check pass; os mouse acceleration would corrupt every reading, so it is detected and blocked up front.',
    ],
  },
  {
    id: 'colophon', idx: 'viii', accent: 'gold',
    eyebrow: ['colophon', 'how it is built'],
    spine: 'design engineering',
    title: 'how it is built.',
    lede: 'a pure, unit-tested measurement core wrapped by an engine and a hand-rolled ui — so validity can be proven, not hoped.',
    body: [
      'the core (<strong>convert · scoring · optimizer · stats</strong>) is plain typescript, tested against published formulas: iso 9241-9 throughput, a constant-velocity kalman filter, a hand-rolled cholesky solve for the gaussian process. no framework, no backend, ~210 passing tests.',
      'the seams are deliberate. every instrument is a pure <code>analyze()</code> plus a thin <code>run()</code> shell, so the math is tested against synthetic players and only the raw pointer/raf glue is runtime-only. the data-viz above is the same idea: a pure <code>plotGeometry()</code> (domain→pixel, fully unit-tested) and a thin renderer that only writes svg attributes.',
      'it runs at 60fps in a real webgl arena, respects <code>prefers-reduced-motion</code> everywhere, and reads cleanly enough to review. the whole thing is a single argument: that careful measurement and considered craft are the same discipline.',
    ],
    spec: [
      { k: 'stack', v: 'typescript · vite · three.js · client-only' },
      { k: 'tests', v: '~210, pure core tdd', mono: true },
      { k: 'seams', v: 'pure analyze + thin shell · geometry + renderer' },
    ],
  },
];

export const CITATIONS: string[] = [
  'Mischiati et al. Internal models direct dragonfly interception steering. Nature 517 (2015).',
  'Gonzalez-Bellido et al. Eight pairs of descending visual neurons … population vector of prey direction. PNAS 110(2) (2013).',
  'Brighton, Thomas & Taylor. Terminal attack trajectories of peregrine falcons … proportional navigation. PNAS 114(51) (2017).',
  'Tucker. The deep fovea, sideways vision and spiral flight paths in raptors. J. Exp. Biol. 203 (2000).',
  'Land. Movements of the retinae of jumping spiders. J. Exp. Biol. 51 (1969); Zurek & Nelson, J. Comp. Physiol. A 198 (2012).',
  'Patek et al. Deadly strike mechanism of a mantis shrimp. Nature 428 (2004); deVries & Patek, ICB 59(6) (2019).',
  'Reinel & Schuster. The archerfish predictive C-start. J. Comp. Physiol. A (2023); Volotsky et al., eLife 13 (2024).',
  'MacKenzie. Fitts’ law (ISO 9241-9 effective throughput), HHCI (2018).',
  'Auer, Cesa-Bianchi & Fischer. Finite-time Analysis of the Multiarmed Bandit Problem (2002).',
];

export const CREDIT = {
  by: 'designed and built by christopher robin fiore',
  theme: 'portfolio theme: looking to nature for answers',
};

/** Illustrative (not live) convergence dataset for Act iii: four organism mark-sets
 *  scattered across the sweep, converging on a concave fit peaked near 29 cm/360. */
export function demoConvergence(): PlotInput {
  const bounds: [number, number] = [15, 60];
  const peak = 29;
  const at = (cm: number) => -Math.pow(Math.log(cm) - Math.log(peak), 2); // concave in ln-space
  const insts: InstrumentId[] = ['track', 'flick', 'calibrate', 'strike'];
  const xs = [18, 23, 29, 37, 47];
  const jitter: Record<InstrumentId, number> = { track: 0.04, flick: -0.05, calibrate: 0.02, strike: -0.03 };
  const marks = insts.flatMap((instrument) =>
    xs.map((cm360) => ({ cm360, instrument, score: at(cm360) + jitter[instrument] })),
  );
  const curve = [16, 20, 25, 29, 34, 42, 55].map((cm) => ({ x: Math.log(cm), mean: at(cm) }));
  return { bounds, marks, curve, ci90: [27.4, 31.1], peak, size: { width: 640, height: 280 } };
}
```

- [ ] **Step 4: Run test, verify it passes** — PASS.
- [ ] **Step 5: Commit** — `feat(case-study): content — five acts, real organism numbers, citations, convergence demo`.

---

### Task A4: IntersectionObserver reveal controller

**Files:**
- Create: `src/ui/case-study/reveal.ts`
- Test: `tests/ui/case-study/reveal.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/ui/case-study/reveal.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReveal } from '../../../src/ui/case-study/reveal';

beforeEach(() => {
  // minimal IntersectionObserver stub that lets us fire entries on demand
  (globalThis as unknown as { __ioEntries: ((e: { target: Element; isIntersecting: boolean }[]) => void)[] }).__ioEntries = [];
  class IO {
    cb: (e: { target: Element; isIntersecting: boolean }[]) => void;
    constructor(cb: never) { this.cb = cb as never; (globalThis as never as { __ioEntries: unknown[] }).__ioEntries.push(this.cb); }
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } root = null; rootMargin = ''; thresholds = [];
  }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
});

describe('createReveal', () => {
  it('marks targets in-view when they intersect, and disconnects on stop', () => {
    const a = document.createElement('div'); a.setAttribute('data-reveal', '');
    const r = createReveal({ reduced: false });
    r.observe(a);
    const fire = (globalThis as never as { __ioEntries: ((e: { target: Element; isIntersecting: boolean }[]) => void)[] }).__ioEntries[0]!;
    fire([{ target: a, isIntersecting: true }]);
    expect(a.getAttribute('data-in-view')).toBe('true');
    expect(() => r.stop()).not.toThrow();
  });
  it('reduced motion reveals immediately without an observer', () => {
    const a = document.createElement('div'); a.setAttribute('data-reveal', '');
    const r = createReveal({ reduced: true });
    r.observe(a);
    expect(a.getAttribute('data-in-view')).toBe('true');
  });
});
```

- [ ] **Step 2: Run test, verify it fails** — FAIL.

- [ ] **Step 3: Implement `src/ui/case-study/reveal.ts`**

```ts
export interface Reveal {
  observe(el: Element): void;
  stop(): void;
}

/** Reveals [data-reveal] elements as they scroll into view. Under reduced motion (or when
 *  IntersectionObserver is unavailable), reveals immediately. */
export function createReveal(opts: { reduced: boolean }): Reveal {
  if (opts.reduced || typeof IntersectionObserver === 'undefined') {
    return {
      observe(el) { el.setAttribute('data-in-view', 'true'); },
      stop() {},
    };
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.setAttribute('data-in-view', 'true');
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.12 },
  );
  return {
    observe(el) { io.observe(el); },
    stop() { io.disconnect(); },
  };
}
```

- [ ] **Step 4: Run test, verify it passes** — PASS.
- [ ] **Step 5: Commit** — `feat(case-study): IntersectionObserver reveal controller (reduced-motion safe)`.

---

### Task A5: the case-study screen (assembly + data-viz mount + lifecycle)

**Files:**
- Create: `src/ui/case-study/case-study.ts`
- Test: `tests/ui/case-study/case-study.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/ui/case-study/case-study.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { caseStudy } from '../../../src/ui/case-study/case-study';
import type { AppContext } from '../../../src/ui/shell';

beforeEach(() => {
  class IO { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } root = null; rootMargin = ''; thresholds = []; }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
});

function ctx(navigate = vi.fn()): AppContext {
  return { navigate, route: 'case-study', storage: {} as never, draft: {} as never };
}

describe('caseStudy screen', () => {
  it('mounts the lowercase article with all eight sections and the citations', () => {
    const host = document.createElement('div');
    const screen = caseStudy(host, ctx());
    screen.mount();
    expect(host.querySelector('.case')).not.toBeNull();
    expect(host.querySelectorAll('.cs-section').length).toBe(8);
    expect(host.querySelectorAll('.cs-refs li').length).toBeGreaterThanOrEqual(8);
    screen.unmount();
  });
  it('renders the convergence demo: four organism mark-sets + curve + peak', () => {
    const host = document.createElement('div');
    const screen = caseStudy(host, ctx());
    screen.mount();
    const marks = host.querySelectorAll('.cs-figure [data-mark]');
    expect(marks.length).toBeGreaterThan(0);
    expect(new Set([...marks].map((m) => m.getAttribute('data-mark'))))
      .toEqual(new Set(['track', 'flick', 'calibrate', 'strike']));
    expect(host.querySelector('.cs-figure [data-curve]')).not.toBeNull();
    expect(host.querySelector('.cs-figure [data-peak]')).not.toBeNull();
    screen.unmount();
  });
  it('back action navigates to the hero', () => {
    const host = document.createElement('div');
    const navigate = vi.fn();
    const screen = caseStudy(host, ctx(navigate));
    screen.mount();
    host.querySelector<HTMLButtonElement>('[data-action="back"]')!.click();
    expect(navigate).toHaveBeenCalledWith('hero');
    screen.unmount();
  });
  it('unmount clears the host', () => {
    const host = document.createElement('div');
    const screen = caseStudy(host, ctx());
    screen.mount();
    screen.unmount();
    expect(host.children.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, verify it fails** — FAIL.

- [ ] **Step 3: Implement `src/ui/case-study/case-study.ts`**

```ts
import type { AppContext, Screen } from '../shell';
import { plotGeometry, renderConvergencePlot } from '../convergence-plot';
import { SECTIONS, CITATIONS, CREDIT, accentVar, demoConvergence, type CaseSection } from './content';
import { monoLabel, sectionNumeral, registrationFrame, specRail } from './chrome';
import { createReveal } from './reveal';

const NS = 'http://www.w3.org/2000/svg';
const prefersReduced = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function buildSection(s: CaseSection): HTMLElement {
  const sec = document.createElement('section');
  sec.className = 'cs-section';
  sec.id = `cs-${s.id}`;
  sec.setAttribute('data-reveal', '');
  sec.setAttribute('aria-label', s.title);
  sec.style.setProperty('--cs-accent', accentVar(s.accent));

  sec.appendChild(registrationFrame());
  sec.appendChild(sectionNumeral(SECTIONS.indexOf(s) + 1));
  if (s.spine) {
    const spine = document.createElement('div');
    spine.className = 'cs-spine';
    spine.setAttribute('aria-hidden', 'true');
    const sp = document.createElement('span');
    sp.textContent = s.spine;
    spine.appendChild(sp);
    sec.appendChild(spine);
  }

  const grid = document.createElement('div');
  grid.className = 'cs-grid';
  grid.appendChild(monoLabel(s.eyebrow));

  const h = document.createElement('h2');
  h.className = 'cs-h';
  h.innerHTML = `<span class="idx" aria-hidden="true">${s.idx}.</span>${s.title}`;
  grid.appendChild(h);

  if (s.lede) {
    const lede = document.createElement('p');
    lede.className = 'cs-lede';
    lede.textContent = s.lede;
    grid.appendChild(lede);
  }

  const body = document.createElement('div');
  body.className = 'cs-body';
  body.innerHTML = s.body.map((p) => `<p>${p}</p>`).join('');
  grid.appendChild(body);

  if (s.spec) grid.appendChild(specRail(s.spec));

  // Act iii (engine) carries the data-viz figure.
  if (s.id === 'engine') grid.appendChild(buildFigure());

  // Colophon carries the citations + credit.
  if (s.id === 'colophon') grid.appendChild(buildRefsAndCredit());

  sec.appendChild(grid);
  return sec;
}

function buildFigure(): HTMLElement {
  const fig = document.createElement('figure');
  fig.className = 'cs-figure';
  fig.setAttribute('data-demo', '');
  const input = demoConvergence();
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('data-plot', '');
  renderConvergencePlot(svg, plotGeometry(input));
  fig.appendChild(svg);
  const cap = document.createElement('figcaption');
  cap.textContent =
    'four instruments, each z-scored across the sweep, converging on one peak. the gold band is the 90% ci — its width is how much the faculties agree.';
  fig.appendChild(cap);
  return fig;
}

function buildRefsAndCredit(): DocumentFragment {
  const frag = document.createDocumentFragment();
  const ul = document.createElement('ul');
  ul.className = 'cs-refs';
  ul.setAttribute('data-demo', '');
  for (const c of CITATIONS) {
    const li = document.createElement('li');
    li.textContent = c;
    ul.appendChild(li);
  }
  frag.appendChild(ul);
  const by = document.createElement('p');
  by.className = 'cs-credit';
  by.textContent = CREDIT.by;
  const theme = document.createElement('p');
  theme.className = 'cs-credit-theme';
  theme.textContent = CREDIT.theme;
  frag.append(by, theme);
  return frag;
}

export function caseStudy(host: HTMLElement, ctx: AppContext): Screen {
  const reveal = createReveal({ reduced: prefersReduced() });
  return {
    mount() {
      const article = document.createElement('article');
      article.className = 'case fade-in';

      const back = document.createElement('button');
      back.className = 'action action--ghost cs-back';
      back.setAttribute('data-action', 'back');
      back.textContent = 'back';
      back.addEventListener('click', () => ctx.navigate('hero'));
      article.appendChild(back);

      for (const s of SECTIONS) {
        const sec = buildSection(s);
        article.appendChild(sec);
        reveal.observe(sec);
      }
      host.appendChild(article);
    },
    unmount() {
      reveal.stop();
      host.replaceChildren();
    },
  };
}
```

- [ ] **Step 4: Run test, verify it passes** — PASS.
- [ ] **Step 5: Commit** — `feat(case-study): assemble the lowercase science article + convergence data-viz`.

---

### Task A6: wire the real case-study screen into the app

**Files:**
- Modify: `src/main.ts`
- Modify: `src/ui/stubs.ts`
- Test: `tests/ui/case-study/wiring.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/ui/case-study/wiring.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('case-study wiring', () => {
  it('main.ts imports the real caseStudy screen and the stylesheet, not the stub', () => {
    const main = readFileSync('src/main.ts', 'utf-8');
    expect(main).toMatch(/import\s*\{\s*caseStudy\s*\}\s*from\s*'\.\/ui\/case-study\/case-study'/);
    expect(main).toMatch(/styles\/case-study\.css/);
    expect(main).not.toMatch(/caseStudyStub/);
  });
});
```

- [ ] **Step 2: Run test, verify it fails** — FAIL.

- [ ] **Step 3: Edit `src/main.ts`** — add `import './styles/case-study.css';` after the other style imports; replace the case-study import + registration:
  - Remove `caseStudyStub` from the `./ui/stubs` import (leave `optionsStub`).
  - Add `import { caseStudy } from './ui/case-study/case-study';`.
  - In the `screens` map: `'case-study': caseStudy,` (was `caseStudyStub`).

- [ ] **Step 4: Edit `src/ui/stubs.ts`** — delete the `caseStudyStub` export (keep `optionsStub` and the `stub` helper).

- [ ] **Step 5: Run tests + typecheck** — `npm test tests/ui/case-study/wiring.test.ts` PASS; `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit** — `feat(case-study): wire the real screen into the shell`.

---

### Task A7: case-study craft review + Chromium runtime proof

**Files:** none (verification task; fix-ups committed if needed).

- [ ] **Step 1: Full suite green** — `npm test` and `npx tsc --noEmit`.
- [ ] **Step 2: Build clean** — `npm run build`.
- [ ] **Step 3: Runtime proof.** `npm run dev`; open `http://localhost:5173/#/case-study`. Verify (use Chrome MCP / Claude Preview): all eight sections render lowercase; registration crosshairs, faint grid, architectural numerals, spines, spec-rails, and dotted exoframe all read in the campeón palette with per-section organism accents; the Act-iii convergence figure shows four organism-colored mark-sets + curve + gold ci band + peak; sections reveal on scroll; the credit reads "looking to nature for answers"; console clean (favicon 404 acceptable until 6D). Then toggle `prefers-reduced-motion` and confirm sections appear instantly (no hidden content).
- [ ] **Step 4: Slow-motion craft pass.** Read the rendered page as a hiring engineer would: typographic hierarchy, rhythm, the marker-wash thesis phrases, no orphaned chrome. Fix anything that doesn't hold up; commit as `refine(case-study): craft pass`.

---

# Workstream 6B — the `+options` page

### Task B1: FOV-aware monitor-distance conversion (the advanced school)

**Files:**
- Modify: `src/convert/schools.ts`
- Test: `tests/convert/schools.test.ts` (extend)

The spec (§7): default school = **360-distance** (FOV-agnostic, what we measure). Advanced = **monitor-distance** (FOV-aware). At monitor distance, matching the on-screen cursor travel for a fraction `m` of the half-screen means matching the angle θ(m) = atan(m·tan(hFov/2)); across two FOVs the matched cm/360 ratio is the ratio of those angles. This is first-principles geometry, analytically testable.

- [ ] **Step 1: Write the failing test**

Append to `tests/convert/schools.test.ts`:
```ts
import { monitorDistanceMatchCm360, CONVERSION_SCHOOLS } from '../../src/convert/schools';

describe('monitor-distance conversion (FOV-aware)', () => {
  it('is identity when source and target FOV match (any fraction)', () => {
    expect(monitorDistanceMatchCm360(30, 103, 103, 0.5)).toBeCloseTo(30, 6);
  });
  it('at fraction → 0 reduces to the focal-length (tangent) ratio', () => {
    // tan(53.13°)/tan(45°) = 1.3333… (a clean 4:3 case). target wider ⇒ needs MORE cm/360 to match center feel.
    const out = monitorDistanceMatchCm360(30, 90, 106.26, 0.0001);
    expect(out / 30).toBeCloseTo(Math.tan((106.26 / 2) * Math.PI / 180) / Math.tan((90 / 2) * Math.PI / 180), 2);
  });
  it('exposes both schools with 360-distance as the default', () => {
    expect(CONVERSION_SCHOOLS.map((s) => s.id)).toEqual(['360', 'monitor']);
    expect(CONVERSION_SCHOOLS[0]!.fovAware).toBe(false);
    expect(CONVERSION_SCHOOLS[1]!.fovAware).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify it fails** — FAIL.

- [ ] **Step 3: Extend `src/convert/schools.ts`** (keep `perGameSens`):
```ts
export interface ConversionSchool { id: '360' | 'monitor'; label: string; fovAware: boolean; note: string; }

export const CONVERSION_SCHOOLS: ConversionSchool[] = [
  { id: '360', label: '360 distance', fovAware: false,
    note: 'cm per 360° — FOV-agnostic; exactly what campeón measures.' },
  { id: 'monitor', label: 'monitor distance', fovAware: true,
    note: 'matches on-screen cursor travel for a fraction of the screen; depends on source + target FOV.' },
];

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** cm/360 that preserves "monitor-distance feel" when moving from sourceFov to targetFov,
 *  matching the angle subtended by a fraction `m` (0..1) of the horizontal half-screen.
 *  θ(m, fov) = atan(m·tan(fov/2)); matched cm/360 scales with the ratio of those angles. */
export function monitorDistanceMatchCm360(
  sourceCm360: Cm360, sourceFovDeg: number, targetFovDeg: number, fraction: number,
): Cm360 {
  const m = Math.max(0, Math.min(1, fraction));
  const thetaSrc = Math.atan(m * Math.tan(rad(sourceFovDeg) / 2));
  const thetaTgt = Math.atan(m * Math.tan(rad(targetFovDeg) / 2));
  if (thetaSrc === 0) {
    // fraction → 0 limit: ratio of tangents (focal-length / center-feel match)
    return sourceCm360 * (Math.tan(rad(targetFovDeg) / 2) / Math.tan(rad(sourceFovDeg) / 2));
  }
  return sourceCm360 * (thetaTgt / thetaSrc);
}
```

- [ ] **Step 4: Run test, verify it passes** — PASS.
- [ ] **Step 5: Commit** — `feat(convert): FOV-aware monitor-distance conversion school`.

---

### Task B2: options pure helpers (bounds + yaw overrides + settings)

**Files:**
- Create: `src/ui/options/settings.ts`
- Test: `tests/ui/options/settings.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/ui/options/settings.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { normalizeBounds, effectiveYaw, effectiveYawTable, DEFAULT_BOUNDS } from '../../../src/ui/options/settings';

describe('options settings helpers', () => {
  it('normalizeBounds orders, clamps to [5,150], and enforces a minimum span', () => {
    expect(normalizeBounds(60, 15)).toEqual([15, 60]);          // reorders
    expect(normalizeBounds(1, 9)).toEqual([5, 9]);              // clamps low
    expect(normalizeBounds(30, 30)).toEqual([30, 35]);          // min span of 5
    expect(normalizeBounds(NaN, 40)).toEqual(DEFAULT_BOUNDS);   // NaN → safe default
  });
  it('effectiveYaw uses an override when present, else the table value', () => {
    expect(effectiveYaw('cs2', {})).toBeCloseTo(0.022, 6);
    expect(effectiveYaw('cs2', { cs2: 0.03 })).toBeCloseTo(0.03, 6);
  });
  it('effectiveYawTable merges overrides over the base table', () => {
    const t = effectiveYawTable({ valorant: 0.08 });
    expect(t.find((e) => e.id === 'valorant')!.yaw).toBeCloseTo(0.08, 6);
    expect(t.find((e) => e.id === 'cs2')!.yaw).toBeCloseTo(0.022, 6);
  });
});
```

- [ ] **Step 2: Run test, verify it fails** — FAIL.

- [ ] **Step 3: Implement `src/ui/options/settings.ts`**
```ts
import type { Cm360, GameId, YawEntry } from '../../types';
import { GAME_YAW } from '../../convert/yaw-table';

export const DEFAULT_BOUNDS: [Cm360, Cm360] = [15, 60];
const LO = 5, HI = 150, MIN_SPAN = 5;

export function normalizeBounds(a: number, b: number): [Cm360, Cm360] {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [...DEFAULT_BOUNDS];
  let lo = Math.min(a, b), hi = Math.max(a, b);
  lo = Math.max(LO, Math.min(HI - MIN_SPAN, lo));
  hi = Math.min(HI, Math.max(lo + MIN_SPAN, hi));
  return [lo, hi];
}

export type YawOverrides = Partial<Record<GameId, number>>;

export function effectiveYaw(id: GameId, overrides: YawOverrides): number {
  const o = overrides[id];
  if (o !== undefined && Number.isFinite(o) && o > 0) return o;
  const base = GAME_YAW.find((e) => e.id === id);
  if (!base) throw new Error(`Unknown game: ${id}`);
  return base.yaw;
}

export function effectiveYawTable(overrides: YawOverrides): YawEntry[] {
  return GAME_YAW.map((e) => ({ ...e, yaw: effectiveYaw(e.id, overrides) }));
}
```

- [ ] **Step 4: Run test, verify it passes** — PASS.
- [ ] **Step 5: Commit** — `feat(options): pure helpers — bounds normalization + yaw overrides`.

---

### Task B3: the options screen

**Files:**
- Create: `src/ui/options/options.ts`
- Create: `src/styles/options.css`
- Test: `tests/ui/options/options.test.ts`

The screen has three panels, all lowercase, using the existing `.field`/`.action`/`.mono` idiom (no new chrome system — options is utility, not editorial):
1. **conversion school** — `<select>` of `CONVERSION_SCHOOLS`; when `monitor`, reveal source/target FOV number inputs + a live converted-cm/360 readout (using `monitorDistanceMatchCm360` against `ctx.draft` cm/360 derived from the current bounds midpoint or a sensible default).
2. **per-game sensitivity table** — built from `effectiveYawTable(overrides)` + `perGameSens`; each row's yaw is an editable input (writes `overrides`), table re-derives live.
3. **cm/360 search bounds** — two number inputs (lo/hi) → `normalizeBounds` → writes `ctx.draft.bounds` (feeds the session). Live readout.

- [ ] **Step 1: Write the failing test**

`tests/ui/options/options.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { options } from '../../../src/ui/options/options';
import type { AppContext } from '../../../src/ui/shell';

function ctx(): AppContext {
  return {
    navigate: vi.fn(), route: 'options', storage: {} as never,
    draft: { dpi: 800, currentGame: 'cs2', currentSens: 1,
      profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
      bounds: [15, 60] },
  };
}

describe('options screen', () => {
  it('renders the three panels and a per-game row for every game', () => {
    const host = document.createElement('div');
    const c = ctx();
    const screen = options(host, c); screen.mount();
    expect(host.querySelector('[data-panel="school"]')).not.toBeNull();
    expect(host.querySelector('[data-panel="games"]')).not.toBeNull();
    expect(host.querySelector('[data-panel="bounds"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-yaw-row]').length).toBe(8);
    screen.unmount();
  });
  it('editing the search bounds writes normalized bounds to the draft', () => {
    const host = document.createElement('div');
    const c = ctx();
    const screen = options(host, c); screen.mount();
    const lo = host.querySelector<HTMLInputElement>('[data-bound="lo"]')!;
    const hi = host.querySelector<HTMLInputElement>('[data-bound="hi"]')!;
    lo.value = '40'; hi.value = '20';
    lo.dispatchEvent(new Event('input', { bubbles: true }));
    hi.dispatchEvent(new Event('input', { bubbles: true }));
    expect(c.draft.bounds).toEqual([20, 40]); // reordered + normalized
    screen.unmount();
  });
  it('selecting the monitor-distance school reveals FOV inputs', () => {
    const host = document.createElement('div');
    const screen = options(host, ctx()); screen.mount();
    const sel = host.querySelector<HTMLSelectElement>('[data-school]')!;
    sel.value = 'monitor';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(host.querySelector('[data-fov="source"]')).not.toBeNull();
    expect(host.querySelector('[data-fov="target"]')).not.toBeNull();
    screen.unmount();
  });
  it('back navigates to the hero', () => {
    const host = document.createElement('div');
    const c = ctx();
    const screen = options(host, c); screen.mount();
    host.querySelector<HTMLButtonElement>('[data-action="back"]')!.click();
    expect(c.navigate).toHaveBeenCalledWith('hero');
    screen.unmount();
  });
});
```

- [ ] **Step 2: Run test, verify it fails** — FAIL.

- [ ] **Step 3: Implement `src/ui/options/options.ts`** (build DOM, wire events; keep all copy lowercase). Reference implementation:
```ts
import type { AppContext, Screen } from '../shell';
import type { GameId } from '../../types';
import { CONVERSION_SCHOOLS, monitorDistanceMatchCm360, perGameSens } from '../../convert/schools';
import { effectiveYawTable, normalizeBounds, type YawOverrides } from './settings';
import { sensFor } from '../../convert/cm360';

export function options(host: HTMLElement, ctx: AppContext): Screen {
  const overrides: YawOverrides = {};
  return {
    mount() {
      const root = document.createElement('section');
      root.className = 'screen screen--shell options fade-in';
      const [lo, hi] = ctx.draft.bounds;
      const mid = Math.round(Math.sqrt(lo * hi));

      root.innerHTML = `
        <div class="wrap options__inner stack">
          <button class="action action--ghost" data-action="back">back</button>
          <h2 class="options__title display">+ options</h2>

          <section class="options__panel" data-panel="school">
            <h3 class="options__h">conversion school</h3>
            <label class="field">method
              <select data-school>${CONVERSION_SCHOOLS.map((s) => `<option value="${s.id}">${s.label}</option>`).join('')}</select>
            </label>
            <p class="options__note mono" data-school-note>${CONVERSION_SCHOOLS[0]!.note}</p>
            <div data-fov-block hidden>
              <label class="field">source fov (°) <input type="number" data-fov="source" value="103" min="60" max="140"></label>
              <label class="field">target fov (°) <input type="number" data-fov="target" value="90" min="60" max="140"></label>
              <label class="field">screen fraction <input type="number" data-fov="fraction" value="0" min="0" max="1" step="0.1"></label>
              <p class="options__readout">at <span class="mono">${mid}</span> cm/360 → <span class="mono" data-fov-out>—</span> cm/360</p>
            </div>
          </section>

          <section class="options__panel" data-panel="games">
            <h3 class="options__h">per-game yaw + sensitivity <span class="options__sub mono">dpi ${ctx.draft.dpi} · ${mid} cm/360</span></h3>
            <table class="options__table"><thead><tr><th>game</th><th>yaw (°/count)</th><th>sensitivity</th></tr></thead>
            <tbody data-games-body></tbody></table>
            <button class="action action--ghost" data-action="reset-yaw">reset yaw to defaults</button>
          </section>

          <section class="options__panel" data-panel="bounds">
            <h3 class="options__h">cm/360 search bounds</h3>
            <p class="options__note">the range the optimizer searches. wider = more thorough, slower.</p>
            <div class="options__bounds">
              <label class="field">min <input type="number" data-bound="lo" value="${lo}" min="5" max="150"></label>
              <label class="field">max <input type="number" data-bound="hi" value="${hi}" min="5" max="150"></label>
            </div>
            <p class="options__readout">searching <span class="mono" data-bounds-out>${lo}–${hi}</span> cm/360</p>
          </section>
        </div>`;

      const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;

      // ── per-game table (re-derives from overrides) ──────────────────────────
      const renderGames = (): void => {
        const sens = perGameSens(mid, ctx.draft.dpi);
        $('[data-games-body]').innerHTML = effectiveYawTable(overrides).map((e) => `
          <tr data-yaw-row data-game="${e.id}">
            <td>${e.label}</td>
            <td><input class="options__yaw" type="number" step="0.0001" data-yaw="${e.id}" value="${e.yaw}"></td>
            <td class="mono" data-sens="${e.id}">${sens[e.id as GameId].toFixed(3)}</td>
          </tr>`).join('');
        // recompute sens with the (possibly overridden) yaw, per row
        for (const e of effectiveYawTable(overrides)) {
          $(`[data-sens="${e.id}"]`).textContent = sensFor(mid, ctx.draft.dpi, e.yaw).toFixed(3);
        }
      };
      renderGames();
      $('[data-games-body]').addEventListener('input', (ev) => {
        const t = ev.target as HTMLInputElement;
        const id = t.getAttribute('data-yaw') as GameId | null;
        if (!id) return;
        const v = parseFloat(t.value);
        if (Number.isFinite(v) && v > 0) { overrides[id] = v; $(`[data-sens="${id}"]`).textContent = sensFor(mid, ctx.draft.dpi, v).toFixed(3); }
      });
      $('[data-action="reset-yaw"]').addEventListener('click', () => {
        for (const k of Object.keys(overrides)) delete overrides[k as GameId];
        renderGames();
      });

      // ── conversion school ───────────────────────────────────────────────────
      const fovBlock = $('[data-fov-block]') as HTMLElement;
      const recalcFov = (): void => {
        const sFov = parseFloat($<HTMLInputElement>('[data-fov="source"]').value);
        const tFov = parseFloat($<HTMLInputElement>('[data-fov="target"]').value);
        const frac = parseFloat($<HTMLInputElement>('[data-fov="fraction"]').value);
        const out = monitorDistanceMatchCm360(mid, sFov, tFov, Number.isFinite(frac) ? frac : 0);
        $('[data-fov-out]').textContent = Number.isFinite(out) ? out.toFixed(1) : '—';
      };
      $('[data-school]').addEventListener('change', (ev) => {
        const id = (ev.target as HTMLSelectElement).value;
        const school = CONVERSION_SCHOOLS.find((s) => s.id === id)!;
        $('[data-school-note]').textContent = school.note;
        fovBlock.hidden = !school.fovAware;
        if (school.fovAware) recalcFov();
      });
      fovBlock.addEventListener('input', recalcFov);

      // ── search bounds → draft ─────────────────────────────────────────────────
      const syncBounds = (): void => {
        const a = parseFloat($<HTMLInputElement>('[data-bound="lo"]').value);
        const b = parseFloat($<HTMLInputElement>('[data-bound="hi"]').value);
        const [nlo, nhi] = normalizeBounds(a, b);
        ctx.draft.bounds = [nlo, nhi];
        $('[data-bounds-out]').textContent = `${nlo}–${nhi}`;
      };
      $('[data-panel="bounds"]').addEventListener('input', syncBounds);

      $('[data-action="back"]').addEventListener('click', () => ctx.navigate('hero'));
      host.appendChild(root);
    },
    unmount() { host.replaceChildren(); },
  };
}
```

- [ ] **Step 4: Implement `src/styles/options.css`** — layout for `.options__inner` (max-width ~40rem), `.options__panel` (bordered card), `.options__table` (full-width, parchment row borders like the result table), `.options__bounds`/`.field` row layout, `.options__readout` (gold accent value), `.options__note`/`.options__sub` (slate-2 mono). Keep within tokens; respect focus-visible.

- [ ] **Step 5: Run test, verify it passes** — PASS. `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit** — `feat(options): conversion school + per-game yaw overrides + search-bounds editor`.

---

### Task B4: wire options into the app + runtime proof

**Files:**
- Modify: `src/main.ts`
- Modify: `src/ui/stubs.ts` (delete it if now empty, else drop `optionsStub`)
- Test: `tests/ui/options/wiring.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
describe('options wiring', () => {
  it('main.ts uses the real options screen + stylesheet, not the stub', () => {
    const main = readFileSync('src/main.ts', 'utf-8');
    expect(main).toMatch(/import\s*\{\s*options\s*\}\s*from\s*'\.\/ui\/options\/options'/);
    expect(main).toMatch(/styles\/options\.css/);
    expect(main).not.toMatch(/optionsStub/);
    expect(main).not.toMatch(/stubs/);
  });
});
```

- [ ] **Step 2: Run test, verify it fails** — FAIL.
- [ ] **Step 3: Edit `src/main.ts`** — `import './styles/options.css';`; `import { options } from './ui/options/options';`; map `options: options,`; remove the `./ui/stubs` import entirely.
- [ ] **Step 4: Delete `src/ui/stubs.ts`** (no longer referenced).
- [ ] **Step 5: Tests + typecheck + build** — `npm test`, `npx tsc --noEmit`, `npm run build` all clean.
- [ ] **Step 6: Runtime proof** — `npm run dev`; `http://localhost:5173/#/options`: all three panels work; editing yaw re-derives sens; monitor-distance reveals FOV inputs + live readout; bounds edits persist into a subsequent session (set bounds → start → confirm session uses them). `prefers-reduced-motion` respected.
- [ ] **Step 7: Commit** — `feat(options): wire the real screen into the shell; remove stubs`.

---

# Workstream 6C — falcon hero motion

The hero is a **typographic** falcon (eye = `ó`, body = wordmark, beak = `+ start`, feet = byline, wing = the glyph scatter). Motion honors spec §10's intent without an SVG silhouette that would fight the composition: a **parallax sky drifts behind** a transparent hero (visible only in the negative space — the opaque glyphs never let it bleed through them), and the **wing scatter flaps** in a slow wing-beat. All motion is gated by `prefers-reduced-motion` and the rAF driver is cleaned up on unmount.

### Task C1: parallax sky layer behind the hero

**Files:**
- Modify: `src/ui/hero.ts`
- Modify: `src/styles/shell.css`
- Test: `tests/ui/hero.test.ts` (extend)

- [ ] **Step 1: Write the failing test** (extend the existing hero test)
```ts
// add inside tests/ui/hero.test.ts
it('renders a sky layer behind the composition, marked aria-hidden and pointer-inert', () => {
  const host = document.createElement('div');
  const screen = hero(host, ctxStub());           // reuse the file's existing ctx stub
  screen.mount();
  const sky = host.querySelector('.hero__sky');
  expect(sky).not.toBeNull();
  expect(sky!.getAttribute('aria-hidden')).toBe('true');
  expect(host.querySelectorAll('.hero__sky-layer').length).toBeGreaterThanOrEqual(2);
  screen.unmount();
});
```
(If the existing test file lacks a reusable ctx stub, mirror the one already used by the other assertions in that file.)

- [ ] **Step 2: Run test, verify it fails** — FAIL.

- [ ] **Step 3: Edit `src/ui/hero.ts`** — add the sky as the first child of `.hero__inner` (behind everything), built from 2–3 `.hero__sky-layer` divs (far/mid/near) holding faint drifting marks:
```ts
// inside the innerHTML, as the FIRST element of .hero__inner:
`<div class="hero__sky" aria-hidden="true">
   <div class="hero__sky-layer" data-depth="far"></div>
   <div class="hero__sky-layer" data-depth="mid"></div>
   <div class="hero__sky-layer" data-depth="near"></div>
 </div>`
```
Ensure `.hero__inner` establishes a stacking context and the sky sits at `z-index:0` (the wordmark/wing already use `z-index:1`).

- [ ] **Step 4: Edit `src/styles/shell.css`** — sky styling + slow drift keyframes; reduced-motion freezes them:
```css
.hero__sky { position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }
.hero__sky-layer { position: absolute; inset: -10%;
  background-repeat: repeat;
  /* faint speckle "altitude" field; depth tints + sizes set per layer */
}
.hero__sky-layer[data-depth="far"] {
  background-image: radial-gradient(color-mix(in oklab, var(--slate-2) 30%, transparent) 1px, transparent 1.5px);
  background-size: 120px 120px; opacity: .25; animation: sky-drift 90s linear infinite; }
.hero__sky-layer[data-depth="mid"] {
  background-image: radial-gradient(color-mix(in oklab, var(--slate-2) 40%, transparent) 1px, transparent 1.6px);
  background-size: 200px 200px; opacity: .2; animation: sky-drift 60s linear infinite reverse; }
.hero__sky-layer[data-depth="near"] {
  background-image: radial-gradient(color-mix(in oklab, var(--gold) 28%, transparent) 1px, transparent 1.8px);
  background-size: 320px 320px; opacity: .15; animation: sky-drift 40s linear infinite; }
@keyframes sky-drift { from { transform: translate3d(0,0,0); } to { transform: translate3d(-6%, 3%, 0); } }
@media (prefers-reduced-motion: reduce) { .hero__sky-layer { animation: none !important; } }
```
(The opaque wordmark/byline/actions sit above the sky; the sky shows only in negative space — satisfying "never bleeding through the wing edges.")

- [ ] **Step 5: Run test + typecheck** — PASS / clean.
- [ ] **Step 6: Commit** — `feat(hero): parallax sky layer behind the falcon composition (reduced-motion safe)`.

---

### Task C2: wing-flap + gentle bob + pointer parallax + runtime proof

**Files:**
- Modify: `src/ui/hero.ts`
- Modify: `src/styles/shell.css`

- [ ] **Step 1: Add the wing-flap + bob keyframes to `src/styles/shell.css`.** The wing marks already arc top-left→lower-right; the flap rotates the whole wing group about a shoulder origin (near the wordmark) and the whole composition bobs subtly. Per-mark stagger via `--i` (set inline in hero.ts).
```css
/* shoulder-anchored wing beat; each mark lags by its index */
.hero__wing { transform-origin: 30% 40%; }
.hero__wing span { animation: wing-beat 3.2s var(--ease-out) infinite; animation-delay: calc(var(--i, 0) * -120ms); }
@keyframes wing-beat {
  0%, 100% { transform: rotate(var(--rot, 0deg)) translateY(0); }
  50%      { transform: rotate(calc(var(--rot, 0deg) - 7deg)) translateY(-4px); }
}
/* gentle whole-composition bob — the glide */
.hero__inner { animation: hero-bob 7s ease-in-out infinite; }
@keyframes hero-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
@media (prefers-reduced-motion: reduce) {
  .hero__wing span { animation: none !important; }
  .hero__inner { animation: none !important; }
}
```
Note: the existing per-`nth-child` rules set each mark's static `transform: rotate(...)`. Refactor those to set `--rot` (the angle) + keep the size, so the keyframe can compose rotation with the beat. Example: `.hero__wing span:nth-child(1) { top:12%; left:14%; --rot:-48deg; font-size:2.2rem; }` and a base rule `.hero__wing span { transform: rotate(var(--rot)); }`.

- [ ] **Step 2: Set `--i` per wing mark in `src/ui/hero.ts`** — when building the marks: `WING_MARKS.map((m, i) => \`<span style="--i:${i}">${m}</span>\`)`.

- [ ] **Step 3: Add a subtle pointer-parallax driver in `src/ui/hero.ts`** (skipped entirely under reduced motion; cleaned up on unmount). On `pointermove`, shift the sky layers by depth and tilt the composition a degree or two via a `requestAnimationFrame`-throttled handler. Store the listener + any `cancelAnimationFrame` handle and remove them in `unmount()`.
```ts
// sketch inside hero(): guard with matchMedia('(prefers-reduced-motion: reduce)').matches
// add window 'pointermove' → set CSS vars (--par-x/--par-y) on root; rAF-coalesced;
// keep a `let raf = 0` + `const onMove = ...`; in unmount: window.removeEventListener + cancelAnimationFrame(raf).
```
Wire `--par-x`/`--par-y` into the sky-layer transforms (e.g., `translate3d(calc(var(--par-x,0)*Npx), ...)`) with per-depth multipliers.

- [ ] **Step 4: Tests + typecheck** — existing hero tests still pass (the parallax driver must no-op safely under jsdom where `matchMedia` may be undefined — guard it); add an assertion that `unmount()` removes the listener if feasible, else verify no throw.

- [ ] **Step 5: Runtime proof** — `npm run dev`; the hero: sky parallaxes behind, wing beats in a slow rhythm, composition glides, pointer shifts the depths subtly, glyphs stay crisp/opaque over the sky. Toggle `prefers-reduced-motion`: everything is still + legible. Confirm 60fps (no layout thrash — only `transform`/`opacity`). Console clean.

- [ ] **Step 6: Commit** — `feat(hero): wing-flap beat + glide + pointer parallax (the falcon flies)`.

---

# Workstream 6D — polish & QA

### Task D1: micro-motion, focus, slider accent, favicon, plot y-axis label

**Files:** `src/ui/setup.ts`, `src/styles/shell.css`, `src/styles/tokens.css` (if needed), `src/ui/convergence-plot.ts`, `public/favicon.svg`, `index.html`
- Test: `tests/ui/convergence-plot.test.ts` (extend for the y-axis label), plus a token/asset presence check.

- [ ] **Step 1 (slider accent):** in `src/ui/setup.ts`, give the goal `<input type="range">` `style="accent-color: var(--gold)"` (or a `.goal-slider` class in shell.css). Verify the existing setup test still passes.
- [ ] **Step 2 (button press / hover micro-motion):** add to shell.css — `.action { transition: transform var(--dur-fast) var(--ease-out); } .action:active { transform: scale(.97); }` (matches the sibling project's tactile feel; reduced-motion already zeroes `--dur-fast`).
- [ ] **Step 3 (plot y-axis label):** add an optional `yLabel?: string` to `renderConvergencePlot` (or a small `<text>` rotated at the left edge reading "blended score (z)"). TDD: a test asserting the label text appears when supplied. Wire a label in the session plot + the case-study figure.
- [ ] **Step 4 (favicon):** create `public/favicon.svg` — a minimal gold `+` or the falcon `ó` eye on bone; reference `<link rel="icon" href="/favicon.svg">` in `index.html`. Removes the console 404.
- [ ] **Step 5:** full suite + typecheck + build clean.
- [ ] **Step 6: Commit** — `polish: slider accent, button micro-motion, plot y-axis label, favicon`.

---

### Task D2: prefers-reduced-motion + a11y audit

**Files:** as needed (fix-ups only).
- [ ] **Step 1:** Audit every screen with `prefers-reduced-motion: reduce`: hero (sky/wing/bob/parallax frozen), case study (sections instant, no hidden content), session/result transitions, options. tokens.css already zeroes `--dur-fast`/`--dur-med`; confirm all new animations either use those or have explicit reduced-motion `animation: none` (the case-study, hero, and any new keyframes).
- [ ] **Step 2:** Keyboard + SR pass: every actionable control is a real `<button>`/`<input>`/`<select>` (already the pattern); `:focus-visible` outlines present; decorative chrome (`cs-reg`, `cs-numeral`, spines, sky, wing) is `aria-hidden`; the case-study article has a sensible heading order (h2 per section). Fix gaps.
- [ ] **Step 3:** Commit any fixes — `a11y: reduced-motion + keyboard/SR audit across screens`.

---

### Task D3: error / empty states

**Files:** as needed.
- [ ] **Step 1:** Verify/strengthen graceful degradation: `result` with no `lastResult` already redirects to hero (keep); `options` invalid numeric input falls back safely (covered by `normalizeBounds` + the `Number.isFinite` guards); `case-study` uses canned `demoConvergence()` so it never depends on a live session; storage malformed-JSON already degrades (Phase 5). Add a test for any path not yet covered.
- [ ] **Step 2:** Commit if changes — `harden: options/result empty + invalid-input states`.

---

### Task D4: whole-app Chromium QA proof + phase wrap

**Files:** none (verification).
- [ ] **Step 1:** `npm test` (all green, expect ~230+), `npx tsc --noEmit` clean, `npm run build` clean.
- [ ] **Step 2:** Chromium walk (Chrome MCP / Claude Preview): hero (now flying) → setup → gate → session (60fps arena + live plot with y-label) → result → **case study** (full editorial read, data-viz, reduced-motion) → **options** (all panels, bounds feed a session). Confirm console clean (no favicon 404). Capture the key numbers from a `__arenaDebug.runSession()` to confirm the measurement core still returns a finite concave Report under the new CSS/JS.
- [ ] **Step 3:** Final whole-phase code review (most-capable model) across the diff; address findings.

---

## Self-Review (run before dispatching)

**Spec coverage** (§4 instruments, §7 conversion, §9 IA case-study + options, §10 falcon motion, §12 success criteria "case study accurately represents the biology with citations" + "falcon hero lands with impact and respects prefers-reduced-motion"): ✓ case study (A1–A7) covers §4 mechanisms + §13 citations + the unified-system `/goal`; options (B1–B4) covers §7 schools + yaw override + bounds; falcon motion (C1–C2) covers §10 motion vision; polish/QA (D1–D4) covers §12 portfolio bar. PSX skin explicitly deferred (per user scope + §10/§11).

**Placeholder scan:** every code step ships real code; the case-study copy is verbatim/final; the one "reference implementation" (options.ts) is complete and runnable; CSS rules are concrete with the sibling project named as the fidelity reference for polish detail (not a placeholder — the load-bearing rules are present + tests pin the contract).

**Type consistency:** `PlotInput`/`InstrumentId` imported from existing modules; `CaseSection.accent` ↔ `accentVar`; `YawOverrides`/`effectiveYaw(Table)` consistent across B2/B3; `monitorDistanceMatchCm360` signature identical in B1 test + impl + B3 use; `Route 'case-study'|'options'` already in `shell.ts`; `ctx.draft.bounds` is the existing `[Cm360,Cm360]` the session already consumes.

**Honesty/voice gates:** content test pins the real numbers (29.94 / 4.133 / MSE / 10,400), forbids naming a company, requires the portfolio-theme credit + ≥8 dated citations; the "honesty" act states the no-fabricated-noise + wide-CI + variance-floor truths; reduced-motion paths tested/required throughout.
