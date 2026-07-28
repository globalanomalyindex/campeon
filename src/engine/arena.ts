import {
  Color,
  DirectionalLight,
  Fog,
  GridHelper,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  type PerspectiveCamera,
  PlaneGeometry,
  Scene,
} from 'three';
import type { AimSample, ArenaScene, Counts360, Degrees, Ms, TargetHandle, TargetSpec } from '../types';
import { hex } from '../palette';
import { CameraRig } from './camera-rig';
import { createWarmEnvTexture, ENV_INTENSITY, FOG_FAR, FOG_NEAR } from './environment';
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

/**
 * A cosmetic first-person VIEWMODEL skin (e.g. the in-scene 3D revolver). MIRRORS `EnemyLayer`'s
 * reads-never-writes shape exactly: the arena drives its lifecycle but it NEVER feeds back into samples
 * or scores. `attach` parents the weapon to the rig camera (and adds the camera to the scene so its
 * children render); `look` is handed the current view each aim sample (the layer computes its own sway
 * delta); `fire` is handed the current view on each shot (cosmetic recoil only); `tick` advances the
 * weapon springs. None of these may write a sample/score/Observation into the scored stream.
 */
export interface ViewmodelLayer {
  /** Parent the weapon to `camera` and ensure the camera is in `scene` (called once on attach). */
  attach(scene: Scene, camera: PerspectiveCamera): void;
  /** Per-frame: advance the recoil/sway springs and re-pose the weapon. */
  tick(nowMs: Ms): void;
  /** An aim sample arrived; `view` is the new crosshair bearing - nudge sway (cosmetic). */
  look(view: [Degrees, Degrees]): void;
  /** A shot was fired with the crosshair at `view` - play the recoil punch (cosmetic). */
  fire(view: [Degrees, Degrees]): void;
  dispose(): void;
}

export interface ArenaOptions {
  renderer: RendererLike;
  input: InputSource;
  size: () => [number, number];
  counts: Counts360;
  rng?: () => number;
  /** Optional cosmetic post-processor (e.g. the PSX pass). When present it owns the final draw. */
  postProcessor?: PostProcessor;
}

/**
 * World Y of the arena's visible floor (the grid). The single source of truth for anything that
 * grounds itself on that plane (the grid itself, per-target contact-shadow blobs). Targets spawn on
 * a sphere around the eye, so a target CAN sit below this plane - consumers must handle that.
 */
export const ARENA_GROUND_Y = -3;

/**
 * The longest single frame the arena will credit to its clock, in ms (10 fps).
 *
 * The clock is a hand-accumulated sum of rAF deltas, and rAF hands back the WHOLE gap on the first
 * frame after the tab was hidden, the machine slept, or the compositor stalled. Uncapped, that gap
 * lands inside an in-flight trial as one enormous frame: the instrument's elapsed accumulator jumps
 * (a 6 s track trial can end on its second frame), the target advances seconds along its path
 * between two adjacent recorded frames, and the recording claims the player was shown all of it.
 * A frame at or under the cap is a hitch a real machine produces, and it passes through untouched.
 * Beyond the cap the arena was stalled: that time was never shown to the player, so it is dropped.
 */
export const MAX_FRAME_MS: Ms = 100;

/**
 * A three color int for a warm arena SURFACE, expressed as a documented BRIGHTNESS of a palette
 * pigment (never a raw literal): every leather-toned surface the arena draws - the stage floor, the
 * grid hairlines - is `hex.hide` (the quarry's own dusty-leather token) at a different value, so a
 * palette retune moves the whole warm family in lockstep. `k` < 1 darkens, > 1 lifts.
 */
