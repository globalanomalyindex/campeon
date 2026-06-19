/**
 * Pure timing + state contract (and legacy UV geometry) for the enemy "quarry" animations.
 *
 * The procedural 3D quarry layer (`enemy-layer.ts`) reads the `ANIMATIONS` table - per-state row /
 * frame range / fps / loop - as the timing/state contract that drives its transform/opacity/emissive
 * tweens, and reuses the `EnemyState` union and the `EnemyController` state machine VERBATIM. The
 * rows define the animation states the arena drives:
 *   row 0 spawn · row 1 idle · row 2 flinch · row 3 death · row 4 escape.
 *
 * The UV helpers (`cellUV` / `frameUV` / `staticFrameUV`) are the original sprite-sheet geometry,
 * retained because the shared controller still returns a UV per frame; the 3D layer simply ignores
 * the UV and animates the procedural mesh instead. Pure: no THREE, no DOM.
 */

export interface UVRect {
  offsetX: number;
  offsetY: number;
  repeatX: number;
  repeatY: number;
}

export interface AnimSpec {
  row: number;
  /** First and last column index (inclusive) of the usable frames in this row. */
  from: number;
  to: number;
  fps: number;
  loop: boolean;
}

export const SHEET = { w: 1448, h: 1086, cols: 8, rows: 5 } as const;

/** Fraction of a cell trimmed on each side so NearestFilter never samples the gutter / neighbour. */
const INSET = 0.06;

export type EnemyState = 'spawn' | 'idle' | 'flinch' | 'death' | 'escape';
export const ENEMY_STATES: readonly EnemyState[] = ['spawn', 'idle', 'flinch', 'death', 'escape'];

/** Row → animation map. Spawn/idle/flinch lead back to life; death/escape are terminal (sprite retires). */
export const ANIMATIONS: Record<EnemyState, AnimSpec> = {
  spawn: { row: 0, from: 0, to: 7, fps: 14, loop: false },
  idle: { row: 1, from: 0, to: 7, fps: 6, loop: true },
  flinch: { row: 2, from: 0, to: 7, fps: 16, loop: false },
  death: { row: 3, from: 0, to: 7, fps: 16, loop: false },
  escape: { row: 4, from: 0, to: 7, fps: 12, loop: false },
};

const frameCount = (a: AnimSpec): number => a.to - a.from + 1;

/** Elapsed time → absolute column index. Loops wrap; one-shots clamp at the final frame. */
export function frameIndex(a: AnimSpec, elapsedMs: number): number {
  const steps = Math.floor((Math.max(0, elapsedMs) * a.fps) / 1000);
  const n = frameCount(a);
  return a.loop ? a.from + (steps % n) : a.from + Math.min(steps, n - 1);
}

/** True once a one-shot has played past its last frame (loops are never complete). */
export function isComplete(state: EnemyState, elapsedMs: number): boolean {
  const a = ANIMATIONS[state];
  if (a.loop) return false;
  return (Math.max(0, elapsedMs) * a.fps) / 1000 >= frameCount(a);
}

/**
 * Normalized UV sub-rect for the cell at [row, col], inset to exclude the gutter. THREE measures V
 * from the bottom, so row 0 (top of the image) maps to the highest V band.
 */
export function cellUV(row: number, col: number): UVRect {
  const cw = 1 / SHEET.cols;
  const ch = 1 / SHEET.rows;
  const ix = cw * INSET;
  const iy = ch * INSET;
  return {
    offsetX: col * cw + ix,
    offsetY: 1 - (row + 1) * ch + iy,
    repeatX: cw - 2 * ix,
    repeatY: ch - 2 * iy,
  };
}

/** UV sub-rect for the live frame of `state` at `elapsedMs`. */
export function frameUV(state: EnemyState, elapsedMs: number): UVRect {
  const a = ANIMATIONS[state];
  return cellUV(a.row, frameIndex(a, elapsedMs));
}

/** Representative still for reduced motion: first frame of a loop, final frame of a one-shot. */
export function staticFrameUV(state: EnemyState): UVRect {
  const a = ANIMATIONS[state];
  return cellUV(a.row, a.loop ? a.from : a.to);
}
