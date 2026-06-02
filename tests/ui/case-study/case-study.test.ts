// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { caseStudy } from '../../../src/ui/case-study/case-study';
import type { AppContext } from '../../../src/ui/shell';

beforeEach(() => {
  class IO { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } root = null; rootMargin = ''; thresholds = []; }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
});

function ctx(navigate = vi.fn()): AppContext {
  return { navigate, route: 'case-study', storage: {} as never, draft: {} as never };
}

describe('caseStudy screen', () => {
  it('mounts the lowercase article with all eight sections and the citations', () => {
    const host = document.createElement('div');
    const screen = caseStudy(host, ctx());
    screen.mount();
    expect(host.querySelector('.case')).not.toBeNull();
    expect(host.querySelectorAll('.cs-section').length).toBe(8);
    expect(host.querySelectorAll('.cs-refs li').length).toBeGreaterThanOrEqual(8);
    screen.unmount();
  });
  it('renders the convergence demo: four organism mark-sets + curve + peak', () => {
    const host = document.createElement('div');
    const screen = caseStudy(host, ctx());
    screen.mount();
    const marks = host.querySelectorAll('.cs-figure [data-mark]');
    expect(marks.length).toBeGreaterThan(0);
    expect(new Set([...marks].map((m) => m.getAttribute('data-mark'))))
      .toEqual(new Set(['track', 'flick', 'calibrate', 'strike']));
    expect(host.querySelector('.cs-figure [data-curve]')).not.toBeNull();
    expect(host.querySelector('.cs-figure [data-peak]')).not.toBeNull();
    screen.unmount();
  });
  it('back action navigates to the hero', () => {
    const host = document.createElement('div');
    const navigate = vi.fn();
    const screen = caseStudy(host, ctx(navigate));
    screen.mount();
    host.querySelector<HTMLButtonElement>('[data-action="back"]')!.click();
    expect(navigate).toHaveBeenCalledWith('hero');
    screen.unmount();
  });
  it('unmount clears the host', () => {
    const host = document.createElement('div');
    const screen = caseStudy(host, ctx());
    screen.mount();
    screen.unmount();
    expect(host.children.length).toBe(0);
  });
});
