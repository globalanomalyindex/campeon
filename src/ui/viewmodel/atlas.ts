/**
 * Pure geometry + timing for the Desert Eagle viewmodel sprite sheet (`public/sprites/deagle.png`).
 *
 * The sheet is an 8-column × 7-row grid with non-uniform row heights and a magenta (#FF00FF-ish)
 * in-cell key inside white gutters — measured from the actual pixels, not assumed. This module is
 * pure (no DOM, no canvas): given an animation name and elapsed time it returns the source rect to
 * blit. The thin renderer (viewmodel.ts) owns the canvas, the chroma-key, and rAF.
 */

export interface Rect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}
export interface AnimSpec {
  row: number;
  /** First and last column index (inclusive) of the usable frames in this row. */
  from: number;
  to: number;
  fps: number;
  loop: boolean;
}

/** Measured grid: 9 column-gutter centres (→ 8 cells) and 7 content row-bands [yTop, yBottom]. */
export const SHEET = {
  w: 1536,
  h: 1024,
  cols: [2, 193, 384, 575, 766, 957, 1149, 1340, 1534],
  rows: [
    [4, 145],
    [148, 291],
    [295, 428],
    [432, 554],
    [558, 673],
    [677, 836],
    [840, 1020],
  ] as ReadonlyArray<readonly [number, number]>,
} as const;

export type AnimName =
  | 'smoking'
  | 'flickDraw'
  | 'checkAmmo'
  | 'cock'
  | 'crackKnuckles'
  | 'fire'
  | 'idleReady';

/** Row → animation map + usable frame ranges (trailing empty/held cells trimmed via ink-density). */
export const ANIMATIONS: Record<AnimName, AnimSpec> = {
  smoking: { row: 0, from: 0, to: 3, fps: 4, loop: true }, // cols 0–3 only: the cig-held/smoke loop. cols 4–7 are the flick-away + hand-leaving frames (those belong to flickDraw, not the idle).
  flickDraw: { row: 1, from: 0, to: 7, fps: 12, loop: false },
  checkAmmo: { row: 2, from: 0, to: 7, fps: 12, loop: false },
  cock: { row: 3, from: 0, to: 4, fps: 12, loop: false },
  crackKnuckles: { row: 4, from: 0, to: 7, fps: 12, loop: false },
  fire: { row: 5, from: 0, to: 7, fps: 22, loop: false },
  idleReady: { row: 6, from: 1, to: 7, fps: 4, loop: true },
};

const frameCount = (a: AnimSpec): number => a.to - a.from + 1;

/** Elapsed time → absolute column index. Loops wrap; one-shots clamp at the final frame. */
export function frameIndex(a: AnimSpec, elapsedMs: number): number {
  const steps = Math.floor((Math.max(0, elapsedMs) * a.fps) / 1000);
  const n = frameCount(a);
  return a.loop ? a.from + (steps % n) : a.from + Math.min(steps, n - 1);
}

/** True once a one-shot animation has played past its last frame (loops are never complete). */
export function isComplete(name: AnimName, elapsedMs: number): boolean {
  const a = ANIMATIONS[name];
  if (a.loop) return false;
  return (Math.max(0, elapsedMs) * a.fps) / 1000 >= frameCount(a);
}

/** Source rect for the cell at [row, col], inset to exclude the white gutter lines. */
export function cellRect(row: number, col: number, inset = 4): Rect {
  const band = SHEET.rows[row]!;
  const x0 = SHEET.cols[col]!;
  const x1 = SHEET.cols[col + 1]!;
  return {
    sx: x0 + inset,
    sy: band[0] + inset,
    sw: x1 - x0 - 2 * inset,
    sh: band[1] - band[0] - 2 * inset,
  };
}

/** Source rect for the live frame of `name` at `elapsedMs`. */
export function frameRect(name: AnimName, elapsedMs: number): Rect {
  const a = ANIMATIONS[name];
  return cellRect(a.row, frameIndex(a, elapsedMs));
}
