// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { range, announceCounts, stepLabel, type RangeDeps } from '../../src/ui/range';
import type { ArenaStage } from '../../src/ui/arena-stage';
import type { AppContext, Route, SessionDraft } from '../../src/ui/shell';
import { counts360, countsBounds } from '../../src/types';
import type { Result } from '../../src/types';

const MEASURED: Result = {
  optimalCounts: counts360(8240), ci90: countsBounds(7400, 9150),
  breakdown: { biasZeroCounts: counts360(7900), precisionFloorDeg: 0.42, ttkMs: 511, hitRate: 0.86, trackContribZ: 0.6, flickContribZ: -0.3 },
  curve: [{ x: Math.log(6000), mean: 0.2 }, { x: Math.log(8240), mean: 0.9 }],
  bounds: countsBounds(4800, 19200),
};

/** A stage that records the count total it was handed and never touches WebGL. */
function fakeStage(): { stage: ArenaStage; setCounts: ReturnType<typeof vi.fn> } {
  const setCounts = vi.fn();
  const stage = {
    arena: {
      onFire: vi.fn(() => () => undefined), onFrame: vi.fn(() => () => undefined),
      view: () => [0, 0], spawnTarget: vi.fn(), removeTarget: vi.fn(),
    } as unknown as ArenaStage['arena'],
    requestLock: vi.fn(() => Promise.resolve('raw')), exitLock: vi.fn(),
    isLocked: () => false, setCounts, setEnemyEnvironment: vi.fn(),
    ready: Promise.resolve(), dispose: vi.fn(),
  } as unknown as ArenaStage;
  return { stage, setCounts };
}

function mountRange(): {
  root: HTMLElement; host: HTMLElement; nav: Route[]; setCounts: ReturnType<typeof vi.fn>;
  saved: Record<string, Result>; unmount(): void;
} {
  const { stage, setCounts } = fakeStage();
  const deps: RangeDeps = { createStage: () => stage };
  const nav: Route[] = [];
  const saved: Record<string, Result> = {};
  const draft: SessionDraft = {
    currentGame: 'cs2', currentSens: 1, bounds: countsBounds(4800, 19200),
    profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
  };
  const ctx = {
    route: 'range', draft,
    navigate(r: Route) { nav.push(r); },
    storage: {
      saveSession() {}, loadSessions: () => [], exportJson: () => '{}',
      saveResult(id: string, r: Result) { saved[id] = r; },
      loadResults: () => ({ s1: MEASURED }),
    },
    lastResult: { sessionId: 's1', result: MEASURED },
  } as unknown as AppContext;

  const host = document.createElement('div');
  document.body.appendChild(host);
  const screen = range(host, ctx, deps);
  screen.mount();
  return {
    root: host.querySelector('.range') as HTMLElement, host, nav, setCounts, saved,
    unmount() { screen.unmount(); host.remove(); },
  };
}

const $ = (root: HTMLElement, name: string): HTMLElement => root.querySelector(`[data-range="${name}"]`) as HTMLElement;

describe('range: the nudge controls say what they actually do', () => {
  it('names the step buttons by the unit they move, counts per 360, and never by an inverted "sensitivity"', () => {
    // A higher count total is a LOWER sensitivity, so "+ increases sensitivity" told a screen-reader
    // user the inverse of what the button does. The name has to track the number that moves.
    const { root, unmount } = mountRange();
    const up = $(root, 'up').getAttribute('aria-label')!;
    const down = $(root, 'down').getAttribute('aria-label')!;

    expect(up).toBe('Increase counts per 360 by 150, a lower sensitivity');
    expect(down).toBe('Decrease counts per 360 by 150, a higher sensitivity');
    expect(up).not.toMatch(/increase sensitivity/i);
    expect(down).not.toMatch(/decrease sensitivity/i);
    unmount();
  });

  it('the "+" button raises the count total and the "−" button lowers it, matching those names', () => {
    const { root, setCounts, unmount } = mountRange();
    $(root, 'up').dispatchEvent(new MouseEvent('click'));
    expect(setCounts).toHaveBeenLastCalledWith(8390);
    $(root, 'down').dispatchEvent(new MouseEvent('click'));
    expect(setCounts).toHaveBeenLastCalledWith(8240);
    unmount();
  });

  it('exposes the bracket keys on the buttons they duplicate', () => {
    const { root, unmount } = mountRange();
    expect($(root, 'down').getAttribute('aria-keyshortcuts')).toBe('[ Shift+[');
    expect($(root, 'up').getAttribute('aria-keyshortcuts')).toBe('] Shift+]');
    unmount();
  });

  it('points the control bar at the key-bindings hint, so the bindings are reachable from the controls', () => {
    const { root, unmount } = mountRange();
    const bar = root.querySelector('.range__bar')!;
    const describedBy = bar.getAttribute('aria-describedby')!;
    const hint = root.querySelector(`#${describedBy}`)!;
    expect(hint).toBe(root.querySelector('.range__hint'));
    expect(hint.textContent).toMatch(/bracket keys/);
    expect(hint.getAttribute('aria-hidden')).toBeNull();
    unmount();
  });

  it('labels stepLabel off the same constant the nudge uses', () => {
    expect(stepLabel(1)).toContain('150');
    expect(stepLabel(-1)).toContain('150');
  });
});

