import type {
  AimSample,
  ArenaScene,
  Cm360,
  Degrees,
  Dpi,
  Ms,
  TargetHandle,
  TargetSpec,
} from '../../src/types';

/** A scriptable ArenaScene for testing instrument run() shells in Node. */
export class FakeScene implements ArenaScene {
  view_: [Degrees, Degrees] = [0, 0];
  now = 0;
  spawned: TargetSpec[] = [];
  cleared = 0;
  private frameCbs = new Set<(dt: Ms, now: Ms) => void>();
  private fireCbs = new Set<(now: Ms) => void>();
  private targets: FakeTarget[] = [];

  setSensitivity(_c: Cm360, _d: Dpi): void {}
  view(): [Degrees, Degrees] {
    return this.view_;
  }
  spawnTarget(spec: TargetSpec): TargetHandle {
    this.spawned.push(spec);
    const t = new FakeTarget(`t${this.spawned.length}`, [spec.yaw ?? 0, spec.pitch ?? 0]);
    this.targets.push(t);
    return t;
  }
  clearTargets(): void {
    this.cleared += 1;
    this.targets = [];
  }
  onAim(_cb: (s: AimSample, v: [Degrees, Degrees]) => void): () => void {
    return () => {};
  }
  onFrame(cb: (dt: Ms, now: Ms) => void): () => void {
    this.frameCbs.add(cb);
    return () => this.frameCbs.delete(cb);
  }
  onFire(cb: (now: Ms) => void): () => void {
    this.fireCbs.add(cb);
    return () => this.fireCbs.delete(cb);
  }

  // --- test drivers ---
  /** Set the current aim and advance the clock by `dt`, emitting one frame. */
  tick(dt: Ms, aim?: [Degrees, Degrees]): void {
    if (aim) this.view_ = aim;
    this.now += dt;
    for (const cb of [...this.frameCbs]) cb(dt, this.now);
  }
  /** Emit a fire event at the current clock. */
  fire(aim?: [Degrees, Degrees]): void {
    if (aim) this.view_ = aim;
    for (const cb of [...this.fireCbs]) cb(this.now);
  }
  /** Move the most-recently-spawned target's bearing (simulates a moving/relocated target). */
  moveTarget(bearing: [Degrees, Degrees], radiusDeg?: Degrees): void {
    const t = this.targets[this.targets.length - 1];
    if (t) t.set(bearing, radiusDeg);
  }
}

class FakeTarget implements TargetHandle {
  private r = 2;
  constructor(
    public readonly id: string,
    private b: [Degrees, Degrees],
  ) {}
  set(b: [Degrees, Degrees], radiusDeg?: Degrees): void {
    this.b = b;
    if (radiusDeg !== undefined) this.r = radiusDeg;
  }
  bearing(): [Degrees, Degrees] {
    return this.b;
  }
  radiusDeg(): Degrees {
    return this.r;
  }
}
