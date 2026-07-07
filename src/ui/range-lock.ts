/**
 * Pointer-lock orchestration for the free-play range: every unlocked click asks for the lock
 * again, and free play starts exactly ONCE, after the FIRST lock is actually granted.
 *
 * This exists because the naive one-liner died twice over:
 * - `{ once: true }` on the click listener meant the first Esc ended the range forever - the next
 *   click had no listener left to relock, and the screen silently froze (the bug this fixes).
 * - swallowing a lock REJECTION and starting anyway (browsers refuse relocks for ~1.5s after an
 *   Esc release) started a range you could not aim in. A denied lock now leaves everything armed:
 *   the click that fails simply does nothing, and the next click retries.
 *
 * Clicks WHILE locked are the player firing - they must not re-request the lock on every shot.
 *
 * Pure orchestration over injected deps (no arena, no WebGL), so the Esc -> click relock cycle is
 * unit-testable in jsdom - the thin `range.ts` shell stays untested glue, per the house seam rule.
 */
export interface RangeLockDeps {
  /** Live pointer-lock state (flips on the async pointerlockchange event). */
  isLocked(): boolean;
  /** Ask the browser for the lock. Rejects when denied (e.g. the post-Esc cooldown). */
  requestLock(): Promise<unknown>;
  /** Resolves once the cosmetic layers have attached, so mercs (not bare spheres) greet the player. */
  ready: Promise<void>;
  /** Start free play. Called exactly once, after the first granted lock + ready. */
  start(): void;
}

/** Bind the relock-forever click handler to `canvas`. Returns the unbinder for unmount. */
export function bindRangeLock(canvas: HTMLElement, deps: RangeLockDeps): () => void {
  let started = false;
  const onClick = (): void => {
    if (deps.isLocked()) return; // locked clicks are shots, not lock requests
    void deps
      .requestLock()
      .then(() => deps.ready)
      .then(() => {
        if (started) return; // a relock after Esc - free play is already running
        started = true;
        deps.start();
      })
      .catch(() => {
        // Denied (cooldown or platform refusal): stay armed, the next click retries. Starting
        // free play WITHOUT a lock would be a range the player cannot aim in.
      });
  };
  canvas.addEventListener('click', onClick);
  return () => canvas.removeEventListener('click', onClick);
}
