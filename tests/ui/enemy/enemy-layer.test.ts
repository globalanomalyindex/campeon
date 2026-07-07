import { describe, it, expect } from 'vitest';
import { Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, Scene, Vector3 } from 'three';
import { ARENA_GROUND_Y } from '../../../src/engine/arena';
import { createEnemyLayer } from '../../../src/ui/enemy/enemy-layer';
import { quarryWorldHeight, WEAKSPOT_NAME } from '../../../src/ui/enemy/meshes';
import { SHADOW_EPS, SHADOW_NAME, SHADOW_STRETCH, shadowPose } from '../../../src/ui/enemy/shadow';
import { SPARK_MS, SPARK_NAME } from '../../../src/ui/enemy/sparks';
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

// ── P3-4: death / escape as real 3D transform motion, downstream of classifyHit / the lifecycle ──
// A clean kill (classifyHit→kill) topples + sinks + fades and emits a pooled dust-puff; a live quarry
// CLEARED without a kill (remove(id)/clear()) sprints laterally and fades instead of being instantly
// cut. Both are handed to the fade-out set so a fresh spawn cannot snap them off mid-motion. These
// read only cosmetic transform/opacity; the scored sphere/path is never touched. Reduced motion
// collapses to an instant static fade (no lingering motion). Everything is pooled - no per-event alloc.
describe('enemy-layer death / escape (P3-4)', () => {
  const DIST = 20;
  const RADIUS = 1.5;
  const SPAWN_MS = (8 / 14) * 1000;
  const DEATH_MS = (8 / 16) * 1000; // death: 8 frames @ 16fps
  const ESCAPE_MS = (8 / 12) * 1000; // escape: 8 frames @ 12fps

  /** Live quarry groups currently parented under the layer container (excludes pooled dust by name). */
  function quarriesIn(scene: Scene): Group[] {
    const layerGroup = scene.getObjectByName('enemy-layer') as Group;
    return layerGroup.children.filter((c) => (c as Group).isGroup && c.name === 'quarry') as Group[];
  }
  /** Pooled dust-puff groups currently SHOWN (visible) under the layer container. */
  function dustIn(scene: Scene): Group[] {
    const layerGroup = scene.getObjectByName('enemy-layer') as Group;
    return layerGroup.children.filter(
      (c) => (c as Group).isGroup && c.name === 'quarry-dust' && c.visible,
    ) as Group[];
  }

  it('a KILL topples (yaw + sink) and fades the quarry, and it plays on past a clear+respawn', async () => {
    const layer = await createEnemyLayer({ reducedMotion: false });
    const scene = new Scene();
    layer.attach(scene);
    const obj = targetAt(0, 0, -DIST);
    layer.spawn('t0', obj, RADIUS, 0);

    // Settle to idle, then a centered shot (view==bearing) is a kill.
    const idleMs = SPAWN_MS + 100;
    layer.update(idleMs);
    const handle = handleAt('t0', [0, 0], RADIUS);
    layer.fire(idleMs, [0, 0], [handle]);

    const quarry = quarriesIn(scene)[0]!;

    // Mid-death: a topple yaw + a downward sink + a fade below full opacity.
    layer.update(idleMs + DEATH_MS * 0.5);
    expect(Math.abs(quarry.rotation.y)).toBeGreaterThan(0.2); // toppling over
    expect(quarry.position.y).toBeLessThan(0); // sinking below the hitbox center
    const ws = quarry.getObjectByName(WEAKSPOT_NAME) as Mesh;
    expect((ws.material as { opacity: number }).opacity).toBeLessThan(1);
    expect((ws.material as { opacity: number }).opacity).toBeGreaterThan(0);

    // The instrument now clears + respawns (range free-play). The death plays on in the fade-out set:
    // the dying quarry is NOT the freshly-spawned live one.
    layer.clear();
    const obj2 = targetAt(0, 0, -DIST);
    layer.spawn('t1', obj2, RADIUS, idleMs + DEATH_MS * 0.5);
    // Still present mid-death (handed off), plus the new live quarry → at least 2 quarry groups.
    expect(quarriesIn(scene).length).toBeGreaterThanOrEqual(2);

    // After the death duration the dying quarry is retired (gone), leaving only the live respawn.
    layer.update(idleMs + DEATH_MS + 200);
    expect(quarriesIn(scene)).not.toContain(quarry);
    layer.dispose();
  });

  it('a KILL emits a pooled dust-puff that fades and is REUSED (no per-event allocation)', async () => {
    const layer = await createEnemyLayer({ reducedMotion: false });
    const scene = new Scene();
    layer.attach(scene);

    const kill = (id: string, t: number): void => {
      const obj = targetAt(0, 0, -DIST);
      layer.spawn(id, obj, RADIUS, t);
      layer.update(t + SPAWN_MS + 100);
      layer.fire(t + SPAWN_MS + 100, [0, 0], [handleAt(id, [0, 0], RADIUS)]);
      layer.update(t + SPAWN_MS + 110);
    };

    kill('a', 0);
    const afterFirst = dustIn(scene).length;
    expect(afterFirst).toBeGreaterThanOrEqual(1); // a puff appeared

    // Let the puff finish so it returns to the pool, then kill again - the pool is reused.
    layer.update(10_000);
    expect(dustIn(scene).length).toBe(0); // faded puff parked back in the pool (not shown)

    kill('b', 10_000);
    layer.update(20_000);
    // Two kills must not have grown an unbounded set of dust geometries: the pool capacity is small.
    // (We assert it never balloons with kills - a strict pool, not a per-event allocation.)
    const total = (scene.getObjectByName('enemy-layer') as Group).children.filter(
      (c) => c.name === 'quarry-dust',
    ).length;
    expect(total).toBeLessThanOrEqual(4);
    layer.dispose();
  });

  it('clearing a LIVE quarry WITHOUT a kill sprints it laterally and fades it (escape), not an instant cut', async () => {
    const layer = await createEnemyLayer({ reducedMotion: false });
    const scene = new Scene();
    layer.attach(scene);
    const obj = targetAt(0, 0, -DIST);
    layer.spawn('t0', obj, RADIUS, 0);
    const idleMs = SPAWN_MS + 100;
    layer.update(idleMs);

    const quarry = quarriesIn(scene)[0]!;
    const x0 = quarry.position.x;

    // No kill - the instrument simply cleared the trial. The quarry must run + fade, not vanish.
    layer.remove!('t0');
    // It is still on screen (handed to fade-outs), now in escape.
    expect(quarriesIn(scene)).toContain(quarry);

    layer.update(idleMs + ESCAPE_MS * 0.5);
    expect(Math.abs(quarry.position.x - x0)).toBeGreaterThan(0.05); // lateral sprint off the spot
    const ws = quarry.getObjectByName(WEAKSPOT_NAME) as Mesh;
    expect((ws.material as { opacity: number }).opacity).toBeLessThan(1); // fading
    expect((ws.material as { opacity: number }).opacity).toBeGreaterThan(0);

    // A fresh spawn must NOT cut the escaping quarry short.
    layer.spawn('t1', targetAt(2, 0, -DIST), RADIUS, idleMs + ESCAPE_MS * 0.5);
    expect(quarriesIn(scene)).toContain(quarry);

    // After the escape duration it is retired.
    layer.update(idleMs + ESCAPE_MS + 200);
    expect(quarriesIn(scene)).not.toContain(quarry);
    layer.dispose();
  });

  it('clear() sends every live quarry into an escape fade-out (not an instant wipe)', async () => {
    const layer = await createEnemyLayer({ reducedMotion: false });
    const scene = new Scene();
    layer.attach(scene);
    layer.spawn('t0', targetAt(0, 0, -DIST), RADIUS, 0);
    const idleMs = SPAWN_MS + 100;
    layer.update(idleMs);
    const quarry = quarriesIn(scene)[0]!;

    layer.clear();
    // Still present, escaping (not wiped instantly).
    expect(quarriesIn(scene)).toContain(quarry);
    layer.update(idleMs + ESCAPE_MS * 0.5);
    const ws = quarry.getObjectByName(WEAKSPOT_NAME) as Mesh;
    expect((ws.material as { opacity: number }).opacity).toBeLessThan(1);

    layer.update(idleMs + ESCAPE_MS + 200);
    expect(quarriesIn(scene)).not.toContain(quarry);
    layer.dispose();
  });

  it('reduced motion: clear()/remove() is an INSTANT static fade - no lingering escape motion', async () => {
    const layer = await createEnemyLayer({ reducedMotion: true });
    const scene = new Scene();
    layer.attach(scene);
    layer.spawn('t0', targetAt(0, 0, -DIST), RADIUS, 0);
    layer.update(0);
    expect(quarriesIn(scene).length).toBe(1);

    // Under reduced motion the quarry is removed at once (no sprint-and-fade frames to play out).
    layer.remove!('t0');
    expect(quarriesIn(scene).length).toBe(0);

    // And no dust-puff motion lingers either.
    layer.update(50);
    expect(dustIn(scene).length).toBe(0);
    layer.dispose();
  });

  it('reduced motion: a kill is an instant fade with no dust-puff (no time-driven motion)', async () => {
    const layer = await createEnemyLayer({ reducedMotion: true });
    const scene = new Scene();
    layer.attach(scene);
    layer.spawn('t0', targetAt(0, 0, -DIST), RADIUS, 0);
    layer.update(0);
    // fire() is a no-op under reduced motion (no hit reactions), so a kill is handled via remove().
    layer.remove!('t0');
    layer.update(50);
    expect(quarriesIn(scene).length).toBe(0);
    expect(dustIn(scene).length).toBe(0);
    layer.dispose();
  });
});

