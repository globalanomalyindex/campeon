import { describe, it, expect } from 'vitest';
import { Group, Mesh, MeshStandardMaterial, Object3D, Scene, Vector3 } from 'three';
import { createEnemyLayer } from '../../../src/ui/enemy/enemy-layer';
import { quarryWorldHeight, WEAKSPOT_NAME } from '../../../src/ui/enemy/meshes';
import type { Degrees, TargetHandle } from '../../../src/types';

/** A bare arena target stand-in: an Object3D at a world position, hidden when the skin attaches. */
function targetAt(x: number, y: number, z: number): Object3D {
  const o = new Object3D();
  o.position.set(x, y, z);
  return o;
}

/** A bearings-only TargetHandle stand-in for fire() (cosmetic classifyHit reads bearing/radius). */
function handleAt(id: string, bearing: [Degrees, Degrees], radiusDeg: Degrees): TargetHandle {
  return { id, bearing: () => bearing, radiusDeg: () => radiusDeg };
}

/** The weak-spot's per-instance emissive intensity (a per-record clone, so safe to read directly). */
function emissiveOf(quarry: Group): number {
  const ws = quarry.getObjectByName(WEAKSPOT_NAME) as Mesh;
  return (ws.material as MeshStandardMaterial).emissiveIntensity;
}

/** Find the single quarry group the layer added to the scene under its container. */
function quarryGroupIn(scene: Scene): Group {
  const layerGroup = scene.getObjectByName('enemy-layer') as Group;
  expect(layerGroup, 'enemy-layer container attached').toBeTruthy();
  const quarry = layerGroup.children.find((c) => (c as Group).isGroup && c.name === 'quarry') as Group;
  expect(quarry, 'one quarry group spawned').toBeTruthy();
  return quarry;
}

describe('enemy-layer (3D quarry)', () => {
  it('keeps the gold sphere visible=false (the arena hides it; the skin owns the visuals)', async () => {
    // The arena is what flips object.visible=false on spawn; the layer must NEVER write it back true.
    // Here we assert the layer does not touch object.visible: a hidden target stays hidden across
    // spawn + update, so the scored sphere is never re-shown by the cosmetic skin.
    const layer = await createEnemyLayer({ reducedMotion: false });
    const scene = new Scene();
    layer.attach(scene);

    const obj = targetAt(0, 0, -20);
    obj.visible = false; // arena hid the scored sphere
    layer.spawn('t0', obj, 1.5, 0);
    expect(obj.visible).toBe(false);
    layer.update(50);
    expect(obj.visible).toBe(false);
    layer.dispose();
  });

  it('scales the quarry by the UNCHANGED formula: K*2*dist*tan(radiusDeg), floored at MIN', async () => {
    const layer = await createEnemyLayer({ reducedMotion: true }); // static idle = no scale tween
    const scene = new Scene();
    layer.attach(scene);

    const dist = 20;
    const radiusDeg = 1.5;
    const obj = targetAt(0, 0, -dist); // |position| == dist
    layer.spawn('t0', obj, radiusDeg, 0);
    layer.update(0);

    const quarry = quarryGroupIn(scene);
    const expected = quarryWorldHeight(dist, radiusDeg);
    // reduced-motion idle pose is scale=1 about baseScale, so the group scale == the formula height.
    expect(quarry.scale.x).toBeCloseTo(expected, 10);
    expect(quarry.scale.y).toBeCloseTo(expected, 10);
    expect(quarry.scale.z).toBeCloseTo(expected, 10);
    layer.dispose();
  });

  it('pins the quarry (and thus its origin weak-spot) at the target world position', async () => {
    const layer = await createEnemyLayer({ reducedMotion: true });
    const scene = new Scene();
    layer.attach(scene);

    const obj = targetAt(3, 1, -18);
    layer.spawn('t0', obj, 1.5, 0);
    layer.update(0);

    const quarry = quarryGroupIn(scene);
    expect(quarry.position.x).toBeCloseTo(3, 10);
    expect(quarry.position.z).toBeCloseTo(-18, 10);
    // The weak-spot sits at the group origin, so its WORLD position is the target position.
    const ws = quarry.getObjectByName(WEAKSPOT_NAME) as Mesh;
    const wp = new Vector3();
    ws.getWorldPosition(wp);
    expect(wp.x).toBeCloseTo(3, 10);
    expect(wp.z).toBeCloseTo(-18, 10);
    layer.dispose();
  });

  it('reduced motion spawns a static idle pose (no spawn burst, controller starts on idle)', async () => {
    const layer = await createEnemyLayer({ reducedMotion: true });
    const scene = new Scene();
    layer.attach(scene);
    const obj = targetAt(0, 0, -20);
    layer.spawn('t0', obj, 1.5, 0);
    layer.update(0);
    const quarry = quarryGroupIn(scene);
    // Static idle: opacity fully on (no fade-in), full-scale (no 0.4→1 spawn growth).
    const ws = quarry.getObjectByName(WEAKSPOT_NAME) as Mesh;
    expect((ws.material as { opacity: number }).opacity).toBe(1);
    layer.dispose();
  });
});

