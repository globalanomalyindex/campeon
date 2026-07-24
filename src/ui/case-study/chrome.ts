/** Pure DOM builders for the case-study chrome. No side effects beyond creating detached nodes. */

import type { InstrumentId } from '../../types';

export function monoLabel(parts: readonly string[]): HTMLElement {
  const span = document.createElement('span');
  span.className = 'cs-eyebrow mono';
  parts.forEach((part, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.setAttribute('aria-hidden', 'true');
      // A middle dot, which is the separator the system specifies for labels. The "+"
      // that used to sit here was part of the retired skin's motif.
      sep.textContent = '·';
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

/**
 * The synthetic-data disclosure. Any figure whose numbers were invented rather than measured wears
 * one of these, in the reading order, before the artwork. Hard invariant 2 (measurement honesty)
 * covers the page arguing for it as much as it covers the engine.
 */
export function demoTag(text: string): HTMLElement {
  const tag = document.createElement('span');
  tag.className = 'cs-demo-tag mono';
  tag.setAttribute('data-demo-tag', '');
  tag.textContent = text;
  return tag;
}

export interface FigureNote { n: number; text: string; }

export interface FigureSpec {
  /** Museum tag: which screen or artifact this is. */
  screen: string;
  /** Set only when the artwork carries invented numbers. */
  demo?: string;
  caption: string;
  notes?: readonly FigureNote[];
  /** The artwork itself. Rendered aria-hidden: the caption and notes are the accessible text. */
  art: Node;
}

/** Frames one artifact: label, optional synthetic-data tag, artwork, caption, numbered notes. */
export function figure(spec: FigureSpec): HTMLElement {
  const fig = document.createElement('figure');
  fig.className = 'cs-figure';
  if (spec.demo !== undefined) fig.setAttribute('data-demo', '');

  const label = document.createElement('span');
  label.className = 'cs-fig-label mono';
  label.textContent = spec.screen;
  fig.appendChild(label);
  if (spec.demo !== undefined) fig.appendChild(demoTag(spec.demo));

  const art = document.createElement('div');
  art.className = 'cs-fig-art';
  art.setAttribute('aria-hidden', 'true');
  art.appendChild(spec.art);
  fig.appendChild(art);

  const cap = document.createElement('figcaption');
  cap.textContent = spec.caption;
  fig.appendChild(cap);

  if (spec.notes?.length) {
    const ol = document.createElement('ol');
    ol.className = 'cs-notes';
    for (const note of spec.notes) {
      const li = document.createElement('li');
      const n = document.createElement('span');
      n.className = 'cs-note-n mono';
      n.textContent = String(note.n).padStart(2, '0');
      li.append(n, document.createTextNode(note.text));
      ol.appendChild(li);
    }
    fig.appendChild(ol);
  }
  return fig;
}

const INSTRUMENT_VAR: Record<InstrumentId, string> = {
  track: 'var(--instrument-track)', flick: 'var(--instrument-flick)',
  calibrate: 'var(--instrument-calibrate)', strike: 'var(--instrument-strike)',
};

export interface FacetRow { instrument: InstrumentId; label: string; value: string; }

/**
 * The result screen's specimen card, rebuilt at reading scale from the same composition rules the
 * real screen follows: the number as the one dominant field in warm ink, the 90% CI as a hairline
 * rule beneath it rather than a coloured badge, and the four facets as a mineral-coded rail.
 */
export function specimenCard(o: {
  cm360: string; ci: string; facets: readonly FacetRow[]; note: string;
}): HTMLElement {
  const card = document.createElement('div');
  card.className = 'cs-ui cs-ui--card';

  const tag = document.createElement('span');
  tag.className = 'cs-ui-tag mono';
  tag.textContent = 'your cm/360';
  card.appendChild(tag);

  const num = document.createElement('span');
  num.className = 'cs-ui-figure';
  num.textContent = o.cm360;
  card.appendChild(num);

  const ci = document.createElement('span');
  ci.className = 'cs-ui-ci mono';
  ci.textContent = o.ci;
  card.appendChild(ci);

  const rail = document.createElement('div');
  rail.className = 'cs-ui-rail';
  for (const f of o.facets) {
    const cell = document.createElement('div');
    cell.style.setProperty('--facet', INSTRUMENT_VAR[f.instrument]);
    const swatch = document.createElement('span');
    swatch.className = 'cs-ui-swatch';
    const k = document.createElement('span');
    k.className = 'cs-ui-k mono';
    k.textContent = f.label;
    const v = document.createElement('span');
    v.className = 'cs-ui-v mono';
    v.textContent = f.value;
    cell.append(swatch, k, v);
    rail.appendChild(cell);
  }
  card.appendChild(rail);

  const note = document.createElement('p');
  note.className = 'cs-ui-note';
  note.textContent = o.note;
  card.appendChild(note);
  return card;
}

export interface GateAction { label: string; primary?: boolean; }

/** A redraw of a real screen: heading, body lines, the actions in the order they are stacked. */
export function screenSketch(o: {
  heading: string; lines: readonly string[]; actions: readonly GateAction[]; footnote?: string;
}): HTMLElement {
  const sketch = document.createElement('div');
  sketch.className = 'cs-ui cs-ui--screen';

  const h = document.createElement('span');
  h.className = 'cs-ui-h';
  h.textContent = o.heading;
  sketch.appendChild(h);

  for (const line of o.lines) {
    const p = document.createElement('p');
    p.className = 'cs-ui-p';
    p.textContent = line;
    sketch.appendChild(p);
  }
  for (const a of o.actions) {
    const btn = document.createElement('span');
    btn.className = a.primary ? 'cs-ui-btn cs-ui-btn--primary' : 'cs-ui-btn';
    btn.textContent = a.label;
    sketch.appendChild(btn);
  }
  if (o.footnote !== undefined) {
    const f = document.createElement('p');
    f.className = 'cs-ui-foot mono';
    f.textContent = o.footnote;
    sketch.appendChild(f);
  }
  return sketch;
}

export interface CodeSide { label: string; file: string; lines: readonly string[]; }

/** Two code panels side by side. Used for the section vii repairs, so the claim is inspectable. */
export function codeCompare(before: CodeSide, after: CodeSide): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'cs-ui cs-ui--code';
  for (const side of [before, after]) {
    const col = document.createElement('div');
    col.className = 'cs-code-col';
    const head = document.createElement('span');
    head.className = 'cs-code-head mono';
    head.textContent = `${side.label} · ${side.file}`;
    const pre = document.createElement('pre');
    pre.className = 'cs-code mono';
    pre.textContent = side.lines.join('\n');
    col.append(head, pre);
    wrap.appendChild(col);
  }
  return wrap;
}

export interface ReviewLink { label: string; href: string; note: string; }

/** The colophon's link block. Section viii claims the measurement is readable line by line, so the
 *  reader gets the lines: one anchor per file the claims above actually rest on. */
export function linkList(links: readonly ReviewLink[]): HTMLElement {
  const ul = document.createElement('ul');
  ul.className = 'cs-links';
  for (const l of links) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = l.href;
    a.textContent = l.label;
    a.rel = 'noreferrer';
    a.target = '_blank';
    const note = document.createElement('span');
    note.className = 'cs-link-note mono';
    note.textContent = l.note;
    li.append(a, note);
    ul.appendChild(li);
  }
  return ul;
}