// ── Phase B integration: contact shadows, per-part secondary motion, impact sparks ──
// All three are cosmetic layers wired through the SAME lifecycle as the quarry itself: they read the
// posed quarry / the classifyHit result the layer already computed, and write nothing scored. The
// scored sphere (rec.object) is never touched by any of them.
describe('enemy-layer contact shadows (Phase B)', () => {
  const DIST = 20;
  const RADIUS = 1.5;
  const SPAWN_MS = (8 / 14) * 1000;
  const DEATH_MS = (8 / 16) * 1000;

  function shadowsIn(scene: Scene): Mesh[] {
    const layerGroup = scene.getObjectByName('enemy-layer') as Group;
    return layerGroup.children.filter((c) => c.name === SHADOW_NAME) as Mesh[];
  }

  /** Expected blob center for a quarry ground point: base + the dusk slide along SHADOW_THROW. */
  function expectedBlobXZ(x: number, y: number, z: number, baseScale: number): [number, number] {
    const pose = shadowPose({ x, y, z }, baseScale)!;
    return [pose.x, pose.z];
  }

  it('a spawn creates a blob on the grid plane at the pure shadowPose spot beneath the target', async () => {
    const layer = await createEnemyLayer({ reducedMotion: false });
    const scene = new Scene();
    layer.attach(scene);
    layer.spawn('t0', targetAt(3, 0, -DIST), RADIUS, 0);
    layer.update(SPAWN_MS + 100);
    const blob = shadowsIn(scene)[0]!;
    expect(blob).toBeTruthy();
    expect(blob.visible).toBe(true);
    // The idle pose bobs the quarry a hair, so compare against shadowPose of the POSED position.
    // baseScale uses the target's TRUE distance from the eye (|(3,0,-20)|), exactly as the layer does.
    const quarry = quarryGroupIn(scene);
    const dist = new Vector3(3, 0, -DIST).length();
    const [ex, ez] = expectedBlobXZ(quarry.position.x, quarry.position.y, quarry.position.z, quarryWorldHeight(dist, RADIUS));
    expect(blob.position.x).toBeCloseTo(ex, 6);
    expect(blob.position.z).toBeCloseTo(ez, 6);
    expect(blob.position.y).toBeCloseTo(ARENA_GROUND_Y + SHADOW_EPS, 10);
    // The ellipse is stretched along the throw: long axis (local y scale) > short axis (local x).
    expect(blob.scale.y).toBeGreaterThan(blob.scale.x);
    expect(blob.scale.y / blob.scale.x).toBeCloseTo(SHADOW_STRETCH / 1.15, 2);
    layer.dispose();
  });

  it('the blob follows a moving target on x/z while y stays pinned to the plane', async () => {
    const layer = await createEnemyLayer({ reducedMotion: false });
    const scene = new Scene();
    layer.attach(scene);
    const obj = targetAt(0, 0, -DIST);
    layer.spawn('t0', obj, RADIUS, 0);
    layer.update(SPAWN_MS + 100);
    const blob = shadowsIn(scene)[0]!;
    const x0 = blob.position.x;
    const z0 = blob.position.z;
    obj.position.set(5, 0, -DIST + 2); // the arena moves the scored sphere; the layer only follows
    layer.update(SPAWN_MS + 150);
    // It moved WITH the target (same height, so the throw slide is unchanged up to idle-bob noise).
    expect(blob.position.x - x0).toBeCloseTo(5, 1);
    expect(blob.position.z - z0).toBeCloseTo(2, 1);
    // ...and never left the plane.
    expect(blob.position.y).toBeCloseTo(ARENA_GROUND_Y + SHADOW_EPS, 10);
    layer.dispose();
  });

  it('a target at/below the grid plane gets NO visible blob (never pokes through the floor)', async () => {
    const layer = await createEnemyLayer({ reducedMotion: false });
    const scene = new Scene();
    layer.attach(scene);
    layer.spawn('t0', targetAt(0, ARENA_GROUND_Y - 1, -DIST), RADIUS, 0);
    layer.update(SPAWN_MS + 100);
    const blob = shadowsIn(scene)[0]!;
    expect(blob.visible).toBe(false);
    layer.dispose();
  });

  it('a death fades the blob alongside the quarry, and release removes it', async () => {
    const layer = await createEnemyLayer({ reducedMotion: false });
    const scene = new Scene();
    layer.attach(scene);
    layer.spawn('t0', targetAt(0, 0, -DIST), RADIUS, 0);
    const idleMs = SPAWN_MS + 100;
    layer.update(idleMs);
    const blob = shadowsIn(scene)[0]!;
    const idleOpacity = (blob.material as MeshBasicMaterial).opacity;
    expect(idleOpacity).toBeGreaterThan(0);

    layer.fire(idleMs, [0, 0], [handleAt('t0', [0, 0], RADIUS)]); // clean kill
    layer.update(idleMs + DEATH_MS * 0.7);
    const dyingOpacity = (blob.material as MeshBasicMaterial).opacity;
    expect(dyingOpacity).toBeLessThan(idleOpacity); // fading WITH the quarry

    layer.update(idleMs + DEATH_MS + 200); // death played out - record released
    expect(shadowsIn(scene)).not.toContain(blob);
    layer.dispose();
  });

  it('reduced motion: the blob still exists and follows at the full shadowPose opacity', async () => {
    const layer = await createEnemyLayer({ reducedMotion: true });
    const scene = new Scene();
    layer.attach(scene);
    const obj = targetAt(0, 0, -DIST);
    layer.spawn('t0', obj, RADIUS, 0);
    layer.update(0);
    const blob = shadowsIn(scene)[0]!;
    expect(blob.visible).toBe(true);
    // Static grounding is not motion: reduced keeps the shadow, at the pure shadowPose opacity
    // (pose.opacity is 1 in the reduced static idle).
    const expected = shadowPose(obj.position, quarryWorldHeight(DIST, RADIUS))!;
    expect((blob.material as MeshBasicMaterial).opacity).toBeCloseTo(expected.opacity, 6);
    const x0 = blob.position.x;
    obj.position.x = 4;
    layer.update(50);
    // Follows by the same world delta (the constant throw slide cancels in the difference).
    expect(blob.position.x - x0).toBeCloseTo(4, 6);
    layer.dispose();
  });
});

