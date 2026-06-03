export interface KeyOpts {
  /** Max green for a pixel to count as the magenta key (default 120). */
  gMax?: number;
  /** Min red / blue for the key (default 150 / 130). */
  rMin?: number;
  bMin?: number;
  /** How much R and B must exceed G for a magenta hue (default 60) — keeps neutral greys/chrome safe. */
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
 * is a hard key — no feather.
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
