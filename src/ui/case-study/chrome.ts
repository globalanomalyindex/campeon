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
