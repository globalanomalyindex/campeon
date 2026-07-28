import { describe, it, expect } from 'vitest';
import { counts360 } from '../../src/types';
import { PerspectiveCamera, type Object3D, type Scene } from 'three';
import {
  Arena,
  type EnemyLayer,
  type InputSource,
  type RendererLike,
  type ViewmodelLayer,
} from '../../src/engine/arena';
import type { AimSample, Degrees, TargetHandle, TargetSpec } from '../../src/types';
import { mulberry32 } from '../../src/stats/bootstrap';
import { TrialRecorder, type Recording } from '../../src/instruments/recording';
import { createEnemyLayer } from '../../src/ui/enemy/enemy-layer';

/** Records every cosmetic call the arena drives - proves the hooks fire without touching scoring. */
class FakeEnemyLayer implements EnemyLayer {
  attached = 0;
  spawned: string[] = [];
  cleared = 0;
  updated = 0;
  fired: Array<{ view: [number, number]; ids: string[] }> = [];
  disposed = 0;
  attach(_scene: Scene): void {
    this.attached += 1;
  }
  spawn(id: string, _object: Object3D, _radiusDeg: number, _nowMs: number): void {
    this.spawned.push(id);
  }
  update(_nowMs: number): void {
    this.updated += 1;
  }
  fire(_nowMs: number, view: [number, number], targets: ReadonlyArray<TargetHandle>): void {
    this.fired.push({ view, ids: targets.map((t) => t.id) });
  }
  clear(): void {
    this.cleared += 1;
  }
  dispose(): void {
    this.disposed += 1;
  }
}

function harness(attachLayer = false) {
  let emit: (s: AimSample) => void = () => {};
  let fire: () => void = () => {};
  const input: InputSource = {
    onSample(cb) {
      emit = cb;
      return () => {};
    },
    onFire(cb) {
      fire = cb;
      return () => {};
    },
  };
  let disposes = 0;
  const renderer: RendererLike = {
    render() {},
    setSize() {},
    dispose() {
      disposes += 1;
    },
  };
  const arena = new Arena({ renderer, input, size: () => [800, 600], counts: counts360(9450), rng: mulberry32(1) });
  const layer = new FakeEnemyLayer();
  if (attachLayer) arena.attachEnemies(layer);
  return {
    arena,
    layer,
    send: (s: AimSample) => emit(s),
    fire: () => fire(),
    disposes: () => disposes,
  };
}

const SPEC = { kind: 'static' as const, yaw: 10, pitch: 3, distance: 20, worldRadius: 0.6 };

// ── hardened integrity gate ───────────────────────────────────────────────
//
// cosmetic-overlay-reads-never-writes (HARD INVARIANT 1 + 2): the hidden gold
// sphere is the SOLE owner of bearing()/radiusDeg()/counts; an attached EnemyLayer
// is a cosmetic sibling that only READS the sphere transform + view. To prove that,
// we drive the SAME scripted session twice - once with a layer attached, once
// without - feeding identical samples/ticks/fire events in the same order, and
// deepEqual the entire scored Recording {frames, fires}. Every 3D-migration task
// (P3-2 quarry meshes, P3-3 revolver viewmodel, P3-4 death/escape, P3-5 film pass)
// MUST keep this gate green and MAY extend it, never weaken an assertion to pass.

/** Records every cosmetic viewmodel call - proves the weapon seam fires without touching scoring. */
class FakeViewmodelLayer implements ViewmodelLayer {
  attached = 0;
  ticked = 0;
  looks: Array<[number, number]> = [];
  fires: Array<[number, number]> = [];
  disposed = 0;
  attach(_scene: Scene, _camera: PerspectiveCamera): void {
    this.attached += 1;
  }
  tick(_nowMs: number): void {
    this.ticked += 1;
  }
  look(view: [Degrees, Degrees]): void {
    this.looks.push(view);
  }
  fire(view: [Degrees, Degrees]): void {
    this.fires.push(view);
  }
  dispose(): void {
    this.disposed += 1;
  }
}

/**
 * Adversarial viewmodel: every cosmetic hook ATTEMPTS to mutate the handed view array + the camera it
 * is parented to. The scored path reads bearing() from the sphere mesh.position and view() from the
 * rig's private state (rig.view() returns a FRESH array), so none of these can reach the scored stream.
 */
