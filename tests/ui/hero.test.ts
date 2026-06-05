// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
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

describe('hero', () => {
  beforeEach(() => { try { sessionStorage.clear(); } catch { /* ignore */ } });

  it('renders the wordmark (ó eye), the start action, and the byline in the menu', () => {
    const host = document.createElement('div');
    hero(host, fakeCtx()).mount();
    expect(host.textContent).toContain('campe');
    expect(host.querySelector('.hero__eye')?.textContent).toBe('ó');
    expect(host.querySelector('[data-action="start"]')).not.toBeNull();
    expect(host.querySelector('.hero__byline')?.textContent).toContain('christopher robin fiore');
  });

  it('plays the cinematic intro: a line stack, the red "el campeón" title, and a skip control', () => {
    const host = document.createElement('div');
    hero(host, fakeCtx()).mount();
    expect(host.querySelectorAll('.intro__line').length).toBeGreaterThanOrEqual(2);
    expect(host.querySelector('.intro__title')?.textContent).toContain('el campeón');
    expect(host.querySelector('[data-skip]')).not.toBeNull();
  });

  it('skip jumps straight to the resolved menu', () => {
    const host = document.createElement('div');
    hero(host, fakeCtx()).mount();
    (host.querySelector('[data-skip]') as HTMLButtonElement).click();
    expect(host.querySelector('.hero__menu')?.classList.contains('is-on')).toBe(true);
    expect(host.querySelector('[data-intro]')).toBeNull();
  });

  it('+ start navigates to setup; the nav routes to case-study and options', () => {
    const ctx = fakeCtx();
    const host = document.createElement('div');
    hero(host, ctx).mount();
    (host.querySelector('[data-action="start"]') as HTMLButtonElement).click();
    (host.querySelector('[data-action="case-study"]') as HTMLButtonElement).click();
    (host.querySelector('[data-action="options"]') as HTMLButtonElement).click();
    expect(ctx.nav).toEqual(expect.arrayContaining(['setup', 'case-study', 'options']));
  });

  it('a returning visitor (intro already seen this session) goes straight to the menu', () => {
    try { sessionStorage.setItem('campeon-intro-seen', '1'); } catch { /* ignore */ }
    const host = document.createElement('div');
    hero(host, fakeCtx()).mount();
    expect(host.querySelector('[data-intro]')).toBeNull();
    expect(host.querySelector('.hero__menu')?.classList.contains('is-on')).toBe(true);
  });

  it('tears down cleanly on unmount', () => {
    const host = document.createElement('div');
    const screen = hero(host, fakeCtx());
    screen.mount();
    screen.unmount();
    expect(host.children.length).toBe(0);
  });
});
