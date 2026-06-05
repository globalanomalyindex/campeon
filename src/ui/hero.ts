// The hero is a spaghetti-western title sequence that resolves into the menu. Lines fade in one at a
// time (auto-paced, click to advance / skip line by line), "el campeon" lands in red, a screen flash
// cuts to the "campeon" mark with a 24fps film-reel weave, and a second click-flash brings up the
// menu + byline. Reduced-motion and returning-this-session visitors go straight to the menu.
import type { AppContext, Screen } from './shell';

// The cinematic lead-in lines (each its own dramatic beat). Easy to swap to match the Figma copy.
const LINES = [
  'out where every shot has to count,',
  'the deadliest hunters share one secret:',
  'the number their whole body is tuned to.',
];

const LINE_HOLD = 1750; // ms a line holds before auto-advancing
const TITLE_HOLD = 1900; // ms "el campeon" holds before the flash cut to the hero

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
            <p class="intro__title" data-title>el campeón</p>
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

      // 24fps film-gate weave on the mark: a hair of jitter, like a projector that won't sit still.
      let weaveRaf = 0;
      const startWeave = (): void => {
        if (reduced || typeof requestAnimationFrame !== 'function') return;
        const mark = q('[data-mark]');
        const FRAME = 1000 / 24;
        let last = 0;
        const loop = (ts: number): void => {
          weaveRaf = requestAnimationFrame(loop);
          if (ts - last < FRAME) return;
          last = ts;
          const x = (Math.random() * 2 - 1) * 1.2;
          const y = (Math.random() * 2 - 1) * 0.9;
          const r = (Math.random() * 2 - 1) * 0.18;
          mark.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${r.toFixed(3)}deg)`;
        };
        weaveRaf = requestAnimationFrame(loop);
      };

      if (skipIntro) {
        startWeave();
        cleanup = () => { if (weaveRaf) cancelAnimationFrame(weaveRaf); };
        return;
      }

      // ── the cinematic sequence ────────────────────────────────────────────────
      const N = LINES.length;        // beats 0..N-1 = lines, N = title, N+1 = hero mark, N+2 = menu
      const menu = q('[data-menu]');
      const intro = q('[data-intro]');
      const flashEl = q('[data-flash]');
      let beat = -1;
      let timer: number | null = null;
      let done = false;

      const clearTimer = (): void => { if (timer !== null) { clearTimeout(timer); timer = null; } };

      const flash = (mid: () => void): void => {
        flashEl.classList.add('is-on');
        window.setTimeout(() => { mid(); flashEl.classList.remove('is-on'); }, 60); // swap content at the peak
      };

      const showBeat = (b: number): void => {
        if (b < N) { q(`[data-line="${b}"]`).classList.add('is-on'); return; }
        if (b === N) { q('[data-title]').classList.add('is-on'); return; }
        if (b === N + 1) {
          flash(() => { intro.classList.add('is-gone'); menu.classList.add('is-mark'); startWeave(); });
          return;
        }
        // b === N + 2: the second click-flash brings up the rest of the menu
        flash(() => { menu.classList.add('is-on'); intro.remove(); });
        done = true; markSeen();
      };

      const advance = (): void => {
        if (done) return;
        clearTimer();
        beat += 1;
        if (beat > N + 2) return;
        showBeat(beat);
        // auto-advance the lines and the title (up to the flash cut); then wait for the click-flash
        if (beat <= N) timer = window.setTimeout(advance, beat < N ? LINE_HOLD : TITLE_HOLD);
      };

      const skip = (): void => {
        if (done) return;
        done = true; clearTimer();
        intro.remove();
        menu.classList.add('is-mark', 'is-on'); // straight to the menu, no flash
        startWeave(); markSeen();
      };

      // Advance on a click anywhere - this must live on the root (not the intro), because once the
      // title flash-cuts to the hero mark the intro overlay is faded out + pointer-events:none, and
      // the final click-flash to the menu still needs to register. The `done` guard makes menu-button
      // clicks (which bubble up here) a no-op once the menu is live.
      const onRootClick = (): void => advance();
      const onSkipClick = (e: Event): void => { e.stopPropagation(); skip(); };
      root.addEventListener('click', onRootClick);
      q('[data-skip]').addEventListener('click', onSkipClick);

      advance(); // reveal the first line

      cleanup = () => {
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
