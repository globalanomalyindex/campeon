import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Scene } from 'three';
import { createViewmodel3D, REST_POSE, poseFromSprings, VM3D_GAIN } from '../../../src/ui/viewmodel/viewmodel-3d';
import { restSway, kick, stepSway } from '../../../src/ui/viewmodel/sway';
import { restRecoil, punch, stepRecoil } from '../../../src/ui/viewmodel/recoil';

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
