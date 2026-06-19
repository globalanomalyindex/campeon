import { describe, it, expect } from 'vitest';
import { Group, Mesh, MeshStandardMaterial } from 'three';
import {
  revolverMesh,
  createRevolverMaterials,
  revolverMaterialList,
  type RevolverMaterials,
} from '../../../src/ui/viewmodel/revolver-mesh';
import { hex } from '../../../src/palette';

/** All palette hex values, lower-cased, for membership checks against material colors. */
const PALETTE = new Set(Object.values(hex).map((h) => h.toLowerCase()));

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

describe('revolverMesh factory', () => {
  it('returns a fresh THREE.Group of primitive meshes', () => {
    const a = revolverMesh();
    const b = revolverMesh();
    expect(a).toBeInstanceOf(Group);
    expect(b).toBeInstanceOf(Group);
    expect(a).not.toBe(b);
    expect(materialsOf(a).length).toBeGreaterThan(0);
  });

  it('uses ONLY palette-derived MeshStandardMaterials (no hardcoded hex)', () => {
    for (const m of materialsOf(revolverMesh())) {
      const color = `#${m.color.getHexString()}`.toLowerCase();
      expect(PALETTE.has(color), `color ${color} from palette`).toBe(true);
    }
  });

  it('builds from gunmetal + wood + brass (the western revolver palette)', () => {
    const colors = new Set(materialsOf(revolverMesh()).map((m) => `#${m.color.getHexString()}`.toLowerCase()));
    expect(colors.has(hex.gunmetal.toLowerCase())).toBe(true);
    expect(colors.has(hex.wood.toLowerCase())).toBe(true);
    expect(colors.has(hex.brass.toLowerCase())).toBe(true);
  });

  it('renders LATE with depthTest off so it never clips world geometry nor occludes the sphere', () => {
    revolverMesh().traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      // A high renderOrder draws it after the world; depthTest:false keeps it on top of everything.
      expect(mesh.renderOrder).toBeGreaterThan(0);
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        expect((mat as MeshStandardMaterial).depthTest).toBe(false);
      }
    });
  });

  it('exposes NO scored API (no bearing/radiusDeg/cm360/sample/score/observation on the group)', () => {
    const banned = ['bearing', 'radiusDeg', 'cm360', 'sample', 'score', 'observation', 'view'];
    const g = revolverMesh() as unknown as Record<string, unknown>;
    for (const k of banned) {
      expect(g[k], `revolver.${k} must not exist`).toBeUndefined();
    }
  });

  it('createRevolverMaterials + revolverMaterialList round-trip for disposal', () => {
    const mats: RevolverMaterials = createRevolverMaterials();
    const list = revolverMaterialList(mats);
    expect(list.length).toBeGreaterThanOrEqual(3);
    for (const m of list) expect(m).toBeInstanceOf(MeshStandardMaterial);
  });
});
