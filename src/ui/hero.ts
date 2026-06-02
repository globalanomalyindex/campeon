import type { AppContext, Screen } from './shell';

const WING_MARKS = ['/', '\\', '~', '<', '^', '/', '~', '\\'];

export function hero(host: HTMLElement, ctx: AppContext): Screen {
  return {
    mount() {
      const root = document.createElement('section');
      root.className = 'screen screen--shell hero fade-in';
      root.innerHTML = `
        <div class="wrap hero__inner">
          <div class="hero__wing" aria-hidden="true">
            ${WING_MARKS.map((m) => `<span>${m}</span>`).join('')}
          </div>
          <p class="hero__tagline">one number. six predators. the sensitivity your hands were built for.</p>
          <h1 class="display hero__mark">campe<span data-eye class="hero__eye">ó</span>n</h1>
          <button class="action action--primary" data-action="start">start</button>
          <p class="hero__byline">by christopher robin fiore</p>
          <nav class="hero__nav">
            <button class="action action--ghost" data-action="case-study">case study</button>
            <button class="action action--ghost" data-action="options">options</button>
          </nav>
        </div>`;
      root.querySelector('[data-action="start"]')!.addEventListener('click', () => ctx.navigate('setup'));
      root.querySelector('[data-action="case-study"]')!.addEventListener('click', () => ctx.navigate('case-study'));
      root.querySelector('[data-action="options"]')!.addEventListener('click', () => ctx.navigate('options'));
      host.appendChild(root);
    },
    unmount() { host.replaceChildren(); },
  };
}
