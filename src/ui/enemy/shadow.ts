import { CircleGeometry, DataTexture, Mesh, MeshBasicMaterial, RGBAFormat } from 'three';
import { hex } from '../../palette';
import { ARENA_GROUND_Y } from '../../engine/arena';
import { SUN_DIR } from '../../engine/environment';

/**
 * PURE procedural contact-shadow blob for the cosmetic "quarry" targets - sphere-aware grounding,
 * NOT a shadow-mapped ground plane.
 *
 * Targets spawn on a SPHERE around the eye, so some sit metres above the visible grid plane and some
 * below it. A shadow-mapped ground plane would be both expensive (a full render pass) and a lie (it
 * would imply every quarry sits at a fixed, known height). Instead each quarry gets a cheap soft blob
 * pinned to the REAL grid plane (`ARENA_GROUND_Y`, see `src/engine/arena.ts`) directly beneath it,
 * whose opacity and size are a pure function of its height above that plane - and NO blob at all when
 * the quarry is at or below the plane (never a blob poking through the floor, and never a shadow for a
 * target that isn't above the ground to cast one).
 *
 * This module has NO scored API: it only reads a target's position and a base scale, and produces pure
 * geometry/material objects or plain pose data. It never reads bearing()/radiusDeg()/view() and never
 * writes a sample/score/Observation. It is pure THREE - safe to unit-test without a WebGL context, and
 * it never touches canvas 2D (the falloff texture is built directly as raw DataTexture pixels).
 */

/** Name of a pooled contact-shadow blob, so the layer/tests can find it. */
export const SHADOW_NAME = 'quarry-shadow';

/** Darkest a contact shadow ever reads, right at the plane (0 = invisible, 1 = opaque). */
export const SHADOW_MAX_OPACITY = 0.6;
/** Height (metres) over which shadow opacity falls off - bigger = a longer, softer fade with altitude. */
export const SHADOW_FALLOFF_H = 8;
/** Height (metres) above the plane below which a quarry casts no shadow at all (also the tiny lift the
 *  blob itself sits at, so it never z-fights the grid). */
export const SHADOW_EPS = 0.01;

// ── The long dusk shadow ─────────────────────────────────────────────────────
// A first-person eye sits ~3m above the floor looking at targets ~20m out, so a flat disc under a
// quarry foreshortens to a sliver and never reads. The DIEGETIC fix doubles as the legibility fix:
// the arena's one low western sun (SUN_DIR - the same direction the env map and the rim light use)
// would throw a LONG shadow away from itself, and "away from a low sun behind the targets" points
// TOWARD the camera - the exact axis that fights the foreshortening. So the blob is an ellipse
// stretched SHADOW_STRETCH x along the anti-sun ground direction, its near edge anchored at the
// quarry's base, spilling toward the viewer like every dusk photograph you have ever seen.

/** Long-axis stretch of the shadow ellipse along the throw direction. */
export const SHADOW_STRETCH = 2.6;
/** Cross-axis widening so the pool still hugs the quarry's stance. */
export const SHADOW_WIDE = 1.15;

const throwLen = Math.hypot(SUN_DIR[0], SUN_DIR[2]) || 1;
/**
 * Unit ground direction [x, z] the shadow is thrown along: the horizontal projection of the
 * ANTI-sun vector (shadows point away from the light). Derived from SUN_DIR so the env map, the
 * rim light, and every shadow on the floor all agree about where the low sun hangs.
 */
export const SHADOW_THROW: readonly [number, number] = [-SUN_DIR[0] / throwLen, -SUN_DIR[2] / throwLen];

/**
 * In-plane spin (rotation.z, composed after the flat rotation.x = -PI/2) that aligns the ellipse's
 * long (local Y) axis with SHADOW_THROW on the ground. Derivation: with Euler XYZ, local +Y maps to
 * world (-sin z, 0, -cos z); solving that parallel to (throwX, throwZ) gives z = atan2(tx, tz).
 */
export const SHADOW_SPIN = Math.atan2(SHADOW_THROW[0], SHADOW_THROW[1]);

const SHADOW_TEX_SIZE = 64;