describe('enemy-layer per-part secondary motion (Phase B)', () => {
  const DIST = 20;
  const RADIUS = 1.5;
  const SPAWN_MS = (8 / 14) * 1000;

  it('a named part animates about its rest between updates under live motion', async () => {
    const layer = await createEnemyLayer({ reducedMotion: false });
    const scene = new Scene();
    layer.attach(scene);
    layer.setEnvironment('track');
    layer.spawn('t0', targetAt(0, 0, -DIST), RADIUS, 0);
    layer.update(SPAWN_MS + 100);
    const quarry = quarryGroupIn(scene);
    const wing = quarry.getObjectByName('part-wing-l') as Mesh;
    const z0 = wing.rotation.z;
    layer.update(SPAWN_MS + 100 + 120); // ~a quarter of the 2.2Hz flap period later
    expect(wing.rotation.z).not.toBeCloseTo(z0, 6); // the wing is flapping
    layer.dispose();
  });

  it('secondary motion never moves the weak-spot off the scored position', async () => {
    const layer = await createEnemyLayer({ reducedMotion: false });
    const scene = new Scene();
    layer.attach(scene);
    layer.setEnvironment('track');
    const obj = targetAt(2, 1, -DIST);
    layer.spawn('t0', obj, RADIUS, 0);
    for (const t of [SPAWN_MS + 100, SPAWN_MS + 300, SPAWN_MS + 700]) {
      layer.update(t);
      const quarry = quarryGroupIn(scene);
      const ws = quarry.getObjectByName(WEAKSPOT_NAME) as Mesh;
      const wp = new Vector3();
      ws.getWorldPosition(wp);
      // Idle lift is bounded (±1% of base scale on Y); x/z must match the scored sphere exactly.
      expect(wp.x).toBeCloseTo(obj.position.x, 6);
      expect(wp.z).toBeCloseTo(obj.position.z, 6);
    }
    layer.dispose();
  });

  it('reduced motion: named parts stay exactly at their captured rest across updates', async () => {
    const layer = await createEnemyLayer({ reducedMotion: true });
    const scene = new Scene();
    layer.attach(scene);
    layer.setEnvironment('track');
    layer.spawn('t0', targetAt(0, 0, -DIST), RADIUS, 0);
    layer.update(0);
    const quarry = quarryGroupIn(scene);
    const wing = quarry.getObjectByName('part-wing-l') as Mesh;
    const z0 = wing.rotation.z;
    layer.update(500);
    layer.update(1500);
    expect(wing.rotation.z).toBe(z0); // frozen at rest - no time-driven part motion
    layer.dispose();
  });
});

