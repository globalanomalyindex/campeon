import { Group, Mesh, type MeshStandardMaterial, type Object3D, type Scene } from 'three';
import type { EnemyLayer } from '../../engine/arena';
import type { Degrees, InstrumentId, Ms, TargetHandle } from '../../types';
import { ANIMATIONS, type EnemyState } from './atlas';
import { EnemyController } from './controller';
import { classifyHit, type HitClass } from './hit';
import {
  createQuarryMaterials,
  materialList,
  quarryMesh,
  quarryWorldHeight,
  WEAKSPOT_NAME,
  type QuarryMesh,
} from './meshes';

interface EnemyRecord {
  /** The cosmetic quarry group (children share QUARRY_MATERIALS - never disposed per-record). */
  mesh: QuarryMesh;
  /** Emissive weak-spot at the group origin, pulsed/flared by the state tweens. */
  weakspot: Mesh;
  ctrl: EnemyController;
  object: Object3D;
  /** Uniform world height (the scale the group is tweened around). */
  baseScale: number;
  /** The state we last saw the controller in, so we can reset the tween clock on a transition. */
  shownState: EnemyState;
  /** When the currently-shown state began (for the tween phase). */
  stateStartMs: Ms;
}

export interface EnemyLayerHandle extends EnemyLayer {
  /** Choose which quarry subsequent spawns use (the active instrument's prey). */
  setEnvironment(id: InstrumentId): void;
}

/** Ease-out cubic - strong settle, no bounce (matches the brand motion rule). */
const easeOut = (t: number): number => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);

/** A state's nominal duration (ms) from the shared animation contract; loops report their cycle. */
function stateDurationMs(state: EnemyState): number {
  const a = ANIMATIONS[state];
  const frames = a.to - a.from + 1;
  return (frames / a.fps) * 1000;
}

/**
 * Per-state COSMETIC pose for a quarry, expressed as transform/opacity/emissive only (no UV, no
 * layout animation): a normalized progress `p` in [0,1] across the state maps to a uniform scale
 * factor about the weak-spot origin, a vertical lift, a slight yaw, and a weak-spot emissive
 * intensity. The hidden gold sphere (the scored owner) is untouched - this only moves the skin.
 */
interface Pose {
  scale: number; // multiple of baseScale
  lift: number; // fraction of baseScale added on Y
  yaw: number; // radians about Y
  emissive: number; // weak-spot emissiveIntensity
  opacity: number;
}

function poseFor(state: EnemyState, p: number, reduced: boolean): Pose {
  if (reduced) {
    // Reduced motion: a single static idle pose, no time-driven motion.
    return { scale: 1, lift: 0, yaw: 0, emissive: 0.9, opacity: 1 };
  }
  switch (state) {
    case 'spawn': {
      const e = easeOut(p);
      return { scale: 0.4 + 0.6 * e, lift: 0, yaw: (1 - e) * 0.5, emissive: 0.5 + 0.7 * e, opacity: e };
    }
    case 'idle': {
      // Gentle perpetual breathing - bounded, no bounce. p loops 0→1.
      const s = Math.sin(p * Math.PI * 2);
      return { scale: 1 + 0.02 * s, lift: 0.01 * s, yaw: 0.08 * Math.sin(p * Math.PI), emissive: 0.85 + 0.15 * s, opacity: 1 };
    }
    case 'flinch': {
      // Quick recoil that settles back - a clipped graze, stays alive.
      const e = easeOut(p);
      const kick = Math.sin(p * Math.PI); // up then back
      return { scale: 1 - 0.06 * kick, lift: 0, yaw: -0.18 * kick, emissive: 1.0 + 0.6 * (1 - e), opacity: 1 };
    }
    case 'death': {
      // Topple + sink + fade (P3-4 will refine; first-pass keeps it a clean fall-away).
      const e = easeOut(p);
      return { scale: 1 - 0.15 * e, lift: -0.45 * e, yaw: 1.2 * e, emissive: 0.9 * (1 - e), opacity: 1 - e };
    }
    case 'escape': {
      // Lateral sprint-and-fade.
      const e = easeOut(p);
      return { scale: 1, lift: 0, yaw: 0.6 * e, emissive: 0.8 * (1 - e), opacity: 1 - e };
    }
  }
}

