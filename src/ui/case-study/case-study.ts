import type { AppContext, Screen } from '../shell';
import { plotGeometry, renderConvergencePlot } from '../convergence-plot';
import { THESIS_COPY } from '../concord';
import { SECTIONS, CITATIONS, CREDIT, accentVar, demoConvergence, type CaseSection } from './content';
import {
  monoLabel, sectionNumeral, registrationFrame, specRail,
  figure, specimenCard, screenSketch, codeCompare, linkList,
} from './chrome';
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

  if (s.environment) {
    const env = document.createElement('p');
    env.className = 'cs-environment';
    const tag = document.createElement('span');
    tag.className = 'cs-env-tag mono';
    tag.setAttribute('aria-hidden', 'true');
    tag.textContent = 'the environment';
    env.append(tag, document.createTextNode(s.environment));
    grid.appendChild(env);
  }

  const body = document.createElement('div');
  body.className = 'cs-body';
  body.innerHTML = s.body.map((p) => `<p>${p}</p>`).join('');
  grid.appendChild(body);

  for (const artifact of artifactsFor(s.id)) grid.appendChild(artifact);

  if (s.spec) grid.appendChild(specRail(s.spec));
  if (s.id === 'colophon') grid.appendChild(buildRefsAndCredit());

  sec.appendChild(grid);
  return sec;
}

/** The inline artifacts a section shows rather than asserts. Every one whose numbers are invented
 *  carries a visible synthetic-data tag; the rest are redraws of shipped screens. */
function artifactsFor(id: CaseSection['id']): HTMLElement[] {
  if (id === 'engine') return [buildFigure()];
  if (id === 'honesty') return [buildRepairFigure(), buildGateFigure()];
  if (id === 'colophon') return [buildResultCardFigure()];
  return [];
}

function buildFigure(): HTMLElement {
  const input = demoConvergence();
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('data-plot', '');
  renderConvergencePlot(svg, plotGeometry(input), 'blended score (z)');
  return figure({
    screen: 'fig. 01 · the convergence plot',
    demo: 'worked example · invented numbers',
    art: svg,
    caption: 'Nothing here was measured. I drew a converged sweep by hand so the shape is legible before you have played a session, and the real plot is the same code with your trials in it. Four instruments, each z-scored across its own sweep, converging on one peak.',
    notes: [
      { n: 1, text: 'The band around the peak is the 90% ci. It widens with measurement noise and with facet disagreement, so a wide band is the honest output of a thin session.' },
      { n: 2, text: `The four marks along the top are each faculty's own peak, which is the one-number thesis being tested and not assumed. Drawn as they sit here, the shipped readout would say: ${THESIS_COPY['some-spread']}.` },
      { n: 3, text: 'Strike is drawn hollow because its peak is conditioned on your goal slider, so it is a labelled marker rather than a fourth estimate of the same constant.' },
    ],
  });
}

function buildRepairFigure(): HTMLElement {
  return figure({
    screen: 'fig. 02 · the two repairs',
    art: codeCompare(
      {
        label: 'Before', file: 'the tuned constant',
        lines: ['// strike: "measured" uncertainty', 'const se = sigmaTheta / 1.0; // deg', '', '// flick: endpoint sign', 'const err = radial * signOf(yawOrder);'],
      },
      {
        label: 'After', file: 'src/instruments/strike.ts · flick.ts',
        lines: [
          '// strike: the hit rate\'s own binomial SE,',
          '// carried through the delta method',
          'const relAcc = Math.sqrt(H * (1 - H) / n) / H;',
          '',
          '// flick: ISO 9241-9 along-axis projection',
          'const errAlong = missComponents(',
          '  presentAim, tgt, aim).radial;',
        ],
      },
    ),
    caption: 'The two lines the adversarial review took apart, and what replaced them. The left column is reconstructed from the change, the right column is what ships today. Both files are linked in the colophon so you can read the rest of the context.',
    notes: [
      { n: 1, text: 'The hand-picked one-degree divisor produced a number that looked measured and was not. The binomial standard error is the score\'s own functional form, so nothing unmeasured enters the nugget.' },
      { n: 2, text: 'Signing the total radial miss by yaw order meant a near-vertical reach had its sign set by horizontal wobble, which inflated We and cancelled real bias out of Ae.' },
    ],
  });
}

