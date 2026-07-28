import { describe, it, expect } from 'vitest';
import { CircleGeometry, DataTexture, Mesh, MeshBasicMaterial } from 'three';
import {
  SHADOW_NAME,
  SHADOW_MAX_OPACITY,
  SHADOW_FALLOFF_H,
  SHADOW_EPS,
  SHADOW_SPIN,
  SHADOW_STRETCH,
  SHADOW_THROW,
  createShadowTexture,
  createShadowBlob,
  shadowPose,
  disposeShadowBlob,
  type ShadowPose,
} from '../../../src/ui/enemy/shadow';
import { hex } from '../../../src/palette';
import { ARENA_GROUND_Y } from '../../../src/engine/arena';
import { SUN_DIR } from '../../../src/engine/environment';

describe('createShadowTexture', () => {
  it('is a 64x64 DataTexture with needsUpdate set', () => {
    const tex = createShadowTexture();
    expect(tex).toBeInstanceOf(DataTexture);
    expect(tex.image.width).toBe(64);
    expect(tex.image.height).toBe(64);
    // needsUpdate is a write-only setter that bumps `version` - assert the effect, not the accessor.
    expect(tex.version).toBeGreaterThan(0);
  });

  it('green channel is 255 at the center and 0 at the corners', () => {
    const tex = createShadowTexture();
    const data = tex.image.data as Uint8Array;
    const w = tex.image.width;
    const h = tex.image.height;

    const greenAt = (x: number, y: number): number => data[(y * w + x) * 4 + 1];

    // Center texel (approx, since 64 is even there's no exact single center - use the 2x2 middle).
    const centerVals = [greenAt(31, 31), greenAt(32, 31), greenAt(31, 32), greenAt(32, 32)];
    expect(Math.max(...centerVals)).toBe(255);

    // Corners should be 0 (rim reaches 0 before the corners).
    expect(greenAt(0, 0)).toBe(0);
    expect(greenAt(w - 1, 0)).toBe(0);
    expect(greenAt(0, h - 1)).toBe(0);
    expect(greenAt(w - 1, h - 1)).toBe(0);
  });

  it('green channel is monotone non-increasing along a radial ray from center', () => {
    const tex = createShadowTexture();
    const data = tex.image.data as Uint8Array;
    const w = tex.image.width;
    const greenAt = (x: number, y: number): number => data[(y * w + x) * 4 + 1];

    const cx = 31.5;
    const cy = 31.5;
    let prev = greenAt(32, 32);
    for (let x = 32; x < w; x++) {
      const y = Math.round(cy + (x - cx)); // ray along the diagonal from center
      if (y < 0 || y >= w) break;
      const g = greenAt(x, y);
      expect(g).toBeLessThanOrEqual(prev);
      prev = g;
    }
  });
});

describe('createShadowBlob', () => {
  const tex = createShadowTexture();

  it('is named, flat, spun onto the anti-sun throw, and built from the shared texture', () => {
    const blob = createShadowBlob(tex);
    expect(blob).toBeInstanceOf(Mesh);
    expect(blob.name).toBe(SHADOW_NAME);
    expect(blob.rotation.x).toBeCloseTo(-Math.PI / 2, 12);
    expect(blob.rotation.z).toBeCloseTo(SHADOW_SPIN, 12);
    expect(blob.geometry).toBeInstanceOf(CircleGeometry);
  });

  it('material is transparent, does not write depth, and uses palette ink', () => {
    const blob = createShadowBlob(tex);
    const mat = blob.material as MeshBasicMaterial;
    expect(mat).toBeInstanceOf(MeshBasicMaterial);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(`#${mat.color.getHexString()}`.toLowerCase()).toBe(hex.ink.toLowerCase());
    expect(mat.alphaMap).toBe(tex);
  });

  it('starts invisible with zero opacity, and renders after the grid (renderOrder 1)', () => {
    const blob = createShadowBlob(tex);
    expect(blob.visible).toBe(false);
    const mat = blob.material as MeshBasicMaterial;
    expect(mat.opacity).toBe(0);
    expect(blob.renderOrder).toBe(1);
  });

  it('each blob owns its own material instance (no cross-instance stomping)', () => {
    const a = createShadowBlob(tex);
    const b = createShadowBlob(tex);
    expect(a.material).not.toBe(b.material);
    (a.material as MeshBasicMaterial).opacity = 0.4;
    expect((b.material as MeshBasicMaterial).opacity).toBe(0);
  });

  it('exposes NO scored API (no bearing/radiusDeg/counts/sample/score/observation on the mesh)', () => {
    const banned = ['bearing', 'radiusDeg', 'counts', 'sample', 'score', 'observation', 'view'];
    const blob = createShadowBlob(tex) as unknown as Record<string, unknown>;
    for (const k of banned) {
      expect(blob[k], `blob.${k} must not exist`).toBeUndefined();
    }
  });
});

