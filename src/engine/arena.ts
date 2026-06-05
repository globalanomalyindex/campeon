import {
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  type Object3D,
  PerspectiveCamera,
  Scene,
} from 'three';
import type { AimSample, ArenaScene, Cm360, Degrees, Dpi, Ms, TargetHandle, TargetSpec } from '../types';
import { CameraRig } from './camera-rig';
import { Target, MovingTarget, placeStatic, type Placement } from './targets';
import type { PostProcessor } from './psx-pass';

/** Minimal renderer surface the arena needs - satisfied by THREE.WebGLRenderer. */
export interface RendererLike {
  render(scene: Scene, camera: PerspectiveCamera): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

/** A source of pointer deltas - satisfied by the pointer-lock controller. */
export interface InputSource {
  onSample(cb: (sample: AimSample) => void): () => void;
  /** Optional fire (primary-button) events. Absent in headless tests that don't fire. */
  onFire?(cb: () => void): () => void;
}

/**
 * A cosmetic billboard skin for targets (e.g. the merc-prey sprites). PURELY decorative: the arena
 * drives its lifecycle but it never feeds back into samples or scores. The arena keeps each target's
 * sphere as the owner of bearing()/radiusDeg() and only hides it; the layer pins a sprite at the same
 * position. Injected post-construction via `attachEnemies` because its sheet textures load async.
 */
export interface EnemyLayer {
  /** Add the layer's container to the arena scene (called once on attach). */
  attach(scene: Scene): void;
  /** A target appeared at `object`'s position with angular radius `radiusDeg` - start its spawn animation. */
  spawn(id: string, object: Object3D, radiusDeg: Degrees, nowMs: Ms): void;
  /** Per-frame: follow target positions, advance animations, retire finished ones. */
  update(nowMs: Ms): void;
  /** A shot was fired from `view`; classify against live `targets` to play death/flinch (cosmetic). */
  fire(nowMs: Ms, view: [Degrees, Degrees], targets: ReadonlyArray<TargetHandle>): void;
  /** Remove all live sprites (per trial). */
  clear(): void;
  /** Retire a single live sprite by id (range free-play removes targets one at a time; no-op if absent). */
  remove?(id: string): void;
  dispose(): void;
}

export interface ArenaOptions {
  renderer: RendererLike;
  input: InputSource;
  size: () => [number, number];
  cm360: Cm360;
  dpi: Dpi;
  rng?: () => number;
  /** Optional cosmetic post-processor (e.g. the PSX pass). When present it owns the final draw. */
  postProcessor?: PostProcessor;
}

type AimCallback = (sample: AimSample, view: [Degrees, Degrees]) => void;
type FrameCallback = (dtMs: Ms, nowMs: Ms) => void;
type FireCallback = (nowMs: Ms) => void;

/** A first-person arena: mouse-look at a set cm/360, spawn targets, emit aim samples. */
export class Arena implements ArenaScene {
  private readonly scene = new Scene();
  private readonly rig: CameraRig;
  private readonly renderer: RendererLike;
  private readonly sizeFn: () => [number, number];
  private readonly rng: () => number;
  private readonly targets = new Map<string, Target | MovingTarget>();
  private readonly aimCbs = new Set<AimCallback>();
  private readonly frameCbs = new Set<FrameCallback>();
  private readonly fireCbs = new Set<FireCallback>();
  private readonly moving = new Set<MovingTarget>();
  private readonly unsubInput: () => void;
  private readonly unsubFire: () => void;
  private nextId = 0;
  private readonly envDisposables: Array<{ dispose(): void }> = [];
  private disposed = false;
  private nowMs: Ms = 0;
  private readonly post: PostProcessor | undefined;
  private enemies: EnemyLayer | undefined;

  constructor(opts: ArenaOptions) {
    this.renderer = opts.renderer;
    this.post = opts.postProcessor;
    this.sizeFn = opts.size;
    this.rng = opts.rng ?? Math.random;
    const [w, h] = this.sizeFn();
    this.rig = new CameraRig(opts.cm360, opts.dpi, w / Math.max(1, h));
    this.buildEnvironment();
    this.renderer.setSize(w, h);
    this.unsubInput = opts.input.onSample((sample) => this.handleSample(sample));
    this.unsubFire = opts.input.onFire
      ? opts.input.onFire(() => this.handleFire())
      : () => {};
  }

  private buildEnvironment(): void {
    this.scene.background = new Color('#0c0b09'); // warm cinema-ink, matches the app-wide film stock
    // Warm film-stock lighting: a cream sky over a warm ground, so lit surfaces read warm not blue-grey.
    const hemi = new HemisphereLight(0xe7dcc4, 0x191510, 1.0);
    const dir = new DirectionalLight(0xfff3e2, 0.6); // faintly warm key light
    dir.position.set(3, 10, 4);
    // Floor grid: warm cream-tinted hairlines over the cinema-ink, not the old cool blue-grey.
    const grid = new GridHelper(200, 80, 0x3a342a, 0x16130e);
    grid.position.y = -3;
    this.scene.add(hemi, dir, grid);
    this.envDisposables.push(grid); // GridHelper owns a BufferGeometry + LineBasicMaterial
  }

