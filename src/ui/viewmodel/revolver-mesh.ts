import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  type Object3D,
} from 'three';
import { hex } from '../../palette';

/**
 * PURE procedural-geometry factory for the in-scene 3D first-person VIEWMODEL: a Colt-style
 * single-action WESTERN revolver (NOT a Deagle). It replaces the flat chrome-Deagle 2D sprite overlay.
 *
 * The group is parented to the camera by the viewmodel layer, so it follows the view for free and
 * inherits the arena's warm hemisphere/key light + film pass. It is PURELY cosmetic: it never reads
 * view()/bearing()/radiusDeg() and never writes a sample/score/Observation. It is pure THREE - safe to
 * unit-test without a WebGL context.
 *
 * Render contract (verified in the unit test): every mesh draws with `depthTest:false` and a LATE
 * `renderOrder`, so the gun is composited on top of the world and can NEVER clip world geometry nor
 * occlude the (visible=false) hidden gold sphere the instruments score against.
 *
 * Built from cylinder + box primitives (barrel, cylinder/chamber, frame, grip, hammer, trigger guard)
 * with gunmetal / wood / brass MeshStandardMaterials sourced ONLY from `src/palette.ts` (no hardcoded
 * hex). First-pass FUNCTIONAL geometry; the human iterates the silhouette + the recoil/sway FEEL in
 * Chromium afterward.
 */

/** Late draw order so the viewmodel composites on top of the whole world. */
export const VIEWMODEL_RENDER_ORDER = 999;

/** Name of the muzzle-flash group, parented at the barrel tip (hidden until `fire()`). */
export const MUZZLE_FLASH_NAME = 'revolver-flash';

/** The four materials a revolver is built from - all from palette.ts. */
export interface RevolverMaterials {
  /** Case-hardened steel: frame, barrel, cylinder. */
  steel: MeshStandardMaterial;
  /** Walnut grip. */
  wood: MeshStandardMaterial;
  /** Brass accents: trigger guard, hammer. */
  brass: MeshStandardMaterial;
  /**
   * Muzzle-flash: additive gold, unlit (MeshBasicMaterial so it ignores the scene's lighting - a
   * flash is a light SOURCE, not a lit surface). Opacity is tweened by viewmodel-3d's `flashPose`.
   * Additive blending + gold color so the film pass's gold-selective bloom (built in parallel) picks
   * it up and blooms the flash without touching anything else on screen.
   */
  flash: MeshBasicMaterial;
}

function parseHex(h: string): number {
  return parseInt(h.replace('#', ''), 16);
}

/**
 * A viewmodel material: `depthTest:false` so it is never occluded by (and never occludes) world depth,
 * and `depthWrite:false` so it does not pollute the depth buffer for anything drawn after it. The LATE
 * renderOrder (set on each mesh) guarantees it draws after the world.
 */
const mkMat = (color: number, opts: { metalness: number; roughness: number }): MeshStandardMaterial =>
  new MeshStandardMaterial({
    color,
    metalness: opts.metalness,
    roughness: opts.roughness,
    flatShading: true,
    depthTest: false,
    depthWrite: false,
  });

/**
 * The muzzle-flash material: additive gold, fully transparent at rest (viewmodel-3d's `flashPose`
 * drives opacity up on `fire()` and back to 0 as it fades). `depthTest:false` so it is never occluded
 * by (and never occludes) world depth, matching the rest of the viewmodel's render contract - but it
 * is a MeshBasicMaterial (NOT MeshStandardMaterial), so it ignores scene lighting entirely: a flash is
 * an emitted light source, not a lit surface.
 */
const mkFlashMat = (color: number): MeshBasicMaterial =>
  new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });

/** Build a fresh, group-owned set of palette materials. Dispose all via `revolverMaterialList()`. */
export function createRevolverMaterials(): RevolverMaterials {
  return {
    // Low metalness on the steel/brass so they read as lit form under direct light WITHOUT an
    // environment map (a high-metalness PBR surface with nothing to reflect renders near-black). This
    // is the stylized low-poly read, not photoreal chrome.
    steel: mkMat(parseHex(hex.gunmetal), { metalness: 0.35, roughness: 0.5 }),
    wood: mkMat(parseHex(hex.wood), { metalness: 0.0, roughness: 0.7 }),
    brass: mkMat(parseHex(hex.brass), { metalness: 0.45, roughness: 0.4 }),
    flash: mkFlashMat(parseHex(hex.gold)),
  };
}

