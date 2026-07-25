// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { openModal, type ModalHandle } from '../../src/ui/modal';

/**
 * The focus trap's doc comment promises the whole open -> Tab cycle -> Escape -> restore path is
 * unit-tested in jsdom. This is that test. Every overlay over the arena (the paused scrim, the
 * dialed-in panel, the run-failed notice, the adopt confirm) depends on it: without the trap a Tab
 * walks into content that is visually covered but still focusable.
 */

interface Fixture {
  dialog: HTMLElement;
  first: HTMLButtonElement;
  middle: HTMLButtonElement;
  last: HTMLButtonElement;
  background: HTMLElement;
  outside: HTMLButtonElement;
}

let openHandles: ModalHandle[] = [];

function build(): Fixture {
  const background = document.createElement('div');
  background.className = 'background';
  const outside = document.createElement('button');
  outside.textContent = 'behind the dialog';
  background.appendChild(outside);

  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  const [first, middle, last] = ['first', 'middle', 'last'].map((name) => {
    const b = document.createElement('button');
    b.textContent = name;
    dialog.appendChild(b);
    return b;
  }) as [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement];

  document.body.append(background, dialog);
  return { dialog, first, middle, last, background, outside };
}

/** Dispatch a keydown the way a browser would: on the focused element, bubbling to document. */
function press(key: string, opts: { shiftKey?: boolean } = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
  (document.activeElement ?? document.body).dispatchEvent(e);
  return e;
}

function open(dialog: HTMLElement, opts: Parameters<typeof openModal>[1] = {}): ModalHandle {
  const handle = openModal(dialog, opts);
  openHandles.push(handle);
  return handle;
}

afterEach(() => {
  for (const h of openHandles) h.release(); // never leak a document-level keydown listener between tests
  openHandles = [];
  document.body.replaceChildren();
});

describe('openModal: focus on open', () => {
  it('moves focus into the dialog, defaulting to its first focusable descendant', () => {
    const { dialog, first } = build();
    open(dialog);
    expect(document.activeElement).toBe(first);
  });

  it('honours an explicit initialFocus', () => {
    const { dialog, middle } = build();
    open(dialog, { initialFocus: middle });
    expect(document.activeElement).toBe(middle);
  });

  it('skips focusables inside a hidden subtree when choosing where to land', () => {
    const { dialog, first, middle } = build();
    first.hidden = true;
    open(dialog);
    expect(document.activeElement).toBe(middle);
  });

  it('falls back to the dialog itself when it holds nothing focusable', () => {
    const empty = document.createElement('div');
    document.body.appendChild(empty);
    const focus = vi.spyOn(empty, 'focus');
    open(empty);
    expect(focus).toHaveBeenCalled();
  });

  it('marks the dialog aria-modal while open and clears it on release', () => {
    const { dialog } = build();
    const handle = open(dialog);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    handle.release();
    expect(dialog.hasAttribute('aria-modal')).toBe(false);
  });
});

