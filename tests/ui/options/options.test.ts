// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
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
  dpi: 800, currentGame: 'cs2', currentSens: 1, speedAccuracy: 0.5, bounds: [15, 60],
};

function ctx(store: Storage = storage(null)): AppContext {
  return {
    navigate: vi.fn(), route: 'options', storage: store,
    draft: { dpi: 800, currentGame: 'cs2', currentSens: 1,
      profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
      bounds: [15, 60] },
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
    lo.value = '40'; hi.value = '20';
    lo.dispatchEvent(new Event('input', { bubbles: true }));

    expect(c.draft.bounds).toEqual([15, 60]);                                  // draft untouched
    expect(host.querySelector('[data-bounds-out]')!.textContent).toBe('20 to 40'); // preview normalized

    host.querySelector<HTMLButtonElement>('[data-action="apply-bounds"]')!.click();
    expect(c.draft.bounds).toEqual([20, 40]);
    expect(lo.value).toBe('20');  // inputs snap to the normalized window
    expect(hi.value).toBe('40');
    screen.unmount();
  });

  it('applying saves the window through the prefs seam, so it survives a reload', () => {
    const store = storage(PREFS);
    const c = ctx(store);
    const { host, screen } = mount(c);
    host.querySelector<HTMLInputElement>('[data-bound="lo"]')!.value = '22';
    host.querySelector<HTMLInputElement>('[data-bound="hi"]')!.value = '44';
    host.querySelector<HTMLButtonElement>('[data-action="apply-bounds"]')!.click();

    expect(store.saved.at(-1)!.bounds).toEqual([22, 44]);
    expect(store.loadPrefs!()!.bounds).toEqual([22, 44]);
    screen.unmount();
  });

  // Setup reads "prefs exist" as "this visitor has calibrated". Saving from here before a
  // calibration would fabricate one, and send them into the hunt on a made-up DPI.
  it('does NOT write prefs when no calibration exists, and says so', () => {
    const store = storage(null);
    const c = ctx(store);
    const { host, screen } = mount(c);
    host.querySelector<HTMLButtonElement>('[data-action="apply-bounds"]')!.click();

    expect(store.saved).toHaveLength(0);
    expect(store.loadPrefs!()).toBeNull();
    expect(c.draft.bounds).toEqual([15, 60]);                     // still applied to this visit
    expect(host.querySelector('[data-bounds-status]')!.textContent).toContain('once you calibrate');
    screen.unmount();
  });

  it('announces what apply did through a live region', () => {
    const c = ctx(storage(PREFS));
    const { host, screen } = mount(c);
    const status = host.querySelector('[data-bounds-status]')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');

    host.querySelector<HTMLInputElement>('[data-bound="hi"]')!.value = '45';
    host.querySelector<HTMLButtonElement>('[data-action="apply-bounds"]')!.click();
    expect(status.textContent).toContain('15 to 45');
    screen.unmount();
  });

  it('the game table follows the applied window', () => {
    const c = ctx(storage(PREFS));
    const { host, screen } = mount(c);
    const before = host.querySelector('[data-sens="cs2"]')!.textContent;
    host.querySelector<HTMLInputElement>('[data-bound="lo"]')!.value = '80';
    host.querySelector<HTMLInputElement>('[data-bound="hi"]')!.value = '120';
    host.querySelector<HTMLButtonElement>('[data-action="apply-bounds"]')!.click();
    expect(host.querySelector('[data-sens="cs2"]')!.textContent).not.toBe(before);
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
    expect(out.textContent).not.toBe(first);         // a wider target FOV needs a smaller cm/360
    expect(Number(out.textContent)).toBeLessThan(Number(first));
    screen.unmount();
  });

  it('the converter starts from the measured number when there is one', () => {
    const c = ctx();
    c.lastResult = { sessionId: 's1', result: { optimalCm360: 32.4 } as Result };
    const { host, screen } = mount(c);
    expect(host.querySelector<HTMLInputElement>('[data-fov="from"]')!.value).toBe('32.4');
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
