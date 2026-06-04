import { describe, it, expect } from 'vitest';
import { isKeyColor, keyMagenta, despillMagenta } from '../../../src/ui/viewmodel/key';

describe('magenta chroma-key', () => {
  it('keys magenta but spares chrome, flash, smoke, and the gold glint', () => {
    expect(isKeyColor(243, 3, 240)).toBe(true); // the sheet's magenta background
    expect(isKeyColor(255, 255, 255)).toBe(false); // white gutter / muzzle flash core
    expect(isKeyColor(255, 200, 0)).toBe(false); // gold draw-glint (#FFC400-ish)
    expect(isKeyColor(180, 180, 180)).toBe(false); // grey smoke
    expect(isKeyColor(60, 58, 64)).toBe(false); // dark gloved hand / gunmetal
    expect(isKeyColor(205, 205, 215)).toBe(false); // chrome highlight (neutral, slight blue)
  });

  it('default key spares the bright anti-aliased pink halo; the gun-scoped tighter key (gMax 175) removes it', () => {
    // Measured fringe: near-full magenta lightened by anti-aliasing, so green is lifted past the default
    // gMax of 120 and the pixel survives as visible pink. Its magenta cast (min(r,b)-g) is still 85-126.
    expect(isKeyColor(248, 121, 247)).toBe(false); // default: survives → pink fringe
    expect(isKeyColor(248, 121, 247, { gMax: 175 })).toBe(true); // gun key: removed
    expect(isKeyColor(248, 163, 251, { gMax: 175 })).toBe(true); // lighter pink halo: removed
  });

  it('even the tighter gun key (gMax 175) spares bright gun pixels - only true magenta keys', () => {
    expect(isKeyColor(250, 250, 250, { gMax: 175 })).toBe(false); // white / muzzle flash
    expect(isKeyColor(255, 200, 0, { gMax: 175 })).toBe(false); // gold glint (low blue)
    expect(isKeyColor(205, 205, 215, { gMax: 175 })).toBe(false); // chrome (neutral)
  });

  it('zeroes alpha only on key pixels and counts them', () => {
    // 4 pixels: magenta, white, grey, gold - RGBA, all opaque to start.
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

describe('magenta despill', () => {
  it('neutralizes a bright-pink fringe pixel to grey (R,B clamped to G)', () => {
    const data = new Uint8ClampedArray([248, 121, 247, 255]); // measured halo: R≈B≈248, G=121
    const n = despillMagenta(data);
    expect(n).toBe(1);
    expect([data[0], data[1], data[2]]).toEqual([121, 121, 121]); // cast removed → neutral
    expect(data[3]).toBe(255); // alpha untouched
  });

  it('spares the gun palette - gold, chrome, white, smoke, gunmetal are unchanged', () => {
    const data = new Uint8ClampedArray([
      255, 200, 0, 255, // gold glint (blue far below green → no magenta cast)
      205, 205, 215, 255, // chrome (cast 0)
      250, 250, 250, 255, // white
      180, 180, 180, 255, // grey smoke
      60, 58, 64, 255, // gunmetal (cast 2, below castMin)
    ]);
    const before = Array.from(data);
    const n = despillMagenta(data);
    expect(n).toBe(0);
    expect(Array.from(data)).toEqual(before);
  });

  it('leaves already-keyed (transparent) pixels alone', () => {
    const data = new Uint8ClampedArray([243, 3, 240, 0]); // keyed magenta - alpha already 0
    const n = despillMagenta(data);
    expect(n).toBe(0);
    expect(Array.from(data)).toEqual([243, 3, 240, 0]);
  });

  it('respects castMin - a faint cast below the threshold is left alone', () => {
    const data = new Uint8ClampedArray([186, 180, 184, 255]); // cast = min(186,184)-180 = 4 < 8
    const n = despillMagenta(data);
    expect(n).toBe(0);
    expect([data[0], data[1], data[2]]).toEqual([186, 180, 184]);
  });
});
