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

describe('hero', () => {
  it('renders the wordmark with the ó as the eye and a + start action', () => {
    const ctx = fakeCtx();
    const host = document.createElement('div');
    hero(host, ctx).mount();
    expect(host.textContent).toContain('campe');
    expect(host.querySelector('[data-eye]')?.textContent).toBe('ó');
    expect(host.querySelector('[data-action="start"]')).not.toBeNull();
  });

  it('+ start navigates to setup', () => {
    const ctx = fakeCtx();
    const host = document.createElement('div');
    hero(host, ctx).mount();
    (host.querySelector('[data-action="start"]') as HTMLButtonElement).click();
    expect(ctx.nav).toContain('setup');
  });

  it('secondary nav routes to case-study and options', () => {
    const ctx = fakeCtx();
    const host = document.createElement('div');
    hero(host, ctx).mount();
    (host.querySelector('[data-action="case-study"]') as HTMLButtonElement).click();
    (host.querySelector('[data-action="options"]') as HTMLButtonElement).click();
    expect(ctx.nav).toEqual(expect.arrayContaining(['case-study', 'options']));
  });
});
