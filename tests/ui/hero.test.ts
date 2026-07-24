// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { hero } from '../../src/ui/hero';
import type { AppContext, Route } from '../../src/ui/shell';

function fakeCtx(): AppContext & { nav: Route[] } {
  const nav: Route[] = [];
  return {
    nav, route: 'hero',
    navigate(r: Route) { nav.push(r); },
    storage: { saveSession() {}, loadSessions: () => [], saveResult() {}, exportJson: () => '' },
    draft: {} as never,
  } as AppContext & { nav: Route[] };
}

const mounted = (): HTMLElement => {
  const host = document.createElement('div');
  hero(host, fakeCtx()).mount();
  return host;
};

describe('hero: the specimen card', () => {
  it('renders the wordmark with the accented eye', () => {
    const host = mounted();
    expect(host.textContent).toContain('campe');
    expect(host.querySelector('.hero__eye')?.textContent).toBe('ó');
  });

  it('puts the primary action on screen immediately, with no timed gate to sit through', () => {
    const host = mounted();
    // The old build hid the menu behind a ~14s title sequence. Nothing may gate the
    // start action now: no intro overlay, no skip control, no seen-this-session flag.
    expect(host.querySelector('[data-action="start"]')).not.toBeNull();
    expect(host.querySelector('[data-intro]')).toBeNull();
    expect(host.querySelector('[data-skip]')).toBeNull();
    expect(host.querySelector('.intro__line')).toBeNull();
  });

  it('lays the four instruments out as a drawer, each with a catalogue number and a mineral dot', () => {
    const host = mounted();
    const cells = host.querySelectorAll('.hero__cell');
    expect(cells).toHaveLength(4);
    for (const id of ['track', 'flick', 'calibrate', 'strike']) {
      const cellEl = host.querySelector(`[data-instrument="${id}"]`);
      expect(cellEl, `${id} cell`).not.toBeNull();
      expect(cellEl!.querySelector(`.dot--${id}`), `${id} dot`).not.toBeNull();
    }
    const numbers = [...host.querySelectorAll('.tag__no')].map((n) => n.textContent);
    expect(numbers).toEqual(['No. 01', 'No. 02', 'No. 03', 'No. 04']);
  });

  it('names every environment and the organisms it was drawn from', () => {
    const text = mounted().textContent ?? '';
    for (const s of ['The open-air intercept', 'The ambush', 'Shooting through the bend', 'The strike window']) {
      expect(text).toContain(s);
    }
    for (const o of ['dragonfly', 'falcon', 'spider', 'raptor', 'archerfish', 'mantis shrimp']) {
      expect(text).toContain(o);
    }
  });

  it('routes start to setup, and the nav to the case study and options', () => {
    const ctx = fakeCtx();
    const host = document.createElement('div');
    hero(host, ctx).mount();
    (host.querySelector('[data-action="start"]') as HTMLButtonElement).click();
    (host.querySelector('[data-action="case-study"]') as HTMLButtonElement).click();
    (host.querySelector('[data-action="options"]') as HTMLButtonElement).click();
    expect(ctx.nav).toEqual(['setup', 'case-study', 'options']);
  });

  it('writes in the brand voice: first person, no em dash, no hype', () => {
    const text = mounted().textContent ?? '';
    expect(text).toContain('I built this');
    expect(text).not.toMatch(/[—–]/);
    expect(text).not.toMatch(/stunning|unlock|next-level|revolutionary|seamless|effortless/i);
  });

  it('unmounts cleanly', () => {
    const host = document.createElement('div');
    const screen = hero(host, fakeCtx());
    screen.mount();
    screen.unmount?.();
    expect(host.childElementCount).toBe(0);
  });
});
