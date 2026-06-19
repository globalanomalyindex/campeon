import { WebGLRenderer } from 'three';
import { Arena, type InputSource } from '../engine/arena';
import { createPsxPass } from '../engine/psx-pass';
import { createPointerLock } from '../input/pointer-lock';
import { mulberry32 } from '../stats/rng';
import { createViewmodel3D, asViewmodelLayer } from './viewmodel/viewmodel-3d';
import { createEnemyLayer, type EnemyLayerHandle } from './enemy/enemy-layer';
import { createShotFeedback } from './feedback';
import type { AnimName } from './viewmodel/atlas';
import type { InstrumentId } from '../types';

export interface ArenaStage {
  readonly arena: Arena;
  /** Request pointer lock (resolves on lock / rejects if denied). Wire to a user click. */
  requestLock(): Promise<unknown>;
  /** Release pointer lock (hand the cursor back, e.g. to click the dialed-in panel). */
  exitLock(): void;
  /** Live sensitivity change (range nudge) → arena.setSensitivity at the fixed dpi. */
  setCm360(cm360: number): void;
  /** Skin subsequent target spawns with an environment's prey sheet (null-safe if not yet loaded). */
  setEnemyEnvironment(id: InstrumentId): void;
  /** Play a viewmodel animation (null-safe). */
  playViewmodel(name: AnimName, then?: AnimName | null): void;
  /** Resolves once the async viewmodel + enemy layers have attached. */
  readonly ready: Promise<void>;
  dispose(): void;
}

/**
 * The shared PSX arena + cosmetic stack used by BOTH the scored session and the free-play range. Owns
 * the renderer, PSX pass, pointer-lock, Arena, the async Deagle viewmodel + merc-prey enemy layer, the
 * sway + fire-recoil feeds, the miss-tick feedback, the rAF loop, resize, and full teardown. The
 * consumer screen owns its own DOM (passes in its canvas + host) and its own gameplay logic (instrument
 * loop, or range director). Runtime-only (WebGL + image decode) - verified in Chromium, not unit tests.
 */
export function createArenaStage(
  host: HTMLElement,
  opts: { canvas: HTMLCanvasElement; cm360: number; dpi: number; reducedMotion: boolean; rngSeed?: number },
): ArenaStage {
  const { canvas, cm360, dpi, reducedMotion } = opts;
  let alive = true;
  let enemies: EnemyLayerHandle | null = null;

  const feedback = createShotFeedback(host); // brief "miss" tick when a shot lands in no hitbox

  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const size = (): [number, number] => [window.innerWidth, window.innerHeight];
  const psx = createPsxPass(renderer, size); // PS1 abyss: low-res + dither + posterize + scanlines
  const pointer = createPointerLock(canvas);
  const input: InputSource = { onSample: (cb) => pointer.onSample(cb), onFire: (cb) => pointer.onFire(cb) };
  const arena = new Arena({ renderer, input, size, cm360, dpi, rng: mulberry32(opts.rngSeed ?? 7), postProcessor: psx });

  // The in-scene 3D revolver attaches through the arena's viewmodel seam (mirrors attachEnemies):
  // the arena drives its look/fire/tick from the rig camera + fire events, so its recoil/sway springs
  // run inside arena.tick - no separate rAF tick, no DOM overlay. Cosmetic: it never touches cm/360.
  const ready = Promise.all([
    Promise.resolve(createViewmodel3D({ reducedMotion })).then((vm) => {
      if (!alive) { vm.dispose(); return; }
      arena.attachViewmodel(asViewmodelLayer(vm)); // arena owns it: arena.dispose() disposes it
    }),
    createEnemyLayer({ reducedMotion, onShot: (r) => { if (r === 'miss') feedback.miss(); } }).then((layer) => {
      if (!alive) { layer.dispose(); return; }
      enemies = layer;
      arena.attachEnemies(layer); // arena.dispose() will dispose it
    }),
  ]).then(() => undefined);

  const onResize = (): void => arena.resize();
  window.addEventListener('resize', onResize);
  let last = 0;
  let raf = window.requestAnimationFrame(function loop(ts: number): void {
    const dt = last === 0 ? 16 : ts - last; last = ts;
    arena.tick(dt); arena.render();
    raf = window.requestAnimationFrame(loop);
  });

  return {
    arena,
    requestLock: () => pointer.request(),
    exitLock: () => pointer.exit(),
    setCm360: (next) => arena.setSensitivity(next, dpi),
    setEnemyEnvironment: (id) => enemies?.setEnvironment(id),
    // The 3D revolver reacts only to fire/look (no named draw/idle sprite animations). Kept as a
    // null-safe no-op so the session-view reveal call site stays byte-compatible; the holster-draw
    // reveal is a Chromium feel pass on the 3D weapon (see humanVerifyNotes), not a sprite animation.
    playViewmodel: (_name, _then = null) => {},
    ready,
    dispose() {
      alive = false;
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      feedback.dispose();
      // The arena owns the attached viewmodel's disposal (mirrors the enemy layer); arena.dispose()
      // disposes it. Disposing it here too would double-free the gun's geometry/materials.
      pointer.dispose();
      arena.dispose();
    },
  };
}