function applyPose(rec: EnemyRecord, pose: Pose): void {
  const s = rec.baseScale * pose.scale;
  rec.mesh.scale.setScalar(s);
  rec.mesh.position.copy(rec.object.position);
  rec.mesh.position.y += rec.baseScale * pose.lift;
  rec.mesh.rotation.y = pose.yaw;
  (rec.weakspot.material as MeshStandardMaterial).emissiveIntensity = pose.emissive;
  // Opacity: fade the whole skin via material transparency (shared materials, so set per-frame).
  setOpacity(rec.mesh, pose.opacity);
}

/** Set transparency on every mesh material in the group (shared materials - last writer wins). */
function setOpacity(g: Group, opacity: number): void {
  g.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as MeshStandardMaterial;
    m.opacity = opacity;
    m.transparent = opacity < 1;
  });
}

/**
 * COSMETIC quarry layer - procedural 3D "designed-quarry" meshes that skin each arena target. It is
 * pure decoration over the true target: the arena keeps every target's gold sphere as the owner of
 * `bearing()` / `radiusDeg()` (the angular truth the instruments score against) and merely hides it,
 * pinning a `THREE.Group` (built by the pure `meshes.ts` factory) at the same world position. Hits
 * drive only animation via the read-only `classifyHit`; nothing here ever writes a sample or a score,
 * so the cm/360 stays exact.
 *
 * The group is centered on its emissive weak-spot at the LOCAL ORIGIN, coincident with the sphere
 * center, and scaled to `ENEMY_SIZE_K x` the hitbox diameter (`worldRadius = dist*tan(radiusDeg)`)
 * EXACTLY as the sprite billboard was. States (spawn / idle / flinch; death / escape land in P3-4)
 * are driven by the unchanged `EnemyController` and rendered as transform / opacity / emissive tweens.
 *
 * The factory stays async (and the signature unchanged) so the arena-stage / harness call sites and
 * the sprite fallback path are byte-compatible; procedural geometry needs no async work, so it
 * resolves immediately.
 */