/**
 * Build the shared soft-radial-falloff alpha texture every shadow blob reads from its GREEN channel.
 * 64x64 RGBA DataTexture: g = round(255 * (1 - min(1, r/0.5)^2)^2), r = distance from the texel center
 * in UV space (so the center texel is 255 and the rim reaches 0 well before the corners, giving a
 * soft pool rather than a hard-edged disc). ONE texture is shared by every blob a layer makes; the
 * layer disposes it once (see `disposeShadowBlob`, which disposes only the per-blob geometry/material).
 */
export function createShadowTexture(): DataTexture {
  const size = SHADOW_TEX_SIZE;
  const data = new Uint8Array(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x - cx) / size;
      const v = (y - cy) / size;
      const r = Math.sqrt(u * u + v * v);
      const t = 1 - Math.min(1, r / 0.5) ** 2;
      const g = Math.round(255 * t ** 2);
      const i = (y * size + x) * 4;
      data[i] = 0;
      data[i + 1] = g;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Build ONE pooled contact-shadow blob: a flat circle pinned face-up to the grid plane, reading its
 * alpha from the shared falloff `alpha` texture. Each blob owns its OWN material (per-instance opacity
 * tweens must not cross-stomp a sibling - mirrors `cloneQuarryMaterials`'s rationale in meshes.ts) but
 * every blob shares the same texture. Starts invisible/transparent; the layer poses + reveals it via
 * `shadowPose`.
 */
export function createShadowBlob(alpha: DataTexture): Mesh {
  const geometry = new CircleGeometry(0.5, 24);
  const material = new MeshBasicMaterial({
    color: parseInt(hex.ink.replace('#', ''), 16),
    alphaMap: alpha,
    transparent: true,
    depthWrite: false,
    opacity: 0,
  });
  const mesh = new Mesh(geometry, material);
  // Flat on the grid plane, long axis spun onto the anti-sun throw (see SHADOW_SPIN's derivation).
  mesh.rotation.set(-Math.PI / 2, 0, SHADOW_SPIN);
  mesh.name = SHADOW_NAME;
  mesh.renderOrder = 1; // draw after the grid; paired with depthWrite:false avoids z-fighting
  mesh.visible = false;
  return mesh;
}

/** Pure pose data for one contact-shadow blob: where to pin it, how big, and how dark. */
export interface ShadowPose {
  x: number;
  y: number;
  z: number;
  scale: number;
  opacity: number;
}

/**
 * Compute the contact-shadow pose for a quarry at `pos`, or `null` if it should have no shadow at all.
 * `baseScale` is the blob's neutral footprint size (typically derived from the quarry's own scale).
 *
 * - h = pos.y - ARENA_GROUND_Y; h <= SHADOW_EPS (at or below the plane) -> null, no blob.
 * - y is pinned to ARENA_GROUND_Y + SHADOW_EPS regardless of quarry height (a flat pool on the real
 *   floor, lifted just enough to avoid z-fighting the grid).
 * - x/z sit at the quarry's ground point, then slide along SHADOW_THROW so the ellipse's near edge
 *   stays anchored at the stance while the long tail spills away from the sun (toward the viewer).
 * - scale grows gently with height: a higher quarry casts a broader, softer-edged pool.
 * - opacity falls off with height: contact reads strong near the plane, fades toward nothing aloft.
 *
 * The consumer applies the anisotropy: scale.set(scale * SHADOW_WIDE, scale * SHADOW_STRETCH, 1)
 * on the (already spun) blob - `scale` here is the SHORT-axis world footprint.
 */
export function shadowPose(pos: { x: number; y: number; z: number }, baseScale: number): ShadowPose | null {
  const h = pos.y - ARENA_GROUND_Y;
  if (h <= SHADOW_EPS) return null;
  const scale = baseScale * (0.9 + 0.1 * h);
  // Near edge at the stance: center = base point + throw * (long semi-axis - short semi-axis).
  const slide = (scale * SHADOW_STRETCH - scale) / 2;
  return {
    x: pos.x + SHADOW_THROW[0] * slide,
    y: ARENA_GROUND_Y + SHADOW_EPS,
    z: pos.z + SHADOW_THROW[1] * slide,
    scale,
    opacity: SHADOW_MAX_OPACITY / (1 + h / SHADOW_FALLOFF_H),
  };
}

/** Dispose a shadow blob's geometry + its own material (NOT the shared texture - see createShadowTexture). */
export function disposeShadowBlob(m: Mesh): void {
  m.geometry.dispose();
  (m.material as MeshBasicMaterial).dispose();
}
