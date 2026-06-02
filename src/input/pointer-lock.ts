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
  /** Request lock, preferring raw (unadjusted) movement; resolves with the granted mode. */
  request(): Promise<PointerLockMode>;
  exit(): void;
  /** Subscribe to per-sample deltas while locked. Returns an unsubscribe fn. */
  onSample(cb: (sample: AimSample) => void): () => void;
  /** The granted mode, or null when not locked. */
  mode(): PointerLockMode | null;
  isLocked(): boolean;
  dispose(): void;
}

/**
 * Pointer-lock + high-frequency raw capture over `element`.
 * - Prefers `pointerrawupdate` (with `getCoalescedEvents`); falls back to `mousemove`
 *   for browsers without raw updates, deduping so counts are never doubled.
 * - Tries `unadjustedMovement: true` first (Chromium raw), falls back to plain lock.
 * Runtime-verified later; not unit-tested.
 */
export function createPointerLock(element: HTMLElement): PointerLockController {
  const cbs = new Set<(sample: AimSample) => void>();
  let currentMode: PointerLockMode | null = null;
  let locked = false;
  let rawSeen = false;

  const emit = (ev: Event): void => {
    if (!locked) return;
    const pe = ev as PointerEvent;
    const dpr = window.devicePixelRatio || 1;
    const coalesced =
      typeof pe.getCoalescedEvents === 'function' ? pe.getCoalescedEvents() : [];
    const batch = coalesced.length > 0 ? coalesced : [pe];
    const samples = flattenCoalesced(batch as unknown as MovementLike[], dpr, ev.timeStamp);
    for (const sample of samples) for (const cb of cbs) cb(sample);
  };

  const onRaw = (ev: Event): void => {
    rawSeen = true;
    emit(ev);
  };
  const onMouse = (ev: Event): void => {
    if (rawSeen) return; // pointerrawupdate is handling this device
    emit(ev);
  };
  const onLockChange = (): void => {
    locked = document.pointerLockElement === element;
    if (!locked) currentMode = null;
  };

  document.addEventListener('pointerrawupdate', onRaw as EventListener);
  document.addEventListener('mousemove', onMouse as EventListener);
  document.addEventListener('pointerlockchange', onLockChange);

  return {
    async request(): Promise<PointerLockMode> {
      try {
        const req = element.requestPointerLock({ unadjustedMovement: true }) as
          | Promise<void>
          | undefined;
        if (req && typeof req.then === 'function') {
          await req;
          currentMode = 'raw';
          return 'raw';
        }
        currentMode = 'os-adjusted';
        return 'os-adjusted';
      } catch {
        try {
          const fallback = element.requestPointerLock() as Promise<void> | undefined;
          if (fallback && typeof fallback.then === 'function') await fallback;
        } catch {
          /* surfaced via the pointerlockerror event */
        }
        currentMode = 'os-adjusted';
        return 'os-adjusted';
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
    mode(): PointerLockMode | null {
      return currentMode;
    },
    isLocked(): boolean {
      return locked;
    },
    dispose(): void {
      document.removeEventListener('pointerrawupdate', onRaw as EventListener);
      document.removeEventListener('mousemove', onMouse as EventListener);
      document.removeEventListener('pointerlockchange', onLockChange);
      cbs.clear();
    },
  };
}