class AdversarialViewmodelLayer implements ViewmodelLayer {
  attach(_scene: Scene, camera: PerspectiveCamera): void {
    camera.scale.multiplyScalar(7); // camera scale never enters bearing/radius
    camera.position.set(99, 99, 99); // the rig syncs only rotation; bearing reads the sphere, not the cam
  }
  tick(_nowMs: number): void {}
  look(view: [Degrees, Degrees]): void {
    (view as number[]).push(123); // a fresh array from rig.view() - mutating it cannot reach the rig
    (view as number[])[0] = Number.NaN;
  }
  fire(view: [Degrees, Degrees]): void {
    (view as number[])[1] = Number.NaN;
  }
  dispose(): void {}
}

/** A self-contained scripted arena + recorder; one optional cosmetic layer, no other deps. */
function scriptedSession(
  spec: TargetSpec,
  layer?: EnemyLayer,
  viewmodel?: ViewmodelLayer,
): { recording: Recording; handle: TargetHandle } {
  let emit: (s: AimSample) => void = () => {};
  let pull: () => void = () => {};
  const input: InputSource = {
    onSample(cb) {
      emit = cb;
      return () => {};
    },
    onFire(cb) {
      pull = cb;
      return () => {};
    },
  };
  const renderer: RendererLike = { render() {}, setSize() {}, dispose() {} };
  const arena = new Arena({ renderer, input, size: () => [800, 600], counts: counts360(9450), rng: mulberry32(7) });
  if (layer) arena.attachEnemies(layer);
  if (viewmodel) arena.attachViewmodel(viewmodel);

  const handle = arena.spawnTarget(spec);
  // Wire the SCORED stream exactly as a trial does: the recorder reads view()/bearing()/radiusDeg().
  const recorder = new TrialRecorder(arena, () => handle);

  // Identical event script: interleaved samples, ticks, and fires (a moving target makes each
  // tick reposition the sphere, so per-frame bearings actually vary and the deepEqual has teeth).
  const samples: AimSample[] = [
    { t: 4, dx: 120, dy: -30 },
    { t: 8, dx: -40, dy: 18 },
    { t: 12, dx: 75, dy: 60 },
    { t: 16, dx: -10, dy: -90 },
  ];
  arena.tick(16);
  emit(samples[0]!);
  arena.tick(16);
  pull();
  emit(samples[1]!);
  arena.tick(16);
  emit(samples[2]!);
  pull();
  arena.tick(16);
  emit(samples[3]!);
  arena.tick(16);
  pull();

  recorder.stop();
  // Snapshot via stop()+structuredClone so the returned recording is frozen + detached.
  return { recording: structuredClone(recorder.recording()), handle };
}

/**
 * A scripted session that also drives the P3-4 death/escape LIFECYCLE on the cosmetic layer: it fires
 * (the kill→death trigger), then clears + removes + respawns targets (the cleared-without-kill escape
 * trigger). The scored Recording must be byte-identical with vs without a cosmetic layer, proving the
 * death/escape motion is purely downstream and never perturbs the stream.
 */
function scriptedLifecycleSession(spec: TargetSpec, layer?: EnemyLayer): Recording {
  let emit: (s: AimSample) => void = () => {};
  let pull: () => void = () => {};
  const input: InputSource = {
    onSample(cb) {
      emit = cb;
      return () => {};
    },
    onFire(cb) {
      pull = cb;
      return () => {};
    },
  };
  const renderer: RendererLike = { render() {}, setSize() {}, dispose() {} };
  const arena = new Arena({ renderer, input, size: () => [800, 600], counts: counts360(9450), rng: mulberry32(11) });
  if (layer) arena.attachEnemies(layer);

  let handle = arena.spawnTarget(spec);
  let recorder = new TrialRecorder(arena, () => handle);

  arena.tick(16);
  emit({ t: 4, dx: 120, dy: -30 });
  arena.tick(16);
  pull(); // fire → cosmetic layer may play death; scored fires++ regardless
  recorder.stop();
  const r1 = structuredClone(recorder.recording());

  // Cleared-without-kill: removeTarget (escape) then a fresh spawn; the layer must not feed back.
  arena.removeTarget(handle.id);
  handle = arena.spawnTarget(spec);
  recorder = new TrialRecorder(arena, () => handle);
  arena.tick(16);
  emit({ t: 8, dx: -40, dy: 18 });
  arena.tick(16);
  pull();
  recorder.stop();
  const r2 = structuredClone(recorder.recording());

  // clearTargets() (escape on every live quarry) then one more spawn + trial.
  arena.clearTargets();
  handle = arena.spawnTarget(spec);
  recorder = new TrialRecorder(arena, () => handle);
  arena.tick(16);
  emit({ t: 12, dx: 75, dy: 60 });
  arena.tick(16);
  pull();
  recorder.stop();
  const r3 = structuredClone(recorder.recording());

  // Concatenate the three trials' streams into one comparable Recording.
  return {
    frames: [...r1.frames, ...r2.frames, ...r3.frames],
    fires: [...r1.fires, ...r2.fires, ...r3.fires],
  };
}

