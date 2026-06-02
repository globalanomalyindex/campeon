import { describe, it, expect } from 'vitest';
import type { AimSample, Degrees } from '../../src/types';
import { Arena } from '../../src/engine/arena';
import type { RendererLike, InputSource } from '../../src/engine/arena';
import { degreesPerCount } from '../../src/engine/camera-rig';
import { mulberry32 } from '../../src/stats/bootstrap';
import { separation } from '../../src/engine/targets';

function harness() {
  let emit: (s: AimSample) => void = () => {};
  let fire: (now: number) => void = () => {};
  let unsubs = 0;
  const input: InputSource = {
    onSample(cb) {
      emit = cb;
      return () => {
        emit = () => {};
        unsubs += 1;
      };
    },
    onFire(cb) {
      fire = cb;
      return () => {
        fire = () => {};
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
    fire: (now: number) => fire(now),
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

describe('Arena instrument surface', () => {
  it('onFrame fires with dt and an advancing clock', () => {
    const h = harness();
    const ticks: Array<[number, number]> = [];
    h.arena.onFrame((dt, now) => ticks.push([dt, now]));
    h.arena.tick(16);
    h.arena.tick(16);
    expect(ticks).toHaveLength(2);
    expect(ticks[0][0]).toBe(16);
    expect(ticks[1][1]).toBeGreaterThan(ticks[0][1]);
  });

  it('view() reflects the integrated aim', () => {
    const h = harness();
    const dpc = degreesPerCount(34, 800);
    h.send({ t: 0, dx: 12 / dpc, dy: 0 });
    expect(h.arena.view()[0]).toBeCloseTo(12, 4);
  });

  it('onFire delivers the arena clock on a fire event', () => {
    const h = harness();
    const fires: number[] = [];
    h.arena.onFire((now) => fires.push(now));
    h.arena.tick(100);
    h.fire(h.arena.now());
    expect(fires).toHaveLength(1);
    expect(fires[0]).toBeCloseTo(100, 6);
  });

  it('spawnTarget honors explicit placement', () => {
    const h = harness();
    const t = h.arena.spawnTarget({ kind: 'static', yaw: 18, pitch: -7, distance: 25, worldRadius: 0.5 });
    const [y, p] = t.bearing();
    expect(y).toBeCloseTo(18, 4);
    expect(p).toBeCloseTo(-7, 4);
  });

  it('a moving target changes bearing as the clock advances', () => {
    const h = harness();
    const t = h.arena.spawnTarget({
      kind: 'moving',
      yaw: 0,
      pitch: 0,
      distance: 20,
      worldRadius: 0.6,
      motion: { yawAmp: 10, pitchAmp: 4, baseFreq: 0.5, seed: 2 },
    });
    const b0 = t.bearing();
    h.arena.tick(800);
    const b1 = t.bearing();
    expect(separation(b0, b1)).toBeGreaterThan(0.3);
  });

  it('dispose() unsubscribes frame/fire callbacks too (idempotent)', () => {
    const h = harness();
    let frames = 0;
    h.arena.onFrame(() => (frames += 1));
    h.arena.dispose();
    h.arena.dispose();
    h.arena.tick(16);
    expect(frames).toBe(0);
    expect(h.disposes()).toBe(1);
  });
});