  private handleSample(sample: AimSample): void {
    this.rig.apply(sample);
    const view = this.rig.view();
    for (const cb of this.aimCbs) cb(sample, view);
  }

  private handleFire(): void {
    // Classify against the LIVE target first - before an instrument's fire handler clears/advances it -
    // so the pop reads the target you actually shot. Cosmetic only: reads view+bearings, writes nothing.
    this.enemies?.fire(this.nowMs, this.rig.view(), [...this.targets.values()]);
    for (const cb of this.fireCbs) cb(this.nowMs);
  }

  setSensitivity(cm360: Cm360, dpi: Dpi): void {
    this.rig.setSensitivity(cm360, dpi);
  }

  /**
   * Attach a cosmetic enemy-billboard layer (its sheet textures load async, so it arrives after
   * construction). The layer hides each target's sphere but never touches its transform - bearing()
   * and radiusDeg() are unchanged, so the cm/360 measurement is unaffected.
   */
  attachEnemies(layer: EnemyLayer): void {
    this.enemies = layer;
    layer.attach(this.scene);
  }

  /** Current arena clock (ms since construction). */
  now(): Ms {
    return this.nowMs;
  }

  view(): [Degrees, Degrees] {
    return this.rig.view();
  }

  /** Advance the clock by `dtMs`, move targets, and emit the frame to subscribers. */
  tick(dtMs: Ms): void {
    if (this.disposed) return;
    this.nowMs += dtMs;
    for (const t of this.moving) t.update(this.nowMs);
    this.enemies?.update(this.nowMs); // follow target positions + advance sprite animations (cosmetic)
    for (const cb of this.frameCbs) cb(dtMs, this.nowMs);
  }

  onFrame(cb: FrameCallback): () => void {
    this.frameCbs.add(cb);
    return () => {
      this.frameCbs.delete(cb);
    };
  }

  onFire(cb: FireCallback): () => void {
    this.fireCbs.add(cb);
    return () => {
      this.fireCbs.delete(cb);
    };
  }

  spawnTarget(spec: TargetSpec): TargetHandle {
    const id = `t${this.nextId++}`;
    const hasPlacement = spec.yaw !== undefined || spec.pitch !== undefined;
    const placement: Placement = hasPlacement
      ? {
          yaw: spec.yaw ?? 0,
          pitch: spec.pitch ?? 0,
          distance: spec.distance ?? 20,
          worldRadius: spec.worldRadius ?? 0.6,
        }
      : placeStatic(this.rng, {
          ...(spec.distance !== undefined ? { distance: spec.distance } : {}),
          ...(spec.worldRadius !== undefined ? { worldRadius: spec.worldRadius } : {}),
        });

    const target: Target | MovingTarget =
      spec.kind === 'moving'
        ? new MovingTarget(id, placement, spec.motion ?? {}, this.nowMs)
        : new Target(id, placement);
    if (target instanceof MovingTarget) this.moving.add(target);
    this.targets.set(id, target);
    this.scene.add(target.mesh);
    if (this.enemies) {
      // The merc skin replaces the gold sphere visually; the sphere's transform still owns bearing/radius.
      target.mesh.visible = false;
      this.enemies.spawn(id, target.mesh, target.radiusDeg(), this.nowMs);
    }
    return target;
  }

  clearTargets(): void {
    this.enemies?.clear();
    for (const target of this.targets.values()) {
      this.scene.remove(target.mesh);
      target.dispose();
    }
    this.targets.clear();
    this.moving.clear();
  }

  /** Remove a single target by id (range free-play retires killed targets one at a time). Safe no-op
   *  if the id is unknown. A clean-hit merc death already lives on in the layer's fade-out set; the
   *  `enemies.remove` call also retires a still-live sprite (e.g. under reduced motion, where `fire()`
   *  never moved it to fade-outs) so none are left frozen on screen. */
  removeTarget(id: string): void {
    const target = this.targets.get(id);
    if (!target) return;
    this.scene.remove(target.mesh);
    if (target instanceof MovingTarget) this.moving.delete(target);
    target.dispose();
    this.targets.delete(id);
    this.enemies?.remove?.(id);
  }

  onAim(cb: AimCallback): () => void {
    this.aimCbs.add(cb);
    return () => {
      this.aimCbs.delete(cb);
    };
  }

  /** Re-read the size function and update camera aspect + renderer (call on window resize). */
  resize(): void {
    const [w, h] = this.sizeFn();
    this.rig.camera.aspect = w / Math.max(1, h);
    this.rig.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.post?.setSize(w, h);
  }

  /** Render one frame (call from the host's RAF loop). The PSX pass, if present, owns the final draw. */
  render(): void {
    if (this.post) this.post.render(this.scene, this.rig.camera);
    else this.renderer.render(this.scene, this.rig.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubInput();
    this.unsubFire();
    this.clearTargets();
    this.frameCbs.clear();
    this.fireCbs.clear();
    this.enemies?.dispose();
    for (const d of this.envDisposables) d.dispose();
    this.post?.dispose();
    this.renderer.dispose();
  }
}
