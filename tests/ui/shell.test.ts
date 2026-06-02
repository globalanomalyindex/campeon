// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createShell, type Screen, type AppContext } from '../../src/ui/shell';

const recordingScreen = (log: string[], name: string) => (host: HTMLElement, _ctx: AppContext): Screen => ({
  mount() { host.innerHTML = `<div data-screen="${name}">${name}</div>`; log.push(`mount:${name}`); },
  unmount() { log.push(`unmount:${name}`); },
});

describe('shell router', () => {
  beforeEach(() => { location.hash = ''; document.body.innerHTML = '<div id="app"></div>'; });

  it('mounts the default (hero) screen on start', () => {
    const log: string[] = [];
    const root = document.getElementById('app')!;
    const shell = createShell(root, {
      screens: { hero: recordingScreen(log, 'hero'), setup: recordingScreen(log, 'setup') } as never,
    });
    shell.start();
    expect(root.querySelector('[data-screen="hero"]')).not.toBeNull();
    expect(log).toContain('mount:hero');
  });

  it('navigate unmounts the old screen and mounts the new one', () => {
    const log: string[] = [];
    const root = document.getElementById('app')!;
    const shell = createShell(root, {
      screens: { hero: recordingScreen(log, 'hero'), setup: recordingScreen(log, 'setup') } as never,
    });
    shell.start();
    shell.context.navigate('setup');
    expect(root.querySelector('[data-screen="setup"]')).not.toBeNull();
    expect(log).toEqual(['mount:hero', 'unmount:hero', 'mount:setup']);
  });

  it('exposes a mutable draft with sensible defaults', () => {
    const root = document.getElementById('app')!;
    const shell = createShell(root, { screens: { hero: recordingScreen([], 'hero') } as never });
    shell.start();
    expect(shell.context.draft.dpi).toBeGreaterThan(0);
    expect(shell.context.draft.bounds[0]).toBeLessThan(shell.context.draft.bounds[1]);
    expect(shell.context.draft.profile.speedAccuracy).toBeGreaterThanOrEqual(0);
  });
});
