import { DataTexture, EquirectangularReflectionMapping, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three';
import { hex } from '../palette';

/**
 * PURE CPU factory for the arena's warm procedural environment map (equirectangular IBL) and its
 * tuning constants. No WebGL, no renderer, no THREE.Scene reference - `createWarmEnvTexture()` builds
 * a plain `DataTexture` from arithmetic on `src/palette.ts` hex anchors. This module is a cosmetic
 * lighting/reflection layer only: it has NO scored API (no bearing/radiusDeg/cm360/sample/score/view)
 * and never reads or writes the aim/scoring stream - it only shades pixels for `scene.environment`
 * and (via `arena.ts`) tunes `scene.fog`.
 */

/** 2D direction: [x, y, z]. */
type Vec3 = [number, number, number];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const normalize = ([x, y, z]: Vec3): Vec3 => {
  const len = Math.sqrt(x * x + y * y + z * z) || 1;
  return [x / len, y / len, z / len];
};

/**
 * Sun direction for the env-map hotspot, normalized from the arena's rim `DirectionalLight` position
 * (6, 7, -24) in `arena.ts`'s `buildEnvironment()`. Kept in lockstep with that light so the IBL
 * specular highlight on metallic props (gunmetal/brass) sits on the SAME side as the analytic rim
 * halo - two lighting systems that must agree, not two independent choices.
 */
export const SUN_DIR: Vec3 = normalize([6, 7, -24]);

/** Attenuation applied to `scene.environment` via `scene.environmentIntensity` (tuning knob). */
export const ENV_INTENSITY = 0.5;

/** Fog start distance in world units (tuning knob). */
export const FOG_NEAR = 12;

/** Fog end distance in world units (tuning knob). */
export const FOG_FAR = 85;

const WIDTH = 128;
const HEIGHT = 64;

/**
 * three.js equirectangular UV convention (matches `EquirectangularReflectionMapping`'s sampling in
 * `WebGLRenderer`): u wraps around the horizontal (atan2 of z,x), v runs top-to-bottom in texture
 * space over the vertical angle (asin of y). Both mapped into [0, 1].
 */
export function dirToEquirectUv(dir: Vec3): [number, number] {
  const [x, y, z] = dir;
  const u = Math.atan2(z, x) / (2 * Math.PI) + 0.5;
  const v = Math.asin(clamp(y, -1, 1)) / Math.PI + 0.5;
  return [u, v];
}

/** Invert {@link dirToEquirectUv}: recover a unit world direction from an equirect (u,v) texel. */
function equirectUvToDir(u: number, v: number): Vec3 {
  const theta = (u - 0.5) * (2 * Math.PI); // atan2(z,x)
  const phi = (v - 0.5) * Math.PI; // asin(y)
  const y = Math.sin(phi);
  const horiz = Math.cos(phi);
  const x = horiz * Math.cos(theta);
  const z = horiz * Math.sin(theta);
  return normalize([x, y, z]);
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Palette-derived RGB anchors (0-255), scaled per the derivations below. Every derivation stays a
// pure function of `hex` - no hardcoded colors outside these scalings.
const CREAM: Vec3 = hexToRgb(hex.cream);
const HIDE: Vec3 = hexToRgb(hex.hide);
const INK: Vec3 = hexToRgb(hex.ink);
const GOLD: Vec3 = hexToRgb(hex.gold);

function hexToRgb(h: string): Vec3 {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

const scale = (c: Vec3, k: number): Vec3 => [c[0] * k, c[1] * k, c[2] * k];
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Smoothstep, for soft radial falloffs (the sun disc). */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Sun disc shaping (tuning knobs, documented per the spec): a bright core to about 0.12 rad,
// smoothly falling off to zero by about 0.35 rad angular distance from SUN_DIR.
const SUN_CORE_RAD = 0.12;
const SUN_EDGE_RAD = 0.35;
// Warm white-gold hotspot color: an even mix of cream + gold. Both anchors already carry a channel
// at/near 255 (cream.r=239, gold.g=196 but gold.r=255), so the 50/50 mix peaks near 255 without
// any extra scaling - a real specular ping for metals (gunmetal/brass viewmodel) without blowing
// past the 0-255 texel range.
const SUN_COLOR: Vec3 = lerp(CREAM, GOLD, 0.5);

/**
 * Shade one equirect texel (0-255 RGB) for world direction `dir`. Per {@link dirToEquirectUv}'s
 * convention, v=0 is straight down (y=-1) and v=1 is straight up (y=1), so "sky" (upper half) is
 * simply dir.y >= 0 and "ground" (lower half) is dir.y < 0 - shading keys directly on dir.y rather
 * than re-deriving v, since dir already carries the same information.
 */
function shadeTexel(dir: Vec3): Vec3 {
  let color: Vec3;
  const isSky = dir[1] >= 0;
  if (isSky) {
    // Sky: vertical gradient from a dim warm horizon glow (cream * 0.35) up to a darker warm zenith
    // (cream * 0.10), keyed on |y| (0 at horizon, 1 at zenith).
    const t = clamp(dir[1], 0, 1);
    const horizonColor = scale(CREAM, 0.35);
    const zenithColor = scale(CREAM, 0.1);
    color = lerp(horizonColor, zenithColor, t);
  } else {
    // Ground: dark warm brown (hide * 0.15 at the horizon) falling to near-black warm ink straight
    // down, keyed on |y| (0 at horizon, 1 at nadir).
    const t = clamp(-dir[1], 0, 1);
    const horizonColor = scale(HIDE, 0.15);
    const nadirColor = INK;
    color = lerp(horizonColor, nadirColor, t);
  }

  // Sun hotspot: smooth disc centered on SUN_DIR, angular radius via the arccos of the dot product
  // (both vectors are unit length, so dot = cos(angle)).
  const cosAngle = clamp(dot(dir, SUN_DIR), -1, 1);
  const angle = Math.acos(cosAngle);
  const sunMask = 1 - smoothstep(SUN_CORE_RAD, SUN_EDGE_RAD, angle);
  color = lerp(color, SUN_COLOR, sunMask);

  // Warmth invariant: a warm film stock never goes blue (r >= g >= b for every texel).
  const r = color[0];
  const g = Math.min(color[1], r);
  const b = Math.min(color[2], g);
  return [clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255)];
}

/**
 * Build the 128x64 equirectangular warm environment map. Row 0 of the buffer is v=0 (straight down),
 * the last row is v=1 (straight up); u wraps per {@link dirToEquirectUv}. Every texel's color is
 * derived ONLY from `src/palette.ts` anchors (see {@link shadeTexel} for the derivations).
 */
export function createWarmEnvTexture(): DataTexture {
  const data = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let row = 0; row < HEIGHT; row += 1) {
    const v = (row + 0.5) / HEIGHT;
    for (let col = 0; col < WIDTH; col += 1) {
      const u = (col + 0.5) / WIDTH;
      const dir = equirectUvToDir(u, v);
      const [r, g, b] = shadeTexel(dir);
      const i = (row * WIDTH + col) * 4;
      data[i] = Math.round(r);
      data[i + 1] = Math.round(g);
      data[i + 2] = Math.round(b);
      data[i + 3] = 255;
    }
  }
  const texture = new DataTexture(data, WIDTH, HEIGHT, RGBAFormat, UnsignedByteType);
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