/** Every material in a set, for disposal. */
export function revolverMaterialList(m: RevolverMaterials): readonly (MeshStandardMaterial | MeshBasicMaterial)[] {
  return [m.steel, m.wood, m.brass, m.flash];
}

function part(
  geom: ConstructorParameters<typeof Mesh>[0],
  mat: MeshStandardMaterial,
  place: (m: Mesh) => void,
): Mesh {
  const m = new Mesh(geom, mat);
  m.renderOrder = VIEWMODEL_RENDER_ORDER; // draw LATE - on top of the world
  place(m);
  return m;
}

/**
 * Build the hidden muzzle-flash group: three crossed petals (fanned 0/60/120 degrees around Z) plus
 * one small center quad, all sharing `flashMat`. Parented at the barrel tip. `renderOrder` is one past
 * `VIEWMODEL_RENDER_ORDER` so the flash composites on top of the revolver itself, not just the world.
 * `visible = false` at rest; viewmodel-3d flips it on for the duration of `flashPose`.
 */
function buildMuzzleFlash(flashMat: MeshBasicMaterial): Group {
  const flash = new Group();
  flash.name = MUZZLE_FLASH_NAME;
  flash.position.set(0, 0.02, -0.37); // the barrel tip
  flash.visible = false;

  const petalAngles = [0, (60 * Math.PI) / 180, (120 * Math.PI) / 180];
  for (const rot of petalAngles) {
    const petal = new Mesh(new PlaneGeometry(0.06, 0.02), flashMat);
    petal.rotation.z = rot;
    petal.renderOrder = VIEWMODEL_RENDER_ORDER + 1;
    flash.add(petal);
  }
  const center = new Mesh(new PlaneGeometry(0.02, 0.02), flashMat);
  center.renderOrder = VIEWMODEL_RENDER_ORDER + 1;
  flash.add(center);

  return flash;
}

/**
 * Assemble the Colt-style single-action revolver from primitives. Dimensions are in a compact local
 * space (~0.4 long); the viewmodel layer positions/scales the whole group in front of the camera and
 * the recoil/sway springs tween its local transform. -Z is forward (the barrel points down -Z, away
 * from the viewer), matching the camera's forward axis.
 */
export function revolverMesh(materials: RevolverMaterials = createRevolverMaterials()): Group {
  const g = new Group();
  g.name = 'revolver';

  const parts: Object3D[] = [];

  // Barrel: a long octagonal-ish cylinder lying along -Z (forward).
  parts.push(
    part(new CylinderGeometry(0.028, 0.03, 0.34, 8), materials.steel, (o) => {
      o.rotation.x = Math.PI / 2; // lie along Z
      o.position.set(0, 0.02, -0.2);
    }),
  );
  // Cylinder / chamber: a fatter short cylinder behind the barrel.
  parts.push(
    part(new CylinderGeometry(0.05, 0.05, 0.09, 12), materials.steel, (o) => {
      o.rotation.x = Math.PI / 2;
      o.position.set(0, 0.02, 0.0);
    }),
  );
  // Frame: a small box wrapping the rear of the cylinder.
  parts.push(
    part(new BoxGeometry(0.05, 0.07, 0.1), materials.steel, (o) => {
      o.position.set(0, 0.01, 0.07);
    }),
  );
  // Hammer: a small brass block reared at the back-top of the frame.
  parts.push(
    part(new BoxGeometry(0.022, 0.045, 0.03), materials.brass, (o) => {
      o.rotation.x = -0.5;
      o.position.set(0, 0.06, 0.11);
    }),
  );
  // Trigger guard: a thin brass loop under the frame (approximated by a flat ring-ish box arc).
  parts.push(
    part(new CylinderGeometry(0.024, 0.024, 0.018, 12), materials.brass, (o) => {
      o.position.set(0, -0.04, 0.085);
    }),
  );
  // Grip: a walnut wedge angled back-down (the plowhandle SAA grip).
  parts.push(
    part(new BoxGeometry(0.045, 0.16, 0.06), materials.wood, (o) => {
      o.rotation.x = 0.45; // raked back like a single-action grip
      o.position.set(0, -0.1, 0.13);
    }),
  );

  for (const p of parts) g.add(p);
  g.add(buildMuzzleFlash(materials.flash));
  return g;
}
