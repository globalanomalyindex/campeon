import { describe, it, expect } from 'vitest';
import type { AimSample, Degrees } from '../../src/types';
import { Arena } from '../../src/engine/arena';
import type { RendererLike, InputSource } from '../../src/engine/arena';
import { degreesPerCount } from '../../src/engine/camera-rig';
import { mulberry32 } from '../../src/stats/bootstrap';

function harness() {
  let emit: (s: AimSample) => void = () => {};
  let unsubs = 0;
  const input: InputSource = {
    onSample(cb) {
      emit = cb;
      return () => {
        emit = () => {};
        unsubs += 1;
      };
    },
  };
  let renders = 0;
  let disposes = 0;
  const renderer: RendererLike = {
    render() {
      renders += 1;
    },
    setSize() {},
    dispose() {
      disposes += 1;
    },
  };
  const arena = new Arena({
    renderer,
    input,
    size: () => [800, 600],
    cm360: 34,
    dpi: 800,
    rng: mulberry32(1),
  });
  return {
    arena,
    send: (s: AimSample) => emit(s),
    renders: () => renders,
    unsubs: () => unsubs,
    disposes: () => disposes,
  };
}

describe('Arena (headless)', () => {
  it('emits onAim with the integrated view for each sample', () => {
    const h = harness();
    const seen: Array<[AimSample, [Degrees, Degrees]]> = [];
    h.arena.onAim((s, v) => seen.push([s, v]));
    const dpc = degreesPerCount(34, 800);
    h.send({ t: 0, dx: 10 / dpc, dy: 0 });
    expect(seen).toHaveLength(1);
    expect(seen[0][1][0]).toBeCloseTo(10, 4); // yaw advanced 10°
  });

  it('unsubscribing stops delivery', () => {
    const h = harness();
    let count = 0;
    const off = h.arena.onAim(() => {
      count += 1;
    });
    h.send({ t: 0, dx: 5, dy: 0 });
    off();
    h.send({ t: 1, dx: 5, dy: 0 });
    expect(count).toBe(1);
  });

  it('spawnTarget returns a forward handle; clearTargets empties without throwing', () => {
    const h = harness();
    const t = h.arena.spawnTarget({ kind: 'static' });
    const [y, p] = t.bearing();
    expect(Math.abs(y)).toBeLessThanOrEqual(25);
    expect(Math.abs(p)).toBeLessThanOrEqual(12);
    expect(t.radiusDeg()).toBeGreaterThan(0);
    h.arena.clearTargets();
    expect(() => h.arena.spawnTarget({ kind: 'static' })).not.toThrow();
  });

  it('setSensitivity halves the rotation for a fixed count stream', () => {
    const h = harness();
    let yaw = 0;
    h.arena.onAim((_s, v) => {
      yaw = v[0];
    });
    h.send({ t: 0, dx: 500, dy: 0 });
    const lo = yaw;
    h.arena.setSensitivity(68, 800);
    h.send({ t: 1, dx: 500, dy: 0 });
    expect(yaw - lo).toBeCloseTo(lo / 2, 4);
  });

  it('render() delegates to the injected renderer', () => {
    const h = harness();
    h.arena.render();
    expect(h.renders()).toBe(1);
  });

  it('dispose() is idempotent: unsubscribes input + disposes the renderer once', () => {
    const h = harness();
    h.arena.dispose();
    h.arena.dispose();
    expect(h.unsubs()).toBe(1);
    expect(h.disposes()).toBe(1);
  });
});
