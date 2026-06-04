/**
 * A brief on-screen "miss" tick - the legibility cue for a shot that didn't land in any target's
 * hitbox. The scoring is unchanged (a miss already lowers the score via Fitts effective-width +
 * hit-rate); this only makes a whiff unmistakable in the moment. One reusable element under `host`;
 * `miss()` restarts a CSS pop+fade. Reduced motion is handled in CSS (the pop is disabled there).
 */
export interface ShotFeedback {
  readonly el: HTMLElement;
  /** Flash the miss tick (re-triggers the animation if already showing). */
  miss(): void;
  dispose(): void;
}

export function createShotFeedback(host: HTMLElement): ShotFeedback {
  const el = document.createElement('div');
  el.className = 'shot-miss mono';
  el.setAttribute('aria-hidden', 'true');
  el.textContent = 'miss';
  host.appendChild(el);

  let timer = 0;
  return {
    el,
    miss(): void {
      el.classList.remove('is-on');
      void el.offsetWidth; // force reflow so re-adding the class restarts the keyframes
      el.classList.add('is-on');
      if (timer) clearTimeout(timer);
      timer = (setTimeout(() => el.classList.remove('is-on'), 500) as unknown) as number;
    },
    dispose(): void {
      if (timer) clearTimeout(timer);
      el.remove();
    },
  };
}
