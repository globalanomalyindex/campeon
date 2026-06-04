export interface KeyOpts {
  /** Max green for a pixel to count as the magenta key (default 120). */
  gMax?: number;
  /** Min red / blue for the key (default 150 / 130). */
  rMin?: number;
  bMin?: number;
  /** How much R and B must exceed G for a magenta hue (default 60) - keeps neutral greys/chrome safe. */
  sep?: number;
}

/** True if a pixel is the magenta chroma-key: strong red + blue, weak green (a magenta hue). */
export function isKeyColor(r: number, g: number, b: number, opts: KeyOpts = {}): boolean {
  const gMax = opts.gMax ?? 120;
  const rMin = opts.rMin ?? 150;
  const bMin = opts.bMin ?? 130;
  const sep = opts.sep ?? 60;
  return g < gMax && r > rMin && b > bMin && Math.min(r, b) - g > sep;
}

/**
 * Knock out the magenta background of an RGBA buffer in place (alpha → 0 on key pixels). Only magenta
 * is keyed, so the gold draw-glint, white muzzle flash, grey smoke, and chrome highlights all survive.
 * Returns the number of pixels keyed (handy for tests + sanity checks). PSX wants hard edges, so this
 * is a hard key - no feather.
 */
export function keyMagenta(data: Uint8ClampedArray, opts: KeyOpts = {}): number {
  let keyed = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (isKeyColor(data[i]!, data[i + 1]!, data[i + 2]!, opts)) {
      data[i + 3] = 0;
      keyed += 1;
    }
  }
  return keyed;
}

export interface DespillOpts {
  /**
   * Minimum magenta cast - `min(r, b) - g` - for a pixel to be despilled (default 8). Anti-aliased
   * magenta fringe carries a cast of 15-130; neutral gunmetal/chrome sit at ≤2, so this cleanly
   * separates contamination from the real palette without nibbling near-neutral pixels.
   */
  castMin?: number;
}

/**
 * Remove residual magenta spill from opaque pixels in place. The hard key knocks out fully-magenta
 * background, but anti-aliasing leaves a thin band of partially-magenta pixels (R and B both above G)
 * that the key can't take without eating real edges - they read as a pink halo. Where that magenta
 * cast exceeds `castMin`, clamp R and B down to G, collapsing the pixel to neutral grey at the same
 * luminance. Skips transparent (already-keyed) pixels and anything without a magenta cast, so the
 * gold glint (low blue), chrome, white, smoke, and gunmetal all survive untouched. Returns the count
 * despilled. Runs after `keyMagenta`, before the dither bake.
 */
export function despillMagenta(data: Uint8ClampedArray, opts: DespillOpts = {}): number {
  const castMin = opts.castMin ?? 8;
  let despilled = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue; // already keyed → invisible, leave it
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (Math.min(r, b) - g > castMin) {
      data[i] = Math.min(r, g); // pull red down to the (clean) green level
      data[i + 2] = Math.min(b, g); // pull blue down to the green level → neutral grey
      despilled += 1;
    }
  }
  return despilled;
}