const MOVING_SPEC: TargetSpec = {
  kind: 'moving',
  yaw: 8,
  pitch: 2,
  distance: 18,
  worldRadius: 0.6,
  motion: { yawAmp: 12, pitchAmp: 4, baseFreq: 0.5, seed: 3 },
};

/**
 * Adversarial layer: every cosmetic hook ATTEMPTS to mutate the handles/objects it is handed -
 * flip visibility, scale/rotate the passed Object3D, and push junk into the handed `view` +
 * `targets` arrays. None of these touch the scored path (bearing() reads mesh.position; radiusDeg()
 * reads the target's private placement; view() reads the rig), so the Recording must be byte-identical.
 * We deliberately do NOT translate mesh.position: the sphere IS the sole owner of bearing(), so
 * writing its position would corrupt the scored truth by design - the integrity contract is that a
 * cosmetic layer READS the transform and NEVER writes it, not that the engine defends a shared object
 * reference against a layer that breaks the contract.
 */
class AdversarialEnemyLayer implements EnemyLayer {
  private readonly poisoned: TargetHandle[] = [];
  attach(_scene: Scene): void {}
  private vandalize(object: Object3D): void {
    object.visible = true; // un-hide the sphere the arena hid (cosmetic flag only)
    object.scale.multiplyScalar(3.5); // radiusDeg() ignores mesh scale
    object.rotation.x += 1.23; // orientation never enters bearing/radius
    (object as unknown as { __poison?: boolean }).__poison = true;
  }
  spawn(_id: string, object: Object3D, _radiusDeg: number, _nowMs: number): void {
    this.vandalize(object);
  }
  update(_nowMs: number): void {}
  fire(_nowMs: number, view: [number, number], targets: ReadonlyArray<TargetHandle>): void {
    (view as number[]).push(999); // a fresh array from rig.view() - mutating it cannot reach the rig
    (view as number[])[0] = Number.NaN;
    (targets as TargetHandle[]).push(...this.poisoned); // a fresh spread - the targets Map is untouched
  }
  // P3-4: clear()/remove() are the "cleared-without-kill" escape triggers + fire()'s kill path is the
  // death trigger. An adversarial layer's death/escape hooks must NOT be able to perturb the scored
  // stream, so here they ALSO attempt to vandalize and to push poison - and the Recording stays equal.
  clear(): void {
    this.poisoned.push({ id: 'ghost', bearing: () => [Number.NaN, Number.NaN], radiusDeg: () => Number.NaN });
  }
  remove(_id: string): void {
    this.poisoned.push({ id: 'ghost', bearing: () => [Number.NaN, Number.NaN], radiusDeg: () => Number.NaN });
  }
  dispose(): void {}
}

