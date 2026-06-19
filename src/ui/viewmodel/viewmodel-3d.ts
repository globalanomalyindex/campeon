import { Group, Mesh, type PerspectiveCamera, type Scene } from 'three';
import type { Degrees } from '../../types';
import type { ViewmodelLayer } from '../../engine/arena';
import { restSway, kick, stepSway, type SwayState } from './sway';
import { restRecoil, punch, stepRecoil, type RecoilState } from './recoil';
import { createRevolverMaterials, revolverMaterialList, revolverMesh, type RevolverMaterials } from './revolver-mesh';

/**
 * In-scene 3D first-person VIEWMODEL: a procedural western single-action revolver parented to the
 * camera. It replaces the flat chrome-Deagle 2D sprite overlay (which stays importable as a fallback).
 *
 * Attaches through the NEW `Arena.attachViewmodel(vm)` seam, MIRRORING `attachEnemies` exactly (a
 * cosmetic sibling that only READS fire()/look() and writes nothing into the scored stream): `attach`
 * parents the revolver Group as a CHILD of the rig camera (so it follows the view) and adds the camera
 * to the scene (a camera's children only render if the camera is in the scene graph). The gun renders
 * with `depthTest:false` + a late renderOrder (set per-mesh in the factory) so it never clips world
 * geometry nor occludes the (visible=false) hidden gold sphere.
 *
 * The PURE recoil.ts / sway.ts springs (math UNCHANGED) are re-pointed here to drive the Group's local
 * position / rotation / scale instead of blitting a 2D sprite. Consumer GAIN constants (`VM3D_GAIN`)
 * are exposed for later feel-tuning in Chromium; the defaults below are reasoned starting points.
 *
 * Reduced motion: a single static rest pose; the spring tick is skipped entirely.
 *
 * Runtime-only at the WebGL/render layer; the spring math + pose mapping are pure and unit-tested here.
 */

/** The revolver's resting transform in front of the camera (camera-local space; -Z is forward). */
export const REST_POSE = {
  posX: 0.16, // right of center (right-handed shooter)
  posY: -0.14, // below the crosshair
  posZ: -0.42, // forward, in front of the near plane
  rotX: 0.06, // barrel tipped slightly up toward the crosshair
  rotY: -0.18, // yawed inward so the muzzle points toward screen center
  rotZ: 0.0,
  scale: 1.0,
} as const;

export interface ViewmodelPose {
  posX: number;
  posY: number;
  posZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  scale: number;
}

/**
 * Consumer GAINS that map the normalized spring offsets onto the gun's local transform. These are the
 * FEEL knobs (reasoned defaults; tuned in Chromium) - the spring MATH in sway.ts/recoil.ts is unchanged.
 */
export const VM3D_GAIN = {
  /** Lateral sway: sway.x (normalized) → local X metres. */
  swayX: 0.5,
  /** Vertical sway: sway.y (normalized) → local Y metres. */
  swayY: 0.5,
  /** Sway roll: sway.x → local Z roll (rad), the parallax tilt the 2D sprite had. */
  swayRoll: 0.6,
  /** Recoil vertical kick: recoil.y → local Y lift (metres) - the muzzle rises. */
  recoilLift: 0.6,
  /** Recoil muzzle-rise pitch: recoil.y → local X rotation (rad). */
  recoilPitch: 0.5,
  /** Recoil backward lunge: recoil.back → local +Z (toward the viewer) metres. */
  recoilBack: 0.25,
  /** Recoil scale lunge: recoil.back → uniform scale-up. */
  recoilScale: 0.12,
} as const;

/**
 * PURE mapping from the two spring states to the gun's local transform. Sway is the slow camera-driven
 * parallax (lateral/vertical offset + a little roll); recoil is the sharp fire-driven snap (the muzzle
 * lifts + pitches up, the gun lunges toward the viewer and scales up briefly). Summed onto REST_POSE.
 */