describe('enemy-layer impact sparks (Phase B)', () => {
  const DIST = 20;
  const RADIUS = 1.5;
  const SPAWN_MS = (8 / 14) * 1000;

  function sparksShown(scene: Scene): Group[] {
    const layerGroup = scene.getObjectByName('enemy-layer') as Group;
    return layerGroup.children.filter((c) => c.name === SPARK_NAME && c.visible) as Group[];
  }

  it('a KILL emits a pooled spark burst at the weak-spot that repools after SPARK_MS', async () => {
    const layer = await createEnemyLayer({ reducedMotion: false });
    const scene = new Scene();
    layer.attach(scene);
    layer.spawn('t0', targetAt(0, 0, -DIST), RADIUS, 0);
    const idleMs = SPAWN_MS + 100;
    layer.update(idleMs);
    layer.fire(idleMs, [0, 0], [handleAt('t0', [0, 0], RADIUS)]);
    layer.update(idleMs + 40);
    const shown = sparksShown(scene);
    expect(shown.length).toBe(1);
    expect(shown[0]!.position.z).toBeCloseTo(-DIST, 6); // at the impact point, not the feet

    layer.update(idleMs + SPARK_MS + 50);
    expect(sparksShown(scene).length).toBe(0); // hidden + parked back in the pool

    // The pool never balloons with kills: total burst groups stay at the fixed pool size.
    const total = (scene.getObjectByName('enemy-layer') as Group).children.filter(
      (c) => c.name === SPARK_NAME,
    ).length;
    expect(total).toBeLessThanOrEqual(2);
    layer.dispose();
  });

  it('a GRAZE emits no spark (the flinch is the graze read)', async () => {
    const layer = await createEnemyLayer({ reducedMotion: false });
    const scene = new Scene();
    layer.attach(scene);
    layer.spawn('t0', targetAt(0, 0, -DIST), RADIUS, 0);
    const idleMs = SPAWN_MS + 100;
    layer.update(idleMs);
    layer.fire(idleMs, [3, 0], [handleAt('t0', [0, 0], RADIUS)]); // sep 3 deg: graze band
    layer.update(idleMs + 40);
    expect(sparksShown(scene).length).toBe(0);
    layer.dispose();
  });

  it('reduced motion: no spark pool is ever allocated', async () => {
    const layer = await createEnemyLayer({ reducedMotion: true });
    const scene = new Scene();
    layer.attach(scene);
    layer.spawn('t0', targetAt(0, 0, -DIST), RADIUS, 0);
    layer.update(0);
    const layerGroup = scene.getObjectByName('enemy-layer') as Group;
    expect(layerGroup.children.filter((c) => c.name === SPARK_NAME).length).toBe(0);
    layer.dispose();
  });
});