describe('INTEGRITY GATE: cosmetic-overlay-reads-never-writes (full scored Recording)', () => {
  it('a scripted session records an identical Recording with and without a cosmetic layer', () => {
    const withLayer = scriptedSession(MOVING_SPEC, new FakeEnemyLayer());
    const without = scriptedSession(MOVING_SPEC);
    expect(withLayer.recording).toEqual(without.recording);
    // Sanity: the script actually exercised the stream (else an empty deepEqual would pass vacuously).
    expect(without.recording.frames.length).toBeGreaterThan(0);
    expect(without.recording.fires.length).toBeGreaterThan(0);
  });

  it('an ADVERSARIAL layer that mutates every handed handle/array cannot move the scored stream', () => {
    const baseline = scriptedSession(MOVING_SPEC);
    const attacked = scriptedSession(MOVING_SPEC, new AdversarialEnemyLayer());
    // The whole scored Recording is byte-identical despite the layer's mutation attempts.
    expect(attacked.recording).toEqual(baseline.recording);
    // And the live handle's angular truth is unchanged after the attack.
    expect(attacked.handle.bearing()).toEqual(baseline.handle.bearing());
    expect(attacked.handle.radiusDeg()).toEqual(baseline.handle.radiusDeg());
  });

  it('also holds for a static target (no per-frame motion)', () => {
    const withLayer = scriptedSession(SPEC, new AdversarialEnemyLayer());
    const without = scriptedSession(SPEC);
    expect(withLayer.recording).toEqual(without.recording);
  });

  // P3-3: the in-scene 3D revolver attaches through attachViewmodel (mirrors attachEnemies). It only
  // READS view()/fire()/look() to drive cosmetic recoil/sway; it must leave the scored stream identical.
  it('attaching a cosmetic VIEWMODEL leaves the Recording byte-identical (with vs without)', () => {
    const withVm = scriptedSession(MOVING_SPEC, undefined, new FakeViewmodelLayer());
    const without = scriptedSession(MOVING_SPEC);
    expect(withVm.recording).toEqual(without.recording);
  });

  it('an ADVERSARIAL viewmodel that mutates the handed view + camera cannot move the scored stream', () => {
    const baseline = scriptedSession(MOVING_SPEC);
    const attacked = scriptedSession(MOVING_SPEC, undefined, new AdversarialViewmodelLayer());
    expect(attacked.recording).toEqual(baseline.recording);
    expect(attacked.handle.bearing()).toEqual(baseline.handle.bearing());
    expect(attacked.handle.radiusDeg()).toEqual(baseline.handle.radiusDeg());
  });

  it('both cosmetic layers (enemy skin + viewmodel) together leave the Recording byte-identical', () => {
    const withBoth = scriptedSession(MOVING_SPEC, new AdversarialEnemyLayer(), new AdversarialViewmodelLayer());
    const without = scriptedSession(MOVING_SPEC);
    expect(withBoth.recording).toEqual(without.recording);
  });

  // P3-4: death (fire→kill) + escape (clear/remove without a kill) are driven HERE through the arena
  // lifecycle. An adversarial layer whose clear()/remove()/fire()/spawn() all attempt to vandalize +
  // push poison must NOT perturb the scored stream across a fire + remove + clear + respawn script.
  it('driving the death/escape LIFECYCLE (fire + remove + clear) leaves the Recording byte-identical', () => {
    const baseline = scriptedLifecycleSession(MOVING_SPEC);
    const attacked = scriptedLifecycleSession(MOVING_SPEC, new AdversarialEnemyLayer());
    expect(attacked).toEqual(baseline);
    // Sanity: the lifecycle script actually exercised the scored stream.
    expect(baseline.frames.length).toBeGreaterThan(0);
    expect(baseline.fires.length).toBeGreaterThan(0);
  });

  it('the death/escape lifecycle also holds for a static target', () => {
    const baseline = scriptedLifecycleSession(SPEC);
    const attacked = scriptedLifecycleSession(SPEC, new AdversarialEnemyLayer());
    expect(attacked).toEqual(baseline);
  });
});

// The gate above proves the CONTRACT (a layer that reads-never-writes cannot move the stream) against
// fake + adversarial stand-ins. This block proves the SHIPPING layer honors it: the REAL
// createEnemyLayer now runs Phase B sublayers that touch positions every frame - applyPose copies the
// scored position into the cosmetic quarry then does `+= lift/lateral`, applySecondary re-poses named
// child parts, shadowPose/emitSpark/emitDust READ rec.mesh/rec.object.position. If any of those ever
// aliased the scored Object3D instead of copying from it, the scored stream would drift - and ONLY a
// byte-identical check against the real module (not a stub) can catch that regression. createEnemyLayer
// resolves synchronously (procedural geometry, no async work), so it drops straight into the helpers.
describe('INTEGRITY GATE: the REAL createEnemyLayer (Phase B secondary motion + shadows + sparks) writes nothing scored', () => {
  it('a scripted session with the real layer records a byte-identical Recording (live motion)', async () => {
    const layer = await createEnemyLayer({ reducedMotion: false });
    const withReal = scriptedSession(MOVING_SPEC, layer);
    const without = scriptedSession(MOVING_SPEC);
    expect(withReal.recording).toEqual(without.recording);
    // Sanity: the stream actually moved (a vacuous empty deepEqual would pass otherwise).
    expect(without.recording.frames.length).toBeGreaterThan(0);
    // The scored sphere's angular truth is unmoved by the per-part motion + shadow/spark position reads.
    expect(withReal.handle.bearing()).toEqual(without.handle.bearing());
    expect(withReal.handle.radiusDeg()).toEqual(without.handle.radiusDeg());
    layer.dispose();
  });

  it('also holds for a static target', async () => {
    const layer = await createEnemyLayer({ reducedMotion: false });
    const withReal = scriptedSession(SPEC, layer);
    const without = scriptedSession(SPEC);
    expect(withReal.recording).toEqual(without.recording);
    layer.dispose();
  });

  it('driving the death/escape LIFECYCLE (kill->death, clear->escape, dust/spark emit) through the real layer stays byte-identical', async () => {
    const layer = await createEnemyLayer({ reducedMotion: false });
    const baseline = scriptedLifecycleSession(MOVING_SPEC);
    const attacked = scriptedLifecycleSession(MOVING_SPEC, layer);
    expect(attacked).toEqual(baseline);
    expect(baseline.frames.length).toBeGreaterThan(0);
    layer.dispose();
  });

  it('the real layer also stays byte-identical under REDUCED motion (static idle + instant retire path)', async () => {
    const layer = await createEnemyLayer({ reducedMotion: true });
    const baseline = scriptedLifecycleSession(SPEC);
    const attacked = scriptedLifecycleSession(SPEC, layer);
    expect(attacked).toEqual(baseline);
    layer.dispose();
  });
});

