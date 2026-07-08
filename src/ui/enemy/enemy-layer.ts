import { Group, Mesh, type MeshBasicMaterial, type MeshStandardMaterial, type Object3D, type Scene } from 'three';
import type { EnemyLayer } from '../../engine/arena';
import type { Degrees, InstrumentId, Ms, TargetHandle } from '../../types';
import { ANIMATIONS, type EnemyState } from './atlas';
import { EnemyController } from './controller';
import { easeOut } from './ease';
import { classifyHit, type HitClass } from './hit';
import {
  cloneQuarryMaterials,
  createQuarryMaterials,
  disposeDust,
  dustMaterial,
  dustPuff,
  materialList,
  quarryMesh,
  quarryWorldHeight,
  WEAKSPOT_NAME,
  type QuarryMaterials,
  type QuarryMesh,
} from './meshes';
import { applySecondary } from './secondary';
import {
  createShadowBlob,
  createShadowTexture,
  disposeShadowBlob,
  SHADOW_STRETCH,
  SHADOW_WIDE,
  shadowPose,
} from './shadow';
import { applySpark, disposeSpark, sparkBurst } from './sparks';

interface EnemyRecord {
  /** The cosmetic quarry group. Its children reference THIS record's own cloned material set. */
  mesh: QuarryMesh;
  /**
   * Per-instance clone of the layer's material template. Owned by the record so opacity/emissive
   * tweens write only to THIS quarry (no last-writer-wins between coexisting quarries); disposed in
   * release(). Geometries are likewise per-group.
   */
  materials: QuarryMaterials;
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
  /** Sign (-1 | +1) of the escape sprint direction, fixed at spawn so the bolt reads consistent. */
  escapeDir: number;
  /** Which quarry silhouette this record wears (the activeEnv at spawn) - keys its secondary motion. */
  env: InstrumentId;
  /** Per-instance secondary-motion phase (spawn counter x golden angle - deterministic, no RNG). */
  phase: number;
  /** This quarry's contact-shadow blob on the grid plane, owned by the record (shared alpha texture). */
  shadow: Mesh;
}

export interface EnemyLayerHandle extends EnemyLayer {
  /** Choose which quarry subsequent spawns use (the active instrument's prey). */
  setEnvironment(id: InstrumentId): void;
}

/**
 * Golden-angle step (radians) between consecutive spawns' secondary-motion phases: coexisting
 * quarry never breathe/flap in lockstep, yet the sequence is fully deterministic (no RNG).
 */
const PHASE_STEP = 2.399963;

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
  lateral: number; // fraction of baseScale added on the camera-relative X (sideways sprint)
  yaw: number; // radians about Y
  emissive: number; // weak-spot emissiveIntensity
  opacity: number;
}

function poseFor(state: EnemyState, p: number, reduced: boolean): Pose {
  if (reduced) {
    // Reduced motion: a single static idle pose, no time-driven motion.
    return { scale: 1, lift: 0, lateral: 0, yaw: 0, emissive: 0.9, opacity: 1 };
  }
  switch (state) {
    case 'spawn': {
      const e = easeOut(p);
      return { scale: 0.4 + 0.6 * e, lift: 0, lateral: 0, yaw: (1 - e) * 0.5, emissive: 0.5 + 0.7 * e, opacity: e };
    }
    case 'idle': {
      // Gentle perpetual breathing - bounded, no bounce. p loops 0→1.
      const s = Math.sin(p * Math.PI * 2);
      return {
        scale: 1 + 0.02 * s,
        lift: 0.01 * s,
        lateral: 0,
        yaw: 0.08 * Math.sin(p * Math.PI),
        emissive: 0.85 + 0.15 * s,
        opacity: 1,
      };
    }
    case 'flinch': {
      // Quick recoil that settles back - a clipped graze, stays alive.
      const e = easeOut(p);
      const kick = Math.sin(p * Math.PI); // up then back
      return { scale: 1 - 0.06 * kick, lift: 0, lateral: 0, yaw: -0.18 * kick, emissive: 1.0 + 0.6 * (1 - e), opacity: 1 };
    }
    case 'death': {
      // Topple + sink + fade: rotates over (yaw), drops below the hitbox center (lift<0), shrinks
      // slightly + fades to nothing. Ease-out, no bounce. P3-4: the clean-kill fall-away.
      const e = easeOut(p);
      return { scale: 1 - 0.15 * e, lift: -0.45 * e, lateral: 0, yaw: 1.2 * e, emissive: 0.9 * (1 - e), opacity: 1 - e };
    }
    case 'escape': {
      // Lateral sprint-and-fade: a live quarry cleared WITHOUT a kill bolts sideways (lateral) while
      // turning away (yaw) and fading. Transform/opacity only, ease-out, no bounce. P3-4.
      const e = easeOut(p);
      return { scale: 1, lift: 0.05 * e, lateral: 1.6 * e, yaw: 0.9 * e, emissive: 0.8 * (1 - e), opacity: 1 - e };
    }
  }
}

