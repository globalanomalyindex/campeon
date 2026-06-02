// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { monoLabel, sectionNumeral, registrationFrame, specRail } from '../../../src/ui/case-study/chrome';

describe('case-study chrome builders', () => {
  it('monoLabel joins parts with + separators', () => {
    const el = monoLabel(['ii', 'the instruments', 'cm/360']);
    expect(el.querySelectorAll('.sep').length).toBe(2);
    expect(el.textContent).toContain('the instruments');
  });
  it('sectionNumeral zero-pads to two digits and is aria-hidden', () => {
    const el = sectionNumeral(3);
    expect(el.textContent).toBe('03');
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });
  it('registrationFrame emits four corner crosshairs', () => {
    const frag = registrationFrame();
    expect(frag.querySelectorAll('.cs-reg').length).toBe(4);
    expect([...frag.querySelectorAll('.cs-reg')].map((e) => e.getAttribute('data-corner')).sort())
      .toEqual(['bl', 'br', 'tl', 'tr']);
  });
  it('specRail renders dt/dd rows; numeric values get .mono', () => {
    const el = specRail([
      { k: 'tsdn latency', v: '29.94 ± 5.75 ms', mono: true },
      { k: 'success rate', v: '~95%' },
    ]);
    expect(el.querySelectorAll('div').length).toBe(2);
    expect(el.querySelector('dd.mono')?.textContent).toBe('29.94 ± 5.75 ms');
  });
});
