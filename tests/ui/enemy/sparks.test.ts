import { describe, it, expect } from 'vitest';
import { AdditiveBlending, Group, Mesh, MeshBasicMaterial } from 'three';
import {
  applySpark,
  disposeSpark,
  SPARK_MS,
  SPARK_NAME,
  SPARK_SHARDS,
  sparkBurst,
  sparkMaterial,
  sparkPose,
} from '../../../src/ui/enemy/sparks';
import { hex } from '../../../src/palette';

function shardsOf(g: Group): Mesh[] {
  const out: Mesh[] = [];
  g.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
}

describe('sparkBurst factory', () => {
  it('builds a hidden named group of SPARK_SHARDS shards', () => {
    const g = sparkBurst();
    expect(g).toBeInstanceOf(Group);
    expect(g.name).toBe(SPARK_NAME);
    expect(g.visible).toBe(false);
    expect(shardsOf(g).length).toBe(SPARK_SHARDS);
  });

  it('all shards share ONE additive gold material at opacity 0 (pool-friendly, per-burst owned)', () => {
    const g = sparkBurst();
    const shards = shardsOf(g);
    const mat = shards[0].material as MeshBasicMaterial;
    expect(mat).toBeInstanceOf(MeshBasicMaterial);
    expect(`#${mat.color.getHexString()}`.toLowerCase()).toBe(hex.gold.toLowerCase());
    expect(mat.transparent).toBe(true);
    expect(mat.opacity).toBe(0);
    expect(mat.blending).toBe(AdditiveBlending);
    expect(mat.depthWrite).toBe(false);
    for (const s of shards) expect(s.material).toBe(mat);
    expect(sparkMaterial(g)).toBe(mat);
  });

  it('shard directions are deterministic unit vectors with an upward bias overall', () => {
    const a = sparkBurst();
    const b = sparkBurst();
    const dirsA = shardsOf(a).map((s) => s.userData.dir as [number, number, number]);
    const dirsB = shardsOf(b).map((s) => s.userData.dir as [number, number, number]);
    expect(dirsA).toEqual(dirsB); // no RNG - the same burst every time
    let ySum = 0;
    for (const d of dirsA) {
      const len = Math.hypot(d[0], d[1], d[2]);
      expect(len).toBeCloseTo(1, 6);
      ySum += d[1];
    }
    expect(ySum).toBeGreaterThan(0); // sparks kick UP off the impact, not down through the floor
  });

  it('exposes NO scored API', () => {
    const banned = ['bearing', 'radiusDeg', 'cm360', 'sample', 'score', 'observation', 'view'];
    const g = sparkBurst() as unknown as Record<string, unknown>;
    for (const k of banned) expect(g[k], `${k} must not exist`).toBeUndefined();
  });
});

describe('sparkPose (pure)', () => {
  it('is null outside the window', () => {
    expect(sparkPose(-1)).toBeNull();
    expect(sparkPose(SPARK_MS)).toBeNull();
    expect(sparkPose(SPARK_MS + 100)).toBeNull();
  });

  it('radius grows and opacity fades monotonically across the window', () => {
    const samples = [0, 0.25, 0.5, 0.75, 0.99].map((f) => sparkPose(f * SPARK_MS)!);
    for (const p of samples) expect(p).not.toBeNull();
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].radius).toBeGreaterThan(samples[i - 1].radius);
      expect(samples[i].opacity).toBeLessThan(samples[i - 1].opacity);
    }
  });
});

describe('applySpark driver', () => {
  it('moves every shard outward along its direction and fades the material', () => {
    const g = sparkBurst();
    expect(applySpark(g, 40, 1)).toBe(true);
    const early = shardsOf(g).map((s) => s.position.length());
    const earlyOpacity = sparkMaterial(g).opacity;
    expect(applySpark(g, 180, 1)).toBe(true);
    const late = shardsOf(g).map((s) => s.position.length());
    for (let i = 0; i < early.length; i++) expect(late[i]).toBeGreaterThan(early[i]);
    expect(sparkMaterial(g).opacity).toBeLessThan(earlyOpacity);
    expect(g.visible).toBe(true);
    disposeSpark(g);
  });

  it('scales the throw radius by the caller scale (bigger quarry, bigger burst)', () => {
    const g = sparkBurst();
    applySpark(g, 120, 1);
    const base = shardsOf(g)[0].position.length();
    applySpark(g, 120, 2.5);
    expect(shardsOf(g)[0].position.length()).toBeCloseTo(base * 2.5, 6);
    disposeSpark(g);
  });

  it('returns false at/after SPARK_MS, hiding the group and zeroing opacity for the pool', () => {
    const g = sparkBurst();
    applySpark(g, 40, 1);
    expect(g.visible).toBe(true);
    expect(applySpark(g, SPARK_MS, 1)).toBe(false);
    expect(g.visible).toBe(false);
    expect(sparkMaterial(g).opacity).toBe(0);
    disposeSpark(g);
  });
});
