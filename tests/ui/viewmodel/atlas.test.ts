import { describe, it, expect } from 'vitest';
import { SHEET, ANIMATIONS, frameIndex, isComplete, cellRect, frameRect, type AnimName } from '../../../src/ui/viewmodel/atlas';

describe('viewmodel atlas — sheet geometry', () => {
  it('describes the measured 8×7 deagle grid', () => {
    expect(SHEET.cols.length).toBe(9); // 9 boundaries → 8 columns
    expect(SHEET.rows.length).toBe(7); // 7 animation rows
    expect(SHEET.w).toBe(1536);
    expect(SHEET.h).toBe(1024);
  });

  it('cellRect stays inside the sheet and excludes the gutter (positive, in-bounds rect)', () => {
    for (let row = 0; row < SHEET.rows.length; row++) {
      for (let col = 0; col < 8; col++) {
        const r = cellRect(row, col);
        expect(r.sw).toBeGreaterThan(0);
        expect(r.sh).toBeGreaterThan(0);
        expect(r.sx).toBeGreaterThanOrEqual(0);
        expect(r.sy).toBeGreaterThanOrEqual(0);
        expect(r.sx + r.sw).toBeLessThanOrEqual(SHEET.w);
        expect(r.sy + r.sh).toBeLessThanOrEqual(SHEET.h);
      }
    }
  });
});

describe('viewmodel atlas — animation timing', () => {
  it('starts every animation on its first frame at t=0', () => {
    for (const name of Object.keys(ANIMATIONS) as AnimName[]) {
      const a = ANIMATIONS[name];
      expect(frameIndex(a, 0)).toBe(a.from);
    }
  });

  it('advances one frame per 1/fps seconds', () => {
    const a = ANIMATIONS.fire; // fps 22, frames 0..7
    expect(frameIndex(a, 0)).toBe(0);
    expect(frameIndex(a, 1000 / 22 + 1)).toBe(1);
    expect(frameIndex(a, (2 * 1000) / 22 + 1)).toBe(2);
  });

  it('loops looping animations and clamps one-shot animations at the last frame', () => {
    const smoke = ANIMATIONS.smoking; // loop, 6 frames (0..5)
    // 6 frames at 6 fps = 1000 ms for a full loop → t=1000ms wraps back to frame 0
    expect(frameIndex(smoke, 1000)).toBe(smoke.from);
    const fire = ANIMATIONS.fire; // one-shot, frames 0..7
    expect(frameIndex(fire, 10_000)).toBe(fire.to); // clamps, never wraps
  });

  it('keeps every frame index within the animation’s [from, to] band', () => {
    for (const name of Object.keys(ANIMATIONS) as AnimName[]) {
      const a = ANIMATIONS[name];
      for (const t of [0, 50, 200, 500, 1500, 9999]) {
        const i = frameIndex(a, t);
        expect(i).toBeGreaterThanOrEqual(a.from);
        expect(i).toBeLessThanOrEqual(a.to);
      }
    }
  });

  it('isComplete is true only after a one-shot animation passes its last frame; never for loops', () => {
    expect(isComplete('smoking', 1e6)).toBe(false); // loops forever
    expect(isComplete('fire', 0)).toBe(false);
    // fire = 8 frames at 22 fps → done after 8/22 s
    expect(isComplete('fire', (8 / 22) * 1000 + 5)).toBe(true);
  });

  it('frameRect returns the rect for the live frame (frame 0 at t=0)', () => {
    const r0 = frameRect('flickDraw', 0);
    expect(r0).toEqual(cellRect(ANIMATIONS.flickDraw.row, ANIMATIONS.flickDraw.from));
  });
});
