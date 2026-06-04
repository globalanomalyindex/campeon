// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createShotFeedback } from '../../src/ui/feedback';

describe('createShotFeedback - miss tick', () => {
  it('mounts a hidden, aria-hidden tick reading "miss" under the host', () => {
    const host = document.createElement('div');
    const fb = createShotFeedback(host);
    expect(host.contains(fb.el)).toBe(true);
    expect(fb.el.textContent).toBe('miss');
    expect(fb.el.getAttribute('aria-hidden')).toBe('true');
    expect(fb.el.classList.contains('is-on')).toBe(false); // not flashing until miss()
  });

  it('miss() turns the tick on', () => {
    const host = document.createElement('div');
    const fb = createShotFeedback(host);
    fb.miss();
    expect(fb.el.classList.contains('is-on')).toBe(true);
  });

  it('dispose() removes the element from the DOM', () => {
    const host = document.createElement('div');
    const fb = createShotFeedback(host);
    fb.dispose();
    expect(host.contains(fb.el)).toBe(false);
  });
});