// ── poseFor() under live (non-reduced) motion: controller states drive transform/opacity/emissive ──
// These pin the heart of P3-2 - the spawn ramp, idle breathing bound, and flinch recoil/settle - so a
// regression that broke the fade-in, the easeOut curve, or the graze reaction fails the suite. They
// read only cosmetic transform/opacity/emissive; the scored sphere/path is never touched here.
describe('enemy-layer poses (live motion)', () => {
  const DIST = 20;
  const RADIUS = 1.5;
  const SPAWN_MS = (8 / 14) * 1000; // spawn: 8 frames @ 14fps
  const FLINCH_MS = (8 / 16) * 1000; // flinch: 8 frames @ 16fps

  it('spawn ramps opacity 0→1 and scale 0.4→1 across the spawn duration (easeOut, no bounce)', async () => {
    const layer = await createEnemyLayer({ reducedMotion: false });
    const scene = new Scene();
    layer.attach(scene);
    const obj = targetAt(0, 0, -DIST);
    layer.spawn('t0', obj, RADIUS, 0); // controller starts on 'spawn', follow-up 'idle'

    const base = quarryWorldHeight(DIST, RADIUS);
    const quarry = quarryGroupIn(scene);

    // t=0: bottom of the ramp - faded out and shrunk to the 0.4 floor.
    layer.update(0);
    const ws0 = quarry.getObjectByName(WEAKSPOT_NAME) as Mesh;
    expect((ws0.material as { opacity: number }).opacity).toBeCloseTo(0, 6);
    expect(quarry.scale.x).toBeCloseTo(0.4 * base, 6);

    // Mid-spawn: strictly between the endpoints (the ramp is moving), still below full.
    layer.update(SPAWN_MS * 0.5);
    expect((ws0.material as { opacity: number }).opacity).toBeGreaterThan(0);
    expect((ws0.material as { opacity: number }).opacity).toBeLessThan(1);
    expect(quarry.scale.x).toBeGreaterThan(0.4 * base);
    expect(quarry.scale.x).toBeLessThan(base);

    // End of spawn: settled to full opacity + full scale, never overshooting (no bounce).
    layer.update(SPAWN_MS - 1);
    expect((ws0.material as { opacity: number }).opacity).toBeGreaterThan(0.95);
    expect((ws0.material as { opacity: number }).opacity).toBeLessThanOrEqual(1);
    expect(quarry.scale.x).toBeLessThanOrEqual(base + 1e-9);
    layer.dispose();
  });

  it('idle breathing stays within ±2% of base scale (bounded, no growth, no bounce)', async () => {
    const layer = await createEnemyLayer({ reducedMotion: false });
    const scene = new Scene();
    layer.attach(scene);
    const obj = targetAt(0, 0, -DIST);
    layer.spawn('t0', obj, RADIUS, 0);
    const base = quarryWorldHeight(DIST, RADIUS);
    const quarry = quarryGroupIn(scene);

    // Sample across a full idle cycle, well past the spawn ramp - scale must hold inside the band.
    for (let t = SPAWN_MS + 50; t < SPAWN_MS + 2000; t += 73) {
      layer.update(t);
      expect(quarry.scale.x).toBeGreaterThanOrEqual(base * 0.98 - 1e-6);
      expect(quarry.scale.x).toBeLessThanOrEqual(base * 1.02 + 1e-6);
    }
    layer.dispose();
  });

  it('a graze drives flinch: a yaw/scale deviation that settles back, and a weak-spot emissive flare', async () => {
    const layer = await createEnemyLayer({ reducedMotion: false });
    const scene = new Scene();
    layer.attach(scene);
    const obj = targetAt(0, 0, -DIST);
    layer.spawn('t0', obj, RADIUS, 0);
    const quarry = quarryGroupIn(scene);

    // Let the spawn finish so the controller is idling (flinch only plays out of a live state).
    const idleMs = SPAWN_MS + 100;
    layer.update(idleMs);
    const idleEmissive = emissiveOf(quarry);

    // A graze: separation between RADIUS and 2.5×RADIUS. bearing [0,0], view [3,0] → sep 3° (1.5<3<3.75).
    const handle = handleAt('t0', [0, 0], RADIUS);
    layer.fire(idleMs, [3, 0], [handle]);

    // Register the flinch transition (resets the tween clock to its start) before sampling mid-state.
    layer.update(idleMs);

    // Mid-flinch: a visible yaw recoil + scale dip, and the weak-spot emissive flares above idle.
    const midMs = idleMs + FLINCH_MS * 0.5;
    layer.update(midMs);
    const base = quarryWorldHeight(DIST, RADIUS);
    expect(Math.abs(quarry.rotation.y)).toBeGreaterThan(0.05); // yaw kicked off zero
    expect(quarry.scale.x).toBeLessThan(base); // recoil dip below full
    expect(emissiveOf(quarry)).toBeGreaterThan(idleEmissive); // flare

    // After flinch completes it auto-returns to idle: yaw settles near zero, scale back in the band.
    layer.update(idleMs + FLINCH_MS + 60);
    expect(Math.abs(quarry.rotation.y)).toBeLessThan(0.12); // within the idle yaw envelope
    expect(quarry.scale.x).toBeGreaterThanOrEqual(base * 0.98 - 1e-6);
    layer.dispose();
  });
});