describe('shadowPose', () => {
  const baseScale = 1;

  it('returns null at or below the ground plane (h <= SHADOW_EPS)', () => {
    expect(shadowPose({ x: 0, y: ARENA_GROUND_Y, z: 0 }, baseScale)).toBeNull();
    expect(shadowPose({ x: 0, y: ARENA_GROUND_Y - 5, z: 0 }, baseScale)).toBeNull();
    expect(shadowPose({ x: 0, y: ARENA_GROUND_Y + SHADOW_EPS, z: 0 }, baseScale)).toBeNull();
    expect(shadowPose({ x: 0, y: ARENA_GROUND_Y + SHADOW_EPS * 0.5, z: 0 }, baseScale)).toBeNull();
  });

  it('pins y to ARENA_GROUND_Y + SHADOW_EPS whenever a pose is returned', () => {
    for (const h of [0.02, 0.5, 2, 4, 10]) {
      const pose = shadowPose({ x: 1, y: ARENA_GROUND_Y + h, z: 2 }, baseScale) as ShadowPose;
      expect(pose).not.toBeNull();
      expect(pose.y).toBeCloseTo(ARENA_GROUND_Y + SHADOW_EPS, 12);
      // x/z sit at the ground point PLUS the dusk slide along the throw (near edge at the stance).
      const slide = (pose.scale * SHADOW_STRETCH - pose.scale) / 2;
      expect(pose.x).toBeCloseTo(1 + SHADOW_THROW[0] * slide, 12);
      expect(pose.z).toBeCloseTo(2 + SHADOW_THROW[1] * slide, 12);
    }
  });

  it('SHADOW_THROW is the unit horizontal ANTI-sun direction (env map, rim, and floor agree)', () => {
    expect(Math.hypot(SHADOW_THROW[0], SHADOW_THROW[1])).toBeCloseTo(1, 12);
    // Anti-parallel to the sun's ground projection: negative dot, and exactly opposite direction.
    const sunGround = [SUN_DIR[0], SUN_DIR[2]];
    const dot = SHADOW_THROW[0] * sunGround[0] + SHADOW_THROW[1] * sunGround[1];
    expect(dot).toBeLessThan(0);
    expect(SHADOW_THROW[0] * sunGround[1] - SHADOW_THROW[1] * sunGround[0]).toBeCloseTo(0, 12); // parallel
  });

  it('opacity is strictly decreasing in height and never exceeds SHADOW_MAX_OPACITY', () => {
    const heights = [0.02, 0.2, 1, SHADOW_FALLOFF_H, SHADOW_FALLOFF_H * 3];
    let prevOpacity = Infinity;
    for (const h of heights) {
      const pose = shadowPose({ x: 0, y: ARENA_GROUND_Y + h, z: 0 }, baseScale) as ShadowPose;
      expect(pose.opacity).toBeLessThanOrEqual(SHADOW_MAX_OPACITY);
      expect(pose.opacity).toBeLessThan(prevOpacity);
      prevOpacity = pose.opacity;
    }
  });

  it('scale is strictly increasing in height', () => {
    const heights = [0.02, 0.2, 1, 4, 10];
    let prevScale = -Infinity;
    for (const h of heights) {
      const pose = shadowPose({ x: 0, y: ARENA_GROUND_Y + h, z: 0 }, baseScale) as ShadowPose;
      expect(pose.scale).toBeGreaterThan(prevScale);
      prevScale = pose.scale;
    }
  });

  it('is a pure function: same input yields the same output', () => {
    const pos = { x: 3, y: ARENA_GROUND_Y + 1.5, z: -2 };
    const a = shadowPose(pos, 1.2);
    const b = shadowPose(pos, 1.2);
    expect(a).toEqual(b);
  });

  it('scale honors the baseScale multiplier', () => {
    const pos = { x: 0, y: ARENA_GROUND_Y + 1, z: 0 };
    const a = shadowPose(pos, 1) as ShadowPose;
    const b = shadowPose(pos, 2) as ShadowPose;
    expect(b.scale).toBeCloseTo(a.scale * 2, 12);
  });
});

describe('disposeShadowBlob', () => {
  it('disposes the geometry and the material, but not the shared texture', () => {
    const tex = createShadowTexture();
    const blob = createShadowBlob(tex);
    let geomDisposed = false;
    let matDisposed = false;
    const origGeomDispose = blob.geometry.dispose.bind(blob.geometry);
    blob.geometry.dispose = () => {
      geomDisposed = true;
      origGeomDispose();
    };
    const mat = blob.material as MeshBasicMaterial;
    const origMatDispose = mat.dispose.bind(mat);
    mat.dispose = () => {
      matDisposed = true;
      origMatDispose();
    };
    let texDisposed = false;
    const origTexDispose = tex.dispose.bind(tex);
    tex.dispose = () => {
      texDisposed = true;
      origTexDispose();
    };

    disposeShadowBlob(blob);

    expect(geomDisposed).toBe(true);
    expect(matDisposed).toBe(true);
    expect(texDisposed).toBe(false);
  });
});
