import { describe, it, expect } from 'vitest';
import type { Object3D, Scene } from 'three';
import { Arena, type EnemyLayer, type InputSource, type RendererLike } from '../../src/engine/arena';
import type { AimSample, TargetHandle, TargetSpec } from '../../src/types';
import { mulberry32 } from '../../src/stats/bootstrap';
import { TrialRecorder, type Recording } from '../../src/instruments/recording';

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
  const arena = new Arena({ renderer, input, size: () => [800, 600], cm360: 34, dpi: 800, rng: mulberry32(1) });
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
// sphere is the SOLE owner of bearing()/radiusDeg()/cm360; an attached EnemyLayer
// is a cosmetic sibling that only READS the sphere transform + view. To prove that,
// we drive the SAME scripted session twice - once with a layer attached, once
// without - feeding identical samples/ticks/fire events in the same order, and
// deepEqual the entire scored Recording {frames, fires}. Every 3D-migration task
// (P3-2 quarry meshes, P3-3 revolver viewmodel, P3-4 death/escape, P3-5 film pass)
// MUST keep this gate green and MAY extend it, never weaken an assertion to pass.

/** A self-contained scripted arena + recorder; one optional cosmetic layer, no other deps. */
function scriptedSession(
  spec: TargetSpec,
  layer?: EnemyLayer,
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
  const arena = new Arena({ renderer, input, size: () => [800, 600], cm360: 34, dpi: 800, rng: mulberry32(7) });
  if (layer) arena.attachEnemies(layer);

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
  clear(): void {}
  remove(_id: string): void {}
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
