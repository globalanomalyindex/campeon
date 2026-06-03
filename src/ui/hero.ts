import type { AppContext, Screen } from './shell';

const WING_MARKS = ['/', '\\', '~', '<', '^', '/', '~', '\\'];

const prefersReduced = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function hero(host: HTMLElement, ctx: AppContext): Screen {
  let cleanup: (() => void) | null = null;
  return {
    mount() {
      const root = document.createElement('section');
      root.className = 'screen screen--shell hero fade-in';
      root.innerHTML = `
        <div class="wrap hero__inner">
          <div class="hero__sky" aria-hidden="true">
            <div class="hero__sky-layer" data-depth="far"></div>
            <div class="hero__sky-layer" data-depth="mid"></div>
            <div class="hero__sky-layer" data-depth="near"></div>
          </div>
          <div class="hero__wing" aria-hidden="true">
            ${WING_MARKS.map((m, i) => `<span style="--i:${i}">${m}</span>`).join('')}
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

      // Pointer parallax: the sky shifts by depth behind the (opaque) falcon, so it reads as flying.
      // Enhancement only — skipped under reduced motion; rAF-coalesced; torn down on unmount.
      if (!prefersReduced()) {
        const inner = root.querySelector<HTMLElement>('.hero__inner');
        if (inner) {
          let raf = 0;
          let lx = 0;
          let ly = 0;
          const onMove = (e: PointerEvent): void => {
            lx = (e.clientX / window.innerWidth - 0.5) * 2;
            ly = (e.clientY / window.innerHeight - 0.5) * 2;
            if (raf) return;
            raf = requestAnimationFrame(() => {
              raf = 0;
              inner.style.setProperty('--par-x', lx.toFixed(3));
              inner.style.setProperty('--par-y', ly.toFixed(3));
            });
          };
          window.addEventListener('pointermove', onMove);
          cleanup = () => {
            window.removeEventListener('pointermove', onMove);
            if (raf) cancelAnimationFrame(raf);
          };
        }
      }
    },
    unmount() {
      cleanup?.();
      cleanup = null;
      host.replaceChildren();
    },
  };
}
