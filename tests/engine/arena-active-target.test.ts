import { describe, it, expect } from 'vitest';
import { Arena, type RendererLike } from '../../src/engine/arena';
import { counts360 } from '../../src/types';

const renderer: RendererLike = { render() {}, setSize() {}, dispose() {} };
const input = { onSample: () => () => {}, onFire: () => () => {} };
const makeArena = (): Arena =>
  new Arena({ renderer, input, size: () => [800, 600], counts: counts360(9000) });

const SPEC = { kind: 'static' as const, yaw: 0, pitch: 0, distance: 20, worldRadius: 0.6 };

describe('Arena.activeTarget', () => {
  it('is null before anything is presented, so absence is never a stale handle', () => {
    const arena = makeArena();
    expect(arena.activeTarget()).toBeNull();
    arena.dispose();
  });

  it('reports the target currently presented, and the newest one when several are up', () => {
    // The scored instruments present exactly one at a time; the range presents several. The
    // observational channel only ever reads the scored case, and the newest-wins rule is what makes
    // the one-at-a-time case exact rather than approximately right.
    const arena = makeArena();
    const a = arena.spawnTarget(SPEC);
    expect(arena.activeTarget()!.id).toBe(a.id);
    const b = arena.spawnTarget({ ...SPEC, yaw: 20 });
    expect(arena.activeTarget()!.id).toBe(b.id);
    arena.dispose();
  });

  it('goes null on clearTargets, which is how a reach ends', () => {
    // src/anchor/reach-observer.ts closes the open reach on the frame it first sees null. If a
    // cleared target kept reporting, the observer would keep buffering frames from the gap between
    // presentations into the previous reach, and the extent it measured would be the gap plus the
    // reach: a landedFraction biased HIGH by an amount nothing in the trace can bound.
    const arena = makeArena();
    arena.spawnTarget(SPEC);
    arena.clearTargets();
    expect(arena.activeTarget()).toBeNull();
    arena.dispose();
  });

  it('goes null when the presented target is removed by id, and survives removing another', () => {
    const arena = makeArena();
    const a = arena.spawnTarget(SPEC);
    const b = arena.spawnTarget({ ...SPEC, yaw: 20 });
    arena.removeTarget(a.id);
    expect(arena.activeTarget()!.id).toBe(b.id); // removing a retired one leaves the live one alone
    arena.removeTarget(b.id);
    expect(arena.activeTarget()).toBeNull();
    arena.dispose();
  });

  it('reads with no side effects: reading it twice does not change what the arena holds', () => {
    // It sits on the read-only side of the integrity invariant, so it must be safe to call from a
    // frame callback on every frame of a scored trial.
    const arena = makeArena();
    const a = arena.spawnTarget(SPEC);
    expect(arena.activeTarget()).toBe(arena.activeTarget());
    expect(arena.activeTarget()!.id).toBe(a.id);
    arena.dispose();
  });
});