export async function createEnemyLayer(
  opts: { reducedMotion?: boolean; onShot?: (result: HitClass) => void } = {},
): Promise<EnemyLayerHandle> {
  const reduced = opts.reducedMotion ?? false;
  const onShot = opts.onShot;

  const group = new Group();
  group.name = 'enemy-layer';
  // One layer-owned material set shared across this layer's spawns + disposed on teardown.
  const materials = createQuarryMaterials();
  const enemies = new Map<string, EnemyRecord>();
  const fadeouts: EnemyRecord[] = []; // dying quarry handed off here so a new spawn/clear can't cut them short
  let activeEnv: InstrumentId = 'flick';
  let scene: Scene | null = null;

  /** Advance the controller, detect a state transition, and apply the matching tween pose. */
  const render = (rec: EnemyRecord, nowMs: Ms): void => {
    const frame = reduced ? rec.ctrl.staticFrame() : rec.ctrl.frameAt(nowMs);
    if (frame.state !== rec.shownState) {
      rec.shownState = frame.state;
      rec.stateStartMs = nowMs;
    }
    const dur = stateDurationMs(rec.shownState);
    const elapsed = nowMs - rec.stateStartMs;
    const loop = ANIMATIONS[rec.shownState].loop;
    const p = reduced ? 1 : loop ? (elapsed % dur) / dur : Math.min(1, elapsed / dur);
    applyPose(rec, poseFor(rec.shownState, p, reduced));
  };

  const release = (rec: EnemyRecord): void => {
    group.remove(rec.mesh);
    // Geometries are per-group (cheap primitives); materials are SHARED and disposed once on dispose().
    rec.mesh.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
  };
  const retire = (id: string, rec: EnemyRecord): void => {
    release(rec);
    enemies.delete(id);
  };

  return {
    setEnvironment(id: InstrumentId): void {
      activeEnv = id;
    },

    attach(s: Scene): void {
      scene = s;
      s.add(group);
    },

    spawn(id: string, object: Object3D, radiusDeg: number, nowMs: Ms): void {
      const mesh = quarryMesh(activeEnv, materials);
      const weakspot = mesh.getObjectByName(WEAKSPOT_NAME) as Mesh;
      // Size to the hitbox: world height = K × the hitbox diameter (worldRadius = dist·tan(radiusDeg)),
      // EXACTLY as the sprite billboard. Aiming at the quarry lands in the hitbox; a small-width flick
      // target gets a small quarry.
      const dist = object.position.length() || 20;
      const baseScale = quarryWorldHeight(dist, radiusDeg);
      mesh.position.copy(object.position);
      // Reduced motion: a static idle pose, no spawn burst, no follow-up.
      const ctrl = new EnemyController(reduced ? 'idle' : 'spawn', nowMs, reduced ? null : 'idle');
      const rec: EnemyRecord = {
        mesh,
        weakspot,
        ctrl,
        object,
        baseScale,
        shownState: ctrl.current(),
        stateStartMs: nowMs,
      };
      group.add(mesh);
      render(rec, nowMs);
      enemies.set(id, rec);
    },

    update(nowMs: Ms): void {
      for (const [id, rec] of enemies) {
        if (!reduced && rec.ctrl.isFinished(nowMs)) {
          retire(id, rec);
          continue;
        }
        render(rec, nowMs); // follows the (possibly weaving) target via applyPose → object.position
      }
      // Dying quarry play out where they fell - independent of the live target's spawn/clear.
      for (let i = fadeouts.length - 1; i >= 0; i--) {
        const rec = fadeouts[i]!;
        if (rec.ctrl.isFinished(nowMs)) {
          release(rec);
          fadeouts.splice(i, 1);
        } else {
          render(rec, nowMs);
        }
      }
    },

    fire(nowMs: Ms, view: [Degrees, Degrees], targets: ReadonlyArray<TargetHandle>): void {
      if (reduced) return; // no hit reactions (or miss tick) under reduced motion
      let best: HitClass = 'miss';
      for (const t of targets) {
        const cls = classifyHit(view, t.bearing(), t.radiusDeg());
        if (cls === 'kill') best = 'kill';
        else if (cls === 'graze' && best !== 'kill') best = 'graze';
        const rec = enemies.get(t.id);
        if (!rec) continue;
        const cur = rec.ctrl.current();
        if (cur === 'death' || cur === 'escape') continue; // already retiring
        if (cls === 'kill') {
          rec.ctrl.play('death', nowMs, null);
          // Hand off to fadeouts: the instrument is about to clear + spawn, but the death plays on.
          enemies.delete(t.id);
          fadeouts.push(rec);
        } else if (cls === 'graze') {
          rec.ctrl.play('flinch', nowMs, 'idle');
        }
      }
      onShot?.(best); // 'miss' → the HUD flashes a miss tick; 'graze'/'kill' → the quarry itself reacts
    },

    remove(id: string): void {
      const rec = enemies.get(id);
      if (rec) retire(id, rec); // a still-live record (e.g. reduced motion, where fire() never fades it out)
    },

    clear(): void {
      for (const [id, rec] of enemies) retire(id, rec);
      enemies.clear();
    },

    dispose(): void {
      for (const [id, rec] of enemies) retire(id, rec);
      enemies.clear();
      for (const rec of fadeouts) release(rec);
      fadeouts.length = 0;
      if (scene) scene.remove(group);
      for (const m of materialList(materials)) m.dispose();
    },
  };
}
