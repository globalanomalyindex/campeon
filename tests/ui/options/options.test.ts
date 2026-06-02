// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { options } from '../../../src/ui/options/options';
import type { AppContext } from '../../../src/ui/shell';

function ctx(): AppContext {
  return {
    navigate: vi.fn(), route: 'options', storage: {} as never,
    draft: { dpi: 800, currentGame: 'cs2', currentSens: 1,
      profile: { speedAccuracy: 0.5, instrumentWeights: { track: 1, flick: 1, calibrate: 1, strike: 1 } },
      bounds: [15, 60] },
  };
}

describe('options screen', () => {
  it('renders the three panels and a per-game row for every game', () => {
    const host = document.createElement('div');
    const c = ctx();
    const screen = options(host, c); screen.mount();
    expect(host.querySelector('[data-panel="school"]')).not.toBeNull();
    expect(host.querySelector('[data-panel="games"]')).not.toBeNull();
    expect(host.querySelector('[data-panel="bounds"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-yaw-row]').length).toBe(8);
    screen.unmount();
  });
  it('editing the search bounds writes normalized bounds to the draft', () => {
    const host = document.createElement('div');
    const c = ctx();
    const screen = options(host, c); screen.mount();
    const lo = host.querySelector<HTMLInputElement>('[data-bound="lo"]')!;
    const hi = host.querySelector<HTMLInputElement>('[data-bound="hi"]')!;
    lo.value = '40'; hi.value = '20';
    lo.dispatchEvent(new Event('input', { bubbles: true }));
    hi.dispatchEvent(new Event('input', { bubbles: true }));
    expect(c.draft.bounds).toEqual([20, 40]);
    screen.unmount();
  });
  it('selecting the monitor-distance school reveals the (initially hidden) FOV inputs', () => {
    const host = document.createElement('div');
    const screen = options(host, ctx()); screen.mount();
    const block = host.querySelector<HTMLElement>('[data-fov-block]')!;
    expect(block.hidden).toBe(true); // 360-distance default → FOV block hidden
    const sel = host.querySelector<HTMLSelectElement>('[data-school]')!;
    sel.value = 'monitor';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(block.hidden).toBe(false); // load-bearing: fails if the reveal toggle is removed
    expect(host.querySelector('[data-fov="source"]')).not.toBeNull();
    expect(host.querySelector('[data-fov="target"]')).not.toBeNull();
    screen.unmount();
  });
  it('back navigates to the hero', () => {
    const host = document.createElement('div');
    const c = ctx();
    const screen = options(host, c); screen.mount();
    host.querySelector<HTMLButtonElement>('[data-action="back"]')!.click();
    expect(c.navigate).toHaveBeenCalledWith('hero');
    screen.unmount();
  });
});
