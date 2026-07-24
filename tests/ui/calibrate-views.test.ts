// @vitest-environment jsdom
// The sweep and the spin are runtime-verified shells, but two things about them are structural and
// cheap to hold here: every step must expose real focusable controls (they used to expose none, so a
// keyboard visitor who entered the guided flow could not leave), and the instruction line that IS the
// interface must be a live region (it is rewritten on every phase change, silently before this).
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createSweepView } from '../../src/ui/calibrate/sweep-view';
import { createSpinView } from '../../src/ui/calibrate/spin-view';

// jsdom has no 2d context and logs a "not implemented" error for every getContext call. Both views
// already guard a null context (they skip drawing), so return it quietly and keep the run readable.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement['getContext'];
});

function sweepOpts(over: Partial<Parameters<typeof createSweepView>[1]> = {}): Parameters<typeof createSweepView>[1] {
  return { referenceWidthCm: 8.56, reducedMotion: false, onResult: () => {}, onInvalid: () => {},
    onLockFailed: () => {}, onManual: () => {}, onBack: () => {}, ...over };
}
function spinOpts(over: Partial<Parameters<typeof createSpinView>[1]> = {}): Parameters<typeof createSpinView>[1] {
  return { dpi: 800, reducedMotion: false, onSeed: () => {}, onManual: () => {}, onBack: () => {}, ...over };
}

describe.each([
  ['sweep', 'sweep', (host: HTMLElement) => createSweepView(host, sweepOpts())],
  ['spin', 'spin', (host: HTMLElement) => createSpinView(host, spinOpts())],
])('%s view: a way out and a spoken instruction', (_name, key, mount) => {
  it('renders real focusable buttons for back and for the typed fallback', () => {
    const host = document.createElement('div');
    const view = mount(host);
    for (const control of ['back', 'manual']) {
      const el = host.querySelector(`[data-${key}="${control}"]`) as HTMLButtonElement | null;
      expect(el, `${control} control`).toBeTruthy();
      expect(el!.tagName).toBe('BUTTON');
      expect(el!.hasAttribute('disabled')).toBe(false);
      expect(el!.textContent!.trim().length).toBeGreaterThan(0); // a real accessible name
    }
    view.dispose();
  });

  it('marks the instruction line as a polite live region', () => {
    const host = document.createElement('div');
    const view = mount(host);
    const lead = host.querySelector(`[data-${key}="lead"]`)!;
    expect(lead.getAttribute('aria-live')).toBe('polite');
    expect(lead.getAttribute('aria-atomic')).toBe('true');
    view.dispose();
  });
});

describe('sweep view: the exits are wired', () => {
  it('back and manual each call their handler', () => {
    const onBack = vi.fn(), onManual = vi.fn();
    const host = document.createElement('div');
    const view = createSweepView(host, sweepOpts({ onBack, onManual }));
    (host.querySelector('[data-sweep="back"]') as HTMLButtonElement).click();
    (host.querySelector('[data-sweep="manual"]') as HTMLButtonElement).click();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onManual).toHaveBeenCalledTimes(1);
    view.dispose();
  });

  it('keeps the per-sample pace verdict out of the live region', () => {
    const host = document.createElement('div');
    const view = createSweepView(host, sweepOpts());
    // It rewrites on every pointer sample; announcing it would drown the step instruction.
    expect(host.querySelector('[data-sweep="pacelabel"]')!.getAttribute('aria-hidden')).toBe('true');
    view.dispose();
  });

  it('promises only the stop it actually performs (Esc resets the pass, it does not end the step)', () => {
    const host = document.createElement('div');
    const view = createSweepView(host, sweepOpts());
    const sub = host.querySelector('[data-sweep="sub"]')!.textContent!.toLowerCase();
    expect(sub).toContain('esc');
    expect(sub).toContain('starts over');
    view.dispose();
  });
});

describe('spin view: the exits are wired', () => {
  it('back and manual each call their handler', () => {
    const onBack = vi.fn(), onManual = vi.fn();
    const host = document.createElement('div');
    const view = createSpinView(host, spinOpts({ onBack, onManual }));
    (host.querySelector('[data-spin="back"]') as HTMLButtonElement).click();
    (host.querySelector('[data-spin="manual"]') as HTMLButtonElement).click();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onManual).toHaveBeenCalledTimes(1);
    view.dispose();
  });
});

describe('both views speak in the first person singular', () => {
  it('carries no institutional "we"', () => {
    const host = document.createElement('div');
    const sweep = createSweepView(host, sweepOpts());
    expect(host.textContent!).not.toMatch(/\bwe\b|\bwe'll\b|\bus\b/i);
    sweep.dispose();
    const host2 = document.createElement('div');
    const spin = createSpinView(host2, spinOpts());
    expect(host2.textContent!).not.toMatch(/\bwe\b|\bwe'll\b|\bus\b/i);
    spin.dispose();
  });
});
