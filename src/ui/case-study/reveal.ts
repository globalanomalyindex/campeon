export interface Reveal {
  observe(el: Element): void;
  stop(): void;
}

/** Reveals [data-reveal] elements as they scroll into view. Under reduced motion (or when
 *  IntersectionObserver is unavailable), reveals immediately. */
export function createReveal(opts: { reduced: boolean }): Reveal {
  if (opts.reduced || typeof IntersectionObserver === 'undefined') {
    return {
      observe(el) { el.setAttribute('data-in-view', 'true'); },
      stop() {},
    };
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.setAttribute('data-in-view', 'true');
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.12 },
  );
  return {
    observe(el) {
      // Already on-screen at observe time → reveal synchronously: no flash of invisible
      // content, and robust even if the observer's first callback is slow to fire. Below-fold
      // elements (or detached ones, height 0) fall through to the observer for scroll reveal.
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      if (rect.height > 0 && rect.top < vh && rect.bottom > 0) {
        el.setAttribute('data-in-view', 'true');
        return;
      }
      io.observe(el);
    },
    stop() { io.disconnect(); },
  };
}