function warmSurface(paletteHex: string, k: number): number {
  const n = parseInt(paletteHex.slice(1), 16);
  const ch = (shift: number): number => Math.min(255, Math.round(((n >> shift) & 0xff) * k));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
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
  private present = true;
  private readonly post: PostProcessor | undefined;
  private enemies: EnemyLayer | undefined;
  private viewmodel: ViewmodelLayer | undefined;

  constructor(opts: ArenaOptions) {
    this.renderer = opts.renderer;
    this.post = opts.postProcessor;
    this.sizeFn = opts.size;
    this.rng = opts.rng ?? Math.random;
    const [w, h] = this.sizeFn();
    this.rig = new CameraRig(opts.counts, w / Math.max(1, h));
    this.buildEnvironment();
    this.renderer.setSize(w, h);
    this.unsubInput = opts.input.onSample((sample) => this.handleSample(sample));
    this.unsubFire = opts.input.onFire
      ? opts.input.onFire(() => this.handleFire())
      : () => {};
  }

  private buildEnvironment(): void {
    // Shared warm cinema-ink from the palette (the single source for the film stock): both the
    // backdrop AND the fog color, so depth fades into the stock instead of a mismatched haze color
    // revealing the far clip plane, and a palette retune moves both at once.
    const inkColor = new Color(hex.ink);
    this.scene.background = inkColor; // warm cinema-ink, matches the app-wide film stock
    this.scene.fog = new Fog(inkColor.getHex(), FOG_NEAR, FOG_FAR);
    // Warm film-stock lighting: a cream sky over a warm ground, so lit surfaces read warm not blue-grey.
    // Tuned so the low-poly 3D quarry + revolver (low-metalness, no environment map) read as lit FORM
    // against the near-black backdrop without washing out the moody spaghetti-western mood.
    const hemi = new HemisphereLight(0xe7dcc4, 0x2a2218, 1.6);
    const key = new DirectionalLight(0xfff3e2, 1.1); // warm key, high front-right
    key.position.set(3, 10, 4);
    // Warm rim/back light (the spaghetti-western low sun). It sits BEYOND the forward targets (negative
    // z, past them) so its rays strike their far faces and halo the silhouette edges against the dark
    // arena - true rim separation, not a front fill. Strong + saturated-warm for a dramatic edge.
    const rim = new DirectionalLight(0xffac5a, 1.5);
    rim.position.set(6, 7, -24);
    // Dim warm FILL from the camera side, low and left (opposite the key's high right): vertical
    // faces otherwise starve (the key + hemisphere favor upward faces), leaving the quarry's front
    // a black cutout. Deliberately weak - it lifts the shadow side a stop, it does not flatten the
    // rim drama.
    const fill = new DirectionalLight(0xe7c9a4, 0.45);
    fill.position.set(-5, 1.5, 9);
    // The stage floor: a big LIT plane under the grid, so the ground actually READS - the warm
    // hemisphere grades it, the fog swallows it toward the horizon (the depth cue), and the
    // per-target contact shadows have a surface to sit on. Dark warm leather, never pure black.
    const floor = new Mesh(
      new PlaneGeometry(400, 400),
      // The leather pigment at a deep value - darker than the quarry so a target reads against it.
      new MeshStandardMaterial({ color: warmSurface(hex.hide, 0.37), roughness: 0.95, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = ARENA_GROUND_Y - 0.02; // just under the grid hairlines
    // Floor grid: warm hairlines (the same leather pigment lifted) over the lit floor, fading into
    // the fog. The center cross (3rd arg) sits a step brighter as the axis anchor; the field lines
    // (4th arg) sit dim between floor and cross so the near field carries the depth read.
    const grid = new GridHelper(200, 80, warmSurface(hex.hide, 1.5), warmSurface(hex.hide, 0.75));
    grid.position.y = ARENA_GROUND_Y;
    this.scene.add(hemi, key, rim, fill, floor, grid);
    this.envDisposables.push(grid); // GridHelper owns a BufferGeometry + LineBasicMaterial
    this.envDisposables.push(floor.geometry, floor.material as MeshStandardMaterial);

    // Warm procedural equirect env map (SUN_DIR normalizes this SAME rim-light position, so the IBL
    // specular ping on metallic props agrees with the analytic rim halo above). three r161+'s
    // WebGLRenderer auto-converts an equirect `scene.environment` at render time, so the arena stays
    // renderer-agnostic - stub renderers in tests never touch WebGL and never see this conversion.
    const env = createWarmEnvTexture();
    this.scene.environment = env;
    this.scene.environmentIntensity = ENV_INTENSITY;
    this.envDisposables.push(env);
  }

  private handleSample(sample: AimSample): void {
    if (!this.present) return; // absent: a cursor swinging over a scrim is not an aim
    this.rig.apply(sample);
    const view = this.rig.view();
    this.viewmodel?.look(view); // cosmetic weapon sway reads the new bearing; writes nothing
    for (const cb of this.aimCbs) cb(sample, view);
  }

  private handleFire(): void {
    if (!this.present) return; // absent: a click on a dialog button is not a shot
    // Classify against the LIVE target first - before an instrument's fire handler clears/advances it -
    // so the pop reads the target you actually shot. Cosmetic only: reads view+bearings, writes nothing.
    this.enemies?.fire(this.nowMs, this.rig.view(), [...this.targets.values()]);
    this.viewmodel?.fire(this.rig.view()); // cosmetic recoil; reads view, writes nothing scored
    for (const cb of this.fireCbs) cb(this.nowMs);
  }

  setSensitivity(counts: Counts360): void {
    this.rig.setSensitivity(counts);
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

  /**
   * Attach a cosmetic first-person viewmodel (the in-scene 3D revolver). MIRRORS `attachEnemies`
   * exactly: the layer parents its weapon to the rig camera (and adds the camera to the scene so its
   * children render) and only READS view()/fire()/look() to react. It NEVER enters the targets map,
   * never replaces the scored sphere, and never writes a sample/score into the scored stream - so
   * bearing()/radiusDeg()/counts stay byte-identical with or without the weapon.
   */
  attachViewmodel(vm: ViewmodelLayer): void {
    this.viewmodel = vm;
    vm.attach(this.scene, this.rig.camera);
  }

  /** Current arena clock (ms since construction). */
  now(): Ms {
    return this.nowMs;
  }

  view(): [Degrees, Degrees] {
    return this.rig.view();
  }

  /**
   * Presence gate (VALIDITY): whether the player is demonstrably in the arena, which the shell
   * reports from pointer lock. While absent the arena advances nothing - no clock, no target motion,
   * no frame, no aim sample, no shot - so an in-flight trial FREEZES and resumes from exactly where
   * it was left, and nothing collected while the player was not playing is scored as if they were.
   *
   * The other honest option was to discard an interrupted trial outright. Freezing is the choice
   * here. Neither one scores the absence, and the difference is what each costs. Discarding makes
   * the pause a filter on the data: a visitor presses Esc when a trial is going badly or a
   * sensitivity feels wrong, so dropping exactly those trials deletes the low tail at whichever
   * cm/360 was under test and bends the fitted curve toward the sensitivities they chose to sit
   * through, which is a direction error. Freezing costs precision: the trial becomes two exposures
   * with a gap the player rested in, which adds noise to that one trial without moving it
   * systematically. What freezing does NOT do is disclose the interruption, and a trial that spanned
   * one deserves to widen the interval it feeds. That belongs to whoever owns the trial record.
   * Defaults to present, so a headless caller that never reports presence behaves as before.
   */
  setPresent(present: boolean): void {
    this.present = present;
  }

  /** Advance the clock by `dtMs`, move targets, and emit the frame to subscribers. */
  tick(dtMs: Ms): void {
    if (this.disposed || !this.present) return;
    // Credit at most one physically possible frame, and never a negative or NaN one: rAF hands back
    // the whole sleep on the first frame after a hidden tab, and that delta must not reach a trial.
    const dt = dtMs > 0 ? Math.min(dtMs, MAX_FRAME_MS) : 0;
    this.nowMs += dt;
    for (const t of this.moving) t.update(this.nowMs);
    this.enemies?.update(this.nowMs); // follow target positions + advance sprite animations (cosmetic)
    this.viewmodel?.tick(this.nowMs); // advance the weapon recoil/sway springs (cosmetic)
    for (const cb of this.frameCbs) cb(dt, this.nowMs);
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
    // Through the rig, which moves the vertical fov with the aspect so the HORIZONTAL field is
    // unchanged. Writing camera.aspect alone let the window's shape change the aiming task.
    this.rig.setAspect(w / Math.max(1, h));
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
    this.viewmodel?.dispose();
    for (const d of this.envDisposables) d.dispose();
    this.post?.dispose();
    this.renderer.dispose();
  }
}
