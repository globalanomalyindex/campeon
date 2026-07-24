/**
 * Modal focus handling for the overlays that appear over the arena: the paused scrim, the
 * dialed-in panel, the run-failed notice and the adopt confirm.
 *
 * These all sit over a screen whose only other controls are a canvas and a fixed HUD, so
 * without a trap a Tab walks straight into content that is visually covered but still
 * focusable, and the reader is never told the dialog opened at all. The overlay also has to
 * hand focus back where it came from when it closes, otherwise dismissing it strands the
 * user at the top of the document.
 *
 * Pure DOM orchestration over injected elements (no arena, no WebGL), so the whole
 * open -> Tab cycle -> Escape -> restore path unit-tests in jsdom.
 */

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface ModalHandle {
  /** Close: drop the trap, un-inert the background, restore the previously focused element. */
  release(): void;
}

export interface ModalOptions {
  /** Element to focus on open. Defaults to the dialog's first focusable descendant. */
  initialFocus?: HTMLElement | null;
  /** Escape while open. Omit for a dialog with no safe dismissal. */
  onEscape?: () => void;
  /** Background regions to hide from assistive tech and from the tab order while open. */
  inert?: readonly (HTMLElement | null | undefined)[];
}

/** Focusable descendants of `root`, minus anything inside a hidden subtree. */
function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((el) => !el.hidden && el.closest('[hidden]') === null);
}

/**
 * Turn `dialog` into an open modal. Sets `aria-modal`, moves focus in, cycles Tab inside it,
 * and routes Escape to `onEscape`. The caller still owns showing and hiding the element: this
 * only owns focus and the background's inertness.
 */
export function openModal(dialog: HTMLElement, opts: ModalOptions = {}): ModalHandle {
  const restoreTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const inerted = (opts.inert ?? []).filter((el): el is HTMLElement => !!el);

  dialog.setAttribute('aria-modal', 'true');
  for (const el of inerted) {
    el.setAttribute('inert', '');
    el.setAttribute('aria-hidden', 'true');
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      if (!opts.onEscape) return;
      e.preventDefault();
      e.stopPropagation();
      opts.onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusableWithin(dialog);
    if (items.length === 0) { e.preventDefault(); return; }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    // Wrap at both ends, and pull focus back in if it escaped the dialog some other way.
    if (e.shiftKey && (active === first || !dialog.contains(active))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
      e.preventDefault(); first.focus();
    }
  };
  document.addEventListener('keydown', onKeyDown, true);

  (opts.initialFocus ?? focusableWithin(dialog)[0] ?? dialog).focus();

  let released = false;
  return {
    release(): void {
      if (released) return;
      released = true;
      document.removeEventListener('keydown', onKeyDown, true);
      dialog.removeAttribute('aria-modal');
      for (const el of inerted) {
        el.removeAttribute('inert');
        el.removeAttribute('aria-hidden');
      }
      // Restore only if the element is still in the document; a torn-down screen has none.
      if (restoreTo?.isConnected) restoreTo.focus();
    },
  };
}