describe('range: the live readout is spoken', () => {
  it('carries the readout as one sentence in a polite region, with the glyph composition aria-hidden', () => {
    const { root, unmount } = mountRange();
    const hud = root.querySelector('.range__hud')!;
    expect(hud.getAttribute('aria-live')).toBe('polite');
    expect(root.querySelector('.display')!.getAttribute('aria-hidden')).toBe('true');
    expect($(root, 'delta').getAttribute('aria-hidden')).toBe('true');

    const announce = $(root, 'announce');
    expect(announce.classList.contains('sr-only')).toBe(true);
    expect(announce.textContent).toBe('8,240 counts per 360. This is your measured value.');
    unmount();
  });

  it('re-announces after a nudge, naming the distance from the measured number', () => {
    const { root, unmount } = mountRange();
    $(root, 'up').dispatchEvent(new MouseEvent('click'));
    expect($(root, 'announce').textContent).toBe('8,390 counts per 360, 150 above your measured 8,240.');
    $(root, 'down').dispatchEvent(new MouseEvent('click'));
    $(root, 'down').dispatchEvent(new MouseEvent('click'));
    expect($(root, 'announce').textContent).toBe('8,090 counts per 360, 150 below your measured 8,240.');
    unmount();
  });

  it('stays silent when a nudge clamps at a bound and the number does not move', () => {
    const { root, unmount } = mountRange();
    // Walk down to the lower bound (4,800 with these draft bounds), then keep pressing.
    for (let i = 0; i < 40; i += 1) $(root, 'down').dispatchEvent(new MouseEvent('click'));
    const atBound = $(root, 'announce').textContent;
    expect($(root, 'counts').textContent).toBe('4,800');

    // A rewrite of a live region is what triggers an announcement, so watch for the mutation
    // itself: an identical string written again would still be read out.
    const announce = $(root, 'announce');
    const observer = new MutationObserver(() => undefined);
    observer.observe(announce, { childList: true, characterData: true, subtree: true });
    $(root, 'down').dispatchEvent(new MouseEvent('click'));
    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
    expect(announce.textContent).toBe(atBound);
    unmount();
  });

  it('spells the unit out, so nothing reads a slash aloud', () => {
    expect(announceCounts(8240, 8240)).toContain('counts per 360');
    expect(announceCounts(5000, 8240)).not.toContain('cm/360');
  });

  it('reports the measured value as measured only inside the display rounding', () => {
    expect(announceCounts(8240.4, 8240)).toContain('your measured value');
    expect(announceCounts(8270, 8240)).toContain('30 above');
  });
});

describe('range: the adopt confirm owns the room', () => {
  it('inerts the HUD, the control bar and the hint while the confirm is open, and restores them after', () => {
    const { root, unmount } = mountRange();
    const behind = ['.range__hud', '.range__bar', '.range__hint'].map((s) => root.querySelector(s) as HTMLElement);

    $(root, 'adopt').dispatchEvent(new MouseEvent('click'));
    for (const el of behind) {
      expect(el.hasAttribute('inert')).toBe(true);
      expect(el.getAttribute('aria-hidden')).toBe('true');
    }

    (root.querySelector('[data-confirm="cancel"]') as HTMLElement).dispatchEvent(new MouseEvent('click'));
    for (const el of behind) {
      expect(el.hasAttribute('inert')).toBe(false);
      expect(el.hasAttribute('aria-hidden')).toBe(false);
    }
    unmount();
  });

  it('takes focus on open and hands it back to the adopt button on cancel', () => {
    const { root, unmount } = mountRange();
    const opener = $(root, 'adopt') as HTMLButtonElement;
    opener.focus();
    opener.dispatchEvent(new MouseEvent('click'));
    expect(document.activeElement).toBe(root.querySelector('[data-confirm="adopt"]'));

    (root.querySelector('[data-confirm="cancel"]') as HTMLElement).dispatchEvent(new MouseEvent('click'));
    expect(document.activeElement).toBe(opener);
    unmount();
  });

  it('Escape closes the confirm and keeps tuning', () => {
    const { root, nav, unmount } = mountRange();
    $(root, 'adopt').dispatchEvent(new MouseEvent('click'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect((root.querySelector('[data-confirm]') as HTMLElement).hidden).toBe(true);
    expect(nav).toEqual([]); // dismissing the confirm adopts nothing
    unmount();
  });
});

describe('range: voice', () => {
  it('writes every readable string in sentence case, with no lowercase "i" standing for the author', () => {
    const { root, unmount } = mountRange();
    const readable = [
      root.querySelector('h1')!, $(root, 'adopt'), $(root, 'reset'), $(root, 'exit'),
      root.querySelector('.range__hint')!, root.querySelector('.range__confirm-label')!,
      root.querySelector('.range__confirm-lead')!,
      root.querySelector('[data-confirm="adopt"]')!, root.querySelector('[data-confirm="cancel"]')!,
    ];
    for (const el of readable) {
      const text = el.textContent!.trim();
      expect(text[0]).toBe(text[0]!.toUpperCase()); // sentence case: the first letter is a capital
      expect(text).not.toMatch(/(^|\s)i(\s|$|,|\.)/); // the pronoun is always "I"
      expect(text).not.toMatch(/[—–]/); // no em dash, no en dash
      expect(text).not.toMatch(/\S--\S/);
    }
    expect($(root, 'exit').textContent).toBe('Back to result');
    unmount();
  });

  it('states what adopting costs in the first person, with no rhetorical flip', () => {
    const { root, unmount } = mountRange();
    const lead = root.querySelector('.range__confirm-lead')!.textContent!.replace(/\s+/g, ' ');
    expect(lead).toContain('I drop the convergence plot');
    expect(lead).toContain('no measured CI'); // the honesty claim survives the rewrite
    expect(lead).not.toMatch(/isn't|rather than|, not /);
    unmount();
  });
});
