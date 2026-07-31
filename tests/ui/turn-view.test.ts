// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  createTurnView, fourthOfferLead, initialTurnMachine, turnTap, turnDirection,
  MIN_PASS_COUNTS, NATURAL_PASSES, type TurnMachine,
} from '../../src/ui/calibrate/turn-view';

type TurnOpts = Parameters<typeof createTurnView>[1];

function mountTurn(over: Partial<TurnOpts> = {}): { host: HTMLElement; view: { dispose(): void } } {
  const host = document.createElement('div');
  const view = createTurnView(host, {
    onTurn: () => {}, onBlocked: () => {}, onManual: () => {}, onBack: () => {}, ...over,
  });
  return { host, view };
}

/** One entry per completed pass: the first tap arms recording, the second finishes it at `c`. */
function runPasses(m: TurnMachine, passCounts: number[], mode: 'raw' | 'os-adjusted'): TurnMachine {
  let s = m;
  for (const c of passCounts) {
    s = turnTap(s, 0, mode); // arm: counts are ignored on a non-recording tap
    s = turnTap(s, c, mode); // finish
  }
  return s;
}

describe('turn machine: the pass loop', () => {
  it('starts idle with no passes and no verdict', () => {
    expect(initialTurnMachine()).toEqual({ phase: 'idle', passes: [], estimate: null, blockReason: null });
  });

  it('alternates direction right-left-right-left, so asymmetry cancels instead of averaging in', () => {
    expect([0, 1, 2, 3].map(turnDirection)).toEqual(['right', 'left', 'right', 'left']);
  });

  it('an arming tap starts recording and commits nothing, whatever counts ride along', () => {
    const s = turnTap(initialTurnMachine(), 999999, 'raw');
    expect(s.phase).toBe('recording');
    expect(s.passes).toEqual([]);
  });

  it('a finishing tap below the floor is an accidental click: ignored, the pass stays live', () => {
    const recording = turnTap(initialTurnMachine(), 0, 'raw');
    const after = turnTap(recording, MIN_PASS_COUNTS - 1, 'raw');
    expect(after).toBe(recording); // identity, so the shell can detect the refusal and explain it
  });
});

describe('turn machine: verdicts', () => {
  it('three agreeing passes on raw input complete without a fast pass', () => {
    // Raw pointer input bypasses OS acceleration at the source; demanding a probe pass anyway
    // would be theater.
    const s = runPasses(initialTurnMachine(), [8000, 8100, 8050], 'raw');
    expect(s.phase).toBe('done');
    expect(s.estimate!.agreed).toBe(true);
    expect(s.estimate!.passes).toBe(NATURAL_PASSES);
    const geo = Math.exp((Math.log(8000) + Math.log(8100) + Math.log(8050)) / 3);
    expect(s.estimate!.counts).toBeCloseTo(geo, 6);
  });

  it('three agreeing passes on os-adjusted input demand the deliberately fast pass', () => {
    const s = runPasses(initialTurnMachine(), [8000, 8100, 8050], 'os-adjusted');
    expect(s.phase).toBe('fast-idle');
  });

  it('an honest fast pass completes; the estimate stays the natural passes own, untouched', () => {
    let s = runPasses(initialTurnMachine(), [8000, 8100, 8050], 'os-adjusted');
    const before = s.estimate!.counts;
    s = turnTap(s, 0, 'os-adjusted');       // arm the fast pass
    s = turnTap(s, 8020, 'os-adjusted');    // same full turn, just faster: totals match
    expect(s.phase).toBe('done');
    expect(s.estimate!.counts).toBe(before); // the probe verifies, it never shades the number
  });

  it('an accelerated fast pass blocks rather than shading the number', () => {
    let s = runPasses(initialTurnMachine(), [8000, 8100, 8050], 'os-adjusted');
    s = turnTap(s, 0, 'os-adjusted');
    s = turnTap(s, 12000, 'os-adjusted'); // ~1.5x the slow total: OS accel inflated the fast turn
    expect(s.phase).toBe('blocked');
    expect(s.blockReason).toBe('accel');
  });

  it('three disagreeing passes offer a fourth rather than failing or averaging', () => {
    const s = runPasses(initialTurnMachine(), [8000, 8000, 10000], 'raw');
    expect(s.phase).toBe('fourth-offer');
    expect(s.estimate!.agreed).toBe(false);
  });

  it('the fourth pass isolates the odd one out and completes', () => {
    let s = runPasses(initialTurnMachine(), [8000, 8000, 10000], 'raw');
    s = turnTap(s, 0, 'raw');    // accept the offer
    s = turnTap(s, 8050, 'raw'); // the fourth agrees with the first two
    expect(s.phase).toBe('done');
    expect(s.estimate!.passes).toBe(3); // turnFromPasses dropped the outlier
  });

  it('a fourth pass that still cannot settle blocks with the spread reason', () => {
    let s = runPasses(initialTurnMachine(), [8000, 9500, 11000], 'raw');
    expect(s.phase).toBe('fourth-offer');
    s = turnTap(s, 0, 'raw');
    s = turnTap(s, 6500, 'raw');
    expect(s.phase).toBe('blocked');
    expect(s.blockReason).toBe('spread');
  });

  it('done and blocked absorb further taps: nothing after the verdict moves the number', () => {
    const done = runPasses(initialTurnMachine(), [8000, 8100, 8050], 'raw');
    expect(turnTap(done, 5000, 'raw')).toBe(done);
  });
});

