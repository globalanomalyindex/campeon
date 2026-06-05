// The hero is a spaghetti-western title sequence that resolves into the menu. A definition of
// evolution fades in and out one line at a time (auto-paced, click to advance / skip line by line),
// "el campeón" lands ("el" in cream, "campeón" in red), a screen flash cuts to the "campeón" mark
// with a vertical film-reel weave that settles, and a second click-flash brings up the (left-aligned)
// menu + byline. Reduced-motion and returning-this-session visitors go straight to the menu.
import type { AppContext, Screen } from './shell';

// The epigraph: a one-sentence definition of evolution dealt out as four title cards, resolving into
// "el campeón" (the one that cannot be beaten). It mirrors the engine - one trait (cm/360) perfected
// across generations of trials. The choreography is content-agnostic; line count drives the pacing.
const LINES = [
  'evolution is defined as',
  'the slow perfecting of one trait,',
  'across a thousand generations,',
  'until it cannot be beaten.',
];

const LINE_IN = 1400;   // ms fade-in (matches the .is-on CSS transition)
const LINE_HOLD = 950;  // ms a line holds at full opacity
// the gap before the next beat begins. MUST be >= the CSS fade-OUT (1000ms) so the outgoing line is
// fully gone before the next fades in - nothing ever overlaps. The 100ms surplus is a clean breath.
const FADE_OUT = 1100;
const TITLE_HOLD = 1700; // ms "el campeón" holds before the flash cut to the hero

const prefersReduced = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const SEEN_KEY = 'campeon-intro-seen';
const introSeen = (): boolean => { try { return sessionStorage.getItem(SEEN_KEY) === '1'; } catch { return false; } };
const markSeen = (): void => { try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode: just replay */ } };