function applyPose(rec: EnemyRecord, pose: Pose): void {
  const s = rec.baseScale * pose.scale;
  rec.mesh.scale.setScalar(s);
  rec.mesh.position.copy(rec.object.position);
  rec.mesh.position.y += rec.baseScale * pose.lift;
  // Camera-relative sideways sprint: offset along the world X axis (the dominant screen-horizontal for
  // the level rig). Cosmetic only - the scored sphere's own position is never touched.
  rec.mesh.position.x += rec.baseScale * pose.lateral * rec.escapeDir;
  rec.mesh.rotation.y = pose.yaw;
  (rec.weakspot.material as MeshStandardMaterial).emissiveIntensity = pose.emissive;
  // Opacity: fade the whole skin via material transparency (per-record clones, so no cross-stomp).
  setOpacity(rec.mesh, pose.opacity);
}

/** Set transparency on every mesh material in the group (per-record clones - no cross-stomp). */
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
  // Layer-owned material TEMPLATE: never attached to a rendered mesh - each spawn clones it so its
  // opacity/emissive tweens stay per-instance. Disposed on teardown alongside any live clones.
  const materialTemplate = createQuarryMaterials();
  // ONE shared radial-falloff alpha texture for every contact-shadow blob this layer spawns (each
  // blob owns its material for per-instance opacity, but the texture is immutable and shared).
  const shadowTexture = createShadowTexture();
  // Monotone spawn counter driving each record's deterministic secondary-motion phase.
  let spawnCount = 0;
  const enemies = new Map<string, EnemyRecord>();
  const fadeouts: EnemyRecord[] = []; // dying/escaping quarry handed off here so a new spawn/clear can't cut them short
  let activeEnv: InstrumentId = 'flick';
  let scene: Scene | null = null;
  // Last clock the layer saw (from spawn/update/fire). remove()/clear() carry no time argument, so the
  // escape one-shot they kick off starts from this - the same clock the next update() advances against.
  let lastNowMs: Ms = 0;

  // ── Pooled dust-puffs (kill punctuation) ─────────────────────────────────
  // A small fixed-capacity pool of dust groups, allocated ONCE and reused. A kill takes a free puff,
  // positions it at the fallen quarry, and animates its opacity; when it finishes it returns to the
  // pool (never re-allocated). Reduced motion never emits a puff at all.
  const DUST_POOL = 3;
  const DUST_MS = 420; // puff lifetime (ms) - a quick kick-up that settles, ease-out
  interface ActiveDust {
    group: Group;
    startMs: Ms;
  }
  const dustPool: Group[] = []; // free puffs, parked + hidden
  const activeDust: ActiveDust[] = []; // currently animating puffs
  if (!reduced) {
    for (let i = 0; i < DUST_POOL; i++) {
      const d = dustPuff();
      dustPool.push(d);
      group.add(d); // parented once; visibility toggles, never re-added/removed
    }
  }

  /** Kick up a pooled dust-puff at a world position. No-op (and no alloc) if the pool is exhausted. */
  const emitDust = (pos: { x: number; y: number; z: number }, baseScale: number, nowMs: Ms): void => {
    const d = dustPool.pop();
    if (!d) return; // pool exhausted - drop the puff rather than allocate (strict pool)
    d.position.set(pos.x, pos.y - baseScale * 0.35, pos.z);
    d.scale.setScalar(baseScale);
    d.visible = true;
    dustMaterial(d).opacity = 0;
    activeDust.push({ group: d, startMs: nowMs });
  };

  /** Advance every active puff; settle + return finished puffs to the pool (no disposal, no alloc). */
  const updateDust = (nowMs: Ms): void => {
    for (let i = activeDust.length - 1; i >= 0; i--) {
      const a = activeDust[i]!;
      const p = (nowMs - a.startMs) / DUST_MS;
      if (p >= 1) {
        a.group.visible = false;
        dustMaterial(a.group).opacity = 0;
        dustPool.push(a.group);
        activeDust.splice(i, 1);
        continue;
      }
      const e = easeOut(Math.max(0, p));
      // Fade out over the lifetime (ease-out, no bounce); position fixed at the fallen quarry's feet.
      dustMaterial(a.group).opacity = (1 - e) * 0.7;
    }
  };

  // ── Pooled impact-sparks (the gold ping at the weak-spot on a clean kill) ──
  // EXACTLY the dust-pool discipline: a small fixed pool allocated once, reused across kills, strict
  // (drop when exhausted, never allocate per kill). Reduced motion never emits a burst at all.
  const SPARK_POOL = 2;
  /** Shard throw distance as a fraction of the quarry height - a punctuation, not a firework. */
  const SPARK_SCALE_K = 0.6;
  interface ActiveSpark {
    group: Group;
    startMs: Ms;
    scale: number;
  }
  const sparkPool: Group[] = [];
  const activeSparks: ActiveSpark[] = [];
  if (!reduced) {
    for (let i = 0; i < SPARK_POOL; i++) {
      const s = sparkBurst();
      sparkPool.push(s);
      group.add(s); // parented once; visibility toggles, never re-added/removed
    }
  }

  /** Fire a pooled spark burst at the impact point. No-op (and no alloc) if the pool is exhausted. */
  const emitSpark = (pos: { x: number; y: number; z: number }, baseScale: number, nowMs: Ms): void => {
    const s = sparkPool.pop();
    if (!s) return; // strict pool - drop the burst rather than allocate
    s.position.set(pos.x, pos.y, pos.z);
    applySpark(s, 0, baseScale * SPARK_SCALE_K);
    activeSparks.push({ group: s, startMs: nowMs, scale: baseScale * SPARK_SCALE_K });
  };

  /** Advance every active burst; repool the finished ones (applySpark hides + zeroes them). */
  const updateSparks = (nowMs: Ms): void => {
    for (let i = activeSparks.length - 1; i >= 0; i--) {
      const a = activeSparks[i]!;
      if (!applySpark(a.group, nowMs - a.startMs, a.scale)) {
        sparkPool.push(a.group);
        activeSparks.splice(i, 1);
      }
    }
  };

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
    const pose = poseFor(rec.shownState, p, reduced);
    applyPose(rec, pose);
    // Per-part secondary motion, layered AFTER the group pose (the pose moves the GROUP, secondary
    // moves named CHILD parts about their captured rest - they compose, and neither ever touches the
    // weak-spot or the scored sphere). Reduced motion keeps every part at rest.
    if (!reduced) applySecondary(rec.mesh, rec.env, nowMs / 1000, rec.phase);
    // Contact shadow: pinned to the grid plane beneath the POSED quarry (so a death sink strengthens
    // it and an escape sprint drags it along), fading with the quarry's own opacity. shadowPose
    // returns null for a below-plane quarry - no blob may ever poke through the floor.
    const sp = shadowPose(rec.mesh.position, rec.baseScale);
    if (sp) {
      rec.shadow.visible = true;
      rec.shadow.position.set(sp.x, sp.y, sp.z);
      // Anisotropic: short axis = the stance footprint, long (local Y, spun onto the anti-sun
      // throw) = the dusk stretch. See shadow.ts's SHADOW_SPIN/SHADOW_THROW derivation.
      rec.shadow.scale.set(sp.scale * SHADOW_WIDE, sp.scale * SHADOW_STRETCH, 1);
      (rec.shadow.material as MeshBasicMaterial).opacity = sp.opacity * pose.opacity;
    } else {
      rec.shadow.visible = false;
    }
  };

  const release = (rec: EnemyRecord): void => {
    group.remove(rec.mesh);
    group.remove(rec.shadow);
    // Geometries AND materials are per-record (the materials are this rec's own clone of the
    // template), so both are disposed here - nothing shared leaks or is freed twice. The shadow blob
    // owns its geometry + material too (only the alpha texture is layer-shared).
    rec.mesh.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    for (const m of materialList(rec.materials)) m.dispose();
    disposeShadowBlob(rec.shadow);
  };
  const retire = (id: string, rec: EnemyRecord): void => {
    release(rec);
    enemies.delete(id);
  };

  /**
   * A live quarry cleared WITHOUT a kill: under live motion, play a one-shot ESCAPE (lateral
   * sprint-and-fade) and hand it to the fade-out set so a fresh spawn can't cut it short; under
   * reduced motion, an INSTANT static fade (retire now - no frames to play). Already-retiring quarry
   * (death/escape) are left alone. Returns true if the record was handed off (caller should not retire).
   */
  const escapeOff = (rec: EnemyRecord, nowMs: Ms): boolean => {
    if (reduced) return false; // instant static fade: caller retires immediately
    const cur = rec.ctrl.current();
    if (cur === 'death' || cur === 'escape') return true; // already in a terminal play-out
    playState(rec, 'escape', nowMs);
    fadeouts.push(rec);
    return true;
  };

  /**
   * Drive a controller state AND pin the tween clock to the play instant, so a one-shot handed to the
   * fade-out set (death/escape) animates from the moment it was triggered - not from the next update()
   * frame that first notices the transition (which would restart its phase and freeze it at p=0).
   */
  const playState = (rec: EnemyRecord, state: EnemyState, nowMs: Ms, then: EnemyState | null = null): void => {
    rec.ctrl.play(state, nowMs, then);
    rec.shownState = state;
    rec.stateStartMs = nowMs;
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
      // Each quarry gets its OWN material clone so a dying quarry fading out and a fresh spawn
      // ramping in (both rendered in the same update pass) tween independently - no shared stomping.
      const recMaterials = cloneQuarryMaterials(materialTemplate);
      const mesh = quarryMesh(activeEnv, recMaterials);
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
        materials: recMaterials,
        weakspot,
        ctrl,
        object,
        baseScale,
        shownState: ctrl.current(),
        stateStartMs: nowMs,
        // Bolt away from screen center: a quarry on the right of the arena runs right, and vice-versa
        // (so the escape never sprints back through the crosshair). Fixed at spawn.
        escapeDir: object.position.x >= 0 ? 1 : -1,
        env: activeEnv,
        phase: spawnCount * PHASE_STEP,
        shadow: createShadowBlob(shadowTexture),
      };
      spawnCount += 1;
      group.add(mesh);
      group.add(rec.shadow);
      lastNowMs = nowMs;
      render(rec, nowMs);
      enemies.set(id, rec);
    },

    update(nowMs: Ms): void {
      lastNowMs = nowMs;
      for (const [id, rec] of enemies) {
        if (!reduced && rec.ctrl.isFinished(nowMs)) {
          retire(id, rec);
          continue;
        }
        render(rec, nowMs); // follows the (possibly weaving) target via applyPose → object.position
      }
      // Dying/escaping quarry play out where they fell - independent of the live target's spawn/clear.
      for (let i = fadeouts.length - 1; i >= 0; i--) {
        const rec = fadeouts[i]!;
        if (rec.ctrl.isFinished(nowMs)) {
          release(rec);
          fadeouts.splice(i, 1);
        } else {
          render(rec, nowMs);
        }
      }
      updateDust(nowMs);
      updateSparks(nowMs);
    },

    fire(nowMs: Ms, view: [Degrees, Degrees], targets: ReadonlyArray<TargetHandle>): void {
      if (reduced) return; // no hit reactions (or miss tick) under reduced motion
      lastNowMs = nowMs;
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
          // Topple + sink + fade, pinned to the fire instant so it animates from now (not the next
          // update frame). Hand off to fadeouts: the instrument is about to clear + spawn, but the
          // death plays on.
          playState(rec, 'death', nowMs, null);
          enemies.delete(t.id);
          fadeouts.push(rec);
          // Punctuate the kill with a pooled dust-puff at the quarry's feet (reused, never allocated)
          // and a pooled gold spark burst at the weak-spot impact point - both downstream of the
          // classifyHit result already computed above, never a new signal.
          emitDust(rec.object.position, rec.baseScale, nowMs);
          emitSpark(rec.object.position, rec.baseScale, nowMs);
        } else if (cls === 'graze') {
          playState(rec, 'flinch', nowMs, 'idle');
        }
      }
      onShot?.(best); // 'miss' → the HUD flashes a miss tick; 'graze'/'kill' → the quarry itself reacts
    },

    remove(id: string): void {
      const rec = enemies.get(id);
      if (!rec) return;
      enemies.delete(id);
      // Cleared without a kill: a lateral sprint-and-fade (live) or an instant static fade (reduced).
      if (!escapeOff(rec, lastNowMs)) retire(id, rec);
    },

    clear(): void {
      for (const [id, rec] of enemies) {
        if (!escapeOff(rec, lastNowMs)) retire(id, rec);
      }
      enemies.clear();
    },

    dispose(): void {
      for (const [id, rec] of enemies) retire(id, rec);
      enemies.clear();
      for (const rec of fadeouts) release(rec);
      fadeouts.length = 0;
      // Free the pooled dust-puffs (allocated once on construction; active + free both live in `group`).
      for (const d of dustPool) disposeDust(d);
      for (const a of activeDust) disposeDust(a.group);
      dustPool.length = 0;
      activeDust.length = 0;
      // Free the pooled spark bursts the same way.
      for (const s of sparkPool) disposeSpark(s);
      for (const a of activeSparks) disposeSpark(a.group);
      sparkPool.length = 0;
      activeSparks.length = 0;
      if (scene) scene.remove(group);
      // Live + fadeout clones were disposed via release(); free the template last. The shared shadow
      // alpha texture goes last of all (every blob material referencing it is already disposed).
      for (const m of materialList(materialTemplate)) m.dispose();
      shadowTexture.dispose();
    },
  };
}
