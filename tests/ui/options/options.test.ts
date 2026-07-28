// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { counts360, countsBounds } from '../../../src/types';
import { options } from '../../../src/ui/options/options';
import type { AppContext } from '../../../src/ui/shell';
import type { PersistedPrefs, Result, Storage } from '../../../src/types';

function storage(prefs: PersistedPrefs | null): Storage & { saved: PersistedPrefs[] } {
  const saved: PersistedPrefs[] = [];
  let current = prefs;
  return {
    saved,
    saveSession() {}, loadSessions() { return []; },
    saveResult() {}, exportJson() { return ''; },
    savePrefs(p) { saved.push(p); current = p; },
    loadPrefs() { return current; },
  };
}

const PREFS: PersistedPrefs = {
  currentGame: 'cs2', currentSens: 1, speedAccuracy: 0.5, bounds: countsBounds(4800, 19200),
};

function ctx(store: Storage = storage(null)): AppContext {
  return {
    navigate: vi.fn(), route: 'options', storage: store,
    draft: { currentGame: 'cs2', currentSens: 1,
      profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
      bounds: countsBounds(4800, 19200) },
  };
}

function mount(c: AppContext): { host: HTMLElement; screen: ReturnType<typeof options> } {
  const host = document.createElement('div');
  const screen = options(host, c);
  screen.mount();
  return { host, screen };
}

