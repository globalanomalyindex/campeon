import {
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
} from 'three';
import type { AimSample, ArenaScene, Cm360, Degrees, Dpi, Ms, TargetHandle, TargetSpec } from '../types';
import { CameraRig } from './camera-rig';
import { Target, MovingTarget, placeStatic, type Placement } from './targets';
import type { PostProcessor } from './psx-pass';

/** Minimal renderer surface the arena needs — satisfied by THREE.WebGLRenderer. */
export interface RendererLike {
  render(scene: Scene, camera: PerspectiveCamera): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

/** A source of pointer deltas — satisfied by the pointer-lock controller. */
export interface InputSource {
  onSample(cb: (sample: AimSample) => void): () => void;
  /** Optional fire (primary-button) events. Absent in headless tests that don't fire. */
  onFire?(cb: () => void): () => void;
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
    this.scene.background = new Color('#0D0D0D');
    const hemi = new HemisphereLight(0xbfd4e0, 0x202020, 1.0);
    const dir = new DirectionalLight(0xffffff, 0.6);
    dir.position.set(3, 10, 4);
    const grid = new GridHelper(200, 80, 0x33424c, 0x1a2228);
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
    for (const cb of this.fireCbs) cb(this.nowMs);
  }

  setSensitivity(cm360: Cm360, dpi: Dpi): void {
    this.rig.setSensitivity(cm360, dpi);
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

    if (spec.kind === 'moving') {
      const target = new MovingTarget(id, placement, spec.motion ?? {}, this.nowMs);
      this.moving.add(target);
      this.targets.set(id, target);
      this.scene.add(target.mesh);
      return target;
    }
    const target = new Target(id, placement);
    this.targets.set(id, target);
    this.scene.add(target.mesh);
    return target;
  }

  clearTargets(): void {
    for (const target of this.targets.values()) {
      this.scene.remove(target.mesh);
      target.dispose();
    }
    this.targets.clear();
    this.moving.clear();
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
    for (const d of this.envDisposables) d.dispose();
    this.post?.dispose();
    this.renderer.dispose();
  }
}
