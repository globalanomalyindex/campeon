import { describe, it, expect } from 'vitest';
import { Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import {
  quarryMesh,
  WEAKSPOT_NAME,
  ENEMY_SIZE_K,
  MIN_ENEMY_HEIGHT,
  quarryWorldHeight,
  type QuarryMesh,
} from '../../../src/ui/enemy/meshes';
import { hex } from '../../../src/palette';
import type { InstrumentId } from '../../../src/types';

const ALL: InstrumentId[] = ['track', 'flick', 'calibrate', 'strike'];

/** All palette hex values, lower-cased, for membership checks against material colors. */
const PALETTE = new Set(Object.values(hex).map((h) => h.toLowerCase()));

/** Collect every MeshStandardMaterial used anywhere in a group's subtree. */
function materialsOf(g: Group): MeshStandardMaterial[] {
  const out: MeshStandardMaterial[] = [];
  g.traverse((o) => {
    if ((o as Mesh).isMesh) {
      const m = (o as Mesh).material;
      for (const mat of Array.isArray(m) ? m : [m]) {
        if (mat instanceof MeshStandardMaterial) out.push(mat);
      }
    }
  });
  return out;
}

function findWeakspot(g: QuarryMesh): Mesh {
  const w = g.getObjectByName(WEAKSPOT_NAME);
  expect(w, 'weak-spot marker present').toBeTruthy();
  return w as Mesh;
}

describe('quarryMesh factory', () => {
  it('returns a distinct THREE.Group per instrument id', () => {
    for (const id of ALL) {
      const g = quarryMesh(id);
      expect(g).toBeInstanceOf(Group);
    }
    // distinct silhouettes: differing child counts or geometry is not asserted here,
    // but each must at minimum be its own Group instance.
    const a = quarryMesh('track');
    const b = quarryMesh('track');
    expect(a).not.toBe(b);
  });

  it('each carries an EMISSIVE weak-spot marker at LOCAL ORIGIN (0,0,0)', () => {
    for (const id of ALL) {
      const g = quarryMesh(id);
      const ws = findWeakspot(g);
      // The weak-spot sits coincident with the hidden gold sphere center.
      const p = new Vector3();
      ws.getWorldPosition(p); // group is at origin in the test, so world == local
      expect(p.x).toBe(0);
      expect(p.y).toBe(0);
      expect(p.z).toBe(0);
      expect(ws.position.x).toBe(0);
      expect(ws.position.y).toBe(0);
      expect(ws.position.z).toBe(0);
      // It is emissive and gold (the crosshair-legible weak-spot anchor).
      const mat = ws.material as MeshStandardMaterial;
      expect(mat.emissiveIntensity).toBeGreaterThan(0);
      expect(`#${mat.emissive.getHexString()}`.toLowerCase()).toBe(hex.gold.toLowerCase());
    }
  });

  it('uses ONLY palette-derived MeshStandardMaterials (no hardcoded hex)', () => {
    for (const id of ALL) {
      const mats = materialsOf(quarryMesh(id));
      expect(mats.length).toBeGreaterThan(0);
      for (const m of mats) {
        const color = `#${m.color.getHexString()}`.toLowerCase();
        const emissive = `#${m.emissive.getHexString()}`.toLowerCase();
        expect(PALETTE.has(color), `color ${color} from palette`).toBe(true);
        // emissive is either black (off) or a palette color.
        expect(emissive === '#000000' || PALETTE.has(emissive), `emissive ${emissive}`).toBe(true);
      }
    }
  });

  it('exposes NO scored API (no bearing/radiusDeg/cm360/sample/score/observation on the group)', () => {
    const banned = ['bearing', 'radiusDeg', 'cm360', 'sample', 'score', 'observation', 'view'];
    for (const id of ALL) {
      const g = quarryMesh(id) as unknown as Record<string, unknown>;
      for (const k of banned) {
        expect(g[k], `${id}.${k} must not exist`).toBeUndefined();
      }
    }
  });

  it('the group is centered on the weak-spot (origin) so scaling pivots on the hitbox center', () => {
    for (const id of ALL) {
      const g = quarryMesh(id);
      expect(g.position.x).toBe(0);
      expect(g.position.y).toBe(0);
      expect(g.position.z).toBe(0);
    }
  });
});

describe('quarryWorldHeight - unchanged scaling formula', () => {
  it('height = max(MIN, ENEMY_SIZE_K * 2 * dist*tan(radiusDeg))', () => {
    const dist = 20;
    const radiusDeg = 1.5;
    const worldRadius = dist * Math.tan((radiusDeg * Math.PI) / 180);
    const expected = Math.max(MIN_ENEMY_HEIGHT, ENEMY_SIZE_K * 2 * worldRadius);
    expect(quarryWorldHeight(dist, radiusDeg)).toBeCloseTo(expected, 12);
  });

  it('floors tiny targets at MIN_ENEMY_HEIGHT', () => {
    expect(quarryWorldHeight(20, 0.01)).toBe(MIN_ENEMY_HEIGHT);
  });

  it('uses a fallback distance of 20 when dist is 0', () => {
    // mirrors enemy-layer: dist = object.position.length() || 20
    const expected = quarryWorldHeight(20, 1.5);
    expect(quarryWorldHeight(0, 1.5)).toBeCloseTo(expected, 12);
  });
});
