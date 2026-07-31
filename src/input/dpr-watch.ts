// The display density behind the `dpr-one` pin, and the single guarantee a shell must make about it:
// that the density it reports HELD FOR THE WHOLE CAPTURE the number is used to interpret.
//
// `pinConvention` deduces k = 1 from a devicePixelRatio of exactly 1, which is only sound if the
// stream it is reading was captured at that same density. A window dragged from a 1x monitor to a
// 2x one changes devicePixelRatio mid-turn, and a reading taken under one density and used under
// another is the exact class of unit bug this project keeps finding. So this watch does not answer
// "what is the density"; it answers "what density held throughout", and null when it cannot say.
//
// Lives beside the pure core it feeds rather than in the UI because the promise it makes is a
// measurement promise. It is a shell: it reads a host object. The host is a parameter so the whole
// thing is testable without a browser.

/** The one media-query object shape this needs, across the two spellings browsers have shipped. */
export interface DprQueryList {
  addEventListener?(type: 'change', listener: () => void): void;
  removeEventListener?(type: 'change', listener: () => void): void;
  /** The pre-2020 spelling, still the only one on older Safari. */
  addListener?(listener: () => void): void;
  removeListener?(listener: () => void): void;
}

/** What the watch needs from a `window`. Structural, so a test passes an object literal. */
export interface DprHost {
  readonly devicePixelRatio: number;
  matchMedia?(query: string): DprQueryList;
}

export interface DprWatch {
  /**
   * The devicePixelRatio that has held for the entire life of this watch, or null when it has not
   * held or cannot be vouched for. Null is not "unknown density", it is "do not deduce from this":
   * `pinConvention` takes null as a refusal of the route, which is the fail-closed direction.
   */
  stable(): number | null;
  dispose(): void;
}

/**
 * Watch the density from now until `dispose`.
 *
 * Two detectors, because they catch different failures and only both together cover the window:
 *  - a `(resolution: Ndppx)` media query pinned to the density at the start. It stops matching the
 *    moment the density changes, which is the ONLY way to catch a density that changed and changed
 *    back during the capture. A live comparison alone would read the restored value and call it
 *    stable, having missed that half the stream arrived at another density.
 *  - a direct comparison of the live density against the starting one on every read, which needs no
 *    event to have fired and so cannot be defeated by a listener that was never called.
 *
 * A host with no `matchMedia` gets null forever. It cannot promise the first detector, so it cannot
 * promise stability, and a route that pins an absolute number the player types into their game is
 * not the place to accept an unverifiable premise. Every browser that can open the acceleration
 * gate has `matchMedia`; jsdom does not, which is why shell tests of the pin stub it deliberately.
 */
export function watchDevicePixelRatio(host: DprHost): DprWatch {
  const start = host.devicePixelRatio;
  const readable = typeof start === 'number' && Number.isFinite(start) && start > 0;
  let changed = false;
  let detach: (() => void) | null = null;

  if (readable && typeof host.matchMedia === 'function') {
    const onChange = (): void => { changed = true; };
    // Pinned to the starting density rather than to 1: this watch reports a CHANGE, and a session
    // that starts at 2 and drops to 1 mid-capture must fail exactly as one that starts at 1 does.
    const mql = host.matchMedia(`(resolution: ${start}dppx)`);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      detach = () => mql.removeEventListener?.('change', onChange);
    } else if (typeof mql.addListener === 'function') {
      mql.addListener(onChange);
      detach = () => mql.removeListener?.(onChange);
    }
  }

  const armed = readable && detach !== null;

  return {
    stable(): number | null {
      if (!armed || changed) return null;
      return host.devicePixelRatio === start ? start : null;
    },
    dispose(): void {
      detach?.();
      detach = null;
    },
  };
}
