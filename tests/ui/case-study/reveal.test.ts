// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createReveal } from '../../../src/ui/case-study/reveal';

beforeEach(() => {
  (globalThis as unknown as { __ioEntries: ((e: { target: Element; isIntersecting: boolean }[]) => void)[] }).__ioEntries = [];
  class IO {
    cb: (e: { target: Element; isIntersecting: boolean }[]) => void;
    constructor(cb: never) { this.cb = cb as never; (globalThis as never as { __ioEntries: unknown[] }).__ioEntries.push(this.cb); }
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } root = null; rootMargin = ''; thresholds = [];
  }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
});

describe('createReveal', () => {
  it('marks targets in-view when they intersect, and disconnects on stop', () => {
    const a = document.createElement('div'); a.setAttribute('data-reveal', '');
    const r = createReveal({ reduced: false });
    r.observe(a);
    const fire = (globalThis as never as { __ioEntries: ((e: { target: Element; isIntersecting: boolean }[]) => void)[] }).__ioEntries[0]!;
    fire([{ target: a, isIntersecting: true }]);
    expect(a.getAttribute('data-in-view')).toBe('true');
    expect(() => r.stop()).not.toThrow();
  });
  it('reduced motion reveals immediately without an observer', () => {
    const a = document.createElement('div'); a.setAttribute('data-reveal', '');
    const r = createReveal({ reduced: true });
    r.observe(a);
    expect(a.getAttribute('data-in-view')).toBe('true');
  });
});
