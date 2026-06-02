import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/case-study.css';
import { createShell, type Route, type ScreenFactory } from './ui/shell';
import { createStorage } from './state/storage';
import { hero } from './ui/hero';
import { setup } from './ui/setup';
import { gate } from './ui/gate';
import { sessionView } from './ui/session-view';
import { result } from './ui/result';
import { caseStudy } from './ui/case-study/case-study';
import { optionsStub } from './ui/stubs';

const appEl = document.querySelector<HTMLDivElement>('#app');
if (!appEl) throw new Error('#app element missing');
const app: HTMLDivElement = appEl;

async function boot(): Promise<void> {
  if (window.location.hash === '#arena') {
    const { mountArenaHarness } = await import('./dev/arena-harness');
    mountArenaHarness(app);
    return;
  }
  const screens: Record<Route, ScreenFactory> = {
    hero, setup, gate, session: sessionView, result,
    'case-study': caseStudy, options: optionsStub,
  };
  createShell(app, { storage: createStorage(), screens }).start();
}

void boot();
