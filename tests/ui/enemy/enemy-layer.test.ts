import { describe, it, expect } from 'vitest';
import { Group, Mesh, Object3D, Scene, Vector3 } from 'three';
import { createEnemyLayer } from '../../../src/ui/enemy/enemy-layer';
import { quarryWorldHeight, WEAKSPOT_NAME } from '../../../src/ui/enemy/meshes';

/** A bare arena target stand-in: an Object3D at a world position, hidden when the skin attaches. */
function targetAt(x: number, y: number, z: number): Object3D {
  const o = new Object3D();
  o.position.set(x, y, z);
  return o;
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
