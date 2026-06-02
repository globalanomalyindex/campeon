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
    observe(el) { io.observe(el); },
    stop() { io.disconnect(); },
  };
}
