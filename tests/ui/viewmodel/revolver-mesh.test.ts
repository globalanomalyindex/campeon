import { describe, it, expect } from 'vitest';
import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import {
  revolverMesh,
  createRevolverMaterials,
  revolverMaterialList,
  MUZZLE_FLASH_NAME,
  VIEWMODEL_RENDER_ORDER,
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
    // steel/wood/brass are lit MeshStandardMaterials; the fourth (flash) is an unlit MeshBasicMaterial.
    for (const m of list) {
      expect(m instanceof MeshStandardMaterial || m instanceof MeshBasicMaterial).toBe(true);
    }
  });

  it('createRevolverMaterials includes a fourth additive-gold flash material in the disposal list', () => {
    const mats: RevolverMaterials = createRevolverMaterials();
    expect(mats.flash).toBeInstanceOf(MeshBasicMaterial);
    expect(`#${mats.flash.color.getHexString()}`.toLowerCase()).toBe(hex.gold.toLowerCase());
    expect(mats.flash.transparent).toBe(true);
    expect(mats.flash.opacity).toBe(0);
    expect(mats.flash.blending).toBe(AdditiveBlending);
    expect(mats.flash.depthTest).toBe(false);
    expect(mats.flash.depthWrite).toBe(false);

    const list = revolverMaterialList(mats);
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(list).toContain(mats.flash);
  });
});

describe('muzzle flash group', () => {
  function findFlash(g: Group): Group {
    const f = g.getObjectByName(MUZZLE_FLASH_NAME);
    expect(f, 'muzzle flash group present').toBeTruthy();
    return f as Group;
  }

  it('is a hidden group named MUZZLE_FLASH_NAME at the barrel tip', () => {
    const flash = findFlash(revolverMesh());
    expect(flash).toBeInstanceOf(Group);
    expect(flash.visible).toBe(false);
    expect(flash.position.x).toBeCloseTo(0, 12);
    expect(flash.position.y).toBeCloseTo(0.02, 12);
    expect(flash.position.z).toBeCloseTo(-0.37, 12);
  });

  it('is built from crossed petals + a center quad, all using the additive gold flash material', () => {
    const flash = findFlash(revolverMesh());
    const meshes: Mesh[] = [];
    flash.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o as Mesh);
    });
    // three crossed petals + one center quad
    expect(meshes.length).toBe(4);
    for (const m of meshes) {
      const mat = m.material as MeshBasicMaterial;
      expect(mat).toBeInstanceOf(MeshBasicMaterial);
      expect(`#${mat.color.getHexString()}`.toLowerCase()).toBe(hex.gold.toLowerCase());
      expect(mat.blending).toBe(AdditiveBlending);
      expect(mat.depthTest).toBe(false);
      expect(mat.depthWrite).toBe(false);
      // draws even later than the rest of the viewmodel, so it composites on top of the gun too.
      expect(m.renderOrder).toBeGreaterThan(VIEWMODEL_RENDER_ORDER);
    }
  });

  it('the three petals are rotated 0/60/120 degrees around Z', () => {
    const flash = findFlash(revolverMesh());
    const meshes: Mesh[] = [];
    flash.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o as Mesh);
    });
    const rotations = meshes.map((m) => m.rotation.z).sort((a, b) => a - b);
    const expected = [0, Math.PI / 3, (2 * Math.PI) / 3].sort((a, b) => a - b);
    // one of the four meshes is the center quad (rotation 0 too, most likely) - just assert the
    // distinct petal angles 0/60/120 are all present among the meshes' Z rotations.
    for (const e of expected) {
      expect(rotations.some((r) => Math.abs(r - e) < 1e-9)).toBe(true);
    }
  });
});
