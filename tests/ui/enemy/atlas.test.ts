import { describe, it, expect } from 'vitest';
import {
  SHEET,
  ANIMATIONS,
  ENEMY_STATES,
  frameIndex,
  isComplete,
  cellUV,
  frameUV,
  staticFrameUV,
} from '../../../src/ui/enemy/atlas';

describe('enemy atlas - uniform 8×5 grid geometry', () => {
  it('describes the verified uniform grid (8 cols × 5 rows at 1448×1086)', () => {
    expect(SHEET.cols).toBe(8);
    expect(SHEET.rows).toBe(5);
    expect(SHEET.w).toBe(1448);
    expect(SHEET.h).toBe(1086);
  });

  it('cellUV stays within [0,1] and excludes the gutter for every cell', () => {
    for (let row = 0; row < SHEET.rows; row++) {
      for (let col = 0; col < SHEET.cols; col++) {
        const uv = cellUV(row, col);
        expect(uv.offsetX).toBeGreaterThanOrEqual(0);
        expect(uv.offsetY).toBeGreaterThanOrEqual(0);
        expect(uv.repeatX).toBeGreaterThan(0);
        expect(uv.repeatY).toBeGreaterThan(0);
        expect(uv.offsetX + uv.repeatX).toBeLessThanOrEqual(1 + 1e-9);
        expect(uv.offsetY + uv.repeatY).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('maps columns left→right and rows top→bottom (V from the bottom)', () => {
    // Column increases → the sub-rect moves right (offsetX grows by exactly one cell width).
    expect(cellUV(0, 1).offsetX - cellUV(0, 0).offsetX).toBeCloseTo(1 / SHEET.cols, 9);
    // Row 0 is the TOP of the image → highest V; deeper rows have a lower offsetY.
    expect(cellUV(0, 0).offsetY).toBeGreaterThan(cellUV(4, 0).offsetY);
    // Bottom row sits in the bottom 1/5 of the texture; top row reaches the very top.
    expect(cellUV(4, 0).offsetY).toBeLessThan(1 / SHEET.rows);
    expect(cellUV(0, 0).offsetY + cellUV(0, 0).repeatY).toBeGreaterThan(1 - 1 / SHEET.rows);
  });
});

describe('enemy atlas - state contract + animation timing', () => {
  it('assigns each state to its contract row (spawn·idle·flinch·death·escape = rows 0..4)', () => {
    expect(ANIMATIONS.spawn.row).toBe(0);
    expect(ANIMATIONS.idle.row).toBe(1);
    expect(ANIMATIONS.flinch.row).toBe(2);
    expect(ANIMATIONS.death.row).toBe(3);
    expect(ANIMATIONS.escape.row).toBe(4);
  });

  it('only idle loops; the rest are one-shots', () => {
    expect(ANIMATIONS.idle.loop).toBe(true);
    for (const s of ENEMY_STATES) {
      if (s !== 'idle') expect(ANIMATIONS[s].loop).toBe(false);
    }
  });

  it('starts every state on its first frame at t=0', () => {
    for (const s of ENEMY_STATES) {
      expect(frameIndex(ANIMATIONS[s], 0)).toBe(ANIMATIONS[s].from);
    }
  });

  it('advances one frame per 1/fps; one-shots clamp, loops wrap', () => {
    const death = ANIMATIONS.death; // one-shot, 8 frames @ 16fps
    expect(frameIndex(death, 0)).toBe(death.from);
    expect(frameIndex(death, 1000 / death.fps + 1)).toBe(death.from + 1);
    expect(frameIndex(death, 10_000)).toBe(death.to); // clamps, never wraps

    const idle = ANIMATIONS.idle; // loop, 8 frames @ 6fps
    const n = idle.to - idle.from + 1;
    expect(frameIndex(idle, (n * 1000) / idle.fps + 1)).toBe(idle.from); // a full loop wraps to start
  });

  it('isComplete is true only after a one-shot passes its last frame; never for loops', () => {
    expect(isComplete('idle', 1e6)).toBe(false);
    const death = ANIMATIONS.death;
    const n = death.to - death.from + 1;
    expect(isComplete('death', 0)).toBe(false);
    expect(isComplete('death', (n / death.fps) * 1000 + 5)).toBe(true);
  });

  it('frameUV at t=0 equals the cell of the state’s first frame', () => {
    expect(frameUV('death', 0)).toEqual(cellUV(ANIMATIONS.death.row, ANIMATIONS.death.from));
  });

  it('staticFrameUV is frame 0 for loops and the last frame for one-shots', () => {
    expect(staticFrameUV('idle')).toEqual(cellUV(ANIMATIONS.idle.row, ANIMATIONS.idle.from));
    expect(staticFrameUV('death')).toEqual(cellUV(ANIMATIONS.death.row, ANIMATIONS.death.to));
  });
});