describe('turn view: blind means blind', () => {
  it('draws a live trace, and no dial, degree readout or percentage', () => {
    // The canvas is back, but it is not the spin's dial: it draws the clock and instantaneous
    // speed, a geometry tests/ui/turn-trace.test.ts pins as unable to encode the path length.
    const { host, view } = mountTurn();
    expect(host.querySelector('canvas.calibrate__trace')).toBeTruthy();
    expect(host.textContent).not.toContain('°');
    expect(host.textContent).not.toContain('%');
    view.dispose();
  });

  it('shows which pass is up and a recording mark, and nothing that encodes progress', () => {
    const { host, view } = mountTurn();
    expect(host.querySelector('[data-turn="pass"]')!.textContent).toContain('Pass 1 of 3');
    expect(host.querySelector('[data-turn="rec"]')).toBeTruthy();
    view.dispose();
  });

  it('cues the direction of the pass, statically', () => {
    // The report this answers: nothing on the stage said which way the pass goes. The cue is
    // static chevrons plus a label; anything that moved would pace the turn it points at.
    const { host, view } = mountTurn();
    expect(host.querySelectorAll('.cal-dir__chevs i').length).toBe(3);
    expect(host.querySelector('[data-turn="dirlabel"]')!.textContent).toBe('to the right');
    view.dispose();
  });

  it('promises no facing anywhere in the copy: the screen cannot show one', async () => {
    // "End facing the way you started" asked the player to check a heading against a screen
    // with no way to draw one. The task is proprioceptive and the copy has to say so; checked
    // at the source because most phase copy renders only behind a pointer lock.
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('src/ui/calibrate/turn-view.ts', 'utf8');
    const copyLines = src.split('\n').filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'));
    expect(copyLines.join('\n')).not.toMatch(/facing/i);
  });

  it('says why it refuses to show progress: the blindness is the trust signal', () => {
    const { host, view } = mountTurn();
    const why = host.querySelector('[data-turn="why"]')!.textContent!;
    expect(why).toContain('on purpose');
    expect(why.toLowerCase()).toContain('not of your turn');
    view.dispose();
  });

  it('preserves the hold-to-reposition helper from the spin verbatim', () => {
    const { host, view } = mountTurn();
    expect(host.querySelector('.cal-helper')!.textContent)
      .toBe('Out of room? Hold the button, slide your mouse back, then let go.');
    view.dispose();
  });
});

describe('turn view: the fourth-pass offer names the measured spread', () => {
  it('renders the spread to one decimal, in tabular figures', () => {
    // Spec: "Afterwards it reports the spread honestly." The number is the honest part of the
    // sentence, so it is pinned here, mono per canon (every measured number gets tabular figures).
    const lead = fourthOfferLead(22.37, 'left');
    expect(lead).toContain('<span class="mono">22.4</span> percent apart');
    expect(lead).toContain('to the left');
  });
});

describe('turn view: a way out and a spoken instruction', () => {
  it('renders real focusable buttons for back and the typed fallback, and they are wired', () => {
    const onBack = vi.fn(); const onManual = vi.fn();
    const { host, view } = mountTurn({ onBack, onManual });
    for (const control of ['back', 'manual']) {
      const el = host.querySelector(`[data-turn="${control}"]`) as HTMLButtonElement | null;
      expect(el, `${control} control`).toBeTruthy();
      expect(el!.tagName).toBe('BUTTON');
      expect(el!.hasAttribute('disabled')).toBe(false);
      expect(el!.textContent!.trim().length).toBeGreaterThan(0); // a real accessible name
    }
    (host.querySelector('[data-turn="back"]') as HTMLButtonElement).click();
    (host.querySelector('[data-turn="manual"]') as HTMLButtonElement).click();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onManual).toHaveBeenCalledTimes(1);
    view.dispose();
  });

  it('marks the instruction line as a polite live region', () => {
    const { host, view } = mountTurn();
    const lead = host.querySelector('[data-turn="lead"]')!;
    expect(lead.getAttribute('aria-live')).toBe('polite');
    expect(lead.getAttribute('aria-atomic')).toBe('true');
    view.dispose();
  });

  it('renders exactly one h1 naming the step, sentence case, no revived "+" prefix', () => {
    const { host, view } = mountTurn();
    const h1s = host.querySelectorAll('h1');
    expect(h1s.length).toBe(1);
    expect(host.querySelector('h2')).toBeNull();
    const title = h1s[0]!.textContent!;
    expect(title.startsWith('+')).toBe(false);
    expect(title).toMatch(/^[A-Z]/);
    view.dispose();
  });
});

describe('turn view: voice', () => {
  it('first person singular: no institutional we, no lowercase standalone i', () => {
    const { host, view } = mountTurn();
    expect(host.textContent!).not.toMatch(/\bwe\b|\bwe'll\b|\bus\b/i);
    expect(host.textContent!).not.toMatch(/\bi\b/); // case-sensitive: a lowercase standalone i is the violation
    view.dispose();
  });

  it('keeps emphasis out of the caps in the copy strings', async () => {
    // The phase copy is rewritten at runtime behind a pointer lock jsdom cannot grant, so the
    // strings are checked at the source, same as the retired calibrate-views check.
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('src/ui/calibrate/turn-view.ts', 'utf8');
    const copyLines = src.split('\n').filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'));
    expect(copyLines.join('\n')).not.toMatch(/['`][^'`]*\b(LEFT|RIGHT|FAST|SLOW)\b[^'`]*['`]/);
  });
});
