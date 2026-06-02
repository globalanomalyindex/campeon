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

  if (s.id === 'engine') grid.appendChild(buildFigure());
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