describe('openModal: Tab cycles inside the dialog', () => {
  it('wraps forward from the last focusable to the first', () => {
    const { dialog, first, last } = build();
    open(dialog, { initialFocus: last });
    const e = press('Tab');
    expect(document.activeElement).toBe(first);
    expect(e.defaultPrevented).toBe(true);
  });

  it('wraps backward from the first focusable to the last', () => {
    const { dialog, first, last } = build();
    open(dialog, { initialFocus: first });
    const e = press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(last);
    expect(e.defaultPrevented).toBe(true);
  });

  it('leaves an interior Tab to the browser, so the dialog tabs through normally', () => {
    const { dialog, first, middle } = build();
    open(dialog, { initialFocus: first });
    // jsdom does not move focus itself; what matters is that the trap does not intercept here.
    const e = press('Tab');
    expect(e.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(first);
    expect(middle.isConnected).toBe(true);
  });

  it('pulls focus back in if it escaped the dialog some other way', () => {
    const { dialog, first, last, outside } = build();
    open(dialog);
    outside.focus();
    expect(press('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    outside.focus();
    expect(press('Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('swallows Tab entirely when the dialog holds nothing focusable', () => {
    const empty = document.createElement('div');
    document.body.appendChild(empty);
    open(empty);
    expect(press('Tab').defaultPrevented).toBe(true);
  });

  it('stops trapping Tab once released', () => {
    const { dialog, last, outside } = build();
    const handle = open(dialog, { initialFocus: last });
    handle.release();
    outside.focus();
    expect(press('Tab').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(outside);
  });
});

describe('openModal: Escape', () => {
  it('routes Escape to onEscape and consumes the key', () => {
    const { dialog } = build();
    const onEscape = vi.fn();
    open(dialog, { onEscape });
    const e = press('Escape');
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it('leaves Escape alone for a dialog with no safe dismissal', () => {
    const { dialog } = build();
    open(dialog); // no onEscape: the caller has no non-destructive way out
    expect(press('Escape').defaultPrevented).toBe(false);
  });

  it('stops answering Escape once released', () => {
    const { dialog } = build();
    const onEscape = vi.fn();
    open(dialog, { onEscape }).release();
    press('Escape');
    expect(onEscape).not.toHaveBeenCalled();
  });
});

describe('openModal: background inertness', () => {
  it('hides the named background regions from assistive tech and the tab order while open', () => {
    const { dialog, background } = build();
    const handle = open(dialog, { inert: [background] });
    expect(background.hasAttribute('inert')).toBe(true);
    expect(background.getAttribute('aria-hidden')).toBe('true');

    handle.release();
    expect(background.hasAttribute('inert')).toBe(false);
    expect(background.hasAttribute('aria-hidden')).toBe(false);
  });

  it('ignores null entries in the inert list, so callers can pass optional regions', () => {
    const { dialog, background } = build();
    expect(() => open(dialog, { inert: [null, background, undefined] })).not.toThrow();
    expect(background.hasAttribute('inert')).toBe(true);
  });

  it('restores a region that was aria-hidden in its own right, rather than revealing it', () => {
    // Background content is sometimes permanently hidden from assistive tech (a decorative plot).
    // Clearing the attribute on release would hand that content to the reader as if it were new.
    const { dialog, background } = build();
    background.setAttribute('aria-hidden', 'true');
    const handle = open(dialog, { inert: [background] });
    handle.release();
    expect(background.getAttribute('aria-hidden')).toBe('true');
    expect(background.hasAttribute('inert')).toBe(false);
  });

  it('leaves a region that was already inert inert on release', () => {
    const { dialog, background } = build();
    background.setAttribute('inert', '');
    open(dialog, { inert: [background] }).release();
    expect(background.hasAttribute('inert')).toBe(true);
  });

  it('leaves the background alone when no inert list is given', () => {
    const { dialog, background } = build();
    open(dialog);
    expect(background.hasAttribute('inert')).toBe(false);
  });
});

describe('openModal: release restores focus', () => {
  it('hands focus back to the element that was focused before opening', () => {
    const { dialog, outside } = build();
    outside.focus();
    const handle = open(dialog);
    expect(document.activeElement).not.toBe(outside);
    handle.release();
    expect(document.activeElement).toBe(outside);
  });

  it('does not reach for an opener that has left the document (a torn-down screen)', () => {
    const { dialog, background, outside } = build();
    outside.focus();
    const handle = open(dialog);
    background.remove(); // the screen unmounted while the dialog was open
    expect(() => handle.release()).not.toThrow();
    expect(document.activeElement).not.toBe(outside);
  });

  it('is idempotent: a second release neither re-restores focus nor re-un-inerts', () => {
    const { dialog, background, outside } = build();
    outside.focus();
    const handle = open(dialog, { inert: [background] });
    handle.release();
    const restore = vi.spyOn(outside, 'focus');
    handle.release();
    expect(restore).not.toHaveBeenCalled();
    expect(background.hasAttribute('inert')).toBe(false);
  });
});
