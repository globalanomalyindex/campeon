import {
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
} from 'three';
import type { AimSample, ArenaScene, Cm360, Degrees, Dpi, TargetHandle, TargetSpec } from '../types';
import { CameraRig } from './camera-rig';
import { Target, placeStatic } from './targets';

/** Minimal renderer surface the arena needs — satisfied by THREE.WebGLRenderer. */
export interface RendererLike {
  render(scene: Scene, camera: PerspectiveCamera): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

/** A source of pointer deltas — satisfied by the pointer-lock controller. */
export interface InputSource {
  onSample(cb: (sample: AimSample) => void): () => void;
}

export interface ArenaOptions {
  renderer: RendererLike;
  input: InputSource;
  size: () => [number, number];
  cm360: Cm360;
  dpi: Dpi;
  rng?: () => number;
}

type AimCallback = (sample: AimSample, view: [Degrees, Degrees]) => void;

/** A first-person arena: mouse-look at a set cm/360, spawn targets, emit aim samples. */
export class Arena implements ArenaScene {
  private readonly scene = new Scene();
  private readonly rig: CameraRig;
  private readonly renderer: RendererLike;
  private readonly sizeFn: () => [number, number];
  private readonly rng: () => number;
  private readonly targets = new Map<string, Target>();
  private readonly aimCbs = new Set<AimCallback>();
  private readonly unsubInput: () => void;
  private nextId = 0;
  private readonly envDisposables: Array<{ dispose(): void }> = [];
  private disposed = false;

  constructor(opts: ArenaOptions) {
    this.renderer = opts.renderer;
    this.sizeFn = opts.size;
    this.rng = opts.rng ?? Math.random;
    const [w, h] = this.sizeFn();
    this.rig = new CameraRig(opts.cm360, opts.dpi, w / Math.max(1, h));
    this.buildEnvironment();
    this.renderer.setSize(w, h);
    this.unsubInput = opts.input.onSample((sample) => this.handleSample(sample));
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

  setSensitivity(cm360: Cm360, dpi: Dpi): void {
    this.rig.setSensitivity(cm360, dpi);
  }

  spawnTarget(_spec: TargetSpec): TargetHandle {
    // Phase 2 places a single static target. spec.kind (moving/grid) is honored in
    // Phase 3 once TargetSpec carries placement/motion fields.
    const id = `t${this.nextId++}`;
    const target = new Target(id, placeStatic(this.rng));
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
  }

  /** Render one frame (call from the host's RAF loop). */
  render(): void {
    this.renderer.render(this.scene, this.rig.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubInput();
    this.clearTargets();
    for (const d of this.envDisposables) d.dispose();
    this.renderer.dispose();
  }
}
