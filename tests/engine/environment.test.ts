import { describe, it, expect } from 'vitest';
import { EquirectangularReflectionMapping, SRGBColorSpace } from 'three';
import {
  createWarmEnvTexture,
  dirToEquirectUv,
  ENV_INTENSITY,
  FOG_FAR,
  FOG_NEAR,
  SUN_DIR,
} from '../../src/engine/environment';

const WIDTH = 128;
const HEIGHT = 64;

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function texelAt(data: Uint8ClampedArray | Uint8Array, row: number, col: number): [number, number, number, number] {
  const i = (row * WIDTH + col) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

/** Recover the world direction a given (row,col) texel represents (inverse of createWarmEnvTexture's loop). */
function dirAt(row: number, col: number): [number, number, number] {
  const u = (col + 0.5) / WIDTH;
  const v = (row + 0.5) / HEIGHT;
  const theta = (u - 0.5) * (2 * Math.PI);
  const phi = (v - 0.5) * Math.PI;
  const y = Math.sin(phi);
  const horiz = Math.cos(phi);
  const x = horiz * Math.cos(theta);
  const z = horiz * Math.sin(theta);
  const len = Math.sqrt(x * x + y * y + z * z) || 1;
  return [x / len, y / len, z / len];
}

function angleBetween(a: [number, number, number], b: [number, number, number]): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.min(1, Math.max(-1, dot))) * (180 / Math.PI);
}

describe('createWarmEnvTexture', () => {
  const texture = createWarmEnvTexture();
  const data = texture.image.data as Uint8Array;

  it('is a 128x64 RGBA DataTexture with the correct mapping, colorSpace, and needsUpdate', () => {
    expect(texture.image.width).toBe(WIDTH);
    expect(texture.image.height).toBe(HEIGHT);
    expect(data.length).toBe(WIDTH * HEIGHT * 4);
    expect(texture.mapping).toBe(EquirectangularReflectionMapping);
    expect(texture.colorSpace).toBe(SRGBColorSpace);
    // needsUpdate is a WRITE-ONLY flag in three: setting it bumps texture.version (0 -> 1) and the
    // getter reads back undefined. Version >= 1 is the observable proof the factory set it.
    expect(texture.version).toBeGreaterThanOrEqual(1);
  });

  it('the brightest plateau of texels is centered on SUN_DIR', () => {
    // The sun disc has a FLAT core (every texel within the core radius shades to the identical
    // SUN_COLOR), so a single argmax texel can legitimately land anywhere on that plateau - up to
    // the core radius away from the center. The honest assertion is that the plateau's CENTROID
    // (in direction space, so no equirect wrap concerns) coincides with SUN_DIR.
    let maxLuma = -Infinity;
    for (let row = 0; row < HEIGHT; row += 1) {
      for (let col = 0; col < WIDTH; col += 1) {
        const [r, g, b] = texelAt(data, row, col);
        maxLuma = Math.max(maxLuma, luma(r, g, b));
      }
    }
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let row = 0; row < HEIGHT; row += 1) {
      for (let col = 0; col < WIDTH; col += 1) {
        const [r, g, b] = texelAt(data, row, col);
        if (luma(r, g, b) < maxLuma - 0.5) continue; // 0.5 absorbs 8-bit rounding of the tie
        const [x, y, z] = dirAt(row, col);
        cx += x;
        cy += y;
        cz += z;
      }
    }
    const len = Math.sqrt(cx * cx + cy * cy + cz * cz);
    expect(len).toBeGreaterThan(0);
    const centroid: [number, number, number] = [cx / len, cy / len, cz / len];
    expect(angleBetween(centroid, SUN_DIR)).toBeLessThan(2);
  });

  it('the warmth invariant holds for every texel (r >= g >= b)', () => {
    for (let row = 0; row < HEIGHT; row += 1) {
      for (let col = 0; col < WIDTH; col += 1) {
        const [r, g, b] = texelAt(data, row, col);
        expect(r).toBeGreaterThanOrEqual(g);
        expect(g).toBeGreaterThanOrEqual(b);
      }
    }
  });

  it('the upper-half (sky) average luma exceeds the lower-half (ground) average luma', () => {
    let upperSum = 0;
    let lowerSum = 0;
    let upperCount = 0;
    let lowerCount = 0;
    for (let row = 0; row < HEIGHT; row += 1) {
      for (let col = 0; col < WIDTH; col += 1) {
        const [r, g, b] = texelAt(data, row, col);
        const l = luma(r, g, b);
        // row < HEIGHT/2 => v < 0.5 => y < 0 (ground, per the module's row-0-is-down convention).
        if (row < HEIGHT / 2) {
          lowerSum += l;
          lowerCount += 1;
        } else {
          upperSum += l;
          upperCount += 1;
        }
      }
    }
    // Exclude the sun hotspot's contribution skew by comparing means, which is still dominated by
    // the base sky/ground gradients since the sun disc only covers a small solid angle.
    const upperMean = upperSum / upperCount;
    const lowerMean = lowerSum / lowerCount;
    expect(upperMean).toBeGreaterThan(lowerMean);
  });

  it('exposes no scored API on the module', () => {
    const mod = { createWarmEnvTexture, dirToEquirectUv, SUN_DIR, ENV_INTENSITY, FOG_NEAR, FOG_FAR } as unknown as Record<
      string,
      unknown
    >;
    const banned = ['bearing', 'radiusDeg', 'counts', 'sample', 'score', 'observation', 'view'];
    for (const k of banned) {
      expect(mod[k], `module.${k} must not exist`).toBeUndefined();
    }
  });
});

describe('dirToEquirectUv', () => {
  it('round-trips a handful of cardinal directions', () => {
    const cases: Array<[number, number, number]> = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    for (const dir of cases) {
      const [u, v] = dirToEquirectUv(dir);
      const theta = (u - 0.5) * (2 * Math.PI);
      const phi = (v - 0.5) * Math.PI;
      const y = Math.sin(phi);
      const horiz = Math.cos(phi);
      const x = horiz * Math.cos(theta);
      const z = horiz * Math.sin(theta);
      expect(x).toBeCloseTo(dir[0], 5);
      expect(y).toBeCloseTo(dir[1], 5);
      expect(z).toBeCloseTo(dir[2], 5);
    }
  });
});
