import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { hex } from '../../palette';
import { easeOut } from './ease';

/**
 * PURE factory + pose driver for the pooled IMPACT-SPARK burst: a small fan of additive gold shards
 * that punctuates a clean kill at the weak-spot, sibling to the dust-puff at the quarry's feet.
 *
 * Mirrors the dustPuff pattern exactly: each burst carries its OWN material (so its opacity tween
 * never stomps a quarry or a sibling burst) and is allocated ONCE into a small layer-owned pool,
 * then reused across kills - never re-allocated per kill. Additive gold so the film pass's
 * gold-selective bloom lifts the burst without touching anything else on screen.
 *
 * COSMETIC ONLY, downstream of `classifyHit`: the layer emits a burst only for a hit class it
 * already computed. No scored API here - it never reads view()/bearing()/radiusDeg() and never
 * writes a sample/score/Observation. Pure THREE, safe to unit-test without a WebGL context.
 * Reduced motion never emits a burst at all (the layer's decision, same as dust).
 */

/** Name of a pooled spark-burst group. */
export const SPARK_NAME = 'impact-spark';

/** Burst lifetime (ms) - a sharp metallic ping, shorter than the dust settle. */
export const SPARK_MS = 240;

/** Shards per burst. Small + fixed - a punctuation mark, not a firework. */
export const SPARK_SHARDS = 5;

function parseHex(h: string): number {
  return parseInt(h.replace('#', ''), 16);
}


/**
 * Build ONE pooled spark burst: SPARK_SHARDS tiny gold planes fanned at DETERMINISTIC angles (an
 * index-derived fan with a slight upward bias - no RNG, the same burst every time). Each shard
 * stores its unit throw direction in `userData.dir`; `applySpark` positions shards along it.
 */
export function sparkBurst(): Group {
  const mat = new MeshBasicMaterial({
    color: parseHex(hex.gold),
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const g = new Group();
  g.name = SPARK_NAME;
  for (let i = 0; i < SPARK_SHARDS; i++) {
    const a = (i / SPARK_SHARDS) * Math.PI * 2 + 0.4;
    // Fan mostly in the local XY plane with a +y bias, so the burst kicks UP and OUT off the
    // impact point rather than down through the quarry.
    const raw: [number, number, number] = [Math.cos(a), Math.sin(a) + 0.55, 0.2 * Math.cos(a * 2)];
    const len = Math.hypot(raw[0], raw[1], raw[2]);
    const dir: [number, number, number] = [raw[0] / len, raw[1] / len, raw[2] / len];
    const shard = new Mesh(new PlaneGeometry(0.05, 0.015), mat);
    shard.rotation.z = a; // long axis roughly along the throw
    shard.userData.dir = dir;
    g.add(shard);
  }
  g.visible = false;
  return g;
}

/**
 * PURE burst pose at `elapsedMs` since the kill: shards fly outward (ease-out - fast leave, soft
 * stop) while the whole burst fades linearly. Null outside the window (the caller repools).
 */
export function sparkPose(elapsedMs: number): { radius: number; opacity: number } | null {
  if (elapsedMs < 0 || elapsedMs >= SPARK_MS) return null;
  const e = elapsedMs / SPARK_MS;
  return { radius: 0.15 + 0.85 * easeOut(e), opacity: 1 - e };
}

/**
 * Drive one pooled burst: place every shard at `dir * radius * scale` and set the burst opacity.
 * Returns false once the burst has finished - the group is hidden + zeroed for the pool and the
 * caller must stop driving it (rest+offset semantics; nothing accumulates between frames).
 */
export function applySpark(group: Group, elapsedMs: number, scale: number): boolean {
  const pose = sparkPose(elapsedMs);
  if (!pose) {
    group.visible = false;
    sparkMaterial(group).opacity = 0;
    return false;
  }
  group.visible = true;
  sparkMaterial(group).opacity = pose.opacity;
  for (const child of group.children) {
    const shard = child as Mesh;
    const dir = shard.userData.dir as [number, number, number];
    shard.position.set(dir[0] * pose.radius * scale, dir[1] * pose.radius * scale, dir[2] * pose.radius * scale);
  }
  return true;
}

/** The single shared material of a burst group (for opacity tweens + disposal). */
export function sparkMaterial(g: Group): MeshBasicMaterial {
  return (g.children[0] as Mesh).material as MeshBasicMaterial;
}

/** Dispose a burst's geometry + its shared material (called once per pooled burst on teardown). */
export function disposeSpark(g: Group): void {
  g.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
  sparkMaterial(g).dispose();
}