describe('Arena ↔ cosmetic EnemyLayer wiring', () => {
  it('attaches the layer exactly once', () => {
    const h = harness(true);
    expect(h.layer.attached).toBe(1);
  });

  it('spawns a sprite and hides the gold sphere when a target is spawned', () => {
    const h = harness(true);
    const handle = h.arena.spawnTarget(SPEC);
    expect(h.layer.spawned).toEqual([handle.id]);
    // The sphere is hidden - the skin owns the visuals now.
    const mesh = (handle as unknown as { mesh: Object3D }).mesh;
    expect(mesh.visible).toBe(false);
  });

  it('drives update on tick, fire on fire (with the live targets + current view), clear + dispose', () => {
    const h = harness(true);
    const handle = h.arena.spawnTarget(SPEC);
    h.arena.tick(16);
    expect(h.layer.updated).toBe(1);

    h.fire();
    expect(h.layer.fired).toHaveLength(1);
    expect(h.layer.fired[0]!.ids).toEqual([handle.id]);
    expect(h.layer.fired[0]!.view).toEqual([0, 0]); // no samples sent → crosshair at origin

    h.arena.clearTargets();
    expect(h.layer.cleared).toBe(1);

    h.arena.dispose();
    expect(h.layer.disposed).toBe(1);
  });

  it('INTEGRITY: attaching the skin does not move the angular truth (bearing/radius identical)', () => {
    const withSkin = harness(true).arena.spawnTarget(SPEC);
    const without = harness(false).arena.spawnTarget(SPEC);
    expect(withSkin.bearing()).toEqual(without.bearing());
    expect(withSkin.radiusDeg()).toEqual(without.radiusDeg());
  });

  it('leaves the sphere visible when no skin is attached (default arena unchanged)', () => {
    const h = harness(false);
    const handle = h.arena.spawnTarget(SPEC);
    const mesh = (handle as unknown as { mesh: Object3D }).mesh;
    expect(mesh.visible).toBe(true);
  });
});

describe('Arena ↔ cosmetic ViewmodelLayer wiring (P3-3)', () => {
  it('attaches the viewmodel exactly once', () => {
    const h = harness(false);
    const vm = new FakeViewmodelLayer();
    h.arena.attachViewmodel(vm);
    expect(vm.attached).toBe(1);
  });

  it('drives look on each aim sample, fire on fire, tick on tick, dispose on dispose', () => {
    const h = harness(false);
    const vm = new FakeViewmodelLayer();
    h.arena.attachViewmodel(vm);

    h.send({ t: 4, dx: 50, dy: 10 });
    expect(vm.looks).toHaveLength(1);

    h.arena.tick(16);
    expect(vm.ticked).toBe(1);

    h.fire();
    expect(vm.fires).toHaveLength(1);

    h.arena.dispose();
    expect(vm.disposed).toBe(1);
  });

  it('the attached weapon NEVER enters the targets map (it is a camera child, not a scored target)', () => {
    const h = harness(false);
    const vm = new FakeViewmodelLayer();
    h.arena.attachViewmodel(vm);
    const handle = h.arena.spawnTarget(SPEC);
    // The only thing in the scored targets map is the real target; the gun is not a TargetHandle.
    const targets = (h.arena as unknown as { targets: Map<string, unknown> }).targets;
    expect([...targets.keys()]).toEqual([handle.id]);
    expect(targets.size).toBe(1);
  });

  it('INTEGRITY: attaching the weapon does not move the angular truth (bearing/radius identical)', () => {
    const a = harness(false);
    a.arena.attachViewmodel(new FakeViewmodelLayer());
    const withGun = a.arena.spawnTarget(SPEC);
    const without = harness(false).arena.spawnTarget(SPEC);
    expect(withGun.bearing()).toEqual(without.bearing());
    expect(withGun.radiusDeg()).toEqual(without.radiusDeg());
  });
});
