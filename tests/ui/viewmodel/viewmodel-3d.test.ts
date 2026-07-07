import { describe, it, expect } from 'vitest';
import { Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from 'three';
import {
  createViewmodel3D,
  REST_POSE,
  poseFromSprings,
  VM3D_GAIN,
  flashPose,
  FLASH_MS,
  FLASH_ROLL_STEP,
} from '../../../src/ui/viewmodel/viewmodel-3d';
import { restSway, kick, stepSway } from '../../../src/ui/viewmodel/sway';
import { restRecoil, punch, stepRecoil } from '../../../src/ui/viewmodel/recoil';
import { MUZZLE_FLASH_NAME } from '../../../src/ui/viewmodel/revolver-mesh';

describe('viewmodel-3d pose mapping (pure)', () => {
  it('rest springs map to the canonical rest pose', () => {
    const pose = poseFromSprings(restSway(), restRecoil());
    expect(pose.posX).toBeCloseTo(REST_POSE.posX, 12);
    expect(pose.posY).toBeCloseTo(REST_POSE.posY, 12);
    expect(pose.posZ).toBeCloseTo(REST_POSE.posZ, 12);
    expect(pose.rotX).toBeCloseTo(REST_POSE.rotX, 12);
    expect(pose.rotY).toBeCloseTo(REST_POSE.rotY, 12);
    expect(pose.rotZ).toBeCloseTo(REST_POSE.rotZ, 12);
    expect(pose.scale).toBeCloseTo(REST_POSE.scale, 12);
  });

  it('a fire recoil kicks the muzzle UP (rotX more negative / posY lifts) and lunges the gun back (+Z toward viewer)', () => {
    let r = punch(restRecoil());
    for (let i = 0; i < 4; i++) r = stepRecoil(r, 1 / 60); // let the offset grow
    const pose = poseFromSprings(restSway(), r);
    // back lunge moves the gun toward the viewer (local +Z) and scales it up slightly
    expect(pose.posZ).toBeGreaterThan(REST_POSE.posZ);
    expect(pose.scale).toBeGreaterThan(REST_POSE.scale);
    // vertical kick lifts the gun (muzzle rise) - posY above rest, and a barrel-up pitch (rotX)
    expect(pose.posY).toBeGreaterThan(REST_POSE.posY);
    expect(pose.rotX).not.toBeCloseTo(REST_POSE.rotX, 6);
  });

  it('a look-left sway offsets the gun laterally (reads the SAME sway spring, math unchanged)', () => {
    let s = kick(restSway(), 30, 0); // a deliberate yaw flick
    for (let i = 0; i < 4; i++) s = stepSway(s, 1 / 60);
    const pose = poseFromSprings(s, restRecoil());
    expect(pose.posX).not.toBeCloseTo(REST_POSE.posX, 6);
    // gains are real numbers exposed for later feel-tuning
    expect(Number.isFinite(VM3D_GAIN.swayX)).toBe(true);
    expect(Number.isFinite(VM3D_GAIN.recoilLift)).toBe(true);
  });
});

describe('createViewmodel3D - attach + lifecycle', () => {
  it('attaches the gun group as a CHILD of the camera and the camera to the scene', () => {
    const vm = createViewmodel3D({ reducedMotion: false });
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    vm.attach(scene, camera);
    // camera children render only if the camera is in the scene graph
    expect(camera.parent).toBe(scene);
    // the gun is a child of the camera so it follows the view
    expect(vm.group.parent).toBe(camera);
    vm.dispose();
  });

  it('reduced motion: a fire/look does not move the gun off its static rest pose', () => {
    const vm = createViewmodel3D({ reducedMotion: true });
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    vm.attach(scene, camera);
    const before = vm.group.position.clone();
    vm.look(40, 20);
    vm.fire();
    vm.tick(16);
    vm.tick(320);
    expect(vm.group.position.x).toBeCloseTo(before.x, 12);
    expect(vm.group.position.y).toBeCloseTo(before.y, 12);
    expect(vm.group.position.z).toBeCloseTo(before.z, 12);
    vm.dispose();
  });

  it('non-reduced: a fire moves the gun off rest within a few ticks (springs drive the group)', () => {
    const vm = createViewmodel3D({ reducedMotion: false });
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    vm.attach(scene, camera);
    const restZ = vm.group.position.z;
    vm.fire();
    let t = 0;
    for (let i = 0; i < 5; i++) {
      t += 16;
      vm.tick(t);
    }
    expect(vm.group.position.z).not.toBeCloseTo(restZ, 6);
    vm.dispose();
  });

  it('dispose detaches the gun from the camera and the camera from the scene', () => {
    const vm = createViewmodel3D({ reducedMotion: false });
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    vm.attach(scene, camera);
    vm.dispose();
    expect(vm.group.parent).toBeNull();
  });
});

describe('flashPose (pure)', () => {
  it('is null before the flash window starts', () => {
    expect(flashPose(-1)).toBeNull();
  });

  it('is null at/after FLASH_MS', () => {
    expect(flashPose(FLASH_MS)).toBeNull();
    expect(flashPose(FLASH_MS + 50)).toBeNull();
  });

  it('scale shrinks and opacity fades monotonically across the window', () => {
    const samples = [0, FLASH_MS * 0.25, FLASH_MS * 0.5, FLASH_MS * 0.75, FLASH_MS * 0.99];
    const poses = samples.map((ms) => flashPose(ms));
    for (const p of poses) expect(p).not.toBeNull();
    for (let i = 1; i < poses.length; i++) {
      expect(poses[i]!.scale).toBeLessThan(poses[i - 1]!.scale);
      expect(poses[i]!.opacity).toBeLessThan(poses[i - 1]!.opacity);
    }
    // bounds at the start of the window
    expect(poses[0]!.scale).toBeCloseTo(1.25, 12);
    expect(poses[0]!.opacity).toBeCloseTo(1, 12);
  });
});

describe('muzzle flash group (viewmodel-3d wiring)', () => {
  function findFlash(vm: ReturnType<typeof createViewmodel3D>): Mesh {
    const f = vm.group.getObjectByName(MUZZLE_FLASH_NAME);
    expect(f, 'muzzle flash group present on the gun').toBeTruthy();
    return f as unknown as Mesh;
  }

  it('a fire followed by a tick shows the flash group with opacity > 0', () => {
    const vm = createViewmodel3D({ reducedMotion: false });
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    vm.attach(scene, camera);
    vm.tick(0); // establish lastMs
    vm.fire();
    vm.tick(10);
    const flash = findFlash(vm);
    expect(flash.visible).toBe(true);
    const mat = (flash.children[0] as Mesh).material as MeshBasicMaterial;
    expect(mat.opacity).toBeGreaterThan(0);
    vm.dispose();
  });

  it('hides again once FLASH_MS has elapsed since the shot', () => {
    const vm = createViewmodel3D({ reducedMotion: false });
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    vm.attach(scene, camera);
    vm.tick(0);
    vm.fire();
    vm.tick(10);
    vm.tick(10 + FLASH_MS + 1);
    const flash = findFlash(vm);
    expect(flash.visible).toBe(false);
    const mat = (flash.children[0] as Mesh).material as MeshBasicMaterial;
    expect(mat.opacity).toBe(0);
    vm.dispose();
  });

  it('reduced motion: fire never shows the flash', () => {
    const vm = createViewmodel3D({ reducedMotion: true });
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    vm.attach(scene, camera);
    vm.fire();
    vm.tick(10);
    vm.tick(20);
    const flash = findFlash(vm);
    expect(flash.visible).toBe(false);
    vm.dispose();
  });

  it('two consecutive shots roll the flash to different rotation.z (golden-angle step, deterministic)', () => {
    const vm = createViewmodel3D({ reducedMotion: false });
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    vm.attach(scene, camera);
    vm.tick(0);
    vm.fire();
    vm.tick(10);
    const flash = findFlash(vm);
    const firstRoll = flash.rotation.z;

    vm.fire();
    vm.tick(20);
    const secondRoll = flash.rotation.z;

    expect(secondRoll).not.toBeCloseTo(firstRoll, 6);
    expect(secondRoll - firstRoll).toBeCloseTo(FLASH_ROLL_STEP, 6);
    vm.dispose();
  });
});