describe('options screen', () => {
  it('renders the three panels and a reference row for every game', () => {
    const { host, screen } = mount(ctx());
    expect(host.querySelector('[data-panel="bounds"]')).not.toBeNull();
    expect(host.querySelector('[data-panel="games"]')).not.toBeNull();
    expect(host.querySelector('[data-panel="fov"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-yaw-row]').length).toBe(8);
    screen.unmount();
  });

  // The screen shipped a yaw input and a conversion-school select that no consumer ever
  // read. This is the guard against either coming back as a control that changes nothing.
  it('exposes no control that writes nowhere: the game table is read only and the school select is gone', () => {
    const { host, screen } = mount(ctx());
    expect(host.querySelector('[data-yaw]')).toBeNull();
    expect(host.querySelector('[data-school]')).toBeNull();
    expect(host.querySelectorAll('[data-panel="games"] input, [data-panel="games"] select').length).toBe(0);
    screen.unmount();
  });

  it('typing previews the window but commits nothing until apply is pressed', () => {
    const c = ctx();
    const { host, screen } = mount(c);
    const lo = host.querySelector<HTMLInputElement>('[data-bound="lo"]')!;
    const hi = host.querySelector<HTMLInputElement>('[data-bound="hi"]')!;
    lo.value = '12000'; hi.value = '6000';
    lo.dispatchEvent(new Event('input', { bubbles: true }));

    expect(c.draft.bounds).toEqual([4800, 19200]);                                     // draft untouched
    expect(host.querySelector('[data-bounds-out]')!.textContent).toBe('6000 to 12000'); // preview normalized

    host.querySelector<HTMLButtonElement>('[data-action="apply-bounds"]')!.click();
    expect(c.draft.bounds).toEqual([6000, 12000]);
    expect(lo.value).toBe('6000');  // inputs snap to the normalized window
    expect(hi.value).toBe('12000');
    screen.unmount();
  });

  it('applying saves the window through the prefs seam, so it survives a reload', () => {
    const store = storage(PREFS);
    const c = ctx(store);
    const { host, screen } = mount(c);
    host.querySelector<HTMLInputElement>('[data-bound="lo"]')!.value = '7000';
    host.querySelector<HTMLInputElement>('[data-bound="hi"]')!.value = '14000';
    host.querySelector<HTMLButtonElement>('[data-action="apply-bounds"]')!.click();

    expect(store.saved.at(-1)!.bounds).toEqual([7000, 14000]);
    expect(store.loadPrefs!()!.bounds).toEqual([7000, 14000]);
    screen.unmount();
  });

  // Setup reads "prefs exist" as "this visitor has calibrated". Saving from here before a
  // calibration would fabricate one, and send them into the hunt on a made-up DPI.
  it('does NOT write prefs when no calibration exists', () => {
    const store = storage(null);
    const c = ctx(store);
    const { host, screen } = mount(c);
    host.querySelector<HTMLButtonElement>('[data-action="apply-bounds"]')!.click();

    expect(store.saved).toHaveLength(0);
    expect(store.loadPrefs!()).toBeNull();
    expect(c.draft.bounds).toEqual([4800, 19200]);                 // still applied to this visit
    screen.unmount();
  });

  // An uncalibrated visitor's only route into a run is the sweep and the spin (or typed
  // numbers), and setup.ts sets draft.bounds from what it measures on both of those paths.
  // So the window they just applied is overwritten before the optimizer ever searches it.
  // The old message said "Applied for this visit", which promised exactly the thing that
  // does not happen. It has to name the calibration, and it must not imply a save.
  it('an uncalibrated visitor is told the calibration will replace the window, not that it is kept', () => {
    const { host, screen } = mount(ctx(storage(null)));
    host.querySelector<HTMLButtonElement>('[data-action="apply-bounds"]')!.click();
    const said = host.querySelector('[data-bounds-status]')!.textContent!;

    expect(said).toContain('4800 to 19200');
    expect(said.toLowerCase()).toContain('calibration');
    expect(said.toLowerCase()).toContain('replace');
    expect(said).not.toMatch(/^Saved/);           // nothing was written
    expect(said).not.toContain('for this visit'); // and it does not last the visit either
    screen.unmount();
  });

  // The mirror case. Prefs exist, so the write lands and the claim of a save is true.
  it('a calibrated visitor is told it is saved, and it is', () => {
    const store = storage(PREFS);
    const { host, screen } = mount(ctx(store));
    host.querySelector<HTMLInputElement>('[data-bound="hi"]')!.value = '14400';
    host.querySelector<HTMLButtonElement>('[data-action="apply-bounds"]')!.click();

    expect(host.querySelector('[data-bounds-status]')!.textContent).toBe('Saved. I search 4800 to 14400 counts per 360.');
    expect(store.loadPrefs!()!.bounds).toEqual([4800, 14400]);
    screen.unmount();
  });

  it('announces what apply did through a live region', () => {
    const c = ctx(storage(PREFS));
    const { host, screen } = mount(c);
    const status = host.querySelector('[data-bounds-status]')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');

    host.querySelector<HTMLInputElement>('[data-bound="hi"]')!.value = '14400';
    host.querySelector<HTMLButtonElement>('[data-action="apply-bounds"]')!.click();
    expect(status.textContent).toContain('4800 to 14400');
    screen.unmount();
  });

  it('the window midpoint follows the applied window, and no row emits a sensitivity', () => {
    // A sensitivity column here would emit a native in-game number from browser counts with the
    // convention factor assumed to be 1, which nothing on this screen measures. The yaw rows stay
    // (they are reference constants); the midpoint readout is what tracks the applied window.
    const c = ctx(storage(PREFS));
    const { host, screen } = mount(c);
    const before = host.querySelector('[data-mid-sub]')!.textContent;
    host.querySelector<HTMLInputElement>('[data-bound="lo"]')!.value = '20000';
    host.querySelector<HTMLInputElement>('[data-bound="hi"]')!.value = '30000';
    host.querySelector<HTMLButtonElement>('[data-action="apply-bounds"]')!.click();
    expect(host.querySelector('[data-mid-sub]')!.textContent).not.toBe(before);
    expect(host.querySelectorAll('[data-yaw-row]').length).toBe(8);
    expect(host.querySelector('[data-sens]')).toBeNull();
    screen.unmount();
  });

  it('the FOV converter computes on load and on every edit', () => {
    const c = ctx();
    const { host, screen } = mount(c);
    const out = host.querySelector('[data-fov-out]')!;
    expect(out.textContent).not.toBe('-');           // computed at mount, not left empty
    const first = out.textContent;
    const target = host.querySelector<HTMLInputElement>('[data-fov="target"]')!;
    target.value = '120';
    target.dispatchEvent(new Event('input', { bubbles: true }));
    expect(out.textContent).not.toBe(first);         // a wider target FOV needs a smaller count total
    expect(Number(out.textContent)).toBeLessThan(Number(first));
    screen.unmount();
  });

  it('the converter starts from the measured number when there is one', () => {
    const c = ctx();
    c.lastResult = { sessionId: 's1', result: { optimalCounts: counts360(8240) } as Result };
    const { host, screen } = mount(c);
    expect(host.querySelector<HTMLInputElement>('[data-fov="from"]')!.value).toBe('8240');
    screen.unmount();
  });

  it('back navigates to the hero', () => {
    const c = ctx();
    const { host, screen } = mount(c);
    const back = host.querySelector<HTMLButtonElement>('[data-action="back"]')!;
    expect(back.textContent).toContain('Back to the start');
    back.click();
    expect(c.navigate).toHaveBeenCalledWith('hero');
    screen.unmount();
  });
});
