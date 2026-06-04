import { describe, it, expect } from 'vitest';
import type { Object3D, Scene } from 'three';
import { Arena, type EnemyLayer, type InputSource, type RendererLike } from '../../src/engine/arena';
import type { AimSample, TargetHandle } from '../../src/types';
import { mulberry32 } from '../../src/stats/bootstrap';

/** Records every cosmetic call the arena drives — proves the hooks fire without touching scoring. */
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

describe('Arena ↔ cosmetic EnemyLayer wiring', () => {
  it('attaches the layer exactly once', () => {
    const h = harness(true);
    expect(h.layer.attached).toBe(1);
  });

  it('spawns a sprite and hides the gold sphere when a target is spawned', () => {
    const h = harness(true);
    const handle = h.arena.spawnTarget(SPEC);
    expect(h.layer.spawned).toEqual([handle.id]);
    // The sphere is hidden — the skin owns the visuals now.
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
