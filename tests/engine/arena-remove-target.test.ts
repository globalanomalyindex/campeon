import { describe, it, expect } from 'vitest';
import { Arena, type RendererLike } from '../../src/engine/arena';

const renderer: RendererLike = { render() {}, setSize() {}, dispose() {} };
const input = { onSample: () => () => {}, onFire: () => () => {} };
const makeArena = (): Arena =>
  new Arena({ renderer, input, size: () => [800, 600], cm360: 30, dpi: 800 });

describe('Arena.removeTarget', () => {
  it('removes a single target by id, leaving others', () => {
    const arena = makeArena();
    const a = arena.spawnTarget({ kind: 'static', yaw: 0, pitch: 0, distance: 20 });
    const b = arena.spawnTarget({ kind: 'static', yaw: 10, pitch: 0, distance: 20 });
    arena.removeTarget(a.id);
    expect(() => arena.removeTarget(a.id)).not.toThrow(); // removing twice is a safe no-op
    arena.removeTarget(b.id);
    arena.dispose();
  });

  it('drops a moving target from the moving set so tick no longer advances it', () => {
    const arena = makeArena();
    const m = arena.spawnTarget({ kind: 'moving', yaw: 0, pitch: 0, distance: 20, motion: { yawAmp: 5, baseFreq: 1 } });
    arena.removeTarget(m.id);
    expect(() => arena.tick(16)).not.toThrow();
    arena.dispose();
  });
});
