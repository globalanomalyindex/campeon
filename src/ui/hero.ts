// The hero is a specimen card.
//
// It used to be a timed title sequence: four lines of an epigraph dealt out one at a
// time, a flash cut, then the menu. That put roughly fourteen seconds between a
// visitor arriving and being able to do anything, and the first thing the tool
// communicated was a wait. The measurement is the interesting part, so the front
// door now shows what is measured and lets you start.
//
// The four instruments are laid out as a drawer: a colour field per mineral, a
// catalogue number, the environment, and the organisms it was drawn from. See
// docs/design/canon.md section 4.5.
import type { AppContext, Screen } from './shell';

interface Specimen {
  readonly id: 'track' | 'flick' | 'calibrate' | 'strike';
  readonly no: string;
  readonly environment: string;
  readonly organisms: string;
  readonly measures: string;
}

const SPECIMENS: readonly Specimen[] = [
  { id: 'track', no: 'No. 01', environment: 'The open-air intercept',
    organisms: 'dragonfly · falcon', measures: 'Staying on a target that keeps moving.' },
  { id: 'flick', no: 'No. 02', environment: 'The ambush',
    organisms: 'spider · raptor', measures: 'Getting there fast and still landing it.' },
  { id: 'calibrate', no: 'No. 03', environment: 'Shooting through the bend',
    organisms: 'archerfish', measures: 'Whether the shot lands where you aimed.' },
  { id: 'strike', no: 'No. 04', environment: 'The strike window',
    organisms: 'mantis shrimp', measures: 'How long you take to commit.' },
];

const cell = (s: Specimen, i: number): string => `
  <article class="hero__cell reveal" data-instrument="${s.id}" data-reveal style="--reveal-i:${i + 2}">
    <div class="hero__cell-field" aria-hidden="true"></div>
    <p class="tag">
      <span class="tag__no">${s.no}</span>
      <span class="tag__name"><span class="dot dot--${s.id}"></span> ${s.organisms}</span>
    </p>
    <h3 class="hero__cell-name">${s.environment}</h3>
    <p class="hero__cell-note">${s.measures}</p>
  </article>`;

export function hero(host: HTMLElement, ctx: AppContext): Screen {
  return {
    mount() {
      const root = document.createElement('section');
      root.className = 'screen screen--shell hero';
      root.innerHTML = `
        <div class="hero__intro">
          <h1 class="hero__mark reveal" data-reveal style="--reveal-i:0">campe<span class="hero__eye">ó</span>n</h1>
          <p class="hero__lead reveal" data-reveal style="--reveal-i:1">
            I built this to find the mouse sensitivity you actually aim best at.
            You play four short drills. Each one scores a different facet of your aim,
            and the search converges on the number where all four agree.
          </p>
          <div class="hero__actions reveal" data-reveal style="--reveal-i:2">
            <button class="action action--primary" data-action="start">Find my number</button>
            <nav class="hero__nav">
              <button class="action action--ghost" data-action="case-study">Case study</button>
              <button class="action action--ghost" data-action="options">Options</button>
            </nav>
          </div>
          <p class="hero__byline reveal" data-reveal style="--reveal-i:3">Christopher Robin Fiore</p>
        </div>
        <div class="hero__drawer">${SPECIMENS.map(cell).join('')}</div>`;
      host.appendChild(root);

      const q = (s: string): HTMLElement => root.querySelector(s) as HTMLElement;
      q('[data-action="start"]').addEventListener('click', () => ctx.navigate('setup'));
      q('[data-action="case-study"]').addEventListener('click', () => ctx.navigate('case-study'));
      q('[data-action="options"]').addEventListener('click', () => ctx.navigate('options'));
    },
    unmount() {
      host.replaceChildren();
    },
  };
}
