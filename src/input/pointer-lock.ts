import type { AimSample, PointerLockMode } from '../types';
import { normalizeByDpr } from './dpi';

interface MovementLike {
  movementX: number;
  movementY: number;
  timeStamp?: number;
}

/** Flatten coalesced pointer events into DPR-normalized AimSamples (pure). */
export function flattenCoalesced(
  events: readonly MovementLike[],
  dpr: number,
  fallbackTime: number,
): AimSample[] {
  return events.map((e) => ({
    t: e.timeStamp ?? fallbackTime,
    dx: normalizeByDpr(e.movementX, dpr),
    dy: normalizeByDpr(e.movementY, dpr),
  }));
}

export interface PointerLockController {
  /**
   * Request lock, preferring raw (unadjusted) movement. Resolves with the granted
   * mode; rejects if the lock could not be acquired at all. `isLocked()` flips on the
   * async `pointerlockchange` event, so observe lock state via the render loop or
   * `mode()` rather than polling immediately after this resolves.
   */
  request(): Promise<PointerLockMode>;
  exit(): void;
  /** Subscribe to per-sample deltas while locked. Returns an unsubscribe fn. */
  onSample(cb: (sample: AimSample) => void): () => void;
  /** Subscribe to fire (primary-button) events while locked. Returns an unsubscribe fn. */
  onFire(cb: () => void): () => void;
  /** Granted mode, or null when not locked. 'raw' only on browsers that support raw input. */
  mode(): PointerLockMode | null;
  isLocked(): boolean;
  dispose(): void;
}

/**
 * Pointer-lock + high-frequency raw capture over `element`.
 * - On browsers that support raw input (Chromium: `pointerrawupdate` exists), captures via
 *   `pointerrawupdate` + `getCoalescedEvents()` so no counts are lost at 1000 Hz. Elsewhere
 *   (Firefox/Safari) captures via `mousemove`. Exactly one path is registered, so counts are
 *   never doubled.
 * - Requests `unadjustedMovement: true` first; reports mode 'raw' only when the browser
 *   actually supports raw input — there is no API to read back whether the flag was honored
 *   (spec §6.2), so support is the honest proxy, backed by the accel-check gate.
 * Runtime-verified later; the shell is not unit-tested.
 */
export function createPointerLock(element: HTMLElement): PointerLockController {
  const cbs = new Set<(sample: AimSample) => void>();
  const fireCbs = new Set<() => void>();
  let currentMode: PointerLockMode | null = null;
  let locked = false;
  const supportsRaw = 'onpointerrawupdate' in window;
  const moveEvent = supportsRaw ? 'pointerrawupdate' : 'mousemove';

  const onMove = (ev: Event): void => {
    if (!locked) return;
    const pe = ev as PointerEvent;
    const dpr = window.devicePixelRatio || 1;
    const coalesced =
      typeof pe.getCoalescedEvents === 'function' ? pe.getCoalescedEvents() : [];
    const batch = coalesced.length > 0 ? coalesced : [pe];
    const samples = flattenCoalesced(batch, dpr, ev.timeStamp);
    for (const sample of samples) for (const cb of cbs) cb(sample);
  };

  const onLockChange = (): void => {
    locked = document.pointerLockElement === element;
    if (!locked) currentMode = null;
  };

  const onMouseDown = (ev: MouseEvent): void => {
    if (!locked || ev.button !== 0) return;
    for (const cb of fireCbs) cb();
  };

  document.addEventListener(moveEvent, onMove as EventListener);
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('mousedown', onMouseDown);

  return {
    async request(): Promise<PointerLockMode> {
      try {
        const req = element.requestPointerLock({ unadjustedMovement: true }) as
          | Promise<void>
          | undefined;
        if (req && typeof req.then === 'function') {
          await req;
          currentMode = supportsRaw ? 'raw' : 'os-adjusted';
          return currentMode;
        }
        // Legacy undefined-returning API: lock requested without a raw guarantee.
        currentMode = 'os-adjusted';
        return currentMode;
      } catch {
        // Raw unsupported or rejected: fall back to a plain lock. A genuine failure here
        // rejects this promise so the caller can surface it (no silent dead capture loop).
        const fallback = element.requestPointerLock() as Promise<void> | undefined;
        if (fallback && typeof fallback.then === 'function') await fallback;
        currentMode = 'os-adjusted';
        return currentMode;
      }
    },
    exit(): void {
      if (document.pointerLockElement === element) document.exitPointerLock();
    },
    onSample(cb): () => void {
      cbs.add(cb);
      return () => {
        cbs.delete(cb);
      };
    },
    onFire(cb): () => void {
      fireCbs.add(cb);
      return () => {
        fireCbs.delete(cb);
      };
    },
    mode(): PointerLockMode | null {
      return currentMode;
    },
    isLocked(): boolean {
      return locked;
    },
    dispose(): void {
      document.removeEventListener(moveEvent, onMove as EventListener);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('mousedown', onMouseDown);
      cbs.clear();
      fireCbs.clear();
    },
  };
}