export function poseFromSprings(sway: SwayState, recoil: RecoilState): ViewmodelPose {
  return {
    posX: REST_POSE.posX + sway.x * VM3D_GAIN.swayX,
    posY: REST_POSE.posY + sway.y * VM3D_GAIN.swayY + recoil.y * VM3D_GAIN.recoilLift,
    posZ: REST_POSE.posZ + recoil.back * VM3D_GAIN.recoilBack,
    rotX: REST_POSE.rotX + recoil.y * VM3D_GAIN.recoilPitch,
    rotY: REST_POSE.rotY,
    rotZ: REST_POSE.rotZ + sway.x * VM3D_GAIN.swayRoll,
    scale: REST_POSE.scale + recoil.back * VM3D_GAIN.recoilScale,
  };
}

export interface Viewmodel3D {
  /** The revolver group (parented to the camera on attach). Exposed for tests + the attach seam. */
  readonly group: Group;
  /** Parent the gun under `camera` and add the camera to `scene` so its children render. */
  attach(scene: Scene, camera: PerspectiveCamera): void;
  /** Advance the springs and re-pose the gun. No-op under reduced motion. `nowMs` is the rAF clock. */
  tick(nowMs: number): void;
  /** Nudge the weapon-sway spring by a camera look delta (degrees). Cosmetic; no-op under reduced motion. */
  look(dYawDeg: number, dPitchDeg: number): void;
  /** Fire: inject a recoil punch. Cosmetic; no-op recoil under reduced motion. */
  fire(): void;
  dispose(): void;
}

function applyPose(group: Group, pose: ViewmodelPose): void {
  group.position.set(pose.posX, pose.posY, pose.posZ);
  group.rotation.set(pose.rotX, pose.rotY, pose.rotZ);
  group.scale.setScalar(pose.scale);
}

export function createViewmodel3D(opts: { reducedMotion?: boolean } = {}): Viewmodel3D {
  const reduced = opts.reducedMotion ?? false;
  const materials: RevolverMaterials = createRevolverMaterials();
  const group = revolverMesh(materials);

  let sway: SwayState = restSway();
  let recoil: RecoilState = restRecoil();
  let lastMs = 0;
  let scene: Scene | null = null;
  let camera: PerspectiveCamera | null = null;

  // Start at the static rest pose (also the only pose under reduced motion).
  applyPose(group, poseFromSprings(sway, recoil));

  return {
    group,
    attach(s: Scene, cam: PerspectiveCamera): void {
      scene = s;
      camera = cam;
      cam.add(group); // the gun follows the view
      if (cam.parent !== s) s.add(cam); // a camera's children render only if the camera is in the graph
    },
    tick(nowMs: number): void {
      if (reduced) return; // static rest pose; skip the spring tick entirely
      const dt = lastMs === 0 ? 1 / 60 : Math.min(0.05, (nowMs - lastMs) / 1000);
      lastMs = nowMs;
      sway = stepSway(sway, dt);
      recoil = stepRecoil(recoil, dt);
      applyPose(group, poseFromSprings(sway, recoil));
    },
    look(dYawDeg: number, dPitchDeg: number): void {
      if (!reduced) sway = kick(sway, dYawDeg, dPitchDeg);
    },
    fire(): void {
      if (!reduced) recoil = punch(recoil);
    },
    dispose(): void {
      if (camera) camera.remove(group);
      if (scene && camera && camera.parent === scene) scene.remove(camera);
      group.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      for (const m of revolverMaterialList(materials)) m.dispose();
      scene = null;
      camera = null;
    },
  };
}

/**
 * Wrap a `Viewmodel3D` into the arena's `ViewmodelLayer` seam: the arena hands the layer the absolute
 * crosshair `view` on each aim sample + each shot, so the adapter tracks the previous view and feeds a
 * DELTA into the (unchanged) sway spring. `fire`'s view is unused (recoil is fire-driven, not aim-driven)
 * but accepted to honor the reads-never-writes shape. Purely cosmetic - nothing here touches scoring.
 */
export function asViewmodelLayer(vm: Viewmodel3D): ViewmodelLayer {
  let prevView: [Degrees, Degrees] | null = null;
  return {
    attach(scene, camera) {
      vm.attach(scene, camera);
    },
    tick(nowMs) {
      vm.tick(nowMs);
    },
    look(view) {
      if (prevView) vm.look(view[0] - prevView[0], view[1] - prevView[1]);
      prevView = view;
    },
    fire(_view) {
      vm.fire();
    },
    dispose() {
      vm.dispose();
    },
  };
}