export function hero(host: HTMLElement, ctx: AppContext): Screen {
  let cleanup: (() => void) | null = null;

  return {
    mount() {
      const reduced = prefersReduced();
      const skipIntro = reduced || introSeen();

      const root = document.createElement('section');
      root.className = 'hero';
      const menuOn = skipIntro ? ' is-mark is-on' : '';
      root.innerHTML = `
        <div class="reel" aria-hidden="true"></div>
        <div class="flash" data-flash aria-hidden="true"></div>
        ${skipIntro ? '' : `
        <div class="intro" data-intro>
          <div class="intro__stack">
            ${LINES.map((t, i) => `<p class="intro__line" data-line="${i}">${t}</p>`).join('')}
            <p class="intro__title" data-title><span class="intro__el">el</span> <span class="intro__champ">campeón</span></p>
          </div>
          <button class="intro__skip" data-skip>skip &rsaquo;</button>
        </div>`}
        <div class="hero__menu${menuOn}" data-menu>
          <h1 class="hero__mark" data-mark>campe<span class="hero__eye">ó</span>n</h1>
          <p class="hero__tagline">one number. six predators. the sensitivity your hands were built for.</p>
          <button class="action action--primary" data-action="start">start</button>
          <p class="hero__byline">by christopher robin fiore</p>
          <nav class="hero__nav">
            <button class="action action--ghost" data-action="case-study">case study</button>
            <button class="action action--ghost" data-action="options">options</button>
          </nav>
        </div>`;
      host.appendChild(root);

      const q = (s: string): HTMLElement => root.querySelector(s) as HTMLElement;
      q('[data-action="start"]').addEventListener('click', () => ctx.navigate('setup'));
      q('[data-action="case-study"]').addEventListener('click', () => ctx.navigate('case-study'));
      q('[data-action="options"]').addEventListener('click', () => ctx.navigate('options'));

      // Vertical film-gate weave on the mark: a hard catch on reveal that decays to rest in ~1.5s.
      let alive = true;
      let weaveRaf = 0;
      const startWeave = (): void => {
        if (reduced || weaveRaf || !alive || typeof requestAnimationFrame !== 'function') return; // start at most once
        const mark = q('[data-mark]');
        const DUR = 1500, FRAME = 1000 / 24;
        let t0 = 0, last = 0;
        const loop = (ts: number): void => {
          if (!alive) { weaveRaf = 0; return; }
          if (!t0) t0 = ts;
          const k = (ts - t0) / DUR;
          if (k >= 1) { mark.style.transform = 'translateY(0)'; weaveRaf = 0; return; } // settle + stop
          weaveRaf = requestAnimationFrame(loop);
          if (ts - last < FRAME) return;
          last = ts;
          const decay = (1 - k) * (1 - k);
          const x = (Math.random() * 2 - 1) * 0.6 * decay;
          const y = (Math.random() * 2 - 1) * 3.2 * decay; // vertical-dominant, like film through a gate
          mark.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
        };
        weaveRaf = requestAnimationFrame(loop);
      };

      if (skipIntro) {
        startWeave();
        cleanup = () => { alive = false; if (weaveRaf) cancelAnimationFrame(weaveRaf); };
        return;
      }

      // ── the cinematic sequence ────────────────────────────────────────────────
      const N = LINES.length; // beats 0..N-1 = lines, N = title, N+1 = hero mark, N+2 = menu
      const menu = q('[data-menu]');
      const intro = q('[data-intro]');
      const flashEl = q('[data-flash]');
      const lineEls = LINES.map((_, i) => q(`[data-line="${i}"]`));
      let beat = -1;
      let timer: number | null = null;
      let flashTimer: number | null = null;
      let done = false;

      const clearTimer = (): void => {
        if (timer !== null) { clearTimeout(timer); timer = null; }
        if (flashTimer !== null) { clearTimeout(flashTimer); flashTimer = null; }
      };

      const flash = (mid: () => void): void => {
        flashEl.classList.add('is-on');
        flashTimer = window.setTimeout(() => {
          flashTimer = null;
          if (!alive) return; // never touch a torn-down DOM (back/forward mid-flash)
          mid();
          flashEl.classList.remove('is-on');
        }, 60);
      };

      const showBeat = (b: number): void => {
        if (b < N) { lineEls[b]!.classList.add('is-on'); timer = window.setTimeout(advance, LINE_IN + LINE_HOLD); return; }
        if (b === N) { q('[data-title]').classList.add('is-on'); timer = window.setTimeout(advance, LINE_IN + TITLE_HOLD); return; }
        if (b === N + 1) { flash(() => { intro.classList.add('is-gone'); menu.classList.add('is-mark'); startWeave(); }); return; }
        flash(() => { menu.classList.add('is-on'); intro.remove(); }); done = true; markSeen();
      };

      function advance(): void {
        if (done) return;
        clearTimer();
        const cur = beat;
        if (cur + 1 > N + 2) return;
        if (cur >= 0 && cur < N) {
          // leaving a line: fade it out, then bring the next beat in after the gap
          lineEls[cur]!.classList.remove('is-on');
          beat = cur + 1;
          timer = window.setTimeout(() => showBeat(beat), FADE_OUT);
          return;
        }
        beat = cur + 1;
        showBeat(beat);
      }

      const skip = (): void => {
        if (done) return;
        done = true; clearTimer();
        intro.remove();
        menu.classList.add('is-mark', 'is-on'); // straight to the menu, no flash
        startWeave(); markSeen();
      };

      // The advance-click lives on the root: once the title flash-cuts away, the intro overlay is
      // pointer-events:none, but the final click-flash to the menu still needs to register. The
      // `done` guard makes menu-button clicks (which bubble here) a no-op once the menu is live.
      const onRootClick = (): void => advance();
      const onSkipClick = (e: Event): void => { e.stopPropagation(); skip(); };
      root.addEventListener('click', onRootClick);
      q('[data-skip]').addEventListener('click', onSkipClick);

      advance(); // reveal the first line

      cleanup = () => {
        alive = false;
        clearTimer();
        if (weaveRaf) cancelAnimationFrame(weaveRaf);
        root.removeEventListener('click', onRootClick);
      };
    },
    unmount() {
      cleanup?.();
      cleanup = null;
      host.replaceChildren();
    },
  };
}
