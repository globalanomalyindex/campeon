import { describe, it, expect } from 'vitest';
import { isKeyColor, keyMagenta } from '../../../src/ui/viewmodel/key';

describe('magenta chroma-key', () => {
  it('keys magenta but spares chrome, flash, smoke, and the gold glint', () => {
    expect(isKeyColor(243, 3, 240)).toBe(true); // the sheet's magenta background
    expect(isKeyColor(255, 255, 255)).toBe(false); // white gutter / muzzle flash core
    expect(isKeyColor(255, 200, 0)).toBe(false); // gold draw-glint (#FFC400-ish)
    expect(isKeyColor(180, 180, 180)).toBe(false); // grey smoke
    expect(isKeyColor(60, 58, 64)).toBe(false); // dark gloved hand / gunmetal
    expect(isKeyColor(205, 205, 215)).toBe(false); // chrome highlight (neutral, slight blue)
  });

  it('zeroes alpha only on key pixels and counts them', () => {
    // 4 pixels: magenta, white, grey, gold — RGBA, all opaque to start.
    const data = new Uint8ClampedArray([
      243, 3, 240, 255, // magenta → key
      250, 250, 250, 255, // white → keep
      180, 180, 180, 255, // grey → keep
      255, 200, 0, 255, // gold → keep
    ]);
    const keyed = keyMagenta(data);
    expect(keyed).toBe(1);
    expect(data[3]).toBe(0); // magenta alpha cleared
    expect(data[7]).toBe(255);
    expect(data[11]).toBe(255);
    expect(data[15]).toBe(255);
  });
});
