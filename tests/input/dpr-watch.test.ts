import { describe, it, expect } from 'vitest';
import { watchDevicePixelRatio, type DprHost, type DprQueryList } from '../../src/input/dpr-watch';

/** A window stand-in whose density can move under the watch, exactly as a window dragged to a
 *  second monitor moves it. `fire` is the resolution media query going off, which is what a real
 *  browser does on that drag. */
function fakeHost(start: number, opts: { matchMedia?: boolean } = {}): {
  host: DprHost; set: (v: number) => void; fire: () => void; listeners: number;
} {
  let dpr = start;
  const listeners: (() => void)[] = [];
  const state = {
    host: {
      get devicePixelRatio(): number { return dpr; },
      ...(opts.matchMedia === false ? {} : {
        matchMedia(): DprQueryList {
          return {
            addEventListener: (_t: 'change', l: () => void) => void listeners.push(l),
            removeEventListener: (_t: 'change', l: () => void) => {
              const i = listeners.indexOf(l);
              if (i >= 0) listeners.splice(i, 1);
            },
          };
        },
      }),
    } as DprHost,
    set: (v: number) => { dpr = v; },
    fire: () => { for (const l of [...listeners]) l(); },
    get listeners(): number { return listeners.length; },
  };
  return state;
}

describe('watchDevicePixelRatio', () => {
  it('reports the density while it holds', () => {
    const { host } = fakeHost(1);
    expect(watchDevicePixelRatio(host).stable()).toBe(1);
  });

  it('reports null once the density has moved', () => {
    // The window was dragged to a denser monitor mid-capture. Part of the stream arrived at one
    // density and part at another, so no single reading describes it and the route must refuse.
    const w = fakeHost(1);
    const watch = watchDevicePixelRatio(w.host);
    w.set(2);
    w.fire();
    expect(watch.stable()).toBeNull();
  });

  it('stays null after a density that changed and changed BACK', () => {
    // The case a reading at the pin cannot catch: dragged to a 2x monitor and back before the
    // player clicked. A live comparison sees 1 and calls it stable; the media query saw the move.
    const w = fakeHost(1);
    const watch = watchDevicePixelRatio(w.host);
    w.set(2);
    w.fire();
    w.set(1);
    w.fire();
    expect(w.host.devicePixelRatio).toBe(1); // the naive read agrees with the start, and is wrong
    expect(watch.stable()).toBeNull();
  });

  it('reports null on a moved density even if no change event ever fired', () => {
    // The listener is the only detector that can see a round trip, and the comparison is the only
    // one that survives a listener that was never called. Neither is redundant.
    const w = fakeHost(1);
    const watch = watchDevicePixelRatio(w.host);
    w.set(2);
    expect(watch.stable()).toBeNull();
  });

  it('watches the density it STARTED at, not the value 1', () => {
    // A session that begins at 2 and drops to 1 mid-capture is the same failure as the reverse, and
    // the deduction downstream would be handed a 1 that only half the stream was captured under.
    const w = fakeHost(2);
    const watch = watchDevicePixelRatio(w.host);
    expect(watch.stable()).toBe(2);
    w.set(1);
    w.fire();
    expect(watch.stable()).toBeNull();
  });

  it('refuses to vouch for anything without matchMedia', () => {
    // No change signal means no way to rule out a round trip, and an unverifiable premise is not
    // good enough for a number the player types into their game. jsdom is exactly this host.
    const { host } = fakeHost(1, { matchMedia: false });
    expect(watchDevicePixelRatio(host).stable()).toBeNull();
  });

  it('refuses to vouch for a density that is not a usable number', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { host } = fakeHost(bad);
      expect(watchDevicePixelRatio(host).stable()).toBeNull();
    }
  });

  it('detaches its listener on dispose, so a watch per turn cannot pile up', () => {
    const w = fakeHost(1);
    const watch = watchDevicePixelRatio(w.host);
    expect(w.listeners).toBe(1);
    watch.dispose();
    expect(w.listeners).toBe(0);
    watch.dispose(); // idempotent: the shell disposes at the pin and again at unmount
    expect(w.listeners).toBe(0);
  });
});