function buildGateFigure(): HTMLElement {
  return figure({
    screen: 'fig. 03 · setup, calibration blocked',
    art: screenSketch({
      heading: 'Mouse acceleration detected',
      lines: [
        'The sweep says your mouse speeds up the faster you move, which makes one true turn distance impossible to pin down.',
        'Turn off enhance pointer precision, or your driver\'s acceleration, then run it again.',
      ],
      actions: [{ label: 'Try again', primary: true }, { label: 'I\'ll type my numbers instead' }],
      footnote: 'Typed numbers seed the search. They are never the answer.',
    }),
    caption: 'A redraw of the screen a blocked calibration lands on. The decision worth defending is the second button: I keep the escape hatch, and I label what it costs you rather than hiding it behind the gate.',
    notes: [
      { n: 1, text: 'The primary action is the one that keeps the session measurable, so it is the only lapis control on the screen.' },
      { n: 2, text: 'The ghost button next to it is the honest admission that a browser can refuse pointer lock outright, in which case there is no measured path to offer.' },
      { n: 3, text: 'The footnote states what the escape hatch costs, because a typed number seeds the search and a reader who skipped that would carry away the one wrong idea this tool cannot afford.' },
    ],
  });
}

function buildResultCardFigure(): HTMLElement {
  return figure({
    screen: 'fig. 04 · the result, as a specimen card',
    demo: 'worked example · invented numbers',
    art: specimenCard({
      cm360: '29.4',
      ci: '90% ci 27.4 to 31.1 cm/360',
      facets: [
        { instrument: 'track', label: 'track', value: '28.1' },
        { instrument: 'flick', label: 'flick', value: '30.4' },
        { instrument: 'calibrate', label: 'calibrate', value: '29.2' },
        { instrument: 'strike', label: 'strike', value: '33.0' },
      ],
      note: 'The four views broadly agree; a few more trials would tighten this band.',
    }),
    caption: 'The payoff screen, at reading scale, with invented numbers. One dominant field and small accents, which is the same composition the rest of the app is built on.',
    notes: [
      { n: 1, text: 'The number is warm ink on paper rather than a coloured headline. The composition carries the payoff, so colour is left free to mean something.' },
      { n: 2, text: 'The 90% ci is a hairline rule under the number rather than a badge, because it is a property of the measurement rather than a status.' },
      { n: 3, text: 'The four facets are a mineral-coded rail read as a museum tag. Lapis is missing from it on purpose: blue is reserved for things you can act on.' },
      { n: 4, text: 'A number you hand-tuned in the range renders this card with no ci at all. A tuned value has no measured interval, so it gets none.' },
    ],
  });
}

function buildRefsAndCredit(): DocumentFragment {
  const frag = document.createDocumentFragment();
  const heading = document.createElement('p');
  heading.className = 'cs-refs-head mono';
  heading.textContent = 'sources · each one tied to the claim it carries';
  frag.appendChild(heading);

  const ol = document.createElement('ol');
  ol.className = 'cs-refs';
  for (const c of CITATIONS) {
    const li = document.createElement('li');
    li.value = c.n;
    const work = document.createElement('span');
    work.className = 'cs-ref-work';
    work.textContent = c.work;
    const backs = document.createElement('span');
    backs.className = 'cs-ref-backs mono';
    backs.textContent = c.backs;
    li.append(work, backs);
    ol.appendChild(li);
  }
  frag.appendChild(ol);

  const readHead = document.createElement('p');
  readHead.className = 'cs-refs-head mono';
  readHead.textContent = 'read the source';
  frag.append(readHead, linkList(CREDIT.links));

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
  // Reveal-on-scroll is an enhancement: only hide-then-animate when an observer can
  // actually drive it (IntersectionObserver present + motion allowed). Otherwise content
  // shows immediately and createReveal's reduced path reveals on observe - never trapped hidden.
  const animate = typeof IntersectionObserver !== 'undefined' && !prefersReduced();
  const reveal = createReveal({ reduced: !animate });
  return {
    mount() {
      const article = document.createElement('article');
      article.className = 'case fade-in';
      if (animate) article.setAttribute('data-reveal-active', '');

      // The article's one h1. It is sr-only because the piece opens on section i's own
      // heading by design, and a visible second title would compete with it. Without an h1
      // the whole document outline started at h2 and the screen had no name.
      const title = document.createElement('h1');
      title.className = 'sr-only';
      title.textContent = 'How I built it';
      article.appendChild(title);

      const back = document.createElement('button');
      back.className = 'action action--ghost cs-back';
      back.setAttribute('data-action', 'back');
      back.textContent = 'Back';
      back.addEventListener('click', () => ctx.navigate('hero'));
      article.appendChild(back);

      const sections = SECTIONS.map((s) => {
        const sec = buildSection(s);
        article.appendChild(sec);
        return sec;
      });
      host.appendChild(article);
      // Observe AFTER the article is in the document so the on-screen check has real layout.
      for (const sec of sections) reveal.observe(sec);
    },
    unmount() {
      reveal.stop();
      host.replaceChildren();
    },
  };
}
