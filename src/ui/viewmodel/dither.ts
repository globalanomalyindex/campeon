/**
 * Ordered (Bayer) dithering + posterization for an RGBA buffer, in place - the CPU/canvas twin of the
 * arena's GLSL PSX pass (`engine/psx-pass.ts`). The Desert Eagle viewmodel is a 2D overlay drawn ABOVE
 * the WebGL canvas, so the post-processing shader can't reach it; baking the same dither + palette into
 * its keyed sheet once at load makes the gun sit in the same low-fi world as the dithered arena.
 *
 * Same 4×4 Bayer matrix and "dither-before-quantize" order as the shader, so the banding matches:
 *   c += bayer(x,y)/levels ; c = floor(c·levels + 0.5)/levels
 * Alpha is preserved untouched (keeps the magenta-keyed transparency intact). Pure - no DOM, no canvas.
 */

/** 4×4 Bayer threshold matrix (values 0..15), identical to the order used in the PSX fragment shader. */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

export interface DitherOpts {
  /** Colour-quantization steps per channel (default 6 → the same limited PS1 palette as the arena). */
  levels?: number;
}

/**
 * Posterize each RGB channel to `levels` steps after adding the per-pixel Bayer threshold, in place.
 * Returns the same buffer for convenience. Output channel values are always one of the `levels + 1`
 * quantization levels `round(k/levels·255)`; alpha is never modified.
 */
export function orderedDither(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  opts: DitherOpts = {},
): Uint8ClampedArray {
  const levels = opts.levels ?? 6;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = BAYER4[(x & 3) + (y & 3) * 4]! / 16 - 0.5; // [-0.5, 0.4375], matches the shader
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = data[i + c]! / 255 + t / levels; // dither before quantizing → smoother banding
        const q = Math.floor(v * levels + 0.5) / levels; // posterize to the limited palette
        data[i + c] = Math.max(0, Math.min(255, Math.round(q * 255)));
      }
      // alpha (i + 3) is left untouched
    }
  }
  return data;
}
